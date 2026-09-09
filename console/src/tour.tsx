import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from "react";
import type { ThreadState } from "./types";

/**
 * The guided walkthrough.
 *
 * A conventional tour counts clicks: step 3 of 7, next, next. That breaks the
 * moment someone wanders off the path, and this product has a real branch in
 * it — you can decline, and the walkthrough has to cope.
 *
 * So the step is *derived from thread state* rather than tracked. There is no
 * counter to fall out of sync, no click handlers to intercept, and the guide
 * follows the person wherever they go, including into the refusal branch and
 * back out of it.
 *
 * It anchors to the control it is talking about, dims everything else, and —
 * where the next move is not itself a decision the person must make — offers
 * to press the control for them.
 */

export type StepId =
  | "start" | "seller" | "buyer" | "agreed" | "authority" | "declined" | "done";

export type TargetName = "start" | "decide" | "detail";

export interface Step {
  id: StepId;
  ordinal: number | null;   // null where the step is off the main path
  title: string;
  body: string;
  target?: TargetName;
  /** Label for a primary button that presses the target. Omitted where the
   *  point of the step is that the person chooses for themselves. */
  action?: string;
}

const STEPS: Record<StepId, Step> = {
  start: {
    id: "start", ordinal: 1, target: "start", action: "Start a deal",
    title: "Read what each side wrote down",
    body: "Nadia is buying transport, Omar is selling it. The two panels behind this " +
          "show the rules each gave their agent. When you start, the agents begin " +
          "haggling on their own.",
  },
  seller: {
    id: "seller", ordinal: 2, target: "decide",
    title: "Omar's agent stopped itself",
    body: "It wants to accept 17,800 with 45 days to pay, and Omar allowed neither. " +
          "Choose Allow the price, not the rest — then watch what the agent does " +
          "about the payment terms you did not approve.",
  },
  buyer: {
    id: "buyer", ordinal: 3, target: "decide",
    title: "It fixed the terms itself. Now Nadia is asked",
    body: "Your narrow approval stayed narrow, so the agent went back to 30 days on " +
          "its own. Nadia let her agent book up to 15,000 without her, and this is " +
          "17,800.",
  },
  agreed: {
    id: "agreed", ordinal: 4, target: "detail", action: "Show technical detail",
    title: "Agreed, with two people woken once each",
    body: "No phone calls, no email chain. There is a second view of this same screen " +
          "for anyone who wants the engineering underneath it.",
  },
  authority: {
    id: "authority", ordinal: 5, action: "Finish",
    title: "This is the part that matters",
    body: "Every rule check now shows what allowed it — which rule, and whose " +
          "approval. If this deal were ever disputed, that is the answer. The Record " +
          "tab shows the same thing sealed against tampering.",
  },
  declined: {
    id: "declined", ordinal: null, target: "start", action: "Start another deal",
    title: "You said no, and that is recorded too",
    body: "Nothing was agreed and no money moved, but the refusal and the reasons " +
          "behind it are in the record. A deal that did not happen is as auditable " +
          "as one that did.",
  },
  done: { id: "done", ordinal: null, title: "", body: "" },
};

/** The main path, in order. Back and Next walk this; state jumps onto it. */
export const ORDER: StepId[] = ["start", "seller", "buyer", "agreed", "authority"];
export const TOTAL_STEPS = ORDER.length;

export function neighbours(id: StepId): { back: StepId | null; next: StepId | null } {
  const i = ORDER.indexOf(id);
  if (i === -1) return { back: null, next: null };   // off-path steps do not walk
  return { back: ORDER[i - 1] ?? null, next: ORDER[i + 1] ?? null };
}

export function stepById(id: StepId): Step {
  return STEPS[id];
}

const ORDINAL_WORD = ["", "one", "two", "three", "four", "five"];

/** Pure, so it can be tested without rendering anything. */
export function deriveStep(state: ThreadState | undefined, detail: boolean): Step {
  if (!state) return STEPS.start;
  switch (state.status) {
    case "awaiting_approval":
      return state.pending?.principal === "Omar" ? STEPS.seller : STEPS.buyer;
    case "closed_no_deal":
      return STEPS.declined;
    case "committed":
      return detail ? STEPS.authority : STEPS.agreed;
    default:
      return STEPS.start;
  }
}

// --------------------------------------------------------------------------

interface TourState {
  showing: boolean;
  step: Step;
  /** Where the app actually is, which may differ from what is being read. */
  liveId: StepId;
  setStep: (s: Step) => void;
  goTo: (id: StepId) => void;
  dismiss: () => void;
  restart: () => void;
}

