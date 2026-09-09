import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";

/** The audit surface. Hashes are shown in full because the claim being made is
 *  that they can be recomputed, not that they exist. */

const LABEL: Record<string, string> = {
  utterance: "said something",
  decision: "rules checked",
  blocked: "stopped itself",
  escalation: "asked a person",
  approval: "person answered",
  commitment: "deal agreed",
  settlement: "money moved",
  injection_flag: "instruction attempt",
};

const WHO: Record<string, string> = {
  agt_buyer: "buyer's agent",
  agt_seller: "seller's agent",
  orchestrator: "platform",
  settlement_service: "platform",
};

export default function Ledger() {
  const list = useQuery({ queryKey: ["threads"], queryFn: api.threads });
  const [selected, setSelected] = useState<string | null>(null);
  const id = selected ?? list.data?.[0]?.thread_id ?? null;

  const thread = useQuery({
    queryKey: ["thread", id],
    queryFn: () => api.thread(id as string),
    enabled: !!id,
  });

  if (list.data?.length === 0) {
    return (
      <p className="max-w-measure text-muted">
        Nothing recorded yet. Start a deal and every offer, every stop, every approval
        and the final agreement will appear here in order.
      </p>
    );
  }

  const s = thread.data;

  return (
    <section className="max-w-5xl">
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-rule pb-4">
        <h1 className="font-display text-title">The record</h1>
        <div className="flex items-center gap-4">
          <select
            aria-label="Thread"
            className="border border-rule bg-raise px-3 py-1.5 font-mono text-micro text-ink rounded-sm"
            value={id ?? ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {list.data?.map((t) => (
              <option key={t.thread_id} value={t.thread_id}>{t.thread_id}</option>
            ))}
          </select>
          {s && (
            <span className={`text-small ${s.chain_valid ? "text-verdigris" : "text-rust"}`}>
              {s.chain_valid
                ? "Nothing has been altered"
                : `Altered at entry ${s.first_bad_seq}`}
            </span>
          )}
        </div>
      </header>

      <p className="mt-4 max-w-measure text-muted">
        Every move on a deal is written here in order and sealed against the entry before
        it. If anyone edited an old entry, the seals from that point on would stop
        matching and the banner above would say so. That is the difference between a
        record you can rely on in a dispute and a log file anyone could rewrite.
      </p>

      {s && (
        <table className="mt-6 w-full border-collapse text-small">
          <thead>
            <tr className="border-b border-rule text-left text-micro text-muted">
              <th className="py-2 pr-4 font-medium">Seq</th>
              <th className="py-2 pr-4 font-medium">Entry</th>
              <th className="py-2 pr-4 font-medium">What happened</th>
              <th className="py-2 pr-4 font-medium">Who</th>
              <th className="py-2 font-medium">Seal, and the seal it follows</th>
            </tr>
          </thead>
          <tbody>
            {s.trace.map((e) => (
              <tr key={e.seq} className="border-b border-rule/50 align-top">
                <td className="py-2 pr-4 font-mono text-micro text-muted">{e.seq}</td>
                <td className="py-2 pr-4 font-mono text-micro text-ink">{e.entry_id}</td>
                <td className="py-2 pr-4">
                  <span
                    className={
                      e.entry_type === "blocked" || e.entry_type === "injection_flag"
                        ? "text-rust"
                        : e.entry_type === "escalation" || e.entry_type === "approval"
                          ? "text-brass"
                          : e.entry_type === "commitment" || e.entry_type === "settlement"
                            ? "text-verdigris"
                            : "text-muted"
                    }
                  >
                    {LABEL[e.entry_type] ?? e.entry_type.replace("_", " ")}
                  </span>
                </td>
                <td className="py-2 pr-4 text-muted">{WHO[e.actor] ?? e.actor}</td>
                <td className="py-2 font-mono text-micro">
                  <span className="block break-all text-ink/70">{e.entry_hash}</span>
                  <span className="block break-all text-muted/50">{e.prev_hash}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
