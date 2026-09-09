import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Technical } from "../detail";

/**
 * "Model-agnostic" and "respects data residency" are claims. A claim a reviewer
 * cannot inspect is worth very little, so this page is the inspection.
 */

const TIER: Record<string, string> = {
  frontier: "Most capable, most expensive",
  cost_efficient: "Cheaper, for high volume",
  local: "Runs in region, never leaves",
};

const JURISDICTION: Record<string, string> = {
  "ae-difc": "DIFC (Dubai financial centre)",
  "ae-federal": "UAE federal law",
  "ae-adgm": "ADGM (Abu Dhabi)",
  sa: "Saudi Arabia",
  qa: "Qatar",
};

const TASK: Record<string, string> = {
  negotiation: "Writing an offer",
  summary: "Summarising",
  classify: "Sorting messages",
};

export default function Models() {
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  const matrix = useQuery({ queryKey: ["routing"], queryFn: api.routingMatrix });

  return (
    <section className="max-w-4xl">
      <h1 className="font-display text-title">Which model, and where it may run</h1>
      <p className="mt-3 max-w-measure text-muted">
        No single model is wired in. Work is sent to whichever one suits the job and is
        allowed to run in the customer&rsquo;s country, and swapping one out is a
        configuration change rather than a rewrite.
      </p>

      <h2 className="mt-10 font-display text-lead">Available models</h2>
      <table className="mt-3 w-full border-collapse text-small">
        <thead>
          <tr className="border-b border-rule text-left text-micro text-muted">
            <th className="py-2 pr-4 font-medium">Provider</th>
            <th className="py-2 pr-4 font-medium">Used for</th>
            <th className="py-2 pr-4 font-medium">Can run in</th>
            <th className="py-2 font-medium">In this demo</th>
          </tr>
        </thead>
        <tbody>
          {providers.data?.map((p) => (
            <tr key={p.name} className="border-b border-rule/60">
              <td className="py-2.5 pr-4">
                <span className="text-ink">{p.name}</span>
                <Technical>
                  <span className="ml-2 font-mono text-micro text-muted">{p.model}</span>
                </Technical>
              </td>
              <td className="py-2.5 pr-4 text-muted">{TIER[p.tier] ?? p.tier}</td>
              <td className="py-2.5 pr-4 text-muted">{p.regions.join(", ")}</td>
              <td className="py-2.5 text-small">
                {p.available
                  ? <span className="text-verdigris">Ready</span>
                  : <span className="text-muted">No account set up here</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-12 font-display text-lead">Where each customer&rsquo;s work goes</h2>
      <p className="mt-2 max-w-measure text-muted">
        The Gulf is not one set of data rules. A company registered in the DIFC, one on the
        UAE mainland and one in Saudi Arabia are each governed differently, so each is
        bound to a jurisdiction and their work only goes somewhere that jurisdiction
        permits. Where nothing qualifies, the platform refuses rather than quietly using
        the next best thing.
      </p>

      <table className="mt-4 w-full border-collapse text-small">
        <thead>
          <tr className="border-b border-rule text-left text-micro text-muted">
            <th className="py-2 pr-4 font-medium">Customer</th>
            <th className="py-2 pr-4 font-medium">Governed by</th>
            <th className="py-2 pr-4 font-medium">Task</th>
            <th className="py-2 font-medium">Goes to</th>
          </tr>
        </thead>
        <tbody>
          {matrix.data?.map((r, i) => (
            <tr key={i} className="border-b border-rule/60 align-top">
              <td className="py-2.5 pr-4 text-ink">{r.tenant}</td>
              <td className="py-2.5 pr-4 text-muted">
                {JURISDICTION[r.jurisdiction] ?? r.jurisdiction}
              </td>
              <td className="py-2.5 pr-4 text-muted">{TASK[r.task_class] ?? r.task_class}</td>
              <td className="py-2.5">
                {r.routed_to ? (
                  <span className="text-verdigris">{r.routed_to}</span>
                ) : (
                  <>
                    <span className="text-rust">Refused</span>
                    <Technical>
                      <span className="mt-1 block max-w-measure font-mono text-micro text-muted">
                        {r.refused}
                      </span>
                    </Technical>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-8 border-l-2 border-l-brass panel p-5">
        <h3 className="font-display text-lead">What that table is saying</h3>
        <ul className="mt-3 max-w-measure space-y-2 text-small text-muted">
          <li>
            <span className="text-ink">The two UAE customers</span> allow work to leave the
            region, so writing an offer goes to the most capable model and high-volume
            sorting goes to a cheaper one. Same customer, different model, decided per task.
          </li>
          <li>
            <span className="text-ink">The Saudi customer</span> does not allow it. Every
            task falls to the model running inside the region — the capable option is not
            offered, because it cannot lawfully be used.
          </li>
          <li>
            <span className="text-ink">The Qatari customer</span> permits a region nothing
            runs in. The platform refuses the work rather than quietly using the next best
            thing, which is the entire point of having the rule.
          </li>
        </ul>
        <p className="mt-4 max-w-measure text-small text-muted">
          This demo executes on the in-region model only, so nothing said here leaves the
          machine and every negotiation is reproducible. The other providers are wired
          through the same adapter and chosen by the same rules; they simply have no
          account configured on this deployment.
        </p>
      </div>
    </section>
  );
}