const Ctx = createContext<TourState>({
  showing: false, step: STEPS.start, liveId: "start",
  setStep: () => {}, goTo: () => {},
  dismiss: () => {}, restart: () => {},
});

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [showing, setShowing] = useState(true);
  const [step, setStepRaw] = useState<Step>(STEPS.start);
  const [liveId, setLiveId] = useState<StepId>("start");

  /**
   * Two things move the walkthrough, and they must not fight.
   *
   * Doing something in the app moves it — that is `setStep`, called with the
   * step derived from thread state. Reading ahead or back moves it too — that
   * is `goTo`. When the app moves on, it wins: whatever the person was reading
   * is replaced by where they now are, because the alternative is a guide
   * describing a screen that is no longer in front of them.
   */
  const setStep = useCallback((s: Step) => {
    setLiveId((prevLive) => {
      if (prevLive !== s.id) setStepRaw(s);
      return s.id;
    });
  }, []);

  const goTo = useCallback((id: StepId) => setStepRaw(STEPS[id]), []);

  return (
    <Ctx.Provider
      value={{
        showing, step, liveId, setStep, goTo,
        dismiss: () => setShowing(false),
        restart: () => setShowing(true),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useTour() {
  return useContext(Ctx);
}

/** Marks a control the walkthrough can point at and, where sensible, press. */
export function tourTarget(name: TargetName) {
  return { "data-tour": name } as const;
}

interface Rect { top: number; left: number; width: number; height: number }

function measure(name: TargetName | undefined): Rect | null {
  if (!name) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function TourGuide() {
  const { showing, step, liveId, goTo, dismiss } = useTour();
  const [rect, setRect] = useState<Rect | null>(null);

  const target = showing && step.id !== "done" ? step.target : undefined;

  useLayoutEffect(() => {
    if (!target) { setRect(null); return; }
    const update = () => setRect(measure(target));
    update();
    // The panel it points at can appear a beat after the step changes.
    const t = window.setTimeout(update, 120);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [target, step.id]);

  useEffect(() => {
    if (!target) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
    // Guarded: not every environment implements scrolling, and a walkthrough
    // that throws is worse than one that does not scroll.
    el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [target, step.id]);

  if (!showing || step.id === "done") return null;

  const press = () => {
    if (!step.target) { dismiss(); return; }
    document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)?.click();
  };

  const { back, next } = neighbours(step.id);
  const reading = step.id !== liveId;      // browsing away from where the app is
  const canAct = step.action && !reading;

  // Sit under the target where there is room, otherwise above it. With no
  // target at all, rest in the lower right rather than covering the page.
  const below = rect ? rect.top + rect.height + 14 : 0;
  const roomBelow = rect ? window.innerHeight - below > 260 : false;
  const style: React.CSSProperties = rect
    ? {
        top: roomBelow ? below : undefined,
        bottom: roomBelow ? undefined : Math.max(16, window.innerHeight - rect.top + 14),
        left: Math.min(Math.max(16, rect.left), Math.max(16, window.innerWidth - 396)),
      }
    : { bottom: 28, right: 28 };

  return (
    <>
      {/* Everything except the target dims. One element, no overlay maths. */}
      {rect ? (
        <div
          data-testid="tour-cutout"
          aria-hidden
          className="pointer-events-none fixed z-30 rounded"
          style={{
            top: rect.top - 6, left: rect.left - 6,
            width: rect.width + 12, height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgb(33 29 23 / 0.34)",
            outline: "1px solid rgb(138 106 18 / 0.7)",
          }}
        />
      ) : (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-30 bg-ink/25" />
      )}

      <aside
        data-testid="tour-guide"
        role="dialog"
        aria-label="Guided walkthrough"
        className="fixed z-40 w-[23rem] max-w-[calc(100vw-2rem)] border border-rule bg-surface p-5 shadow-lift rounded"
        style={style}
      >
        <p className="step-mark text-small">
          {step.ordinal
            ? `Step ${ORDINAL_WORD[step.ordinal]} of ${TOTAL_STEPS}`
            : "Off the main path"}
        </p>

        <h2 className="mt-1 font-display text-lead leading-snug">{step.title}</h2>
        <p className="mt-2 text-small text-muted">{step.body}</p>

        {reading && (
          <p className="mt-3 text-small text-brass">
            You are reading ahead. The deal is still at step{" "}
            {stepById(liveId).ordinal ?? "—"}.
          </p>
        )}

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-rule pt-4">
          <button className="text-small text-muted underline decoration-rule underline-offset-4 hover:text-ink"
                  onClick={dismiss}>
            Skip
          </button>

          {/* Back and Next always read; the action, when there is one, does.
              Reading ahead never acts on the person's behalf. */}
          <div className="flex items-center gap-2">
            <button className="btn-quiet" onClick={() => back && goTo(back)} disabled={!back}>
              Back
            </button>

            {next && (
              <button className="btn-quiet" onClick={() => goTo(next)}>Next</button>
            )}

            {canAct ? (
              <button className="btn-authority" onClick={press}>{step.action}</button>
            ) : !next ? (
              <button className="btn-authority" onClick={dismiss}>Finish</button>
            ) : null}
          </div>
        </div>

        {!step.action && !reading && (
          <p className="mt-3 text-small text-muted">
            This one is yours to decide — the buttons behind this panel are the point.
            Next just reads on without answering.
          </p>
        )}
      </aside>
    </>
  );
}
