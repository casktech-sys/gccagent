import { useState } from "react";
import { money, terms as fmtTerms } from "../api";
import { Technical, useDetail } from "../detail";
import type { Offer, TraceEntry } from "../types";

/**
 * The trace reads as one continuous thread down a gutter rule. Entries that
 * stopped the agent break out of that rule — the interruption is the
 * information, so nothing else on the row needs to shout.
 */

const speaker = (actor: string) =>
  actor === "agt_buyer" ? "The buyer's agent"
    : actor === "agt_seller" ? "The seller's agent"
      : actor === "orchestrator" ? "The platform"
        : actor;

// What each move is called by the people making it, not by the protocol.
const INTENT: Record<string, string> = {
  request_quote: "asked for a price",
  quote: "quoted",
  counter: "came back with",
  accept: "accepted",
  withdraw: "walked away",
};

function OfferLine({ offer, currency }: { offer: Offer; currency: string }) {
  return (
    <span className="figure text-ink">
      {money(offer.price, currency)}
      {offer.terms && <span className="text-muted"> · {fmtTerms(offer.terms)}</span>}
      {offer.quantity && (
        <span className="text-muted"> · {offer.quantity} {offer.unit ?? "units"}</span>
      )}
    </span>
  );
}

function Row({ children, tone = "quiet", broken = false, id, reveal = false }: {
  children: React.ReactNode;
  tone?: "quiet" | "block" | "authority" | "commit";
  broken?: boolean;
  id: string;
  reveal?: boolean;
}) {
  const dot = {
    quiet: "bg-rule", block: "bg-rust", authority: "bg-brass", commit: "bg-verdigris",
  }[tone];
  return (
    <li className={`relative pl-7 ${reveal ? "settle" : ""}`}>
      {broken && <span className={`absolute left-[3px] top-3 h-px w-4 ${dot} opacity-60`} />}
      <span className={`absolute left-0 top-[9px] h-[7px] w-[7px] rounded-full ${dot}`} />
      <div className="py-2.5">
        {children}
        <Technical>
          <span className="ml-2 font-mono text-micro text-muted/60">{id}</span>
        </Technical>
      </div>
    </li>
  );
}

function Authority({ chain }: { chain: string[] }) {
  const [open, setOpen] = useState(false);
  const approvals = chain.filter((c) => c.startsWith("approval:"));
  return (
    <div className="text-small text-muted">
      <button
        className="text-left underline decoration-rule underline-offset-4 hover:text-ink"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {approvals.length > 0
          ? "Allowed by the rules, plus a person saying yes"
          : `Allowed by ${chain.length} of the rules already set`}
      </button>
      {open && (
        <ul className="mt-2 space-y-1 border-l border-rule pl-3 font-mono text-micro">
          {chain.map((c) => (
            <li key={c} className={c.startsWith("approval:") ? "text-brass" : "text-muted"}>
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Trace({ entries, currency, revealFrom = Infinity }: {
  entries: TraceEntry[];
  currency: string;
  /** Entries at or after this sequence are what the last decision produced. */
  revealFrom?: number;
}) {
  const { detail } = useDetail();

  if (entries.length === 0) {
    return (
      <p className="py-8 text-muted">
        Nothing has happened yet. Start a deal and the agents will begin talking.
      </p>
    );
  }

  return (
    <ol className="relative ml-1 border-l border-rule">
      {entries.map((e) => {
        const p = e.payload as Record<string, never>;
        const reveal = e.seq >= revealFrom;

        switch (e.entry_type) {
          case "utterance":
            return (
              <Row key={e.seq} id={e.entry_id} reveal={reveal}>
                <p className="text-small text-muted">
                  {speaker(e.actor)}{" "}
                  <span className="text-ink">
                    {INTENT[String(p.intent)] ?? String(p.intent).replace("_", " ")}
                  </span>
                </p>
                <p className="mt-0.5">
                  <OfferLine offer={p.offer as Offer} currency={currency} />
                </p>
                {p.narrative && (
                  <p className="mt-1 max-w-measure text-small text-muted">{String(p.narrative)}</p>
                )}
              </Row>
            );

          case "decision":
            if (!detail) return null;
            return (
              <Row key={e.seq} id={e.entry_id} reveal={reveal}>
                <Authority chain={(p.authority_chain as unknown as string[]) ?? []} />
              </Row>
            );

          case "blocked":
            return (
              <Row key={e.seq} id={e.entry_id} tone="block" broken reveal={reveal}>
                <p className="text-small text-rust">
                  Stopped itself before saying anything
                </p>
                <ul className="mt-1 max-w-measure space-y-1 text-small text-ink">
                  {(((p.breaches_plain ?? p.breaches) as unknown as string[]) ?? []).map(
                    (b) => <li key={b}>{b}</li>,
                  )}
                </ul>
                <Technical>
                  <ul className="mt-2 space-y-0.5 font-mono text-micro text-muted">
                    {((p.breaches as unknown as string[]) ?? []).map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </Technical>
              </Row>
            );

          case "escalation":
            return (
              <Row key={e.seq} id={e.entry_id} tone="authority" broken reveal={reveal}>
                <p className="text-small">
                  <span className="text-muted">Asked </span>
                  <span className="text-brass">{String(p.principal)}</span>
                  <span className="text-muted"> to decide</span>
                </p>
              </Row>
            );

          case "approval":
            return (
              <Row key={e.seq} id={e.entry_id} tone="authority" reveal={reveal}>
                <p className="text-small">
                  <span className="text-brass">{String(p.principal)}</span>{" "}
                  <span className="text-muted">
                    {p.granted
                      ? p.scope === "price_only" ? "allowed the price, nothing else"
                        : p.scope === "terms_only" ? "allowed the payment terms only"
                          : "allowed it"
                      : "said no"}
                  </span>
                </p>
              </Row>
            );

          case "commitment":
            return (
              <Row key={e.seq} id={e.entry_id} tone="commit" reveal={reveal}>
                <p className="text-small text-verdigris">Deal agreed</p>
                <p className="mt-0.5">
                  <OfferLine offer={p.offer as Offer} currency={currency} />
                </p>
              </Row>
            );

          case "settlement":
            return (
              <Row key={e.seq} id={e.entry_id} tone="commit" reveal={reveal}>
                <p className="text-small text-verdigris">
                  Settled <span className="figure">{money(Number(p.amount), String(p.currency))}</span>
                </p>
              </Row>
            );

          case "injection_flag":
            return (
              <Row key={e.seq} id={e.entry_id} tone="block" broken reveal={reveal}>
                <p className="text-small text-rust">
                  The other side tried to give this agent instructions
                </p>
                <p className="mt-0.5 max-w-measure text-small text-muted">
                  Recorded and ignored. It changed nothing about what the agent was
                  allowed to do.
                </p>
                <Technical>
                  <p className="mt-1 font-mono text-micro text-muted">
                    {((p.patterns as unknown as string[]) ?? []).join(", ")}
                  </p>
                </Technical>
              </Row>
            );

          default:
            return null;
        }
      })}
    </ol>
  );
}
