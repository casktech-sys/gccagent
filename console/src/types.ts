export type Outcome = "authorised" | "escalate" | "reject";
export type Scope = "full" | "price_only" | "terms_only";

export interface Offer {
  price?: number;
  quantity?: number;
  unit?: string;
  terms?: string;
  start_date?: string;
}

export interface Clause {
  clause_id: string;
  kind: string;
  value: unknown;
  on_breach: Outcome;
  note: string;
}

export interface Mandate {
  mandate_id: string;
  version: number;
  tenant_id: string;
  principal: string;
  role: "buyer" | "seller";
  scope: string;
  subject: string;
  unit: string;
  opening_quantity: number;
  list_price: number | null;
  currency: string;
  clauses: Clause[];
}

export interface Breach {
  clause_id: string;
  kind: string;
  limit: unknown;
  proposed: unknown;
  outcome: Outcome;
  explanation: string;
  plain: string;
}

export interface Limit {
  id: string;
  label: string;
  hint: string;
  value: number;
  side: "lower" | "upper";
}

export interface Pending {
  escalation_id: string;
  signature: string;
  principal: string;
  who_you_are: string;
  mandate_ref: string;
  currency: string;
  subject: string;
  unit: string;
  proposed: Offer;
  agent_position: string;
  breaches: Breach[];
  limits: Limit[];
  offered_scopes: { scope: Scope; label: string; hint: string }[];
}

export type EntryType =
  | "utterance" | "decision" | "escalation" | "approval"
  | "commitment" | "settlement" | "blocked" | "injection_flag";

export interface TraceEntry {
  seq: number;
  entry_id: string;
  thread_id: string;
  entry_type: EntryType;
  actor: string;
  payload: Record<string, unknown>;
  prev_hash: string;
  entry_hash: string;
  created_at: string;
}

export interface Commitment {
  commitment_id: string;
  thread_id: string;
  buyer_principal: string;
  seller_principal: string;
  offer: Offer;
  currency: string;
  buyer_authority: string[];
  seller_authority: string[];
  created_at: string;
}

export interface ThreadState {
  thread_id: string;
  subject: string;
  status: "created" | "awaiting_approval" | "committed" | "closed_no_deal";
  replays: number;
  buyer_mandate: string;
  seller_mandate: string;
  chain_valid: boolean;
  first_bad_seq: number | null;
  trace: TraceEntry[];
  pending: Pending | null;
  decisions: {
    approval_id: string; principal: string; scope: Scope;
    granted: boolean; breaches: string[]; at: string;
  }[];
  commitment: Commitment | null;
}

export interface ThreadSummary {
  thread_id: string;
  status: ThreadState["status"];
  awaiting: string | null;
  replays: number;
  commitment_id: string | null;
}

export interface Health {
  status: string;
  ledger_entries: number;
  chain_valid: boolean;
  first_bad_seq: number | null;
  providers: string[];
}
