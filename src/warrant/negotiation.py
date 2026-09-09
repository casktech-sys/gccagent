"""
Negotiation orchestrator.

Runs the turn loop, routes escalations to the principal, creates the commitment
when both sides accept, and writes every step to the ledger.

The `PrincipalDesk` protocol is where a real UI plugs in. The simulation uses a
scripted desk; the API uses a queue-backed one. The orchestrator does not care.
"""

from __future__ import annotations

import uuid
from typing import Callable, Optional, Protocol

from . import injection
from .agent import Agent
from .ledger import Ledger
from .models import (
    Approval, ApprovalScope, Commitment, Decision, EscalationRequest,
    Envelope, Intent, Offer, Outcome,
)


def _rid(p: str) -> str:
    return f"{p}-{uuid.uuid4().hex[:6].upper()}"


class PrincipalDesk(Protocol):
    def resolve(self, request: EscalationRequest) -> Approval: ...


class ScriptedDesk:
    """Test/simulation desk. `policy` maps principal -> (granted, scope)."""

    def __init__(self, policy: dict[str, tuple[bool, ApprovalScope]]):
        self.policy = policy
        self.handled: list[EscalationRequest] = []

    def resolve(self, request: EscalationRequest) -> Approval:
        self.handled.append(request)
        granted, scope = self.policy.get(request.principal, (False, ApprovalScope.FULL))
        return Approval(
            approval_id=_rid("APR"), mandate_ref=request.mandate_ref,
            principal=request.principal, thread_id=request.thread_id,
            scope=scope, granted=granted,
            covers_clause_ids=[b.clause_id for b in request.decision.breaches],
        )


class NegotiationResult:
    def __init__(self):
        self.commitment: Optional[Commitment] = None
        self.rounds: int = 0
        self.escalations: list[EscalationRequest] = []
        self.terminated: str = "max_rounds"


