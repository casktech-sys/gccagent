from datetime import date

import pytest

from warrant import scenarios
from warrant.engine import AuthorisationEngine
from warrant.models import (
    Approval, ApprovalScope, ClauseKind, Envelope, Intent, Offer, Outcome, Terms,
)

E = AuthorisationEngine()


@pytest.fixture
def buyer():
    return scenarios.buyer_mandate()


@pytest.fixture
def seller():
    return scenarios.seller_mandate()


def _offer(**kw):
    base = dict(price=18500.0, quantity=3, unit="trucks", terms=Terms.NET_30,
                start_date=date(2026, 10, 1))
    base.update(kw)
    return Offer(**base)


# -- core outcomes ---------------------------------------------------------

def test_compliant_non_binding_offer_is_authorised(buyer):
    d = E.authorise(buyer, _offer(), binding=False)
    assert d.outcome is Outcome.AUTHORISED
    assert d.may_send
    assert "budget_ceiling" in d.authorising_clauses


def test_hard_ceiling_breach_rejects_not_escalates(buyer):
    d = E.authorise(buyer, _offer(price=23000.0))
    assert d.outcome is Outcome.REJECT


def test_terms_outside_allowlist_escalates(seller):
    d = E.authorise(seller, _offer(price=19320.0, terms=Terms.NET_45))
    assert d.outcome is Outcome.ESCALATE
    assert {b.kind for b in d.breaches} == {ClauseKind.TERMS_ALLOWLIST}


def test_date_outside_window_escalates(buyer):
    d = E.authorise(buyer, _offer(start_date=date(2026, 11, 20)))
    assert d.outcome is Outcome.ESCALATE
    assert d.breaches[0].kind is ClauseKind.DATE_WINDOW


def test_discount_authority_computed_against_list_price(seller):
    assert E.authorise(seller, _offer(price=19320.0)).outcome is Outcome.AUTHORISED  # 8.0%
    d = E.authorise(seller, _offer(price=19200.0))                                   # 8.6%
    assert d.outcome is Outcome.ESCALATE
    assert d.breaches[0].kind is ClauseKind.DISCOUNT_MAX_PCT


def test_price_floor_breach_rejects(seller):
    assert E.authorise(seller, _offer(price=12000.0)).outcome is Outcome.REJECT


# -- binding distinction (ADR-001) ----------------------------------------

def test_auto_commit_limit_ignored_for_non_binding_action(buyer):
    """An agent may negotiate above its unattended-commit limit."""
    assert E.authorise(buyer, _offer(price=17800.0), binding=False).outcome is Outcome.AUTHORISED


def test_auto_commit_limit_enforced_for_binding_action(buyer):
    """It may not close above it without a human."""
    d = E.authorise(buyer, _offer(price=17800.0), binding=True)
    assert d.outcome is Outcome.ESCALATE
    assert d.breaches[0].kind is ClauseKind.AUTO_COMMIT_MAX


# -- scoped approvals ------------------------------------------------------

def _approval(scope, mandate):
    return Approval(approval_id="APR-T1", mandate_ref=mandate.ref,
                    principal=mandate.principal, thread_id="T", scope=scope, granted=True)


def test_price_only_approval_waives_price_but_not_terms(seller):
    offer = _offer(price=17800.0, terms=Terms.NET_45)
    d = E.authorise(seller, offer, approvals=[_approval(ApprovalScope.PRICE_ONLY, seller)])
    assert d.outcome is Outcome.ESCALATE
    assert {b.kind for b in d.breaches} == {ClauseKind.TERMS_ALLOWLIST}
    assert "APR-T1" in d.amendments_applied


def test_full_approval_waives_everything(seller):
    offer = _offer(price=17800.0, terms=Terms.NET_45)
    d = E.authorise(seller, offer, approvals=[_approval(ApprovalScope.FULL, seller)])
    assert d.outcome is Outcome.AUTHORISED


def test_denied_approval_is_not_applied(seller):
    a = _approval(ApprovalScope.FULL, seller)
    a.granted = False
    assert E.authorise(seller, _offer(price=17800.0), approvals=[a]).outcome is Outcome.ESCALATE


def test_consumed_approval_does_not_persist(seller):
    a = _approval(ApprovalScope.FULL, seller)
    a.consumed = True
    assert E.authorise(seller, _offer(price=17800.0), approvals=[a]).outcome is Outcome.ESCALATE


# -- counterparty verification --------------------------------------------

def test_unverified_counterparty_escalates(buyer):
    env = Envelope(envelope_id="E1", thread_id="T", sender_agent="x",
                   intent=Intent.QUOTE, offer=_offer(), counterparty_verified=False)
    d = E.authorise(buyer, _offer(), envelope=env)
    assert d.outcome is Outcome.ESCALATE
    assert any(b.kind is ClauseKind.COUNTERPARTY_VERIFIED for b in d.breaches)


# -- determinism -----------------------------------------------------------

def test_engine_is_deterministic(buyer):
    offer = _offer(price=17800.0)
    outs = {E.authorise(buyer, offer, binding=True).outcome for _ in range(50)}
    assert len(outs) == 1


def test_authority_chain_is_traceable(buyer):
    d = E.authorise(buyer, _offer(price=17800.0), binding=True,
                    approvals=[_approval(ApprovalScope.FULL, buyer)])
    chain = E.authority_chain(buyer, d)
    assert all(c.startswith("MND-BUY-001.v1#") or c.startswith("approval:") for c in chain)
    assert "approval:APR-T1" in chain
