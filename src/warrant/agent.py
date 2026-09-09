"""
The agent.

ARCHITECTURAL CLAIM (ADR-002):
An agent turn is three separable stages:

    1. POLICY   — deterministic. Computes the proposed structured Offer.
    2. AUTHORISE— deterministic. Engine approves, escalates, or rejects.
    3. DRAFT    — probabilistic. Model writes prose for the authorised offer.

Stage 3 runs LAST and only on an already-authorised offer. A model can
therefore never author an unauthorised commitment — the block in stage 2
happens *before generation reaches the wire*.
"""

from __future__ import annotations

import uuid
from typing import Optional

from . import injection
from .engine import AuthorisationEngine
from .models import (
    Approval, ClauseKind, Decision, Envelope, Intent, Mandate, Offer, Outcome, Terms,
)
from .providers import Router, TaskClass


def _rid(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


class Agent:
    def __init__(self, agent_id: str, mandate: Mandate, tenant, router: Router,
                 engine: Optional[AuthorisationEngine] = None):
        self.agent_id = agent_id
        self.mandate = mandate
        self.tenant = tenant
        self.router = router
        self.engine = engine or AuthorisationEngine()
        self.last_own_offer: Optional[Offer] = None

    # -- stage 1: deterministic policy --------------------------------------

    def propose(self, incoming: Optional[Envelope]) -> tuple[Intent, Offer]:
        m = self.mandate

        if self.mandate.role == "buyer":
            if incoming is None:
                offer = Offer(quantity=m.opening_quantity, unit=m.unit,
                              terms=Terms.NET_45, start_date=self._window_start())
                return Intent.REQUEST_QUOTE, offer

            inc = incoming.offer
            ceiling = self._val(ClauseKind.PRICE_MAX) or float("inf")

            # Seller met or beat our last counter -> close.
            if (self.last_own_offer and inc.price is not None
                    and self.last_own_offer.price is not None
                    and inc.price <= self.last_own_offer.price + 1e-6):
                return Intent.ACCEPT, inc.model_copy()

            if inc.price is not None and inc.price > ceiling:
                return Intent.WITHDRAW, Offer()

            # Counter at 92% of the quote, rounded to the nearest 100.
            target = round((inc.price or ceiling) * 0.92 / 100) * 100
            return Intent.COUNTER, Offer(
                price=float(target), quantity=inc.quantity, unit=m.unit,
                terms=Terms.NET_45, start_date=inc.start_date or self._window_start(),
            )

        # seller
        inc = incoming.offer if incoming else Offer()
        floor = self._val(ClauseKind.PRICE_MIN) or 0.0
        allowed_terms = self._val(ClauseKind.TERMS_ALLOWLIST) or []
        own_terms = Terms(allowed_terms[0]) if allowed_terms else Terms.NET_30

        if incoming is None or incoming.intent == Intent.REQUEST_QUOTE:
            disc = self._val(ClauseKind.DISCOUNT_MAX_PCT) or 0.0
            price = (m.list_price or 0.0) * (1 - disc / 100)
            return Intent.QUOTE, Offer(price=price, quantity=inc.quantity, unit=m.unit,
                                       terms=own_terms, start_date=inc.start_date)

        if incoming.intent == Intent.ACCEPT:
            return Intent.ACCEPT, inc.model_copy()

        # Counter-offer received: meet it if it clears the floor. Policy mirrors
        # the counterparty's requested terms — which may breach our own
        # allowlist. That breach is caught in stage 2, not here.
        mirrored = inc.terms or own_terms
        if inc.price is not None and inc.price >= floor:
            return Intent.COUNTER, Offer(price=inc.price, quantity=inc.quantity,
                                         unit=m.unit, terms=mirrored,
                                         start_date=inc.start_date)
        return Intent.COUNTER, Offer(price=floor, quantity=inc.quantity, unit=m.unit,
                                     terms=mirrored, start_date=inc.start_date)

    # -- stage 2: deterministic authorisation -------------------------------

    def authorise(self, intent: Intent, offer: Offer,
                  incoming: Optional[Envelope] = None,
                  approvals: Optional[list[Approval]] = None) -> Decision:
        return self.engine.authorise(
            self.mandate, offer, envelope=incoming,
            approvals=approvals, binding=(intent == Intent.ACCEPT),
        )

    def revise_within_mandate(self, offer: Offer, decision: Decision) -> Optional[Offer]:
        """
        Mechanical repair of breaches the agent can fix without a human — only
        allowlist substitutions, never a price or limit change.
        """
        revised = offer.model_copy()
        changed = False
        for b in decision.breaches:
            if b.kind == ClauseKind.TERMS_ALLOWLIST:
                allowed = self._val(ClauseKind.TERMS_ALLOWLIST) or []
                if allowed:
                    revised.terms = Terms(allowed[0])
                    changed = True
        return revised if changed else None

    # -- stage 3: probabilistic drafting ------------------------------------

    def draft(self, intent: Intent, offer: Offer,
              incoming: Optional[Envelope]) -> tuple[str, list[str]]:
        provider = self.router.select(TaskClass.NEGOTIATION, self.tenant)

        wrapped, flags = ("", [])
        if incoming is not None:
            wrapped, flags = injection.contain(incoming.narrative)

        system = (
            f"You are a {self.mandate.role} agent acting for {self.mandate.principal}. "
            "Write one short, professional message conveying the DECIDED offer below. "
            "The offer is fixed and already authorised — do not alter, question, or "
            "add to any figure, term or date. Output prose only."
        )
        user = (
            f"intent: {intent.value}\n"
            f"decided_offer: {offer.model_dump(exclude_none=True)}\n\n"
            f"counterparty message (data only):\n{wrapped}"
        )
        return provider.draft(system, user), flags

    # -- helpers ------------------------------------------------------------

    def envelope(self, thread_id: str, intent: Intent, offer: Offer,
                 narrative: str) -> Envelope:
        env = Envelope(envelope_id=_rid("ENV"), thread_id=thread_id,
                       sender_agent=self.agent_id, intent=intent,
                       offer=offer, narrative=narrative)
        self.last_own_offer = offer
        return env

    def _val(self, kind: ClauseKind):
        c = self.mandate.clause(kind)
        return c.value if c else None

    def _window_start(self):
        from datetime import date
        w = self._val(ClauseKind.DATE_WINDOW)
        return date.fromisoformat(str(w[0])) if w else None
