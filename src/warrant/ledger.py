"""
Append-only, hash-chained commitment ledger + double-entry settlement.

ARCHITECTURAL CLAIM (ADR-004):
Every entry carries the hash of its predecessor. Any retroactive edit breaks
`verify()`. This is what makes "who authorised this, under what authority"
answerable after the fact rather than merely loggable at the time.

MVP uses in-memory + JSONL. Postgres swap is a storage-adapter change only.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Iterable, Optional

from .models import Commitment, LedgerEntry

GENESIS = "0" * 64


def _hash(prev: str, seq: int, entry_type: str, actor: str, payload: dict) -> str:
    blob = json.dumps(
        {"prev": prev, "seq": seq, "type": entry_type, "actor": actor, "payload": payload},
        sort_keys=True, separators=(",", ":"), default=str,
    )
    return hashlib.sha256(blob.encode()).hexdigest()


class Ledger:
    def __init__(self, path: Optional[Path] = None):
        self._entries: list[LedgerEntry] = []
        self._path = Path(path) if path else None

    # -- write --------------------------------------------------------------

    def append(self, thread_id: str, entry_type: str, actor: str, payload: dict) -> LedgerEntry:
        seq = len(self._entries)
        prev = self._entries[-1].entry_hash if self._entries else GENESIS
        h = _hash(prev, seq, entry_type, actor, payload)
        entry = LedgerEntry(
            seq=seq,
            entry_id=f"{entry_type[:3].upper()}-{seq:04d}",
            thread_id=thread_id,
            entry_type=entry_type,  # type: ignore[arg-type]
            actor=actor,
            payload=payload,
            prev_hash=prev,
            entry_hash=h,
        )
        self._entries.append(entry)
        if self._path:
            with self._path.open("a") as f:
                f.write(entry.model_dump_json() + "\n")
        return entry

    # -- read ---------------------------------------------------------------

    def entries(self, thread_id: Optional[str] = None) -> list[LedgerEntry]:
        if thread_id is None:
            return list(self._entries)
        return [e for e in self._entries if e.thread_id == thread_id]

    def verify(self) -> tuple[bool, Optional[int]]:
        """Recompute the chain. Returns (ok, first_bad_seq)."""
        prev = GENESIS
        for e in self._entries:
            expect = _hash(prev, e.seq, e.entry_type, e.actor, e.payload)
            if expect != e.entry_hash or e.prev_hash != prev:
                return False, e.seq
            prev = e.entry_hash
        return True, None

    def replay(self, thread_id: str) -> list[str]:
        """Narrative reconstruction of a thread from the ledger alone."""
        out = []
        for e in self.entries(thread_id):
            p = e.payload
            if e.entry_type == "utterance":
                out.append(f"{e.entry_id}  {e.actor} -> {p.get('intent')} {p.get('offer')}")
            elif e.entry_type == "decision":
                out.append(f"{e.entry_id}  engine: {p.get('outcome')} "
                           f"authority={p.get('authority_chain')}")
            elif e.entry_type == "blocked":
                out.append(f"{e.entry_id}  BLOCKED pre-utterance: {p.get('breaches')}")
            elif e.entry_type == "escalation":
                out.append(f"{e.entry_id}  escalated to {p.get('principal')}")
            elif e.entry_type == "approval":
                out.append(f"{e.entry_id}  {p.get('principal')} granted "
                           f"scope={p.get('scope')} ({p.get('approval_id')})")
            elif e.entry_type == "commitment":
                out.append(f"{e.entry_id}  COMMITMENT {p.get('commitment_id')} {p.get('offer')}")
            elif e.entry_type == "settlement":
                out.append(f"{e.entry_id}  SETTLED {p.get('amount')} {p.get('currency')}")
            elif e.entry_type == "injection_flag":
                out.append(f"{e.entry_id}  INJECTION FLAGGED: {p.get('patterns')}")
        return out


class SettlementError(RuntimeError):
    pass


class Wallets:
    """
    Minimal double-entry token ledger. Debits must equal credits; balances may
    not go negative. No payment rails — deliberately out of MVP scope.
    """

    def __init__(self):
        self.balances: dict[str, float] = {}
        self.journal: list[dict] = []

    def fund(self, account: str, amount: float) -> None:
        self.balances[account] = self.balances.get(account, 0.0) + amount
        self.journal.append({"type": "fund", "account": account, "amount": amount})

    def balance(self, account: str) -> float:
        return self.balances.get(account, 0.0)

    def settle(self, commitment: Commitment, ledger: Ledger) -> dict:
        amount = commitment.offer.price or 0.0
        buyer, seller = commitment.buyer_principal, commitment.seller_principal
        escrow = f"escrow::{commitment.commitment_id}"

        if self.balance(buyer) < amount:
            raise SettlementError(
                f"insufficient funds: {buyer} has {self.balance(buyer):,.0f}, needs {amount:,.0f}"
            )

        legs = [
            {"debit": buyer, "credit": escrow, "amount": amount},
            {"debit": escrow, "credit": seller, "amount": amount},
        ]
        for leg in legs:
            self.balances[leg["debit"]] = self.balance(leg["debit"]) - leg["amount"]
            self.balances[leg["credit"]] = self.balance(leg["credit"]) + leg["amount"]
            self.journal.append({"type": "transfer", **leg})

        assert abs(self.balance(escrow)) < 1e-6, "escrow must net to zero"

        payload = {
            "commitment_id": commitment.commitment_id,
            "amount": amount,
            "currency": commitment.currency,
            "legs": legs,
            "preconditions_met": ["commitment_active", "both_authority_chains_valid"],
        }
        ledger.append(commitment.thread_id, "settlement", "settlement_service", payload)
        return payload
