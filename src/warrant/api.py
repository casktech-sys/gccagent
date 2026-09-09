"""
HTTP surface.

    uvicorn warrant.api:app --reload --app-dir src
    open http://127.0.0.1:8000/docs

State is in-memory for the MVP. The storage seam is Ledger + Wallets; both are
adapter-shaped so a Postgres swap touches no other module.
"""

from __future__ import annotations

import os
from typing import Optional
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import injection, scenarios
from .agent import Agent
from .engine import AuthorisationEngine
from .ledger import Ledger, SettlementError, Wallets
from .models import (
    Approval, ApprovalScope, Commitment, EscalationRequest, Mandate, Offer,
)
from .negotiation import Orchestrator, PrincipalDesk
from .providers import NoCompliantProviderError, TaskClass, default_router

app = FastAPI(title="Warrant — delegated-authority agent platform", version="0.1.0")

# The console runs on the Vite dev server during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"], allow_headers=["*"],
)

LEDGER = Ledger()
WALLETS = Wallets()
ENGINE = AuthorisationEngine()
ROUTER = default_router(offline=os.getenv("WARRANT_ONLINE") != "1")

MANDATES: dict[str, Mandate] = {
    m.mandate_id: m for m in (scenarios.buyer_mandate(), scenarios.seller_mandate())
}
TENANTS = {
    scenarios.BUYER_TENANT.tenant_id: scenarios.BUYER_TENANT,
    scenarios.SELLER_TENANT.tenant_id: scenarios.SELLER_TENANT,
    scenarios.STRICT_TENANT.tenant_id: scenarios.STRICT_TENANT,
}
COMMITMENTS: dict[str, Commitment] = {}
PENDING: dict[str, EscalationRequest] = {}
RESOLVED: dict[str, Approval] = {}


class QueueDesk:
    """
    Desk that parks escalations for a real human. In the MVP the run endpoint
    supplies a decision policy up front; a production build would suspend the
    thread and resume on approval. The seam is identical.
    """

    def __init__(self, policy: dict[str, tuple[bool, str]]):
        self.policy = policy

    def resolve(self, request: EscalationRequest) -> Approval:
        PENDING[request.escalation_id] = request
        granted, scope = self.policy.get(request.principal, (False, "full"))
        approval = Approval(
            approval_id=f"APR-{request.escalation_id[-6:]}",
            mandate_ref=request.mandate_ref, principal=request.principal,
            thread_id=request.thread_id, scope=ApprovalScope(scope), granted=granted,
            covers_clause_ids=[b.clause_id for b in request.decision.breaches],
        )
        RESOLVED[request.escalation_id] = approval
        request.resolved_by = approval.approval_id
        return approval


# --------------------------------------------------------------------------


@app.get("/health")
def health():
    ok, bad = LEDGER.verify()
    return {"status": "ok", "ledger_entries": len(LEDGER.entries()),
            "chain_valid": ok, "first_bad_seq": bad,
            "providers": [p.spec.name for p in ROUTER.providers]}


@app.get("/mandates")
def list_mandates():
    return [m.model_dump(mode="json") for m in MANDATES.values()]


@app.get("/mandates/{mandate_id}")
def get_mandate(mandate_id: str):
    if mandate_id not in MANDATES:
        raise HTTPException(404, "mandate not found")
    return MANDATES[mandate_id].model_dump(mode="json")


@app.put("/mandates/{mandate_id}")
def upsert_mandate(mandate_id: str, mandate: Mandate):
    """Mandates are versioned; editing bumps the version so old commitments
    still point at the authority that actually existed at the time."""
    existing = MANDATES.get(mandate_id)
    mandate.mandate_id = mandate_id
    mandate.version = (existing.version + 1) if existing else 1
    MANDATES[mandate_id] = mandate
    return {"mandate_ref": mandate.ref}


class AuthoriseRequest(BaseModel):
    mandate_id: str
    offer: Offer
    binding: bool = False


@app.post("/authorise")
def authorise(req: AuthoriseRequest):
    """Dry-run the engine against a mandate. Useful for mandate authoring UIs."""
    m = MANDATES.get(req.mandate_id)
    if not m:
        raise HTTPException(404, "mandate not found")
    d = ENGINE.authorise(m, req.offer, binding=req.binding)
    return {"decision": d.model_dump(mode="json"),
            "authority_chain": ENGINE.authority_chain(m, d)}


class RunRequest(BaseModel):
    thread_id: Optional[str] = None
    buyer_mandate_id: str = "MND-BUY-001"
    seller_mandate_id: str = "MND-SEL-001"
    approval_policy: dict[str, tuple[bool, str]] = {
        "Omar": (True, "price_only"), "Nadia": (True, "full"),
    }


@app.post("/threads/run")
def run_thread(req: RunRequest):
    bm, sm = MANDATES.get(req.buyer_mandate_id), MANDATES.get(req.seller_mandate_id)
    if not bm or not sm:
        raise HTTPException(404, "mandate not found")

    buyer = Agent("agt_buyer", bm, TENANTS[bm.tenant_id], ROUTER, ENGINE)
    seller = Agent("agt_seller", sm, TENANTS[sm.tenant_id], ROUTER, ENGINE)
    desk: PrincipalDesk = QueueDesk(req.approval_policy)

    try:
        res = Orchestrator(LEDGER, desk).run(buyer, seller, thread_id=req.thread_id)
    except NoCompliantProviderError as e:
        raise HTTPException(422, f"residency policy blocked this thread: {e}")

    if res.commitment:
        COMMITMENTS[res.commitment.commitment_id] = res.commitment

    thread = res.commitment.thread_id if res.commitment else (req.thread_id or "")
    return {
        "thread_id": thread,
        "outcome": res.terminated,
        "rounds": res.rounds,
        "escalations": [e.escalation_id for e in res.escalations],
        "commitment": res.commitment.model_dump(mode="json") if res.commitment else None,
        "replay": LEDGER.replay(thread),
    }


