# Master Brief — Warrant

**Working name:** Warrant *(a warrant is an instrument of delegated authority — suggestive, not descriptive. Not trademark-cleared; see Open Questions.)*
**Owner:** Kaliraj — sole author, sole IP holder
**Status:** MVP core and console complete and runnable. Blocks B4–B6, B8–B10 open.
**Version:** 1.0 · 2026-09-08

---

## 1. Why this exists

Two purposes, in priority order:

1. **Portfolio evidence.** A public, runnable artifact demonstrating agent orchestration, multi-provider abstraction, permission systems, auditability, and regional data governance. This closes the largest gap in the existing portfolio — the ISO 42001 compliance agent is a retrieval-and-advice system; it does not *act*.
2. **Application asset** for a GCC agentic-platform contract. The artifact is submitted as demonstrated work. It is built under the author's own name and remains the author's property regardless of engagement outcome.

**Explicit non-goal:** this is not a product launch. Success is a defensible architecture with a legible authority model, not user adoption.

---

## 2. Product thesis

A two-sided marketplace where the participants are **agents**, not listings.

A **principal** — individual or business — defines a **mandate**: a declarative envelope stating what their agent may say, offer, commit to, and spend. The agent is published, then transacts with humans or with other principals' agents inside those bounds. Anything outside the mandate stops and escalates to the human.

**The demonstration:** a buyer's agent and a seller's agent negotiate overnight. Both principals wake to either a completed transaction with a replayable audit trail, or an approval request at the exact point authority ran out.

### The five load-bearing capabilities

| # | Capability | Realised as |
|---|---|---|
| 1 | Mandate definition | Versioned, typed clause set (`Mandate`, `Clause`) |
| 2 | Delegated execution | Three-stage agent turn: policy → authorise → draft |
| 3 | Escalation | `EscalationRequest` + scoped, single-use `Approval` |
| 4 | Commitment ledger | Hash-chained append-only log with authority chains |
| 5 | Settlement | Double-entry token wallet against a recorded commitment |

---

## 3. The architectural claim

> **The language model drafts. A deterministic engine decides.**

No proposed action reaches the wire without passing `AuthorisationEngine.authorise()`, which contains no model call, no probabilistic step, and no free-text parsing. Consequently every commitment carries a machine-checkable authority chain: the clause IDs that permitted it plus any human approvals consumed.

An agent that decides its own limits with an LLM cannot produce that chain — and has no defence when a commitment is disputed.

This is the single idea the whole artifact exists to demonstrate. Everything else is scaffolding.

### Corollary: prompt injection is structurally defeated, not filtered

In agent-to-agent negotiation the counterparty is an adversarial channel. Because the engine reads only typed fields and never counterparty prose, a *fully successful* injection still cannot authorise an action — the model does not hold that power to give away. Pattern detection exists as a second layer and flags to the ledger rather than silently stripping, because suppressing evidence of an attack is itself a governance failure.

---

## 4. Scope

### In scope (MVP)

- Mandate schema and deterministic enforcement
- Agent-to-agent negotiation over a structured envelope
- Escalation with scoped partial approval (`full` / `price_only` / `terms_only`)
- Mechanical in-mandate repair before troubling a human
- Hash-chained commitment + audit ledger with thread replay
- Double-entry simulated settlement
- Multi-provider routing (frontier / cost-efficient / offline mock), policy-driven
- Residency-aware routing that **refuses** rather than silently downgrading
- Counterparty injection containment, two layers, tested
- HTTP API + offline simulation runner
- Resumable threads: pause at an escalation, resume on a human decision, by deterministic replay
- Console: negotiation view, scoped escalation decisions, mandate editor, ledger explorer with chain verification, containment demonstrator

### Out of scope — documented, not silently deferred

| Item | Reason |
|---|---|
| Real payment rails, KYC/AML | Regulated; needs an entity and counsel |
| Agent reputation / dispute resolution | Second-order; needs volume to design honestly |
| Multi-region production deployment | Residency is designed for, single region deployed |
| Persistent multi-tenant auth | Storage seam exists; auth is block B6. The console runs on in-memory state until then — a recorded trade, made because the brief assesses visible work |
| Long-horizon agent memory | Thread-scoped state only in MVP |
| Mobile / native clients | Web only |

---

## 5. Success criteria

The MVP is done when a reviewer can, in under ten minutes:

1. Run one command offline, with no API key, and see a full negotiation with two escalations and a settled commitment
2. Read a commitment and name every clause and human approval that authorised it
3. Tamper with one ledger entry and watch verification fail at the exact sequence number
4. Send a hostile counterparty message and observe that the authorisation outcome is bit-identical to the benign case
5. Point a strict-residency tenant at a non-compliant provider pool and get a refusal, not a downgrade
6. Answer an escalation with a *partial* approval and watch it stay partial

One to five are demonstrated by `run_simulation.py`. Six needs the console, where the narrow approval and the agent's own repair of what it left unresolved are visible as they happen.

**Verification gates:** 56 backend tests, 23 console tests, `tsc --noEmit` clean, `vite build` clean.

---

## 6. Open questions

- **Trademark:** "Warrant" is unverified. Clearance needed through UK IPO, EUIPO, USPTO (Nice classes 9, 42) before any public commitment to the name.
- **Legal — binding commitments:** is a commitment made by software binding on the principal, and who bears loss when an agent commits outside mandate? The architecture answers *evidentially* (the ledger shows what authority existed at the moment of commitment). It does not answer *legally*. Requires counsel, ideally UAE-qualified for the GCC framing.
- **Residency specifics:** UAE PDPL, DIFC DP Law, ADGM DPR, and Saudi NDMO are four regimes, not one. The code models the distinction correctly but the specific obligations must be verified before any external claim is made about compliance.
- **Escalation rate** is the metric that decides whether this product works at all. If most exchanges escalate, it is a slower email client. Not measurable without real mandates.

---

## 7. Deliberate constraints

- **Neutral engine, concrete scenario.** The authorisation engine knows only price, quantity, terms and date — no vertical assumptions anywhere in `src/warrant/` outside `scenarios.py`. The *demo* is deliberately concrete: cross-border road freight, Jebel Ali to Riyadh. A named trade makes the value legible to a non-technical audience, and confining it to one file is the extensibility claim demonstrated rather than asserted. No automotive or safety-critical analogies appear in any artifact output — those remain private learning aids.

- **Why this trade.** Jebel Ali is a principal regional gateway; inland haulage moves on spot rates negotiated per load, at volume, between thin-margin operators. Cargo clears overnight, so the people negotiating are often asleep — which is the delegation case in one sentence. Figures are synthetic but sit inside the published range for full-truckload rates on the lane.
- **Synthetic data only.** No real names, no real counterparties, no real prices. Any publicly reachable demo carries this constraint permanently.
- **Offline-first tests.** The suite must not depend on a probabilistic external service. Determinism in tests is a governance property, not a convenience.
