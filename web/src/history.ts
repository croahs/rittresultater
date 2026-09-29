// "Hent alle mine ritt" (functions/api/history.ts): asking for a rider's full race history.
// The request only joins a queue; the daily data job fetches the history later.
// Without the site's database (local dev, the artifact preview) this says "not enabled".

export interface HistoryState { enabled: boolean; status: "none" | "queued" | "running" | "done" | "failed" | "skipped"; requested_at?: string; done_at?: string | null; note?: string | null; ahead?: number }

import { ridOf } from "./data";

const off: HistoryState = { enabled: false, status: "none" };

export async function getHistory(rider: string): Promise<HistoryState> {
  try {
    const r = await fetch(`api/history?rider=${encodeURIComponent(await ridOf(rider))}`, { cache: "no-store" });
    if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) return off;
    return await r.json() as HistoryState;
  } catch { return off; }
}

export async function requestHistory(rider: string): Promise<HistoryState> {
  let r: Response;
  try {
    r = await fetch("api/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rider: await ridOf(rider) }) });
  } catch { throw new Error("Fikk ikke kontakt med siden. Prøv igjen."); }
  const b = await r.json().catch(() => ({})) as HistoryState & { error?: string };
  if (!r.ok) throw new Error(b.error || "Noe gikk galt. Prøv igjen.");
  return b;
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
