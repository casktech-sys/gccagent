import { NavLink, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { DetailProvider, useDetail } from "./detail";
import { TourGuide, TourProvider, tourTarget, useTour } from "./tour";
import Containment from "./routes/Containment";
import Ledger from "./routes/Ledger";
import Mandates from "./routes/Mandates";
import Threads from "./routes/Threads";

// Named for what a business owner would call them, not for what they are
// internally. "Ledger" and "Containment" are our words, not theirs.
const NAV = [
  { to: "/", label: "Deals", end: true },
  { to: "/mandates", label: "Rules" },
  { to: "/ledger", label: "Record" },
  { to: "/containment", label: "Safety" },
];

function DetailSwitch() {
  const { detail, setDetail } = useDetail();
  return (
    <button
      {...tourTarget("detail")}
      onClick={() => setDetail(!detail)}
      aria-pressed={detail}
      className={`btn ${detail ? "border-brass text-brass" : "border-rule text-muted hover:text-ink"}`}
    >
      {detail ? "Hide technical detail" : "Show technical detail"}
    </button>
  );
}

function TourRestart() {
  const { showing, restart } = useTour();
  if (showing) return null;
  return (
    <button className="btn-quiet" onClick={restart}>
      Show me around
    </button>
  );
}

function Shell() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: false });

  return (
    <div className="min-h-screen">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-6 py-5">
          <div className="flex items-end gap-8">
            <h1 className="font-display text-title leading-none">Warrant</h1>
            <nav>
              <ul className="flex gap-6">
                {NAV.map((n) => (
                  <li key={n.to}>
                    <NavLink
                      to={n.to}
                      end={n.end}
                      className={({ isActive }: { isActive: boolean }) =>
                        `pb-1 text-small transition-colors ${
                          isActive
                            ? "border-b border-brass text-ink"
                            : "text-muted hover:text-ink"
                        }`
                      }
                    >
                      {n.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            {health.isError && (
              <p className="text-small text-rust">
                Nothing is running on port 8000. Start the server, then reload.
              </p>
            )}
            <TourRestart />
            <DetailSwitch />
          </div>
        </div>
      </header>

      {/* pb clears the fixed walkthrough bar so nothing hides behind it. */}
      <main className="mx-auto max-w-6xl px-6 pb-44 pt-10">
        <Routes>
          <Route path="/" element={<Threads />} />
          <Route path="/mandates" element={<Mandates />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/containment" element={<Containment />} />
        </Routes>
      </main>

      <TourGuide />
    </div>
  );
}

export default function App() {
  return (
    <DetailProvider>
      <TourProvider>
        <Shell />
      </TourProvider>
    </DetailProvider>
  );
}
