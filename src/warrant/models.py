"""
Core domain models.

Design note: every object that can affect an authorisation decision is typed.
Free text from a counterparty is *never* a field the engine reads. It travels
in `narrative` and is treated as untrusted data throughout.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------------
# Residency
# --------------------------------------------------------------------------

class Jurisdiction(str, Enum):
    """
    GCC data-residency regimes are not one regime. A tenant is bound to exactly
    one, and that binding governs both storage and inference routing.
    """
    UAE_FEDERAL = "ae-federal"      # Federal PDPL
    UAE_DIFC = "ae-difc"            # DIFC DP Law (separate common-law jurisdiction)
    UAE_ADGM = "ae-adgm"            # ADGM DP Regulations
    KSA = "sa"                      # NDMO / SDAIA
    QA = "qa"
    OTHER = "other"


class Tenant(BaseModel):
    tenant_id: str
    display_name: str
    jurisdiction: Jurisdiction
    # Inference may only be routed to providers offering these regions.
    allowed_inference_regions: list[str] = Field(default_factory=lambda: ["me-central"])
    allow_cross_border_inference: bool = False


# --------------------------------------------------------------------------
# Mandate
# --------------------------------------------------------------------------

class ClauseKind(str, Enum):
    PRICE_MAX = "price_max"                  # buyer: hard ceiling
    PRICE_MIN = "price_min"                  # seller: floor
    AUTO_COMMIT_MAX = "auto_commit_max"      # above this -> human approval
    DISCOUNT_MAX_PCT = "discount_max_pct"    # seller: discount authority off list
    TERMS_ALLOWLIST = "terms_allowlist"      # permitted payment terms
    DATE_WINDOW = "date_window"              # permitted start window
    COUNTERPARTY_VERIFIED = "counterparty_verified"
    QTY_MAX = "qty_max"


class Outcome(str, Enum):
    AUTHORISED = "authorised"
    ESCALATE = "escalate"
    REJECT = "reject"


class Clause(BaseModel):
    clause_id: str
    kind: ClauseKind
    value: Any
    on_breach: Literal[Outcome.ESCALATE, Outcome.REJECT] = Outcome.ESCALATE
    note: str = ""


class Mandate(BaseModel):
    """
    The permission envelope. Declarative, versioned, and the only source of
    authority in the system. The LLM never edits this.
    """
    mandate_id: str
    version: int = 1
    tenant_id: str
    principal: str
    role: Literal["buyer", "seller"]
    scope: str
    who_you_are: str = ""                # one line identifying the principal
    subject: str = ""                    # what is being traded, for humans only
    unit: str = "units"                  # label for quantity, for humans only
    opening_quantity: int = 1            # buyer only: how much it sets out to buy
    list_price: Optional[float] = None   # seller only, basis for discount_max_pct
    currency: str = "AED"
    clauses: list[Clause] = Field(default_factory=list)

    def clause(self, kind: ClauseKind) -> Optional[Clause]:
        for c in self.clauses:
            if c.kind == kind:
                return c
        return None

    @property
    def ref(self) -> str:
        return f"{self.mandate_id}.v{self.version}"


# --------------------------------------------------------------------------
# Wire protocol
# --------------------------------------------------------------------------

class Intent(str, Enum):
    REQUEST_QUOTE = "request_quote"
    QUOTE = "quote"
    COUNTER = "counter"
    ACCEPT = "accept"
    WITHDRAW = "withdraw"


class Terms(str, Enum):
    NET_30 = "net_30"
    NET_45 = "net_45"
    NET_60 = "net_60"
    PREPAY = "prepay"


class Offer(BaseModel):
    """
    The structured, machine-readable substance of a turn.

    `quantity` is deliberately unitless to the engine — a limit is a limit
    whether the units are trucks, pallets, seats or hours. `unit` exists only so
    the interface can say "3 trucks" instead of "3".
    """
    price: Optional[float] = None
    quantity: Optional[int] = None
    unit: Optional[str] = None
    terms: Optional[Terms] = None
    start_date: Optional[date] = None


class Envelope(BaseModel):
    """
    What actually crosses the wire between two agents.

    `narrative` is generated prose for the human reader. It is UNTRUSTED and is
    never parsed for intent, never used in an authorisation decision, and is
    always wrapped as data before it reaches a model.
    """
    envelope_id: str
    thread_id: str
    sender_agent: str
    intent: Intent
    offer: Offer = Field(default_factory=Offer)
    narrative: str = ""
    counterparty_verified: bool = True
    created_at: str = Field(default_factory=_now)


# --------------------------------------------------------------------------
# Authorisation
# --------------------------------------------------------------------------

class Breach(BaseModel):
    """
    Two renderings of the same fact, deliberately.

    `explanation` is precise and goes in the ledger, where an auditor needs the
    exact figures and units. `plain` is what a business owner reads at 6am on a
    phone. Neither is a translation of the other at display time — both are
    produced where the fact is known, so the audit record never depends on the
    interface and the interface never has to parse the audit record.
    """
    clause_id: str
    kind: ClauseKind
    limit: Any
    proposed: Any
    outcome: Outcome
    explanation: str
    plain: str = ""


class Decision(BaseModel):
    """
    Output of the deterministic engine. This is the audit primitive: it names
    the clauses that authorised an action and the clauses that blocked it.
    """
    outcome: Outcome
    authorising_clauses: list[str] = Field(default_factory=list)
    breaches: list[Breach] = Field(default_factory=list)
    amendments_applied: list[str] = Field(default_factory=list)
    evaluated_at: str = Field(default_factory=_now)

    @property
    def may_send(self) -> bool:
        return self.outcome == Outcome.AUTHORISED


# --------------------------------------------------------------------------
# Human approvals & scoped amendments
# --------------------------------------------------------------------------

class ApprovalScope(str, Enum):
    FULL = "full"                 # authorise every breach in this decision
    PRICE_ONLY = "price_only"     # authorise price/discount breaches only
    TERMS_ONLY = "terms_only"


class Approval(BaseModel):
    """
    A human tap. Creates a single-use, scoped amendment to the mandate for one
    proposed action. It does NOT widen the mandate for future turns.
    """
    approval_id: str
    mandate_ref: str
    principal: str
    thread_id: str
    scope: ApprovalScope
    granted: bool
    covers_clause_ids: list[str] = Field(default_factory=list)
    granted_at: str = Field(default_factory=_now)
    consumed: bool = False


class EscalationRequest(BaseModel):
    escalation_id: str
    thread_id: str
    principal: str
    mandate_ref: str
    proposed: Offer
    decision: Decision
    agent_position: str
    created_at: str = Field(default_factory=_now)
    resolved_by: Optional[str] = None


# --------------------------------------------------------------------------
# Commitments & settlement
# --------------------------------------------------------------------------

class Commitment(BaseModel):
    commitment_id: str
    thread_id: str
    buyer_principal: str
    seller_principal: str
    offer: Offer
    currency: str = "AED"
    buyer_authority: list[str] = Field(default_factory=list)
    seller_authority: list[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=_now)


class LedgerEntry(BaseModel):
    seq: int
    entry_id: str
    thread_id: str
    entry_type: Literal[
        "utterance", "decision", "escalation", "approval",
        "commitment", "settlement", "blocked", "injection_flag",
    ]
    actor: str
    payload: dict
    prev_hash: str
    entry_hash: str = ""
    created_at: str = Field(default_factory=_now)
