import { useEffect, useState } from "react";
import { getHistory, requestHistory, type HistoryState } from "./history";
import { firstName } from "./format";
import type { Athlete } from "./data";
import { Sources } from "./sources";

/* Riders rebuilt from the shared result lists only have the races the site already covers.
   The button asks for the rest; the weekly data job fetches it later, never during the visit. */
export default function MoreRaces({ a, rivals }: { a: Athlete; rivals?: "some" | "none" }) {
  const [h, setH] = useState<HistoryState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let live = true; getHistory(a.id).then((x) => live && setH(x)); return () => { live = false; }; }, [a.id]);
  // While the job works on the request, check again every minute so the card moves on without a reload.
  const waiting = h?.status === "queued" || h?.status === "running";
  useEffect(() => {
    if (!waiting) return;
    let live = true;
    const t = setInterval(() => getHistory(a.id).then((x) => live && setH(x)), 60_000);
    return () => { live = false; clearInterval(t); };
  }, [a.id, waiting]);
  const name = firstName(a.name);
  const shown = rivals === "none" ? `Rivalene til ${name} er ikke regnet ut ennå.` : rivals ? `Rivalene til ${name} bygger bare på rittene som er hentet inn så langt, så de kan være ufullstendige.` : `Viser ${a.results.length === 1 ? "det ene rittet" : `de ${a.results.length} rittene`} med ${name} som er hentet inn så langt.`;
  if (!h?.enabled) return <p className="note" style={{ margin: "-12px 0 0" }}>{shown} {name} kan ha kjørt flere ritt som ikke er med her.{rivals ? "" : " Watt vises når rytteren kobler til intervals.icu."}</p>;
  const ask = async () => {
    setBusy(true); setErr(null);
    try { setH(await requestHistory(a.id)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="more-races card card-pad" role="note">
      <div>
        <b>{h.status === "none" || h.status === "failed" || h.status === "skipped" ? (rivals === "none" ? "Ingen rivaler ennå" : rivals ? "Kan være ufullstendig" : "Mangler det ritt?") : h.status === "done" ? "Hentet" : "Under behandling"}</b>
        {h.status === "none" && <p>{shown} Er du {name}? Da kan du be om alle rittene dine fra <Sources />, helt tilbake til 2005. Vi henter dem rolig i løpet av noen timer og regner ut rivalene dine på nytt.</p>}
        {h.status === "queued" && <p>Alle rittene til {name} står i kø{h.ahead ? `, med ${h.ahead} ${h.ahead === 1 ? "rytter" : "ryttere"} foran` : ""}. Vi henter ritt og rivaler i løpet av noen timer. Kom tilbake senere, så ligger alt her.</p>}
        {h.status === "running" && <p>Ritt og rivaler for {name} hentes nå. Kom tilbake om litt, så ligger alt her.</p>}
        {h.status === "done" && <p>{h.note ? `Rittene til ${name} er hentet. ${h.note}` : `Alle rittene til ${name} er hentet.`} Ritt og rivaler vises når siden er bygget på nytt, om noen minutter.</p>}
        {(h.status === "failed" || h.status === "skipped") && <p>Vi fikk ikke hentet alle rittene til {name}.{h.note ? ` ${h.note}` : ""}</p>}
        {err && <p className="err" role="alert">{err}</p>}
      </div>
      {(h.status === "none" || h.status === "failed" || h.status === "skipped") && <button type="button" className="btn primary" onClick={ask} disabled={busy}>{busy ? "Sender …" : h.status === "none" ? "Hent alle mine ritt" : "Prøv igjen"}</button>}
    </div>
  );
}
