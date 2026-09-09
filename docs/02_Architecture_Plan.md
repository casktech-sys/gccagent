# Architecture Plan — Warrant

**Version:** 1.0 · 2026-09-08

---

## 1. System shape

```
                       ┌──────────────────────────────┐
   principal ─────────▶│  Mandate  (declarative)      │
   (human)             │  versioned, typed clauses    │
                       └───────────────┬──────────────┘
                                       │  read-only to the agent
                                       ▼
  incoming     ┌────────┐   ┌──────────────────┐   ┌──────────────┐
  envelope ───▶│ POLICY │──▶│  AUTHORISATION   │──▶│    DRAFT     │──▶ outgoing
  (untrusted)  │ det.   │   │  ENGINE  det.    │   │  model  prob.│    envelope
               └────────┘   └────────┬─────────┘   └──────────────┘
                                     │ escalate
                                     ▼
                            ┌──────────────────┐
                            │ PRINCIPAL DESK   │  scoped, single-use approval
                            └────────┬─────────┘
                                     ▼
                  ┌───────────────────────────────────────┐
                  │ LEDGER  append-only, hash-chained     │
                  │ utterance · decision · blocked ·      │
                  │ escalation · approval · commitment ·  │
                  │ settlement · injection_flag           │
                  └───────────────────────────────────────┘
```

The critical property is **ordering**: authorisation precedes generation. The model is downstream of the decision, never upstream of it.

---

## 2. Architecture Decision Records

### ADR-001 — Deterministic authorisation, not LLM judgement
**Status:** Accepted · **Module:** `engine.py`

The model drafts; a rules engine authorises. `authorise()` is pure: same mandate + same offer → same decision, always. Tested with 50 repetitions asserting a single distinct outcome.

*Rejected alternative:* LLM-as-judge for mandate compliance. Cheaper to build, produces no authority chain, and fails the only question that matters after a dispute — *who authorised this?*

**Sub-decision:** binding vs non-binding actions are distinguished. `AUTO_COMMIT_MAX` applies only to `ACCEPT`. An agent may *negotiate* above its unattended-commit limit; it may not *close* above it. Without this, agents escalate on every turn and the product is unusable.

---

### ADR-002 — Three-stage agent turn
**Status:** Accepted · **Module:** `agent.py`

`propose()` → `authorise()` → `draft()`. Stages 1 and 2 are deterministic; stage 3 is probabilistic and runs last, on an already-authorised offer.

Consequence: the block at a mandate breach happens *before generation reaches the wire*. Nothing unauthorised is ever written, let alone sent. Contrast with post-hoc filtering, where the model has already produced the offending text and the system is reduced to hoping the filter catches it.

---

### ADR-003 — Provider selection is policy, not a client
**Status:** Accepted · **Module:** `providers.py`

Routing is driven by `(task_class, tenant_jurisdiction)`. Sensitive classes prefer frontier tier; high-volume classes prefer cost-efficient. One `OpenAICompatProvider` adapter covers OpenAI, DeepSeek, Qwen, GLM, Mistral, and self-hosted vLLM — most cost-efficient models speak the same wire format.

**Residency refuses, never downgrades.** If no provider offers inference in the tenant's permitted regions and cross-border is disabled, `NoCompliantProviderError` is raised. Silent fallback to a non-compliant provider would be the exact failure a residency control exists to prevent.

Every routing decision is recorded with its eligible pool, so "why did this tenant's data go there" is answerable.

---

### ADR-004 — Hash-chained append-only ledger
**Status:** Accepted · **Module:** `ledger.py`

Each entry carries `prev_hash` and a SHA-256 over `(prev, seq, type, actor, payload)`. `verify()` recomputes the chain and returns the first bad sequence number. Retroactive edits are detectable, which is the difference between an audit ledger and a log file.

Commitment authority is taken from each agent's **final** decision in the thread — the authority under which the binding position was actually held, not the union of everything ever true during negotiation.

*MVP limitation, stated:* in-memory + JSONL. Not tamper-*proof*, only tamper-*evident*, and only against an actor without write access to the whole chain. Postgres with append-only grants is the block B5 answer.

---

### ADR-005 — Two-layer counterparty containment
**Status:** Accepted · **Module:** `injection.py`

