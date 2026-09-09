# Decisions Log & Block Plan — Warrant

**Version:** 1.0 · 2026-09-08

---

## Part A — Decisions Log

Locked decisions. Not re-debated within a block. Changing one requires a new ADR and a note here.

| # | Decision | Rationale | Locked |
|---|---|---|---|
| D-01 | Mandate enforcement is deterministic rule evaluation, not LLM judgement | Only path to a provable authority chain | 2026-09-08 |
| D-02 | Stack: Python 3.11+ / FastAPI backend, React+TS frontend (B7) | Reuses proven delivery cadence; nothing exotic to defend | 2026-09-08 |
| D-03 | Postgres, **not** a vector store | Data is transactional and relational; retrieval is not the problem here | 2026-09-08 |
| D-04 | Providers: Anthropic (frontier) + OpenAI-compatible adapter (cost-efficient) + offline mock | One adapter covers DeepSeek/Qwen/GLM/vLLM | 2026-09-08 |
| D-05 | Wire protocol: structured envelope, prose as inert payload | Also the injection boundary | 2026-09-08 |
| D-06 | Settlement: internal double-entry ledger, no payment rails | Rails need an entity, KYC, and counsel | 2026-09-08 |
| D-07 | Built under the author's own neutral name, not the client's | Portfolio asset stays the author's regardless of engagement | 2026-09-08 |
| D-08 | Binding vs non-binding actions distinguished in the engine | Otherwise every turn escalates and the product is unusable | 2026-09-08 |
| D-09 | Approvals are scoped and single-use; they do not amend the mandate | A narrow tap must stay narrow | 2026-09-08 |
| D-10 | Residency violations refuse; they never silently downgrade | Silent fallback defeats the control's purpose | 2026-09-08 |
| D-11 | Injection detections are flagged to the ledger, never silently stripped | Suppressing attack evidence is itself a governance failure | 2026-09-08 |
| D-12 | Tests run fully offline and deterministically | Governance claims cannot rest on a probabilistic dependency | 2026-09-08 |
| D-13 | All output domain-neutral; synthetic data only | Public artifact; data handling is part of what is assessed | 2026-09-08 |
| D-14 | Threads resume by deterministic replay, not by persisted continuation | Cheaper, and doubles as a standing proof of determinism | 2026-09-08 |
| D-15 | Console talks to the API through `/api`, proxied | Same code in dev, preview, and behind a reverse proxy | 2026-09-08 |
| D-16 | Every breach carries both a precise and a plain rendering, both produced in the engine | The audit record must not depend on the interface, and the interface must not parse the audit record | 2026-09-09 |
| D-17 | Plain language is the default; technical detail is one switch away | Two readers with opposite needs; neither should be served badly | 2026-09-09 |
| D-18 | One deployed service, console served by the API | Two services means two URLs, CORS, and two things a reviewer can find broken | 2026-09-09 |
| D-19 | Public demo runs the offline provider, single worker, capped sessions | No key on a public link, and in-memory state makes a second worker incorrect | 2026-09-09 |
| D-20 | The walkthrough derives its step from state, never counts clicks | A counter breaks the moment someone leaves the path, and this product has a real branch in it | 2026-09-09 |
| D-21 | The walkthrough is fixed to the viewport and rendered outside the page grid | Anything a first-time visitor must see cannot depend on scroll position or ancestor heights | 2026-09-09 |
| D-22 | The guide anchors to the control and presses it, except where the choice is the point | Describing a button is worse than pointing at it; pressing it for them is better still, unless pressing it is the decision | 2026-09-09 |
| D-22a | Reading the walkthrough and acting on it are separate; Back and Next never act | Someone should be able to read all five steps without committing to anything, and never have a guide press a button they did not | 2026-09-09 |
| D-23 | Warm paper theme, serif titles, hairline rules | Matches the register of a printed instrument of authority, and the rest of the portfolio | 2026-09-09 |

### Parked for counsel

- Is a commitment made by software binding on the principal?
- Who bears loss on an out-of-mandate commitment — principal, platform, or counterparty?
- Trademark clearance for the working name (UK IPO, EUIPO, USPTO; Nice 9 and 42).

---

## Part B — Block Plan

Each block: kickoff prompt → locked decisions → implementation → exit gate → handoff. One chat per block.

### Complete

**B1 — Domain model & authorisation engine** ✓
`models.py`, `engine.py`. Typed clauses, scoped approvals, binding distinction, authority chains.
*Exit gate met:* 20 engine tests passing; determinism asserted over 50 repetitions.

**B2 — Agent, orchestration, ledger, settlement** ✓
`agent.py`, `negotiation.py`, `ledger.py`. Three-stage turn, escalation routing, mechanical repair, hash chain, double-entry wallets.
*Exit gate met:* end-to-end negotiation reaches a settled commitment with two escalations; chain verifies; tamper detected at correct sequence.

**B3 — Providers, residency, injection containment, API** ✓
`providers.py`, `injection.py`, `api.py`, `run_simulation.py`.
*Exit gate met:* 42/42 tests passing; simulation runs offline; all 11 API endpoints smoke-tested.

**B7 — Console (frontend)** ✓
React 18 / Vite / TypeScript / Tailwind / TanStack Query v5 / react-router v6. Four surfaces: thread view with escalation decisions, mandate editor with version bump, ledger explorer with chain verification, containment demonstrator.
Backend additions: `session.py` (ADR-009 replay resumption, ADR-010 offered scopes), session endpoints, CORS.
*Exit gate met:* `tsc --noEmit` clean · `vite build` clean · 28 console tests passing · 59 backend tests passing · reference scenario driveable end to end from the UI, verified live through the dev proxy.

