import type { Breach, Limit } from "../types";

/**
 * The gauge is the one place this console spends its boldness.
 *
 * A mandate is a set of limits; an escalation happens when a proposal crosses
 * one. Rather than describe that in prose, the gauge puts the proposal and the
 * limits on the same line so the principal sees the distance, the direction,
 * and the severity at once.
 *
 * Shaded regions are the ground the agent may not stand on. Rust means the
 * mandate rejects outright; brass means it needs this human.
 */

export interface LimitGaugeProps {
  limits: Limit[];
  proposed: number;
  breaches: Breach[];
  currency: string;
}

interface Zone {
  id: string;
  from: number;
  to: number;
  severity: "reject" | "escalate";
}

export function gaugeDomain(limits: Limit[], proposed: number): [number, number] {
  const points = [...limits.map((l) => l.value), proposed];
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const pad = Math.max((hi - lo) * 0.35, Math.abs(hi) * 0.04 || 1);
  return [lo - pad, hi + pad];
}

export function positionOf(value: number, domain: [number, number]): number {
  const [lo, hi] = domain;
  if (hi === lo) return 50;
  return ((value - lo) / (hi - lo)) * 100;
}

/** Labels are centred on their tick, so a tick near either end would hang off
 *  the panel on a narrow screen. Ticks stay honest; labels get pulled inside. */
export function labelPosition(value: number, domain: [number, number]): number {
  return Math.min(92, Math.max(8, positionOf(value, domain)));
}

export function forbiddenZones(
  limits: Limit[], proposed: number, breaches: Breach[],
): Zone[] {
  const domain = gaugeDomain(limits, proposed);
  const zones: Zone[] = [];
  for (const limit of limits) {
    const breach = breaches.find((b) => b.clause_id === limit.id);
    if (!breach) continue;
    const at = positionOf(limit.value, domain);
    const severity = breach.outcome === "reject" ? "reject" : "escalate";
    zones.push(
      limit.side === "lower"
        ? { id: limit.id, from: 0, to: at, severity }
        : { id: limit.id, from: at, to: 100, severity },
    );
  }
  return zones;
}

export default function LimitGauge({
  limits, proposed, breaches, currency,
}: LimitGaugeProps) {
  if (limits.length === 0) return null;

  const domain = gaugeDomain(limits, proposed);
  const zones = forbiddenZones(limits, proposed, breaches);
  const marker = positionOf(proposed, domain);
  const fmt = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 0 });

  return (
    <figure className="mt-5 overflow-hidden" aria-label="Where this proposal sits against the mandate">
      <div className="relative h-6">
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap text-small text-ink figure"
          style={{ left: `${labelPosition(proposed, domain)}%` }}
        >
          {fmt(proposed)} {currency}
        </span>
      </div>

      <div className="relative h-[3px] bg-rule" role="presentation">
        {zones.map((z) => (
          <div
            key={z.id}
            data-testid={`zone-${z.id}`}
            className={`absolute inset-y-0 ${
              z.severity === "reject" ? "bg-rust" : "bg-brass"
            } opacity-40`}
            style={{ left: `${z.from}%`, width: `${z.to - z.from}%` }}
          />
        ))}

        {limits.map((l) => (
          <div
            key={l.id}
            data-testid={`tick-${l.id}`}
            className="absolute -top-1 h-[11px] w-px bg-muted"
            style={{ left: `${positionOf(l.value, domain)}%` }}
          />
        ))}

        <div
          data-testid="gauge-marker"
          className="absolute -top-[5px] h-[13px] w-[13px] -translate-x-1/2 rotate-45 border-2 border-ground bg-ink"
          style={{ left: `${marker}%` }}
        />
      </div>

      <div className="relative mt-2 h-16">
        {limits.map((l, i) => (
          <span
            key={l.id}
            className="absolute -translate-x-1/2 text-center text-micro leading-tight text-muted"
            style={{
              left: `${labelPosition(l.value, domain)}%`,
              top: i % 2 ? "1.6rem" : 0,
              maxWidth: "11rem",
            }}
            title={l.hint}
          >
            <span className="block whitespace-nowrap text-ink/80">{l.label}</span>
            <span className="figure block whitespace-nowrap">
              {fmt(l.value)} {currency}
            </span>
          </span>
        ))}
      </div>
    </figure>
  );
}
