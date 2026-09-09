import type {
  Health, Mandate, Scope, ThreadState, ThreadSummary,
} from "./types";

const BASE = "/api";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* response had no JSON body; the status line is the best we have */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => call<Health>("/health"),
  mandates: () => call<Mandate[]>("/mandates"),
  saveMandate: (id: string, mandate: Mandate) =>
    call<{ mandate_ref: string }>(`/mandates/${id}`, {
      method: "PUT",
      body: JSON.stringify(mandate),
    }),
  threads: () => call<ThreadSummary[]>("/sessions"),
  thread: (id: string) => call<ThreadState>(`/sessions/${id}`),
  openThread: (thread_id?: string) =>
    call<ThreadState>("/sessions", {
      method: "POST",
      body: JSON.stringify({ thread_id }),
    }),
  decide: (id: string, granted: boolean, scope: Scope) =>
    call<ThreadState>(`/sessions/${id}/decide`, {
      method: "POST",
      body: JSON.stringify({ granted, scope }),
    }),
  closeThread: (id: string) =>
    call<{ deleted: string }>(`/sessions/${id}`, { method: "DELETE" }),
  scan: (text: string) =>
    call<{ flags: string[]; wrapped_preview: string }>("/injection/scan", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
};

export function money(value: number | undefined, currency = "AED"): string {
  if (value === undefined) return "—";
  return `${value.toLocaleString("en-GB", { maximumFractionDigits: 0 })} ${currency}`;
}

export function terms(value: string | undefined): string {
  if (!value) return "—";
  return value.replace("net_", "net ").replace("prepay", "prepaid");
}
