# Warrant

**Delegated-authority infrastructure for autonomous agents.**

Agents negotiate and transact on behalf of human principals, inside a declarative permission envelope called a *mandate*. Every commitment carries a machine-checkable authority chain: the clauses that permitted it, plus any human approvals consumed.

```bash
python -m venv .venv && source .venv/bin/activate
pip install pydantic fastapi uvicorn pytest httpx
python -m pytest -q          # 42 passed
python run_simulation.py     # full negotiation, offline, no API key
```

Then the console, with the API running:

```bash
uvicorn warrant.api:app --app-dir src    # terminal one
cd console && npm install && npm run dev # terminal two, then open :5173
```

Detailed walkthrough: [`RUNBOOK.md`](RUNBOOK.md)
Non-technical overview, written for a business reader: [`OVERVIEW.md`](OVERVIEW.md)

---

## The idea

> The language model drafts. A deterministic engine decides.

No proposed action reaches the wire without passing `AuthorisationEngine.authorise()` — which contains no model call, no probabilistic step, and no free-text parsing. A model can therefore never author an unauthorised commitment.

Two consequences:

**Provable authority.** Read any commitment and name every clause and human approval behind it. An agent that decides its own limits with an LLM cannot produce that chain, and has no defence when a deal is disputed.

**Prompt injection is structurally defeated, not filtered.** The counterparty in an agent-to-agent negotiation is an adversarial channel. Because the engine reads only typed fields, a fully successful injection still cannot authorise anything — the model does not hold that power to give away. Detection exists as a second layer and flags to the ledger rather than silently stripping.

---

## What it does

- **Mandates** — versioned, typed permission envelopes (price limits, discount authority, terms allowlists, delivery windows, counterparty verification)
- **Delegated execution** — three-stage agent turn: deterministic policy → deterministic authorisation → model drafting, in that order
- **Escalation** — scoped, single-use approvals (`full` / `price_only` / `terms_only`) that do not widen the mandate for future turns
- **Mechanical repair** — the agent fixes what it can inside its own mandate before troubling a human
- **Commitment ledger** — hash-chained, append-only, replayable, tamper-evident
- **Agent lifecycle** — draft, published, suspended; an unpublished agent cannot be put into a negotiation
- **Multi-provider routing** — frontier, two cost-efficient vendors, and an in-region model, selected by task sensitivity and tenant jurisdiction
- **Residency** — permissive tenants get the frontier model, a Saudi tenant is confined to the in-region one, and a tenant whose regulator permits no served region is refused outright rather than quietly downgraded
- **Token settlement** — double-entry, buyer → escrow → seller, executed only against a commitment whose authority chain is already recorded
- **Guided walkthrough** — five steps from the briefing to the authority chain, anchored to the control in question; it follows the visitor rather than leading them, and handles the refusal branch instead of breaking on it
- **Console** — written for the person who has to decide, not the person who built it. Plain sentences, no identifiers, no protocol vocabulary; a single switch reveals clause IDs, authority chains and hashes for anyone who wants them

---

## Reference scenario

Cross-border road freight, Jebel Ali to Riyadh. Nadia needs three trucks; Omar
runs them. Both sent an agent.

```
buyer  counters  17,800 / net_45 / 3 trucks
seller BLOCKED pre-utterance — discount 15.2% > 8% authority
                             — terms net_45 not in ['net_30']
       escalated to Omar
       Omar approves scope=price_only
       agent repairs terms to net_30 on its own
seller counters  17,800 / net_30
buyer  BLOCKED — 17,800 above 15,000 unattended-commit limit
       escalated to Nadia → approved
buyer  ACCEPT → commitment → settled
```

Figures are synthetic but sit inside the published range for full-truckload
rates on this lane. The engine sees a price, a quantity, terms and a date — it
knows nothing about freight, and changing the trade means editing
`scenarios.py` and nothing else.

Two escalations, one partial approval that stayed partial, one mechanical repair, one settled deal, and a ledger that reconstructs all of it.

---

## Layout

```
console/src/        React 18 · Vite · TypeScript · Tailwind · TanStack Query
  components/       limit gauge, negotiation trace, escalation decision
  routes/           deals, rules, models, record, safety
  detail.tsx        plain by default, engineering depth on demand
  tour.tsx          walkthrough whose step is derived from state, not counted
src/warrant/
  models.py       typed domain objects, residency enums
  engine.py       authorisation — the 150 lines the argument rests on
  agent.py        policy → authorise → draft
  negotiation.py  turn loop, escalation routing, commitments
  ledger.py       hash chain, replay, double-entry wallets
  providers.py    provider adapters + residency-aware routing
  injection.py    counterparty containment
  scenarios.py    the freight scenario: mandates, tenants, figures
  session.py      resumable threads by deterministic replay
  api.py          FastAPI surface
  serve.py        production composite: API under /api, console at /
docs/             master brief, architecture plan + ADRs, decisions log, block plan
tests/            77 backend tests, fully offline and deterministic
                  plus 29 console tests under console/src/test
```

---

## Deploying

One Render web service. The console is built into static files and served by the
same process as the API, so there is one URL and no CORS.

```bash
docker build -t warrant . && docker run --rm -p 8000:8000 warrant
```

Full instructions, including the pre-flight gates and what to write in the
message that carries the link: [`DEPLOY.md`](DEPLOY.md)

## Status

MVP core and console complete. Blocks B4–B6 and B8–B10 (mandate validation, Postgres, multi-tenancy, live providers, adversarial suite, deployment) are planned in `docs/03_Decisions_and_Block_Plan.md`.

Known limitations are documented rather than hidden — the ledger is tamper-*evident*, not tamper-*proof*; the negotiation policy is deliberately simple because it is the replaceable part; injection patterns are English-only and are the second layer, not the guarantee.

All data is synthetic. All output is domain-neutral.