class Orchestrator:
    def __init__(self, ledger: Ledger, desk: PrincipalDesk, max_rounds: int = 12):
        self.ledger = ledger
        self.desk = desk
        self.max_rounds = max_rounds

    # ----------------------------------------------------------------------

    def _turn(self, agent: Agent, incoming: Optional[Envelope],
              thread_id: str) -> tuple[Optional[Envelope], Optional[EscalationRequest]]:
        intent, offer = agent.propose(incoming)

        if intent == Intent.WITHDRAW:
            return None, None

        approvals: list[Approval] = []
        escalation: Optional[EscalationRequest] = None

        decision = agent.authorise(intent, offer, incoming, approvals)

        # Try mechanical repair before troubling a human.
        if decision.outcome == Outcome.ESCALATE:
            revised = agent.revise_within_mandate(offer, decision)
            if revised is not None:
                trial = agent.authorise(intent, revised, incoming, approvals)
                if trial.outcome == Outcome.AUTHORISED:
                    offer, decision = revised, trial

        # Still blocked -> escalate to the human principal.
        if decision.outcome in (Outcome.ESCALATE, Outcome.REJECT):
            # The record keeps the precise wording; the console needs the plain
            # one. Both are written here so the interface never has to re-derive
            # a sentence from an audit entry (ADR-011).
            self.ledger.append(thread_id, "blocked", agent.agent_id, {
                "intent": intent.value,
                "proposed": offer.model_dump(exclude_none=True, mode="json"),
                "breaches": [b.explanation for b in decision.breaches],
                "breaches_plain": [b.plain for b in decision.breaches],
                "note": "blocked before generation reached the wire",
            })

            if decision.outcome == Outcome.REJECT:
                return None, None

            escalation = EscalationRequest(
                escalation_id=_rid("ESC"), thread_id=thread_id,
                principal=agent.mandate.principal, mandate_ref=agent.mandate.ref,
                proposed=offer, decision=decision,
                agent_position=self._position(agent, offer, incoming),
            )
            self.ledger.append(thread_id, "escalation", agent.agent_id, {
                "escalation_id": escalation.escalation_id,
                "principal": escalation.principal,
                "breaches": [b.explanation for b in decision.breaches],
                "breaches_plain": [b.plain for b in decision.breaches],
            })

            approval = self.desk.resolve(escalation)
            self.ledger.append(thread_id, "approval", approval.principal, {
                "approval_id": approval.approval_id, "principal": approval.principal,
                "scope": approval.scope.value, "granted": approval.granted,
                "covers": approval.covers_clause_ids,
            })
            if not approval.granted:
                return None, escalation

            approvals = [approval]
            decision = agent.authorise(intent, offer, incoming, approvals)

            # Partial approval: repair what remains, if it is mechanically fixable.
            if decision.outcome != Outcome.AUTHORISED:
                revised = agent.revise_within_mandate(offer, decision)
                if revised is not None:
                    trial = agent.authorise(intent, revised, incoming, approvals)
                    if trial.outcome == Outcome.AUTHORISED:
                        offer, decision = revised, trial

            if decision.outcome != Outcome.AUTHORISED:
                return None, escalation

        # Authorised. Only now does the model write anything.
        narrative, flags = agent.draft(intent, offer, incoming)
        if flags:
            self.ledger.append(thread_id, "injection_flag", agent.agent_id, {
                "patterns": flags, "source_envelope": incoming.envelope_id if incoming else None,
                "action": "flagged; prose quarantined as data; engine unaffected",
            })

        env = agent.envelope(thread_id, intent, offer, narrative)
        self.ledger.append(thread_id, "decision", agent.agent_id, {
            "outcome": decision.outcome.value,
            "authority_chain": agent.engine.authority_chain(agent.mandate, decision),
            "amendments": decision.amendments_applied,
        })
        self.ledger.append(thread_id, "utterance", agent.agent_id, {
            "envelope_id": env.envelope_id, "intent": intent.value,
            "offer": offer.model_dump(exclude_none=True, mode="json"),
            "narrative": narrative,
        })
        return env, escalation

    def _position(self, agent: Agent, offer: Offer, incoming: Optional[Envelope]) -> str:
        from .models import ClauseKind
        floor = agent._val(ClauseKind.PRICE_MIN)
        if floor and offer.price:
            return (f"proposal clears floor by {offer.price - floor:,.0f} "
                    f"{agent.mandate.currency}; counterparty holding on terms")
        ceiling = agent._val(ClauseKind.PRICE_MAX)
        if ceiling and offer.price:
            return (f"proposal is {ceiling - offer.price:,.0f} {agent.mandate.currency} "
                    f"under ceiling")
        return "no additional context"

    # ----------------------------------------------------------------------

    def run(self, buyer: Agent, seller: Agent,
            thread_id: Optional[str] = None) -> NegotiationResult:
        thread_id = thread_id or _rid("THR")
        result = NegotiationResult()
        current: Optional[Envelope] = None
        turn_of, other = buyer, seller
        accepted_by: set[str] = set()

        for _ in range(self.max_rounds):
            result.rounds += 1
            env, esc = self._turn(turn_of, current, thread_id)
            if esc:
                result.escalations.append(esc)
            if env is None:
                result.terminated = "withdrawn_or_denied"
                return result

            if env.intent == Intent.ACCEPT:
                accepted_by.add(turn_of.agent_id)
                # A commitment exists once one side accepts a standing offer that
                # the other side already authorised and sent.
                result.commitment = self._commit(buyer, seller, env, thread_id)
                result.terminated = "committed"
                return result

            current = env
            turn_of, other = other, turn_of

        return result

    def _commit(self, buyer: Agent, seller: Agent,
                env: Envelope, thread_id: str) -> Commitment:
        # Authority is taken from each agent's FINAL decision in the thread —
        # the authority under which the binding position was actually held, not
        # the union of everything ever true during the negotiation.
        chain = [e for e in self.ledger.entries(thread_id) if e.entry_type == "decision"]

        def last_for(agent_id: str) -> list[str]:
            hits = [e for e in chain if e.actor == agent_id]
            return list(hits[-1].payload["authority_chain"]) if hits else []

        buyer_auth = last_for(buyer.agent_id)
        seller_auth = last_for(seller.agent_id)

        cmt = Commitment(
            commitment_id=_rid("CMT"), thread_id=thread_id,
            buyer_principal=buyer.mandate.principal,
            seller_principal=seller.mandate.principal,
            offer=env.offer, currency=buyer.mandate.currency,
            buyer_authority=buyer_auth,
            seller_authority=seller_auth,
        )
        self.ledger.append(thread_id, "commitment", "orchestrator", {
            "commitment_id": cmt.commitment_id,
            "offer": cmt.offer.model_dump(exclude_none=True, mode="json"),
            "buyer_authority": cmt.buyer_authority,
            "seller_authority": cmt.seller_authority,
        })
        return cmt
