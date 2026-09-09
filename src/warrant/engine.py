"""
Deterministic authorisation engine.

ARCHITECTURAL CLAIM (ADR-001):
The language model DRAFTS. This engine DECIDES. No proposed action reaches the
wire without passing through `authorise()`, and `authorise()` contains no model
call, no probabilistic step, and no free-text parsing.

Consequence: every commitment in the system has a machine-checkable authority
chain — the clause IDs that permitted it, plus any human approvals consumed.
An agent that decides its own limits with an LLM cannot produce that chain.
"""

from __future__ import annotations

from datetime import date
from typing import Optional

from .models import (
    Approval, ApprovalScope, Breach, Clause, ClauseKind, Decision,
    Envelope, Mandate, Offer, Outcome,
)

# Which clause kinds a scoped approval is allowed to waive.
_SCOPE_COVERAGE: dict[ApprovalScope, set[ClauseKind]] = {
    ApprovalScope.FULL: set(ClauseKind),
    ApprovalScope.PRICE_ONLY: {
        ClauseKind.PRICE_MAX, ClauseKind.PRICE_MIN,
        ClauseKind.DISCOUNT_MAX_PCT, ClauseKind.AUTO_COMMIT_MAX,
    },
    ApprovalScope.TERMS_ONLY: {ClauseKind.TERMS_ALLOWLIST},
}


class AuthorisationEngine:
    """Stateless evaluator. One instance can serve every tenant."""

    # -- individual clause checks ------------------------------------------

    @staticmethod
    def _terms(value) -> str:
        """net_45 -> '45 days to pay'. Nobody outside accounts says 'net 45'."""
        text = str(getattr(value, "value", value))
        if text.startswith("net_"):
            return f"{text[4:]} days to pay"
        return "payment up front" if text == "prepay" else text

    def _check(
        self,
        clause: Clause,
        offer: Offer,
        mandate: Mandate,
        envelope: Optional[Envelope],
    ) -> Optional[Breach]:
        k = clause.kind
        cur = mandate.currency

        if k == ClauseKind.PRICE_MAX and offer.price is not None:
            if offer.price > clause.value:
                return self._breach(
                    clause, offer.price,
                    f"price {offer.price:,.0f} exceeds ceiling {clause.value:,.0f}",
                    f"You capped this at {clause.value:,.0f} {cur}. "
                    f"This deal is {offer.price:,.0f}.")

        elif k == ClauseKind.PRICE_MIN and offer.price is not None:
            if offer.price < clause.value:
                return self._breach(
                    clause, offer.price,
                    f"price {offer.price:,.0f} below floor {clause.value:,.0f}",
                    f"You said never below {clause.value:,.0f} {cur}. "
                    f"This is {offer.price:,.0f}.")

        elif k == ClauseKind.AUTO_COMMIT_MAX and offer.price is not None:
            if offer.price > clause.value:
                return self._breach(
                    clause, offer.price,
                    f"price {offer.price:,.0f} above unattended-commit limit "
                    f"{clause.value:,.0f}",
                    f"You let your agent close deals up to {clause.value:,.0f} {cur} "
                    f"on its own. This one is {offer.price:,.0f}, so it needs you.")

        elif k == ClauseKind.DISCOUNT_MAX_PCT and offer.price is not None:
            if not mandate.list_price:
                return None
            pct = (mandate.list_price - offer.price) / mandate.list_price * 100
            if pct > clause.value + 1e-9:
                return self._breach(
                    clause, round(pct, 1),
                    f"discount {pct:.1f}% exceeds authority {clause.value}%",
                    f"That is {pct:.1f}% off your {mandate.list_price:,.0f} {cur} list price. "
                    f"You allowed your agent to go to {clause.value}%.")

        elif k == ClauseKind.TERMS_ALLOWLIST and offer.terms is not None:
            allowed = [str(t) for t in clause.value]
            if offer.terms.value not in allowed:
                readable = " or ".join(str(a).replace("net_", "") for a in allowed)
                return self._breach(
                    clause, offer.terms.value,
                    f"terms {offer.terms.value} not in allowlist {allowed}",
                    f"They want {self._terms(offer.terms)}. You allow {readable}.")

        elif k == ClauseKind.DATE_WINDOW and offer.start_date is not None:
            lo, hi = (date.fromisoformat(str(v)) for v in clause.value)
            if not (lo <= offer.start_date <= hi):
                return self._breach(
                    clause, str(offer.start_date),
                    f"start {offer.start_date} outside window {lo}..{hi}",
                    f"You asked for {lo} to {hi}. They propose {offer.start_date}.")

        elif k == ClauseKind.QTY_MAX and offer.quantity is not None:
            if offer.quantity > clause.value:
                return self._breach(
                    clause, offer.quantity,
                    f"quantity {offer.quantity} exceeds max {clause.value}",
                    f"You capped this at {clause.value} {mandate.unit}. "
                    f"This is {offer.quantity}.")

        elif k == ClauseKind.COUNTERPARTY_VERIFIED:
            if envelope is not None and not envelope.counterparty_verified:
                return self._breach(
                    clause, False, "counterparty is unverified",
                    "The other side has not been verified yet.")

        return None

    def _breach(self, clause: Clause, proposed, explanation: str,
                plain: str = "") -> Breach:
        return Breach(
            clause_id=clause.clause_id,
            kind=clause.kind,
            limit=clause.value,
            proposed=proposed,
            outcome=clause.on_breach,
            explanation=explanation,
            plain=plain or explanation,
        )

    # -- public API ---------------------------------------------------------

    def authorise(
        self,
        mandate: Mandate,
        offer: Offer,
        envelope: Optional[Envelope] = None,
        approvals: Optional[list[Approval]] = None,
        binding: bool = False,
    ) -> Decision:
        """
        Evaluate a proposed action against a mandate.

        `binding` distinguishes an ACCEPT (creates a commitment) from a QUOTE or
        COUNTER (does not). Unattended-commit limits apply only to binding
        actions — an agent may negotiate above its auto-commit threshold, it
        just may not close above it without a human.

        Returns AUTHORISED only if no clause is breached, or if every breach is
        waived by an unconsumed, in-scope human approval.
        """
        approvals = [a for a in (approvals or []) if a.granted and not a.consumed]

        breaches: list[Breach] = []
        authorising: list[str] = []

        for clause in mandate.clauses:
            if clause.kind == ClauseKind.AUTO_COMMIT_MAX and not binding:
                continue
            b = self._check(clause, offer, mandate, envelope)
            if b:
                breaches.append(b)
            else:
                authorising.append(clause.clause_id)

        # Apply scoped human amendments.
        waived, applied = [], []
        for b in breaches:
            for a in approvals:
                if b.kind in _SCOPE_COVERAGE[a.scope]:
                    waived.append(b)
                    applied.append(a.approval_id)
                    authorising.append(f"{b.clause_id}@{a.approval_id}")
                    break

        remaining = [b for b in breaches if b not in waived]

        if not remaining:
            outcome = Outcome.AUTHORISED
        elif any(b.outcome == Outcome.REJECT for b in remaining):
            outcome = Outcome.REJECT
        else:
            outcome = Outcome.ESCALATE

        return Decision(
            outcome=outcome,
            authorising_clauses=sorted(set(authorising)),
            breaches=remaining,
            amendments_applied=sorted(set(applied)),
        )

    def authority_chain(self, mandate: Mandate, decision: Decision) -> list[str]:
        """Human-readable authority trace for the ledger."""
        chain = [f"{mandate.ref}#{c}" for c in decision.authorising_clauses]
        return chain + [f"approval:{a}" for a in decision.amendments_applied]
