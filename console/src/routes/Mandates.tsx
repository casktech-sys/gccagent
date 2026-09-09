import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Technical } from "../detail";
import type { Mandate } from "../types";

const KIND_LABEL: Record<string, string> = {
  price_max: "Never pay more than",
  price_min: "Never go below",
  auto_commit_max: "Agree deals on your own up to",
  discount_max_pct: "Knock off up to, without asking me",
  terms_allowlist: "Payment terms I accept",
  date_window: "Collection must fall between",
  qty_max: "At most this many",
  counterparty_verified: "Only deal with verified companies",
};

const NUMERIC = new Set(["price_max", "price_min", "auto_commit_max", "discount_max_pct", "qty_max"]);

function readable(kind: string, value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v).replace("net_", "net ")).join(", ");
  if (kind === "discount_max_pct") return `${value}%`;
  if (typeof value === "number") return value.toLocaleString("en-GB");
  return String(value);
}

export default function Mandates() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["mandates"], queryFn: api.mandates });
  const [draft, setDraft] = useState<Mandate | null>(null);

  useEffect(() => {
    if (data && !draft) setDraft(structuredClone(data[0]));
  }, [data, draft]);

  const save = useMutation({
    mutationFn: (m: Mandate) => api.saveMandate(m.mandate_id, m),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mandates"] });
      setDraft(null);
    },
  });

  if (isLoading || !draft) return <p className="text-muted">Loading mandates.</p>;

  const setClauseValue = (clauseId: string, raw: string) => {
    const next = structuredClone(draft);
    const clause = next.clauses.find((c) => c.clause_id === clauseId);
    if (clause) clause.value = Number(raw);
    setDraft(next);
  };

  return (
    <div className="grid gap-10 lg:grid-cols-[15rem_1fr]">
      <aside>
        <h2 className="font-display text-lead">Whose rules</h2>
        <ul className="mt-4 space-y-px">
          {data?.map((m) => (
            <li key={m.mandate_id}>
              <button
                onClick={() => setDraft(structuredClone(m))}
                className={`w-full border-l-2 px-3 py-2 text-left transition-colors ${
                  draft.mandate_id === m.mandate_id
                    ? "border-l-brass bg-surface"
                    : "border-l-transparent hover:bg-surface/60"
                }`}
              >
                <span className="block text-small text-ink">{m.principal}</span>
                <span className="block text-micro text-muted">
                  {m.role === "buyer" ? "Buying" : "Selling"}
                </span>
                <Technical>
                  <span className="font-mono text-micro text-muted">
                    {m.mandate_id} v{m.version}
                  </span>
                </Technical>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="max-w-3xl">
        <header className="border-b border-rule pb-4">
          <h1 className="font-display text-title">
            What {draft.principal}&rsquo;s agent is allowed to do
          </h1>
          <p className="mt-2 max-w-measure text-muted">
            These are the only instructions the agent obeys. It cannot change them, and
            nothing the other side writes can change them either. Where a line says
            <span className="text-brass"> Ask me</span>, the agent stops and waits for a
            person. Where it says <span className="text-rust"> Hard stop</span>, it will
            not even ask.
          </p>
        </header>

        <ul className="mt-6 divide-y divide-rule">
          {draft.clauses.map((c) => (
            <li key={c.clause_id} className="flex flex-wrap items-center gap-4 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-ink">{KIND_LABEL[c.kind] ?? c.kind}</p>
                <Technical>
                  <p className="mt-0.5 font-mono text-micro text-muted">{c.clause_id}</p>
                </Technical>
                {c.note && <p className="mt-1 max-w-measure text-small text-muted">{c.note}</p>}
              </div>

              {NUMERIC.has(c.kind) ? (
                <input
                  type="number"
                  aria-label={KIND_LABEL[c.kind] ?? c.clause_id}
                  className="w-32 border border-rule bg-raise px-3 py-1.5 text-right figure text-ink rounded-sm"
                  value={String(c.value)}
                  onChange={(e) => setClauseValue(c.clause_id, e.target.value)}
                />
              ) : (
                <span className="w-48 text-right text-small text-ink">
                  {readable(c.kind, c.value)}
                </span>
              )}

              <span
                className={`w-24 text-right text-small ${
                  c.on_breach === "reject" ? "text-rust" : "text-brass"
                }`}
                title={
                  c.on_breach === "reject"
                    ? "The agent stops and does not ask"
                    : "The agent stops and asks you"
                }
              >
                {c.on_breach === "reject" ? "Hard stop" : "Ask me"}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex items-center gap-3 border-t border-rule pt-5">
          <button
            className="btn-authority"
            disabled={save.isPending}
            onClick={() => save.mutate(draft)}
          >
            {save.isPending ? "Saving" : "Save these rules"}
          </button>
          <p className="max-w-measure text-small text-muted">
            Changing your rules never rewrites history. Deals already agreed stay attached
            to the rules that were in force when they were made.
          </p>
        </div>

        {save.isError && (
          <p className="mt-3 text-small text-rust">{(save.error as Error).message}</p>
        )}
      </section>
    </div>
  );
}
