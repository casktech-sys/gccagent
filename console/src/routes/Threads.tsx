import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, money, terms as fmtTerms } from "../api";
import { Technical, useDetail } from "../detail";
import { deriveStep, tourTarget, useTour } from "../tour";
import EscalationCard from "../components/EscalationCard";
import Trace from "../components/Trace";
import type { Scope } from "../types";

const STATUS: Record<string, { label: string; tone: string }> = {
  awaiting_approval: { label: "Someone needs to decide", tone: "text-brass" },
  committed: { label: "Deal agreed", tone: "text-verdigris" },
  closed_no_deal: { label: "No deal", tone: "text-muted" },
  created: { label: "Starting", tone: "text-muted" },
};

export default function Threads() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const list = useQuery({ queryKey: ["threads"], queryFn: api.threads });
  const thread = useQuery({
    queryKey: ["thread", selected],
    queryFn: () => api.thread(selected as string),
    enabled: !!selected,
  });

  const open = useMutation({
    mutationFn: () => api.openThread(),
    onSuccess: (s) => {
      setSelected(s.thread_id);
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.setQueryData(["thread", s.thread_id], s);
    },
  });

  const settle = useMutation({
    mutationFn: () => api.settle(selected as string),
    onSuccess: (st) => qc.setQueryData(["thread", st.thread_id], st),
  });

  const decide = useMutation({
    mutationFn: ({ granted, scope }: { granted: boolean; scope: Scope }) =>
      api.decide(selected as string, granted, scope),
    onSuccess: (s) => {
      qc.setQueryData(["thread", s.thread_id], s);
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  // Each decision replays the whole thread, so the ledger is rebuilt rather than
  // appended to. Remembering how long it was lets the view reveal only the part
  // the person's decision actually produced.
  const seenLength = useRef(0);
  const state = thread.data;

  // The walkthrough reads the same state the page renders, so it cannot drift
  // out of step with what the person is actually looking at.
  const { detail } = useDetail();
  const { setStep } = useTour();
  useEffect(() => {
    setStep(deriveStep(state, detail));
  }, [state, detail, setStep]);

  const revealFrom = state ? seenLength.current : Infinity;
  if (state) seenLength.current = state.trace.length;
  const currency = state?.pending?.currency ?? state?.commitment?.currency ?? "AED";

  return (
    <div className="grid gap-10 lg:grid-cols-[15rem_1fr]">
      <aside>
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lead">Deals</h2>
          <button
            {...tourTarget("start")}
            className="btn-quiet"
            onClick={() => open.mutate()}
            disabled={open.isPending}
          >
            {open.isPending ? "Starting" : "Start a deal"}
          </button>
        </div>

        {open.isError && (
          <p className="mt-3 text-small text-rust">{(open.error as Error).message}</p>
        )}

        {list.data?.length === 0 && (
          <p className="mt-4 text-small text-muted">
            Nothing here yet. Start a deal and two agents will haggle until one of them
            runs out of room.
          </p>
        )}

        <ul className="mt-4 space-y-px">
          {list.data?.map((t) => (
            <li key={t.thread_id}>
              <button
                onClick={() => { seenLength.current = 0; setSelected(t.thread_id); }}
                className={`w-full border-l-2 px-3 py-2 text-left transition-colors ${
                  selected === t.thread_id
                    ? "border-l-brass bg-surface"
                    : "border-l-transparent hover:bg-surface/60"
                }`}
              >
                <span className={`block text-small ${STATUS[t.status]?.tone}`}>
                  {t.awaiting ? `${t.awaiting} must decide` : STATUS[t.status]?.label}
                </span>
                <span className="mt-0.5 block font-mono text-micro text-muted">
                  {t.thread_id}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section>
        {!selected && (
          <div className="pt-2">
            <h1 className="max-w-measure font-display text-display">
              Two people, two sets of rules, no phone call.
            </h1>

            <p className="mt-5 max-w-measure text-muted">
              A container has landed at Jebel Ali and needs trucking to Riyadh. Normally
              the two sides would go back and forth on the phone four or five times.
              Here, each one has written down what their agent may agree to, and the
              agents do the haggling.
            </p>

            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              <div className="panel p-5">
                <h2 className="font-display text-lead">Nadia — buying</h2>
                <p className="mt-1 text-small text-muted">
                  She needs three trucks. What she wrote down:
                </p>
                <ul className="mt-3 space-y-1.5 text-small">
                  <li>Never pay more than 22,000 AED</li>
                  <li>Book it yourself up to 15,000. Above that, wake me</li>
                  <li>Pay 30 or 45 days after delivery, nothing longer</li>
                  <li>Trucks collect between 1 and 15 October</li>
                </ul>
              </div>

              <div className="panel p-5">
                <h2 className="font-display text-lead">Omar — selling</h2>
                <p className="mt-1 text-small text-muted">
                  He owns the trucks. What he wrote down:
                </p>
                <ul className="mt-3 space-y-1.5 text-small">
                  <li>My price is 21,000 for three trucks</li>
                  <li>Never below 17,400 — that is fuel, drivers and border fees</li>
                  <li>Knock up to 8% off without asking me</li>
                  <li>I need paying 30 days after delivery, not longer</li>
                </ul>
              </div>
            </div>

            <p className="mt-8 max-w-measure text-muted">
              Press <span className="text-ink">Start a deal</span>. The agents will
              negotiate on their own until one of them wants to agree to something its
              owner never allowed. At that point it stops, before saying a word, and
              asks. You will be asked twice — once as Omar, once as Nadia.
            </p>
          </div>
        )}

        {thread.isError && (
          <p className="text-rust">Could not load that thread. {(thread.error as Error).message}</p>
        )}

        {state && (
          <>
            <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-4">
              <div>
                <h1 className="font-display text-title">
                  {state.subject || "Deal"}
                </h1>
                <p className="mt-1 font-mono text-micro text-muted">{state.thread_id}</p>
              </div>
              <div className="flex items-center gap-4 text-small">
                <span className={STATUS[state.status]?.tone}>{STATUS[state.status]?.label}</span>
                <span
                  className={state.chain_valid ? "text-verdigris" : "text-rust"}
                  title="Every entry in the record is sealed against the one before it"
                >
                  {state.chain_valid
                    ? "Record intact"
                    : `Record altered at entry ${state.first_bad_seq}`}
                </span>
              </div>
            </header>

            {state.pending && (
              <div className="mt-6">
                <div {...tourTarget("decide")}>
                  <EscalationCard
                    pending={state.pending}
                    busy={decide.isPending}
                    onDecide={(granted, scope) => decide.mutate({ granted, scope })}
                  />
                </div>
              </div>
            )}

            {state.status === "closed_no_deal" && (
              <section className="mt-6 panel border-l-2 border-l-rule p-6">
                <h2 className="font-display text-title">No deal</h2>
                <p className="mt-2 max-w-measure text-muted">
                  Someone said no, so the agents stopped. Nothing was agreed and no money
                  moved. The record below still shows every step, including the refusal —
                  a deal that did not happen is as auditable as one that did.
                </p>
                <button
                  className="btn-quiet mt-5"
                  onClick={() => open.mutate()}
                  disabled={open.isPending}
                >
                  {open.isPending ? "Starting" : "Start another deal"}
                </button>
              </section>
            )}

            {state.commitment && (
              <section className="mt-6 panel border-l-2 border-l-verdigris p-6">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-display text-title">Deal agreed</h2>
                  <Technical>
                    <span className="font-mono text-micro text-muted">
                      {state.commitment.commitment_id}
                    </span>
                  </Technical>
                </div>
                <p className="mt-2 figure text-lead">
                  {money(state.commitment.offer.price, state.commitment.currency)}
                  <span className="text-muted"> · {fmtTerms(state.commitment.offer.terms)}</span>
                  <span className="text-muted">
                    {" "}· {state.commitment.offer.quantity} {state.commitment.offer.unit}
                  </span>
                </p>

                <p className="mt-3 max-w-measure text-small text-muted">
                  Both sides are held to this. If it is ever disputed, the record below
                  shows exactly which rule, and whose approval, allowed it.
                </p>

                <Technical>
                <div className="mt-6 grid gap-6 sm:grid-cols-2">
                  {[
                    { who: state.commitment.buyer_principal, chain: state.commitment.buyer_authority },
                    { who: state.commitment.seller_principal, chain: state.commitment.seller_authority },
                  ].map(({ who, chain }) => (
                    <div key={who}>
                      <h3 className="text-small text-muted">What authorised {who}</h3>
                      <ul className="mt-2 space-y-1 font-mono text-micro">
                        {chain.map((c) => (
                          <li key={c} className={c.startsWith("approval:") ? "text-brass" : "text-ink/70"}>
                            {c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                </Technical>
              </section>
            )}

            {state.commitment && (
              <section className="mt-6 panel p-6">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="font-display text-title">
                    {state.settlement ? "Paid" : "Payment"}
                  </h2>
                  {!state.settlement && (
                    <button
                      className="btn-authority"
                      onClick={() => settle.mutate()}
                      disabled={settle.isPending}
                    >
                      {settle.isPending ? "Moving the money" : "Settle this deal"}
                    </button>
                  )}
                </div>

                {!state.settlement ? (
                  <p className="mt-2 max-w-measure text-muted">
                    Nothing has moved yet. Money can only move against a deal that is
                    already agreed, so paying is downstream of being allowed to promise.
                  </p>
                ) : (
                  <>
                    <p className="mt-2 max-w-measure text-muted">
                      {money(state.settlement.amount, state.settlement.currency)} went from{" "}
                      {state.commitment.buyer_principal} to{" "}
                      {state.commitment.seller_principal}, by way of an escrow account that
                      is emptied in the same transaction.
                    </p>

                    <table className="mt-5 w-full max-w-lg border-collapse text-small">
                      <thead>
                        <tr className="border-b border-rule text-left text-micro text-muted">
                          <th className="py-2 font-medium">Account</th>
                          <th className="py-2 text-right font-medium">Before</th>
                          <th className="py-2 text-right font-medium">After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(state.settlement.before).map((who) => (
                          <tr key={who} className="border-b border-rule/60">
                            <td className="py-2 text-ink">{who}</td>
                            <td className="py-2 text-right figure text-muted">
                              {money(state.settlement!.before[who], state.settlement!.currency)}
                            </td>
                            <td className="py-2 text-right figure text-ink">
                              {money(state.settlement!.after[who], state.settlement!.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <Technical>
                      <ul className="mt-4 space-y-1 font-mono text-micro text-muted">
                        {state.settlement.legs.map((l, i) => (
                          <li key={i}>
                            debit {l.debit} · credit {l.credit} · {l.amount}
                          </li>
                        ))}
                        {state.settlement.preconditions_met.map((c) => (
                          <li key={c} className="text-verdigris">precondition met: {c}</li>
                        ))}
                      </ul>
                    </Technical>
                  </>
                )}

                {settle.isError && (
                  <p className="mt-3 text-small text-rust">{(settle.error as Error).message}</p>
                )}
              </section>
            )}

            <div className="mt-8">
              <h2 className="font-display text-lead">What happened</h2>
              <p className="mt-1 max-w-measure text-small text-muted">
                Every move, in order, including the ones that were stopped.
              </p>
              <div className="mt-3">
                <Trace entries={state.trace} currency={currency} revealFrom={revealFrom} />
              </div>
            </div>

            {state.replays > 1 && (
              <Technical>
              <p className="mt-6 max-w-measure border-t border-rule pt-4 text-small text-muted">
                Rebuilt {state.replays} times. Every decision replays the whole
                negotiation from the start against the approvals given so far, so what
                you see above is reproduced rather than remembered. That only works
                because the rule checking is deterministic — same rules and same offer
                always give the same answer.
              </p>
              </Technical>
            )}
          </>
        )}
      </section>
    </div>
  );
}