**L1 structural (load-bearing):** the engine reads only typed fields. Counterparty prose is never parsed for intent and can never widen a mandate.

**L2 detection (defence in depth):** prose is wrapped in a delimited untrusted-data block with delimiter neutralisation, and scanned for directive patterns. Detections are **flagged to the ledger, not silently stripped**.

The key test asserts that authorisation outcomes are *identical* for a benign and a hostile envelope carrying the same offer. That is a structural guarantee, not a filter's success rate.

---

### ADR-006 — Scoped, single-use approvals
**Status:** Accepted · **Modules:** `models.py`, `engine.py`

A human tap produces an `Approval` with a scope (`full` / `price_only` / `terms_only`) that waives only the clause kinds inside `_SCOPE_COVERAGE`. It is single-use and does **not** amend the mandate for future turns.

This is why the reference scenario matters: Omar approves *price only*, the terms breach survives, and the agent repairs terms mechanically back inside its own allowlist. The narrow approval stayed narrow.

**Mechanical repair before escalation:** `revise_within_mandate()` fixes allowlist substitutions the agent can resolve alone, and never touches a price or a limit. Escalation rate is the product's core metric; not every breach deserves a human.

---

### ADR-007 — Postgres-shaped storage seam, in-memory for MVP
**Status:** Accepted

`Ledger` and `Wallets` are the only stateful objects. Both are adapter-shaped. This is transactional, relational, append-only data — a vector store would be the wrong instinct here and is deliberately absent.

---

### ADR-008 — Offline determinism as a test requirement
**Status:** Accepted · **Module:** `providers.py`

`MockProvider` produces narrative prose only, never the structured offer. The entire suite and the full simulation run with no API key. A governance system whose tests depend on a probabilistic external service cannot make claims about its own behaviour.

---

### ADR-009 — Resumption by deterministic replay
**Status:** Accepted · **Module:** `session.py`

A negotiation must stop at an escalation and wait, possibly for hours. The orchestrator is a synchronous loop, so the usual answers are a coroutine or a persisted continuation. Both add machinery.

Because policy and authorisation are deterministic (ADR-001, ADR-002), a third option exists: **re-run the thread from the beginning with the approvals gathered so far.** Every earlier escalation recurs identically and is answered from the store; the run advances to the first unanswered one and pauses there.

This is only sound because the system is deterministic, so it doubles as a continuous proof of that property — if a replay ever diverged, the claim the product rests on would be false.

Escalations are matched across replays by **content signature** (principal, mandate ref, offer, breached clause IDs), not by ID. IDs are generated fresh each run; the situation is not.

*Cost, stated:* replay is O(turns) per decision. Fine at negotiation length; a long-running thread would want a persisted continuation instead. Named as a scaling limit rather than hidden.

---

### ADR-010 — Approval scopes are offered, not enumerated
**Status:** Accepted · **Module:** `session.py`

The backend computes which scopes would actually change the outcome for *this* block and offers only those. A principal never sees "approve the terms only" when no terms clause was breached. Removing meaningless choices is part of making authority legible.

---

### ADR-011 — Two renderings of every fact, produced where the fact is known
**Status:** Accepted · **Modules:** `engine.py`, `session.py`, `console/src/detail.tsx`

The console has two readers with incompatible needs. A haulier deciding something at 6am wants a sentence. An assessor reading the same screen wants the clause identifier, the authority chain and the hash.

Writing for one fails the other, and translating at display time would make the interface parse the audit record — the wrong dependency direction. So `Breach` carries both `explanation` (precise, goes in the ledger) and `plain` (English, goes on screen), each produced at the point the breach is detected. The interface never derives one from the other.

On top of that, a single **detail switch** in the header reveals identifiers, authority chains and hashes throughout. Nothing is hidden; it is one click away and the switch is not buried.

*Why this is an architecture decision and not styling:* the plain sentence needs the mandate's currency, units and list price to read naturally. Only the engine has all three at the moment of evaluation. Pushing that job to the frontend would mean shipping mandate internals to the client purely for phrasing.

*Failure mode this created, and the fix:* both renderings have to survive every hop. The first implementation produced `plain` correctly and then dropped it when writing the `blocked` ledger entry, so the console fell back to audit wording. Anywhere a `Breach` is serialised, both fields go with it — asserted by test rather than left to review.

