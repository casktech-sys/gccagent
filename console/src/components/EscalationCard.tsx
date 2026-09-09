import { money, terms as fmtTerms } from "../api";
import { Technical } from "../detail";
import type { Pending, Scope } from "../types";
import LimitGauge from "./LimitGauge";

/**
 * The decision moment, written for the person who has to make it.
 *
 * They arrive from a notification, possibly at 6am, possibly having never seen
 * this screen before. So the panel answers, in order: who am I, what is being
 * asked, why couldn't my agent just do it, and what happens to my rules if I
 * say yes.
 */

export default function EscalationCard({
  pending, onDecide, busy,
}: {
  pending: Pending;
  onDecide: (granted: boolean, scope: Scope) => void;
  busy: boolean;
}) {
  const {
    proposed, currency, breaches, limits, principal, agent_position, who_you_are,
  } = pending;

  return (
    <section className="panel border-l-2 border-l-brass p-6">
      <p className="text-small text-brass">{who_you_are}</p>

      <header className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-title">{principal}, your agent needs you</h2>
        <Technical>
          <span className="font-mono text-micro text-muted">{pending.mandate_ref}</span>
        </Technical>
      </header>

      <p className="mt-3 max-w-measure text-muted">
        It has negotiated this far and wants to put the deal below on the table. Your
        rules do not stretch that far, so it stopped rather than say anything.
      </p>

      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3">
        <div>
          <dt className="text-micro text-muted">Price</dt>
          <dd className="figure text-lead">{money(proposed.price, currency)}</dd>
        </div>
        <div>
          <dt className="text-micro text-muted">Load</dt>
          <dd className="figure text-lead">
            {proposed.quantity ?? "—"} {proposed.unit ?? pending.unit}
          </dd>
        </div>
        <div>
          <dt className="text-micro text-muted">Payment</dt>
          <dd className="text-lead">{fmtTerms(proposed.terms)}</dd>
        </div>
        <div>
          <dt className="text-micro text-muted">Collection</dt>
          <dd className="figure text-lead">{proposed.start_date ?? "—"}</dd>
        </div>
      </dl>

      {proposed.price !== undefined && limits.length > 0 && (
        <>
          <p className="mt-8 text-small text-muted">
            Where this price sits against the lines you drew
          </p>
          <LimitGauge
            limits={limits}
            proposed={proposed.price}
            breaches={breaches}
            currency={currency}
          />
        </>
      )}

      <div className="mt-7">
        <h3 className="text-small text-muted">Why it stopped</h3>
        <ul className="mt-3 space-y-3">
          {breaches.map((b) => (
            <li key={b.clause_id} className="flex gap-3">
              <span
                className={`mt-[9px] h-[6px] w-[6px] shrink-0 rounded-full ${
                  b.outcome === "reject" ? "bg-rust" : "bg-brass"
                }`}
              />
              <span className="max-w-measure">
                <span className="block text-ink">{b.plain}</span>
                <Technical>
                  <span className="mt-1 block font-mono text-micro text-muted">
                    {b.clause_id} — {b.explanation}
                  </span>
                </Technical>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {agent_position && (
        <p className="mt-6 max-w-measure border-l border-rule pl-4 text-small text-muted">
          Your agent adds: {agent_position}.
        </p>
      )}

      <div className="mt-7 border-t border-rule pt-6">
        <h3 className="text-small text-muted">What would you like to do?</h3>
        <div className="mt-3 flex flex-wrap gap-3">
          {pending.offered_scopes.map((s) => (
            <button
              key={s.scope}
              className="btn-authority max-w-[15rem] text-left"
              disabled={busy}
              onClick={() => onDecide(true, s.scope)}
            >
              <span className="block">{s.label}</span>
              <span className="mt-0.5 block text-micro font-normal opacity-70">{s.hint}</span>
            </button>
          ))}
          <button
            className="btn-decline max-w-[15rem] text-left"
            disabled={busy}
            onClick={() => onDecide(false, "full")}
          >
            <span className="block">Say no</span>
            <span className="mt-0.5 block text-micro font-normal opacity-70">
              The deal ends here
            </span>
          </button>
        </div>

        <p className="mt-4 max-w-measure text-small text-muted">
          Whatever you choose applies to this one deal. Your rules are not rewritten, and
          the next thing your agent proposes is measured against them exactly as this was.
        </p>
      </div>
    </section>
  );
}