**B7.1 — Plain-language pass** ✓
The first console was written for someone who already understood the architecture, which is the wrong reader: the brief says a non-technical founder assesses the work. Rewrote the whole copy layer — plain breach sentences produced in the engine (ADR-011), an orientation briefing on first load, identity line on every decision, gauge ticks labelled in words, navigation renamed to Deals / Rules / Record / Safety, and all identifiers and authority chains moved behind a detail switch.
*Exit gate met:* no clause identifier, protocol token or underscore appears in default view; asserted by test, not by inspection.

**B7.2 — Defect found in use** ✓
The negotiation trace still showed audit wording in plain mode. Cause: the `blocked` ledger entry stored only `explanation`, so the console had nothing else to render — the plain sentence existed on the `Breach` object but was discarded at the point it was written to the ledger. Fixed by writing both renderings to the entry, and locked with a test asserting no underscore or protocol token survives into `breaches_plain`.
Also added: an explicit outcome panel when a principal declines (previously the thread just ended with no summary), and the replay explanation moved behind the detail switch where it belongs.
*Found by walking the product as a user rather than as its author, which is the only way this class of defect surfaces.*

**B7.3 — Guided walkthrough** ✓
Five steps taking a first-time visitor from the briefing to the authority chain. The step is **derived from thread state** rather than tracked as a counter — there is nothing to fall out of sync, no click handlers to intercept, and the refusal branch is handled as a state rather than as a tour failure. Attention is drawn with an outline on the one relevant control, not a dimmed overlay.
*Exit gate met:* `deriveStep` is pure and covered by nine tests including the decline-and-restart path; walkthrough instructions verified against the labels the API actually returns, so the two cannot drift apart silently.

*Defect found in use:* the bar was `sticky bottom-0` inside the deals grid, so on arrival it sat below the fold instead of pinning to the viewport — a walkthrough nobody can see. Moved to fixed positioning and rendered from the shell rather than from inside the page layout, with a regression test asserting it is pinned and not sticky. Third defect in this block found by using the product rather than reading it.

**B7.4 — Anchored guide and light theme** ✓
The bottom bar described a control without pointing at it, which leaves a first-time visitor hunting. Replaced with a popover anchored to the control itself, everything else dimmed by a single cut-out element. Where the next move is not a decision the person must make — starting a deal, revealing technical detail — the guide offers to press the control for them; where the choice *is* the point, it says "Your move" and offers nothing.
Theme moved from slate to warm editorial paper: serif titles, hairline rules, one soft lift reserved for things floating above the page. Semantics unchanged — brass is still human authority, and it is still the same colour as the accent.
*Exit gate met:* 60 backend, 51 console; light theme, popover and navigation all verified in the built bundle rather than in source.

*Correction:* the first version had no Back or Next — on decision steps it said "Your move" and offered nothing, on reasoning that a Next button there would let someone skip the only two moments that matter. In use a counter reading "of 5" with no navigation simply reads as broken. Back and Next now always read, the action button (where there is one) always acts, and they sit together rather than replacing each other. Reading ahead is labelled as such, and the moment the deal itself moves on, what the person is reading is replaced by where they now are — a guide describing a screen that is no longer in front of them is worse than one that loses your place.

**B10 — Deployment** ✓ (partial)
Single Render web service. Multi-stage Dockerfile: Node builds the console, the Python image serves both it and the API from one process. `warrant/serve.py` mounts the API under `/api` and the built console at `/`, with an SPA fallback so client-side routes survive a reload. Health check on `/healthz`, kept separate from `/api/health` so ledger state can never fail a deploy. Deployment runs the offline provider — no key, no model calls, no bill on a public link. Session store capped and evicting oldest.
*Exit gate met:* production shape verified locally (root, deep link, static asset, `/api/*`, full negotiation to commitment); Dockerfile stages reproduced step by step and checked.
*Remaining in B10:* screenshot in the README, and the repo made public.

### Open

**B4 — Mandate authoring & validation**
Mandate DSL (YAML), conflict detection (e.g. `auto_commit_max > price_max`), version diffing, dry-run authorisation preview.
*Exit gate:* invalid mandates rejected with clause-level errors; version bump preserves historical authority references.

**B5 — Persistence**
Postgres via SQLAlchemy. Append-only grants on the ledger table. Alembic migrations. Ledger and Wallets adapters swapped; no other module touched.
*Exit gate:* full suite passes against Postgres; chain verifies across a process restart.

**B6 — Multi-tenancy & auth**
Tenant isolation, principal accounts, agent lifecycle (draft → published → suspended), row-level scoping, residency enforced at the storage adapter.
*Exit gate:* cross-tenant read attempt denied and logged; residency violation refused at write time.

**B8 — Live provider integration**
Real Anthropic + one cost-efficient provider behind the existing adapters. Latency and cost telemetry per routing decision. Fallback policy on provider failure — explicit, logged, never silent.
*Exit gate:* identical negotiation outcome online and offline; only narrative text differs.

**B9 — Adversarial test suite**
A hostile counterparty agent that actively attempts mandate widening, escalation suppression, role reassignment, and delimiter escape. Escalation-rate instrumentation.
*Exit gate:* zero unauthorised commitments across the hostile corpus; every attempt flagged to the ledger.

### Sequencing note

B4 → B5 → B6 is the dependency spine. B8 and B9 are independent. B10 last.

B7 was pulled forward ahead of persistence and auth because the brief assesses candidates on visible work, and a console is what "visible" means to a non-technical founder. The cost of that choice is that the console currently runs against in-memory state — a deliberate, recorded trade, not an oversight. B5 and B6 remove it.

With B10 largely closed, the remaining weight for the application is **B5 (persistence)** — the demo currently forgets every deal on restart, which is defensible and documented, but a reviewer who returns to the link twice will notice.