---

## 3. Module map

| Module | Responsibility | Deterministic |
|---|---|---|
| `models.py` | Typed domain objects; residency enums | ✓ |
| `engine.py` | Authorisation, clause evaluation, authority chains | ✓ |
| `agent.py` | Negotiation policy, mandate repair, drafting call | policy ✓ / draft ✗ |
| `negotiation.py` | Turn loop, escalation routing, commitment creation | ✓ |
| `ledger.py` | Hash chain, replay, double-entry wallets | ✓ |
| `providers.py` | Provider adapters, residency-aware routing | ✓ |
| `injection.py` | Counterparty containment | ✓ |
| `scenarios.py` | The freight scenario — the only file that knows the trade | ✓ |
| `session.py` | Resumable threads, replay, gauge data shaping | ✓ |
| `api.py` | HTTP surface | — |
| `console/` | React console: deals, rules, record, safety | — |
| `console/src/detail.tsx` | Plain-by-default, technical-on-demand switch | — |
| `console/src/tour.tsx` | Walkthrough: step derived from state, anchored to the control | — |

---

## 4. Data model summary

**Mandate** → `mandate_id`, `version`, `tenant_id`, `principal`, `role`, `list_price`, `clauses[]`
**Clause** → `clause_id`, `kind`, `value`, `on_breach` (`escalate` | `reject`)

Clause kinds: `price_max`, `price_min`, `auto_commit_max`, `discount_max_pct`, `terms_allowlist`, `date_window`, `qty_max`, `counterparty_verified`.

`Offer.quantity` is unitless to the engine — a cap is a cap whether the units are trucks, pallets or hours. `Offer.unit` and `Mandate.subject` exist only so the interface can say "3 trucks on the Jebel Ali–Riyadh lane" instead of "3".

**Envelope** (the wire) → `intent`, `offer` *(typed — engine reads this)*, `narrative` *(prose — engine never reads this)*

**Decision** → `outcome`, `authorising_clauses[]`, `breaches[]`, `amendments_applied[]`

**LedgerEntry** → `seq`, `entry_type`, `actor`, `payload`, `prev_hash`, `entry_hash`

Registry-driven extensibility: a new clause kind requires an enum value plus one branch in `_check()`. No changes to the agent, orchestrator, ledger, or API.

---

## 5. Known limitations

| Limitation | Honest framing |
|---|---|
| In-memory state | Storage seam is clean; Postgres is block B5, not a rewrite |
| Tamper-evident, not tamper-proof | Correct claim for a single-writer chain; anchoring is future work |
| Negotiation policy is simple | Deliberate — the policy is *replaceable*; the authority model is the artifact |
| Injection patterns are English-only | L2 is defence in depth; L1 carries the guarantee |
| Escalation rate unmeasured | Needs real mandates; named as the make-or-break metric |
| No auth / multi-tenancy | Tenant model exists; enforcement is block B6 |

---

## 6. Interview talking points

1. **"Why deterministic authorisation?"** Because a commitment must have a provable authority chain, and a probabilistic system cannot produce one. Then show a commitment and read its chain aloud.
2. **"How do you handle prompt injection between agents?"** Structurally — the model never holds the power to widen a mandate. Then show the test asserting identical outcomes for benign and hostile inputs.
3. **"How do you stop the agent escalating constantly?"** Binding vs non-binding actions, plus mechanical in-mandate repair. Escalation rate is the metric that decides whether the product works.
4. **"What about GCC data sovereignty?"** It's at least four regimes, not one — UAE federal PDPL, DIFC, ADGM, Saudi NDMO. So residency is a tenant-scoped policy binding both storage and inference routing, and it refuses rather than downgrades.
5. **"How does a thread wait hours for a human?"** It replays. Determinism makes resumption free, and the replay is itself a standing test of the determinism claim. Then name the scaling limit out loud.
6. **"Who is this interface for?"** A non-technical owner, by default — plain sentences, no identifiers, no protocol vocabulary. The engineering view is one switch away, because the assessor is a second reader with opposite needs. Serving both without compromising either is the design argument.
7. **"What did you get wrong?"** In-memory ledger is tamper-evident, not tamper-proof, and I say so rather than overclaiming. The negotiation policy is deliberately naive because it is the replaceable part.
