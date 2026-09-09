import { createContext, useContext, useState } from "react";

/**
 * This console has two readers.
 *
 * A business owner deciding something at 6am wants a sentence. An assessor
 * reading the same screen wants the clause identifier, the authority chain and
 * the hash. Writing for one of them fails the other.
 *
 * So: plain language always, technical detail behind a single switch. Nothing
 * is hidden — it is one click away and the switch is in the header, not buried.
 */

interface DetailState {
  detail: boolean;
  setDetail: (v: boolean) => void;
}

const Ctx = createContext<DetailState>({ detail: false, setDetail: () => {} });

export function DetailProvider({ children }: { children: React.ReactNode }) {
  const [detail, setDetail] = useState(false);
  return <Ctx.Provider value={{ detail, setDetail }}>{children}</Ctx.Provider>;
}

export function useDetail() {
  return useContext(Ctx);
}

/** Renders its children only in technical mode. */
export function Technical({ children }: { children: React.ReactNode }) {
  const { detail } = useDetail();
  if (!detail) return null;
  return <>{children}</>;
}
