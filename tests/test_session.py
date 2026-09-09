import pytest

from warrant import scenarios
from warrant.engine import AuthorisationEngine
from warrant.models import ApprovalScope, Terms
from warrant.providers import MockProvider, Router
from warrant.session import ApprovalRequired, PausingDesk, ThreadSession, signature

TENANTS = {
    scenarios.BUYER_TENANT.tenant_id: scenarios.BUYER_TENANT,
    scenarios.SELLER_TENANT.tenant_id: scenarios.SELLER_TENANT,
}


def _session(thread_id="T"):
    return ThreadSession(thread_id, scenarios.buyer_mandate(), scenarios.seller_mandate(),
                         TENANTS, Router([MockProvider()]), AuthorisationEngine())


def test_first_advance_pauses_at_the_first_escalation():
    s = _session().advance()
    assert s.status == "awaiting_approval"
    assert s.pending is not None
    assert s.pending.principal == "Omar"
    assert s.commitment is None


def test_paused_thread_records_the_block_before_pausing():
    s = _session().advance()
    types = [e.entry_type for e in s.ledger.entries("T")]
    assert types[-2:] == ["blocked", "escalation"]


def test_declining_closes_the_thread_without_a_commitment():
    s = _session().advance().decide(False, ApprovalScope.FULL)
    assert s.status == "closed_no_deal"
    assert s.commitment is None


def test_approving_advances_to_the_next_principal():
    s = _session().advance().decide(True, ApprovalScope.PRICE_ONLY)
    assert s.status == "awaiting_approval"
    assert s.pending.principal == "Nadia"


def test_full_run_reaches_a_commitment():
    s = _session().advance()
    s.decide(True, ApprovalScope.PRICE_ONLY)
    s.decide(True, ApprovalScope.FULL)
    assert s.status == "committed"
    assert s.commitment.offer.price == 17800.0
    assert s.commitment.offer.terms is Terms.NET_30


def test_replay_is_deterministic_across_resumptions():
    """The property ADR-009 rests on: earlier escalations recur identically."""
    a = _session("A").advance()
    first_sig = signature(a.pending)
    a.decide(True, ApprovalScope.PRICE_ONLY)

    # The Omar escalation must reappear on the replay and be answered from store,
    # not re-raised.
    assert first_sig in a.approvals
    assert a.pending.principal == "Nadia"

    b = _session("B").advance()
    assert signature(b.pending) == first_sig


def test_signature_ignores_run_scoped_ids():
    a, b = _session("A").advance(), _session("B").advance()
    assert a.pending.escalation_id != b.pending.escalation_id
    assert signature(a.pending) == signature(b.pending)


def test_ledger_chain_valid_at_every_stage():
    s = _session().advance()
    assert s.ledger.verify()[0]
    s.decide(True, ApprovalScope.PRICE_ONLY)
    assert s.ledger.verify()[0]
    s.decide(True, ApprovalScope.FULL)
    assert s.ledger.verify()[0]


def test_pausing_desk_raises_when_unanswered():
    s = _session()
    desk = PausingDesk({})
    s.advance()
    with pytest.raises(ApprovalRequired):
        desk.resolve(s.pending)


# -- gauge / state shaping -------------------------------------------------

def test_limits_are_ordered_and_sided():
    s = _session().advance()
    limits = s.limits("Omar")
    values = [x["value"] for x in limits]
    assert values == sorted(values)
    assert {x["label"] for x in limits} == {"Your minimum", "Agent can discount to"}
    assert all(x["hint"] for x in limits), "every gauge tick needs a plain hint"


def test_buyer_limits_include_ceiling_and_unattended_limit():
    s = _session().advance()
    s.decide(True, ApprovalScope.PRICE_ONLY)
    labels = {x["label"] for x in s.limits("Nadia")}
    assert labels == {"Agent can close alone", "Most you will pay"}


def test_offered_scopes_include_both_partials_for_mixed_breaches():
    """Omar's block mixes a price breach and a terms breach, so either partial
    approval is a meaningful choice."""
    s = _session().advance()
    scopes = {x["scope"] for x in s.state()["pending"]["offered_scopes"]}
    assert scopes == {"full", "price_only", "terms_only"}


def test_offered_scopes_collapse_to_full_for_single_kind():
    s = _session().advance()
    s.decide(True, ApprovalScope.PRICE_ONLY)
    scopes = {x["scope"] for x in s.state()["pending"]["offered_scopes"]}
    assert scopes == {"full"}


def test_every_breach_carries_a_plain_sentence():
    """The audit record keeps the precise wording; the person gets English."""
    s = _session().advance()
    for b in s.pending.decision.breaches:
        assert b.plain and b.plain != b.explanation
        assert "allowlist" not in b.plain
        assert "_" not in b.plain


def test_pending_says_who_the_person_is():
    s = _session().advance()
    assert s.state()["pending"]["who_you_are"].startswith("You own the trucks")


def test_every_offered_scope_has_a_hint():
    s = _session().advance()
    for sc in s.state()["pending"]["offered_scopes"]:
        assert sc["hint"]


def test_state_is_json_serialisable():
    import json
    s = _session().advance()
    json.dumps(s.state())
    s.decide(True, ApprovalScope.PRICE_ONLY)
    s.decide(True, ApprovalScope.FULL)
    json.dumps(s.state())
