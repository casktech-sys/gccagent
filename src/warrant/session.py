"""
Resumable negotiation sessions.

ADR-009 — RESUMPTION BY DETERMINISTIC REPLAY.

A negotiation must stop at an escalation and wait — possibly for hours — for a
human. The orchestrator is a synchronous loop, so the obvious options are to
make it a coroutine or to persist a continuation. Both add machinery.

Because policy and authorisation are fully deterministic (ADR-001, ADR-002), a
third option exists: re-run the thread from the beginning with the approvals
gathered so far. Every earlier escalation recurs identically and is answered
from the store; the run advances to the first *unanswered* one and pauses there.

This is only sound because the system is deterministic. It is therefore also a
demonstration of it: if a replay ever diverged, the property the whole product
rests on would be false.

Escalations are matched across replays by content signature, not by ID —
IDs are freshly generated each run, the underlying situation is not.
"""

from __future__ import annotations

import hashlib
import json
from typing import Optional

from .agent import Agent
from .engine import AuthorisationEngine
from .ledger import Ledger
from .models import (
    Approval, ApprovalScope, ClauseKind, Commitment, EscalationRequest, Mandate,
)
from .negotiation import NegotiationResult, Orchestrator


def signature(req: EscalationRequest) -> str:
    """Stable identity for 'this situation', independent of run-scoped IDs."""
    blob = json.dumps({
        "principal": req.principal,
        "mandate_ref": req.mandate_ref,
        "offer": req.proposed.model_dump(exclude_none=True, mode="json"),
        "breaches": sorted(b.clause_id for b in req.decision.breaches),
    }, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


class ApprovalRequired(Exception):
    def __init__(self, request: EscalationRequest):
        super().__init__(f"awaiting {request.principal}")
        self.request = request


class PausingDesk:
    """Answers from the approval store, or suspends the run."""

    def __init__(self, approvals: dict[str, Approval]):
        self.approvals = approvals

    def resolve(self, request: EscalationRequest) -> Approval:
        sig = signature(request)
        if sig in self.approvals:
            approval = self.approvals[sig].model_copy()
            request.resolved_by = approval.approval_id
            return approval
        raise ApprovalRequired(request)


class ThreadSession:
    """One negotiation, its approval store, and its materialised ledger."""

    def __init__(self, thread_id: str, buyer_mandate: Mandate, seller_mandate: Mandate,
                 tenants: dict, router, engine: Optional[AuthorisationEngine] = None):
        self.thread_id = thread_id
        self.buyer_mandate = buyer_mandate
        self.seller_mandate = seller_mandate
        self.tenants = tenants
        self.router = router
        self.engine = engine or AuthorisationEngine()

        self.approvals: dict[str, Approval] = {}
        self.decisions_log: list[dict] = []
        self.ledger = Ledger()
        self.status = "created"
        self.pending: Optional[EscalationRequest] = None
        self.result: Optional[NegotiationResult] = None
        self.commitment: Optional[Commitment] = None
        self.replays = 0

    # ----------------------------------------------------------------------

    def advance(self) -> "ThreadSession":
        """Replay from the start with everything known so far."""
        self.replays += 1
        self.ledger = Ledger()
        self.pending = None

        buyer = Agent("agt_buyer", self.buyer_mandate,
                      self.tenants[self.buyer_mandate.tenant_id], self.router, self.engine)
        seller = Agent("agt_seller", self.seller_mandate,
                       self.tenants[self.seller_mandate.tenant_id], self.router, self.engine)

        try:
            self.result = Orchestrator(self.ledger, PausingDesk(self.approvals)).run(
                buyer, seller, thread_id=self.thread_id)
        except ApprovalRequired as e:
            self.pending = e.request
            self.status = "awaiting_approval"
            return self

        self.commitment = self.result.commitment
        self.status = "committed" if self.result.commitment else "closed_no_deal"
        return self

    def decide(self, granted: bool, scope: ApprovalScope) -> "ThreadSession":
        if self.pending is None:
            raise ValueError("nothing is awaiting a decision on this thread")

        req = self.pending
        approval = Approval(
            approval_id=f"APR-{signature(req)[:6].upper()}",
            mandate_ref=req.mandate_ref, principal=req.principal,
            thread_id=self.thread_id, scope=scope, granted=granted,
            covers_clause_ids=[b.clause_id for b in req.decision.breaches],
        )
        self.approvals[signature(req)] = approval
        self.decisions_log.append({
            "approval_id": approval.approval_id, "principal": approval.principal,
            "scope": scope.value, "granted": granted,
            "breaches": [b.explanation for b in req.decision.breaches],
            "at": approval.granted_at,
        })
        return self.advance()

    # ----------------------------------------------------------------------

    def mandate_for(self, principal: str) -> Mandate:
        return (self.buyer_mandate if self.buyer_mandate.principal == principal
                else self.seller_mandate)

    def limits(self, principal: str) -> list[dict]:
        """
        Numeric boundaries for the escalation gauge, in mandate currency.
        Only clauses that place a price on a line are returned.
        """
        m = self.mandate_for(principal)
        out: list[dict] = []
        for c in m.clauses:
            if c.kind is ClauseKind.PRICE_MIN:
                out.append({"id": c.clause_id, "label": "Your minimum",
                            "hint": "Below this the job costs you money",
                            "value": float(c.value), "side": "lower"})
            elif c.kind is ClauseKind.PRICE_MAX:
                out.append({"id": c.clause_id, "label": "Most you will pay",
                            "hint": "You set this as the hard cap",
                            "value": float(c.value), "side": "upper"})
            elif c.kind is ClauseKind.AUTO_COMMIT_MAX:
                out.append({"id": c.clause_id, "label": "Agent can close alone",
                            "hint": "Above this it has to ask you",
                            "value": float(c.value), "side": "upper"})
            elif c.kind is ClauseKind.DISCOUNT_MAX_PCT and m.list_price:
                out.append({"id": c.clause_id, "label": "Agent can discount to",
                            "hint": f"{c.value}% off your list price",
                            "value": m.list_price * (1 - float(c.value) / 100),
                            "side": "lower"})
        return sorted(out, key=lambda x: x["value"])

    def state(self) -> dict:
        chain_ok, bad = self.ledger.verify()
        pending = None
        if self.pending:
            p = self.pending
            pending = {
                "escalation_id": p.escalation_id,
                "signature": signature(p),
                "principal": p.principal,
                "who_you_are": self.mandate_for(p.principal).who_you_are,
                "mandate_ref": p.mandate_ref,
                "currency": self.mandate_for(p.principal).currency,
                "subject": self.mandate_for(p.principal).subject,
                "unit": self.mandate_for(p.principal).unit,
                "proposed": p.proposed.model_dump(exclude_none=True, mode="json"),
                "agent_position": p.agent_position,
                "breaches": [b.model_dump(mode="json") for b in p.decision.breaches],
                "limits": self.limits(p.principal),
                "offered_scopes": self._scopes_for(p),
            }
        return {
            "thread_id": self.thread_id,
            "status": self.status,
            "replays": self.replays,
            "subject": self.buyer_mandate.subject,
            "buyer_mandate": self.buyer_mandate.ref,
            "seller_mandate": self.seller_mandate.ref,
            "chain_valid": chain_ok,
            "first_bad_seq": bad,
            "trace": [e.model_dump(mode="json") for e in self.ledger.entries(self.thread_id)],
            "pending": pending,
            "decisions": self.decisions_log,
            "commitment": self.commitment.model_dump(mode="json") if self.commitment else None,
        }

    def _scopes_for(self, req: EscalationRequest) -> list[dict]:
        """Offer only the scopes that would actually change this outcome."""
        kinds = {b.kind for b in req.decision.breaches}
        price_kinds = {ClauseKind.PRICE_MAX, ClauseKind.PRICE_MIN,
                       ClauseKind.DISCOUNT_MAX_PCT, ClauseKind.AUTO_COMMIT_MAX}
        scopes = [{"scope": ApprovalScope.FULL.value, "label": "Allow all of it",
                   "hint": "Every point below is approved, this once"}]
        if kinds & price_kinds and not kinds.issubset(price_kinds):
            scopes.append({"scope": ApprovalScope.PRICE_ONLY.value,
                           "label": "Allow the price, not the rest",
                           "hint": "Your agent then has to solve the others itself"})
        if ClauseKind.TERMS_ALLOWLIST in kinds and len(kinds) > 1:
            scopes.append({"scope": ApprovalScope.TERMS_ONLY.value,
                           "label": "Allow the payment terms only",
                           "hint": "The price stays where your rules put it"})
        return scopes


class SessionStore:
    def __init__(self):
        self._sessions: dict[str, ThreadSession] = {}

    def put(self, s: ThreadSession) -> ThreadSession:
        self._sessions[s.thread_id] = s
        return s

    def get(self, thread_id: str) -> Optional[ThreadSession]:
        return self._sessions.get(thread_id)

    def all(self) -> list[ThreadSession]:
        return list(self._sessions.values())

    def drop(self, thread_id: str) -> None:
        self._sessions.pop(thread_id, None)
