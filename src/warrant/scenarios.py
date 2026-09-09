"""
Reference scenario: cross-border road freight, Jebel Ali to Riyadh.

Why this trade. Jebel Ali is one of the region's main gateways, and cargo
landing there moves inland by road under spot rates negotiated per load,
thousands of times a day, between operators with thin margins. Loads clear
customs overnight, so the people negotiating are frequently asleep. That is the
case for delegation: rounds one to three happen without them, and they are woken
only when someone's authority runs out.

The engine knows none of this. It sees a price, a quantity, payment terms and a
date. Swapping the trade means editing this file and nothing else — which is the
extensibility claim, stated as a file rather than a paragraph.

All figures are synthetic but sit inside the published range for cross-border
full-truckload rates on this lane (roughly AED 4,500–7,500 per 20-tonne truck).
"""

from __future__ import annotations

from .models import Clause, ClauseKind, Jurisdiction, Mandate, Outcome, Tenant

# The shipper sits in a DIFC-registered trading arm; the haulier is a mainland
# UAE company. Same country, two different data-protection regimes.
BUYER_TENANT = Tenant(
    tenant_id="tn_shipper", display_name="Shipper (DIFC)",
    jurisdiction=Jurisdiction.UAE_DIFC,
    allowed_inference_regions=["me-central", "eu-west", "us-east"],
    allow_cross_border_inference=True,
)

SELLER_TENANT = Tenant(
    tenant_id="tn_haulier", display_name="Haulier (UAE mainland)",
    jurisdiction=Jurisdiction.UAE_FEDERAL,
    allowed_inference_regions=["me-central", "eu-west", "us-east"],
    allow_cross_border_inference=True,
)

# A Saudi-registered operator that may not send data out of the Kingdom.
# Used to demonstrate routing refusal rather than silent downgrade.
STRICT_TENANT = Tenant(
    tenant_id="tn_ksa_operator", display_name="Riyadh operator (KSA)",
    jurisdiction=Jurisdiction.KSA,
    allowed_inference_regions=["me-central"],
    allow_cross_border_inference=False,
)

LANE = "Road freight, Jebel Ali to Riyadh"


def buyer_mandate() -> Mandate:
    """Nadia books inbound haulage for a distributor. She needs three trucks."""
    return Mandate(
        mandate_id="MND-BUY-001", version=1, tenant_id=BUYER_TENANT.tenant_id,
        principal="Nadia", role="buyer", scope="book_freight",
        who_you_are="You book the transport. You are paying for this run.",
        subject=LANE, unit="trucks", opening_quantity=3, currency="AED",
        clauses=[
            Clause(clause_id="budget_ceiling", kind=ClauseKind.PRICE_MAX,
                   value=22000, on_breach=Outcome.REJECT,
                   note="the load stops being worth moving above this"),
            Clause(clause_id="unattended_commit_limit", kind=ClauseKind.AUTO_COMMIT_MAX,
                   value=15000, on_breach=Outcome.ESCALATE,
                   note="may keep negotiating above this, may not book above it"),
            Clause(clause_id="payment_terms", kind=ClauseKind.TERMS_ALLOWLIST,
                   value=["net_30", "net_45"], on_breach=Outcome.ESCALATE),
            Clause(clause_id="collection_window", kind=ClauseKind.DATE_WINDOW,
                   value=["2026-10-01", "2026-10-15"], on_breach=Outcome.ESCALATE,
                   note="cargo clears the port in this window"),
            Clause(clause_id="truck_cap", kind=ClauseKind.QTY_MAX, value=5,
                   on_breach=Outcome.ESCALATE),
            Clause(clause_id="verified_carrier", kind=ClauseKind.COUNTERPARTY_VERIFIED,
                   value=True, on_breach=Outcome.ESCALATE,
                   note="cross-border carriers must be verified before booking"),
        ],
    )


def seller_mandate() -> Mandate:
    """Omar runs the trucks. List is 7,000 per truck; three trucks is 21,000."""
    return Mandate(
        mandate_id="MND-SEL-001", version=1, tenant_id=SELLER_TENANT.tenant_id,
        principal="Omar", role="seller", scope="sell_haulage",
        who_you_are="You own the trucks. You are being paid for this run.",
        subject=LANE, unit="trucks", currency="AED", list_price=21000,
        clauses=[
            Clause(clause_id="price_floor", kind=ClauseKind.PRICE_MIN,
                   value=17400, on_breach=Outcome.REJECT,
                   note="fuel, driver and border costs; never waivable in-flight"),
            Clause(clause_id="discount_authority", kind=ClauseKind.DISCOUNT_MAX_PCT,
                   value=8, on_breach=Outcome.ESCALATE,
                   note="the desk may discount this far without asking Omar"),
            Clause(clause_id="payment_terms", kind=ClauseKind.TERMS_ALLOWLIST,
                   value=["net_30"], on_breach=Outcome.ESCALATE,
                   note="cash cycle will not carry longer terms"),
            Clause(clause_id="verified_shipper", kind=ClauseKind.COUNTERPARTY_VERIFIED,
                   value=True, on_breach=Outcome.ESCALATE),
        ],
    )