@app.get("/escalations")
def escalations(unresolved_only: bool = False):
    items = list(PENDING.values())
    if unresolved_only:
        items = [e for e in items if e.resolved_by is None]
    return [e.model_dump(mode="json") for e in items]


@app.get("/ledger")
def ledger(thread_id: Optional[str] = None):
    ok, bad = LEDGER.verify()
    return {"chain_valid": ok, "first_bad_seq": bad,
            "entries": [e.model_dump(mode="json") for e in LEDGER.entries(thread_id)]}


@app.get("/ledger/replay/{thread_id}")
def replay(thread_id: str):
    return {"thread_id": thread_id, "replay": LEDGER.replay(thread_id)}


@app.get("/commitments")
def commitments():
    return [c.model_dump(mode="json") for c in COMMITMENTS.values()]


class SettleRequest(BaseModel):
    commitment_id: str
    fund_buyer: float = 25000.0


@app.post("/settle")
def settle(req: SettleRequest):
    c = COMMITMENTS.get(req.commitment_id)
    if not c:
        raise HTTPException(404, "commitment not found")
    if req.fund_buyer:
        WALLETS.fund(c.buyer_principal, req.fund_buyer)
    try:
        payload = WALLETS.settle(c, LEDGER)
    except SettlementError as e:
        raise HTTPException(409, str(e))
    return {"settlement": payload, "balances": WALLETS.balances}


class ScanRequest(BaseModel):
    text: str


@app.post("/injection/scan")
def scan(req: ScanRequest):
    wrapped, flags = injection.contain(req.text)
    return {"flags": flags, "wrapped_preview": wrapped[:400]}


@app.get("/routing/preview")
def routing_preview(tenant_id: str, task_class: str = TaskClass.NEGOTIATION):
    t = TENANTS.get(tenant_id)
    if not t:
        raise HTTPException(404, "tenant not found")
    try:
        p = ROUTER.select(task_class, t)
    except NoCompliantProviderError as e:
        return {"tenant": tenant_id, "jurisdiction": t.jurisdiction.value,
                "routed": None, "refused_reason": str(e)}
    return {"tenant": tenant_id, "jurisdiction": t.jurisdiction.value,
            "routed": p.spec.name, "tier": p.spec.tier, "regions": p.spec.regions}


# --------------------------------------------------------------------------
# Resumable sessions — the console drives these (ADR-009)
# --------------------------------------------------------------------------

from .session import SessionStore, ThreadSession  # noqa: E402

SESSIONS = SessionStore()

# This is reachable by anyone with the link and holds state in memory, so the
# store is bounded. Oldest threads are evicted rather than refusing new ones —
# a demo that stops working after fifty visitors is worse than one that forgets.
MAX_SESSIONS = int(os.getenv("WARRANT_MAX_SESSIONS", "50"))


class CreateSession(BaseModel):
    thread_id: Optional[str] = None
    buyer_mandate_id: str = "MND-BUY-001"
    seller_mandate_id: str = "MND-SEL-001"


@app.post("/sessions")
def create_session(req: CreateSession):
    bm, sm = MANDATES.get(req.buyer_mandate_id), MANDATES.get(req.seller_mandate_id)
    if not bm or not sm:
        raise HTTPException(404, "mandate not found")
    thread_id = req.thread_id or f"THR-{uuid4().hex[:6].upper()}"
    if SESSIONS.get(thread_id):
        raise HTTPException(409, "a thread with that id already exists")

    while len(SESSIONS.all()) >= MAX_SESSIONS:
        SESSIONS.drop(SESSIONS.all()[0].thread_id)

    s = ThreadSession(thread_id, bm, sm, TENANTS, ROUTER, ENGINE)
    SESSIONS.put(s)
    try:
        s.advance()
    except NoCompliantProviderError as e:
        raise HTTPException(422, f"residency policy blocked this thread: {e}")
    if s.commitment:
        COMMITMENTS[s.commitment.commitment_id] = s.commitment
    return s.state()


@app.get("/sessions")
def list_sessions():
    return [{"thread_id": s.thread_id, "status": s.status,
             "awaiting": s.pending.principal if s.pending else None,
             "replays": s.replays,
             "commitment_id": s.commitment.commitment_id if s.commitment else None}
            for s in SESSIONS.all()]


@app.get("/sessions/{thread_id}")
def get_session(thread_id: str):
    s = SESSIONS.get(thread_id)
    if not s:
        raise HTTPException(404, "thread not found")
    return s.state()


class DecideRequest(BaseModel):
    granted: bool
    scope: str = "full"


@app.post("/sessions/{thread_id}/decide")
def decide(thread_id: str, req: DecideRequest):
    s = SESSIONS.get(thread_id)
    if not s:
        raise HTTPException(404, "thread not found")
    if not s.pending:
        raise HTTPException(409, "nothing is awaiting a decision on this thread")
    try:
        s.decide(req.granted, ApprovalScope(req.scope))
    except ValueError as e:
        raise HTTPException(400, str(e))
    if s.commitment:
        COMMITMENTS[s.commitment.commitment_id] = s.commitment
    return s.state()


@app.delete("/sessions/{thread_id}")
def delete_session(thread_id: str):
    SESSIONS.drop(thread_id)
    return {"deleted": thread_id}


@app.get("/tenants")
def tenants():
    return [t.model_dump(mode="json") for t in TENANTS.values()]
