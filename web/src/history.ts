// "Hent alle mine ritt" (functions/api/history.ts): asking for a rider's full race history.
// The request only joins a queue; the daily data job fetches the history later.
// Without the site's database (local dev, the artifact preview) this says "not enabled".

export interface HistoryState { enabled: boolean; status: "none" | "queued" | "running" | "done" | "failed" | "skipped" | "needs_source"; requested_at?: string; done_at?: string | null; note?: string | null; ahead?: number; ref?: string }

import { ridOf } from "./data";

const off: HistoryState = { enabled: false, status: "none" };

export async function getHistory(rider: string): Promise<HistoryState> {
  try {
    const r = await fetch(`api/history?rider=${encodeURIComponent(await ridOf(rider))}`, { cache: "no-store" });
    if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) return off;
    return await r.json() as HistoryState;
  } catch { return off; }
}

async function post(body: Record<string, unknown>): Promise<HistoryState> {
  let r: Response;
  try {
    r = await fetch("api/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch { throw new Error("Fikk ikke kontakt med siden. Prøv igjen."); }
  const b = await r.json().catch(() => ({})) as HistoryState & { error?: string };
  if (!r.ok) throw new Error(b.error || "Noe gikk galt. Prøv igjen.");
  return b;
}

export const requestHistory = async (rider: string) => post({ rider: await ridOf(rider) });

/* «Fant du deg ikke?»: a request for someone not on the site. The answer carries a ref, which this
   browser keeps so the page can show where the request stands on a later visit. */
const REF = "rittresultater.finn";
export const savedRef = (): string | null => { try { return localStorage.getItem(REF); } catch { return null; } };
export const forgetRef = () => { try { localStorage.removeItem(REF); } catch { /* private window */ } };

export async function requestFind(body: { eq: string } | { name: string; race: string; year: number }): Promise<HistoryState> {
  const h = await post(body);
  try { if (h.ref) localStorage.setItem(REF, h.ref); } catch { /* the status just isn't remembered */ }
  return h;
}

export async function getFind(ref: string): Promise<HistoryState> {
  try {
    const r = await fetch(`api/history?ref=${encodeURIComponent(ref)}`, { cache: "no-store" });
    if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) return off;
    return await r.json() as HistoryState;
  } catch { return off; }
}

/** The first sentence of a finished request. The job's note is usually a count like "7 ritt";
    anything else is shown as its own sentence. */
export function doneText(name: string, note?: string | null): string {
  const n = (note || "").trim();
  const count = /^(\d+) ritt$/i.exec(n);
  if (count) return count[1] === "0" ? `Vi fant ingen flere ritt for ${name}.` : `Vi fant ${count[1]} ritt for ${name}.`;
  if (!n) return `Alle rittene til ${name} er hentet.`;
  return `Rittene til ${name} er hentet. ${n.charAt(0).toUpperCase()}${n.slice(1)}${/[.!?]$/.test(n) ? "" : "."}`;
}
