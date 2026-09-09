import { render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import LimitGauge, { forbiddenZones, gaugeDomain, positionOf } from "../components/LimitGauge";
import Trace from "../components/Trace";
import EscalationCard from "../components/EscalationCard";
import { money, terms } from "../api";
import { DetailProvider, useDetail } from "../detail";
import { TOTAL_STEPS, TourGuide, TourProvider, deriveStep, useTour } from "../tour";
import type { ThreadState } from "../types";
import type { Breach, Limit, Pending, TraceEntry } from "../types";

const limits: Limit[] = [
  {
    id: "price_floor", label: "Your minimum",
    hint: "Below this the job costs you money", value: 17400, side: "lower",
  },
  {
    id: "discount_authority", label: "Agent can discount to",
    hint: "8% off your list price", value: 19320, side: "lower",
  },
];

const breaches: Breach[] = [
  {
    clause_id: "discount_authority", kind: "discount_max_pct", limit: 8,
    proposed: 15.2, outcome: "escalate",
    explanation: "discount 15.2% exceeds authority 8%",
    plain: "That is 15.2% off your 21,000 AED list price. You allowed your agent to go to 8%.",
  },
];

// -- gauge maths -----------------------------------------------------------

describe("gauge maths", () => {
  it("puts every point inside the domain", () => {
    const [lo, hi] = gaugeDomain(limits, 17800);
    expect(lo).toBeLessThan(17400);
    expect(hi).toBeGreaterThan(19320);
  });

  it("maps the domain endpoints to the track ends", () => {
    expect(positionOf(0, [0, 100])).toBe(0);
    expect(positionOf(100, [0, 100])).toBe(100);
    expect(positionOf(50, [0, 100])).toBe(50);
  });

  it("does not divide by zero on a degenerate domain", () => {
    expect(positionOf(5, [5, 5])).toBe(50);
  });

  it("shades only breached limits", () => {
    const zones = forbiddenZones(limits, 17800, breaches);
    expect(zones).toHaveLength(1);
    expect(zones[0].id).toBe("discount_authority");
  });

  it("shades a lower breach leftwards from the limit", () => {
    const [z] = forbiddenZones(limits, 17800, breaches);
    expect(z.from).toBe(0);
    expect(z.to).toBeGreaterThan(0);
  });

  it("shades an upper breach rightwards from the limit", () => {
    const upper: Limit[] = [{
      id: "ceiling", label: "Most you will pay", hint: "Hard cap",
      value: 22000, side: "upper",
    }];
    const b: Breach[] = [{ ...breaches[0], clause_id: "ceiling", outcome: "reject" }];
    const [z] = forbiddenZones(upper, 23000, b);
    expect(z.to).toBe(100);
    expect(z.severity).toBe("reject");
  });
});

// -- gauge render ----------------------------------------------------------

describe("LimitGauge", () => {
  it("renders a tick for every limit and one marker", () => {
    render(<LimitGauge limits={limits} proposed={17800} breaches={breaches} currency="AED" />);
    expect(screen.getByTestId("tick-price_floor")).toBeInTheDocument();
    expect(screen.getByTestId("tick-discount_authority")).toBeInTheDocument();
    expect(screen.getByTestId("gauge-marker")).toBeInTheDocument();
  });

  it("shows the proposal in the mandate currency", () => {
    render(<LimitGauge limits={limits} proposed={17800} breaches={breaches} currency="AED" />);
    expect(screen.getByText(/17,800 AED/)).toBeInTheDocument();
  });

  it("renders nothing when a mandate places no price limits", () => {
    const { container } = render(
      <LimitGauge limits={[]} proposed={100} breaches={[]} currency="AED" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

// -- formatting ------------------------------------------------------------

describe("formatting", () => {
  it("renders money with a thousands separator", () => {
    expect(money(17800, "AED")).toBe("17,800 AED");
  });
  it("renders an em dash for a missing figure", () => {
    expect(money(undefined)).toBe("—");
  });
  it("renders payment terms in plain language", () => {
    expect(terms("net_30")).toBe("net 30");
  });
});

// -- trace -----------------------------------------------------------------

const entry = (over: Partial<TraceEntry>): TraceEntry => ({
  seq: 0, entry_id: "UTT-0000", thread_id: "T", entry_type: "utterance",
  actor: "agt_buyer", payload: {}, prev_hash: "0", entry_hash: "1",
  created_at: "2026-09-08T00:00:00Z", ...over,
});

/** Trace reads the detail switch, so it needs the provider around it. */
const plain = (ui: ReactElement) => render(<DetailProvider>{ui}</DetailProvider>);

async function technical(ui: ReactElement) {
  const view = render(
    <DetailProvider>
      <TechnicalToggleForTests />
      {ui}
    </DetailProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "toggle detail" }));
  return view;
}

function TechnicalToggleForTests() {
  const { detail, setDetail } = useDetail();
  return <button onClick={() => setDetail(!detail)}>toggle detail</button>;
}

describe("Trace", () => {
  it("invites action when nothing has happened", () => {
    plain(<Trace entries={[]} currency="AED" />);
    expect(screen.getByText(/Start a deal/)).toBeInTheDocument();
  });

  it("names the speaker in words a customer would use", () => {
    plain(
      <Trace currency="AED" entries={[entry({
        payload: { intent: "counter", offer: { price: 17800, terms: "net_45", quantity: 3, unit: "trucks" }, narrative: "" },
      })]} />,
    );
    expect(screen.getByText("The buyer's agent")).toBeInTheDocument();
    expect(screen.getByText("came back with")).toBeInTheDocument();
    expect(screen.getByText(/17,800 AED/)).toBeInTheDocument();
  });

  const blocked = entry({
    entry_type: "blocked", entry_id: "BLO-0006",
    payload: {
      breaches: ["terms net_45 not in allowlist ['net_30']"],
      breaches_plain: ["They want 45 days to pay. You allow 30."],
    } as never,
  });

  it("says the agent stopped itself, without protocol jargon", () => {
    plain(<Trace currency="AED" entries={[blocked]} />);
    expect(screen.getByText("Stopped itself before saying anything")).toBeInTheDocument();
    expect(screen.getByText("They want 45 days to pay. You allow 30.")).toBeInTheDocument();
    expect(screen.queryByText(/allowlist/)).not.toBeInTheDocument();
  });

  it("shows the audit wording too, but only in technical mode", async () => {
    await technical(<Trace currency="AED" entries={[blocked]} />);
    expect(screen.getByText(/allowlist/)).toBeInTheDocument();
  });

  it("hides entry identifiers until technical detail is switched on", () => {
    plain(<Trace currency="AED" entries={[blocked]} />);
    expect(screen.queryByText("BLO-0006")).not.toBeInTheDocument();
  });

  it("shows entry identifiers in technical mode", async () => {
    await technical(<Trace currency="AED" entries={[blocked]} />);
    expect(screen.getByText("BLO-0006")).toBeInTheDocument();
  });

  it("omits rule-check rows entirely in plain mode", () => {
    plain(
      <Trace currency="AED" entries={[entry({
        entry_type: "decision", entry_id: "DEC-0009",
        payload: { authority_chain: ["MND-SEL-001.v1#price_floor", "approval:APR-1"] },
      })]} />,
    );
    expect(screen.queryByRole("button", { name: /Allowed by/ })).not.toBeInTheDocument();
  });

  it("shows the authority chain in technical mode, collapsed until asked", async () => {
    await technical(
      <Trace currency="AED" entries={[entry({
        entry_type: "decision", entry_id: "DEC-0009",
        payload: { authority_chain: ["MND-SEL-001.v1#price_floor", "approval:APR-1"] },
      })]} />,
    );
    expect(screen.queryByText("approval:APR-1")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /Allowed by the rules, plus a person saying yes/ }),
    );
    expect(screen.getByText("approval:APR-1")).toBeInTheDocument();
  });

  it("says an injection attempt changed nothing", () => {
    plain(
      <Trace currency="AED" entries={[entry({
        entry_type: "injection_flag", entry_id: "INJ-0001",
        payload: { patterns: ["mandate_tamper"] },
      })]} />,
    );
    expect(screen.getByText(/tried to give this agent instructions/)).toBeInTheDocument();
    expect(screen.getByText(/changed nothing/)).toBeInTheDocument();
    expect(screen.queryByText("mandate_tamper")).not.toBeInTheDocument();
  });
});

// -- escalation ------------------------------------------------------------

const pending: Pending = {
  escalation_id: "ESC-1", signature: "abc", principal: "Omar",
  mandate_ref: "MND-SEL-001.v1", currency: "AED",
  subject: "Road freight, Jebel Ali to Riyadh", unit: "trucks",
  proposed: { price: 17800, quantity: 3, unit: "trucks", terms: "net_45", start_date: "2026-10-01" },
  agent_position: "proposal clears floor by 400 AED",
  breaches, limits,
  who_you_are: "You own the trucks. You are being paid for this run.",
  offered_scopes: [
    { scope: "full", label: "Allow all of it", hint: "Every point below is approved, this once" },
    {
      scope: "price_only", label: "Allow the price, not the rest",
      hint: "Your agent then has to solve the others itself",
    },
  ],
};

describe("EscalationCard", () => {
  it("addresses the principal who must decide", () => {
    plain(<EscalationCard pending={pending} onDecide={vi.fn()} busy={false} />);
    expect(screen.getByText("Omar, your agent needs you")).toBeInTheDocument();
  });

  it("offers only the scopes the backend allows, plus declining", () => {
    plain(<EscalationCard pending={pending} onDecide={vi.fn()} busy={false} />);
    expect(screen.getByRole("button", { name: /Allow all of it/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Allow the price, not the rest/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Say no/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /payment terms only/i })).not.toBeInTheDocument();
  });

  it("reports the chosen scope, not just that a choice was made", async () => {
    const onDecide = vi.fn();
    plain(<EscalationCard pending={pending} onDecide={onDecide} busy={false} />);
    await userEvent.click(screen.getByRole("button", { name: /Allow the price, not the rest/ }));
    expect(onDecide).toHaveBeenCalledWith(true, "price_only");
  });

  it("sends granted=false when declining", async () => {
    const onDecide = vi.fn();
    plain(<EscalationCard pending={pending} onDecide={onDecide} busy={false} />);
    await userEvent.click(screen.getByRole("button", { name: /Say no/ }));
    expect(onDecide).toHaveBeenCalledWith(false, "full");
  });

  it("locks the controls while a decision is in flight", () => {
    plain(<EscalationCard pending={pending} onDecide={vi.fn()} busy />);
    expect(screen.getByRole("button", { name: /Allow all of it/ })).toBeDisabled();
  });

  it("shows the plain sentence, not the allowlist syntax", () => {
    plain(<EscalationCard pending={pending} onDecide={vi.fn()} busy={false} />);
    expect(screen.getByText(/That is 15.2% off your 21,000 AED list price/)).toBeInTheDocument();
    expect(screen.queryByText(/discount_authority/)).not.toBeInTheDocument();
  });

  it("names who the person is before asking them anything", () => {
    plain(<EscalationCard pending={pending} onDecide={vi.fn()} busy={false} />);
    expect(screen.getByText(/You own the trucks/)).toBeInTheDocument();
  });

  it("says that approving does not widen the mandate", () => {
    plain(<EscalationCard pending={pending} onDecide={vi.fn()} busy={false} />);
    expect(screen.getByText(/Your rules are not rewritten/)).toBeInTheDocument();
  });
});


// -- guided walkthrough ----------------------------------------------------

const thread = (over: Partial<ThreadState>): ThreadState => ({
  thread_id: "T", subject: "Road freight, Jebel Ali to Riyadh",
  status: "committed", replays: 1, buyer_mandate: "MND-BUY-001.v1",
  seller_mandate: "MND-SEL-001.v1", chain_valid: true, first_bad_seq: null,
  trace: [], pending: null, decisions: [], commitment: null, ...over,
});

describe("guided walkthrough", () => {
  it("opens on the briefing before any deal exists", () => {
    expect(deriveStep(undefined, false).id).toBe("start");
  });

  it("follows the seller when the seller is the one being asked", () => {
    const step = deriveStep(
      thread({ status: "awaiting_approval", pending: { ...pending, principal: "Omar" } }),
      false,
    );
    expect(step.id).toBe("seller");
    expect(step.target).toBe("decide");
  });

  it("moves to the buyer once the seller has answered", () => {
    const step = deriveStep(
      thread({ status: "awaiting_approval", pending: { ...pending, principal: "Nadia" } }),
      false,
    );
    expect(step.id).toBe("buyer");
  });

  it("points at the detail switch once a deal is agreed", () => {
    const step = deriveStep(thread({ status: "committed" }), false);
    expect(step.id).toBe("agreed");
    expect(step.target).toBe("detail");
  });

  it("advances when the person turns technical detail on", () => {
    expect(deriveStep(thread({ status: "committed" }), true).id).toBe("authority");
  });

  it("handles the refusal branch instead of breaking", () => {
    const step = deriveStep(thread({ status: "closed_no_deal" }), false);
    expect(step.id).toBe("declined");
    expect(step.ordinal).toBeNull();
    expect(step.body).toMatch(/as auditable as one that did/);
  });

  it("recovers the main path if the person starts another deal", () => {
    const declined = deriveStep(thread({ status: "closed_no_deal" }), false);
    const restarted = deriveStep(
      thread({ status: "awaiting_approval", pending: { ...pending, principal: "Omar" } }),
      false,
    );
    expect(declined.id).toBe("declined");
    expect(restarted.id).toBe("seller");
  });

  it("numbers every main-path step within the advertised total", () => {
    const ids = ["start", "seller", "buyer", "agreed", "authority"] as const;
    const ordinals = [
      deriveStep(undefined, false),
      deriveStep(thread({ status: "awaiting_approval", pending: { ...pending, principal: "Omar" } }), false),
      deriveStep(thread({ status: "awaiting_approval", pending: { ...pending, principal: "Nadia" } }), false),
      deriveStep(thread({ status: "committed" }), false),
      deriveStep(thread({ status: "committed" }), true),
    ].map((s) => s.ordinal);
    expect(ordinals).toEqual([1, 2, 3, 4, 5]);
    expect(Math.max(...(ordinals as number[]))).toBe(TOTAL_STEPS);
    expect(ids).toHaveLength(TOTAL_STEPS);
  });

  it("tells the person what to press, in the words on the button", () => {
    /* Drift guard: these strings must match labels rendered elsewhere — the
       approval buttons come from the API, the detail switch from App.tsx. */
    const seller = deriveStep(
      thread({ status: "awaiting_approval", pending: { ...pending, principal: "Omar" } }),
      false,
    );
    expect(seller.body).toContain("Allow the price, not the rest");
    expect(deriveStep(thread({ status: "committed" }), false).action)
      .toBe("Show technical detail");
  });

  it("offers to press the control only where the choice is not the point", () => {
    const decisions = [
      deriveStep(thread({ status: "awaiting_approval", pending: { ...pending, principal: "Omar" } }), false),
      deriveStep(thread({ status: "awaiting_approval", pending: { ...pending, principal: "Nadia" } }), false),
    ];
    expect(decisions.every((s) => s.action === undefined)).toBe(true);
    expect(deriveStep(undefined, false).action).toBe("Start a deal");
  });
});


// -- walkthrough guide -----------------------------------------------------

function TourHarness({ withTarget = true }: { withTarget?: boolean }) {
  const { showing, dismiss, restart } = useTour();
  return (
    <>
      {withTarget && <button data-tour="start">Start a deal</button>}
      <button onClick={dismiss}>dismiss</button>
      <button onClick={restart}>restart</button>
      <span>{showing ? "visible" : "hidden"}</span>
      <TourGuide />
    </>
  );
}

describe("TourGuide", () => {
  const harness = (withTarget = true) =>
    render(<TourProvider><TourHarness withTarget={withTarget} /></TourProvider>);

  it("is showing the moment someone arrives", () => {
    harness();
    expect(screen.getByText(/Read what each side wrote down/)).toBeInTheDocument();
  });

  it("is pinned to the viewport, not placed in the page flow", () => {
    /* Regression guard: as a sticky element inside the deals grid it landed
       below the fold on arrival, which is the one thing it must never do. */
    harness();
    expect(screen.getByTestId("tour-guide").className).toContain("fixed");
    expect(screen.getByTestId("tour-guide").className).not.toContain("sticky");
  });

  it("numbers the step the way a printed page would", () => {
    harness();
    expect(screen.getByText(`Step one of ${TOTAL_STEPS}`)).toBeInTheDocument();
  });

  it("dims everything except the control it is pointing at", () => {
    /* jsdom reports every element as zero-sized, so give the target a box. */
    const rect = { top: 100, left: 40, width: 160, height: 36 };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ ...rect, right: 200, bottom: 136, x: 40, y: 100, toJSON: () => rect } as DOMRect);
    harness();
    expect(screen.getByTestId("tour-cutout")).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("falls back to a plain dim when the control is not on screen", () => {
    harness(false);
    expect(screen.queryByTestId("tour-cutout")).not.toBeInTheDocument();
    expect(screen.getByTestId("tour-guide")).toBeInTheDocument();
  });

  it("presses the control for the person when the next move is not a decision", async () => {
    const clicked = vi.fn();
    render(
      <TourProvider>
        <button data-tour="start" onClick={clicked}>Start a deal</button>
        <TourGuide />
      </TourProvider>,
    );
    const guide = screen.getByTestId("tour-guide");
    await userEvent.click(within(guide).getByRole("button", { name: "Start a deal" }));
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("offers Next instead of an action when the step is a decision", () => {
    render(
      <TourProvider>
        <StepSetter />
        <TourGuide />
      </TourProvider>,
    );
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    expect(screen.getByText(/yours to decide/)).toBeInTheDocument();
  });

  it("lets someone read the whole walkthrough without acting", async () => {
    harness();
    for (const title of [
      /Omar's agent stopped itself/,
      /Now Nadia is asked/,
      /two people woken once each/,
      /This is the part that matters/,
    ]) {
      await userEvent.click(screen.getByRole("button", { name: "Next" }));
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
  });

  it("walks back the way it came", async () => {
    harness();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText(/Read what each side wrote down/)).toBeInTheDocument();
  });

  it("says so when the reader has run ahead of the deal", async () => {
    harness();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/You are reading ahead/)).toBeInTheDocument();
  });

  it("snaps back to the deal when the app moves on", async () => {
    render(
      <TourProvider>
        <button data-tour="start">Start a deal</button>
        <Advancer />
        <TourGuide />
      </TourProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/You are reading ahead/)).toBeInTheDocument();

    // The deal itself moves: whatever was being read is replaced.
    await userEvent.click(screen.getByRole("button", { name: "advance the deal" }));
    expect(screen.queryByText(/You are reading ahead/)).not.toBeInTheDocument();
    expect(screen.getByText(/two people woken once each/)).toBeInTheDocument();
  });

  it("goes away when skipped and comes back when asked", async () => {
    harness();
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByText(/Read what each side wrote down/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "restart" }));
    expect(screen.getByText(/Read what each side wrote down/)).toBeInTheDocument();
  });
});

function Advancer() {
  const { setStep } = useTour();
  return (
    <button onClick={() => setStep(deriveStep(thread({ status: "committed" }), false))}>
      advance the deal
    </button>
  );
}

function StepSetter() {
  const { setStep } = useTour();
  const step = deriveStep(
    thread({ status: "awaiting_approval", pending: { ...pending, principal: "Omar" } }),
    false,
  );
  useEffect(() => setStep(step), [setStep, step]);
  return null;
}
