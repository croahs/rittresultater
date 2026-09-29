import { useEffect, useState } from "react";
import { doneText, forgetRef, getFind, requestFind, savedRef, type HistoryState } from "../history";
import { eqParticipant, freeText, FIRST_YEAR } from "../find";

/* «Fant du deg ikke?»: for riders the search can't find. The form only puts a request in the queue;
   the data job looks the rider up later, never during the visit. This browser keeps the request's ref,
   so the status is here on the next visit too. */
export default function FindMe({ name: initial, onDone }: { name: string; onDone: () => void }) {
  const [h, setH] = useState<HistoryState | null>(null);
  const [how, setHow] = useState<"eq" | "text">("eq");
  const [eq, setEq] = useState("");
  const [name, setName] = useState(initial);
  const [race, setRace] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const ref = savedRef();
    if (!ref) { setH({ enabled: true, status: "none" }); return; }
    let live = true;
    getFind(ref).then((x) => { if (!live) return; if (x.status === "none") forgetRef(); setH(x); });
    return () => { live = false; };
  }, []);
  // While the job works on the request, check again every minute so the card moves on without a reload.
  const waiting = h?.status === "queued" || h?.status === "running";
  useEffect(() => {
    const ref = h?.ref;
    if (!waiting || !ref) return;
    let live = true;
    const t = setInterval(() => getFind(ref).then((x) => live && setH(x)), 60_000);
    return () => { live = false; clearInterval(t); };
  }, [waiting, h?.ref]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    let body: { eq: string } | { name: string; race: string; year: number };
    if (how === "eq") {
      if (!eqParticipant(eq)) { setErr("Det ser ikke ut som en profillenke fra EQ Timing. Den har «participanthistory:» og et tall i seg."); return; }
      body = { eq: eq.trim() };
    } else {
      const f = freeText(name, race, Number(year));
      if (typeof f === "string") { setErr(f); return; }
      body = f;
    }
    setBusy(true);
    try { setH(await requestFind(body)); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const again = () => { forgetRef(); setH({ enabled: true, status: "none" }); setErr(null); };

  const years: number[] = [];
  for (let y = new Date().getFullYear(); y >= FIRST_YEAR; y--) years.push(y);
  const asked = h && h.status !== "none";

  return (
    <section className="find-me" aria-labelledby="h-finn">
      <h1 className="h-display" id="h-finn">Fant du deg ikke?</h1>
      <p className="lead">Siden har bare ryttere fra resultatlistene vi har hentet så langt. Si hvem du er, så leter vi etter rittene dine i resultatlistene til tidtakerne, som <a href="https://www.eqtiming.com" target="_blank" rel="noopener">EQ Timing</a> og <a href="https://www.raceresult.com" target="_blank" rel="noopener">raceresult</a>, og legger deg til. Det skjer rolig i løpet av noen timer, aldri mens du venter her.</p>

      {h && !h.enabled && <p className="note">Forespørsler virker bare på den publiserte siden.</p>}

      {asked && (
        <div className="more-races card card-pad" role="status">
          <div>
            <b>{h.status === "done" ? "Hentet" : h.status === "needs_source" ? "Må finnes for hånd" : h.status === "failed" || h.status === "skipped" ? "Fant deg ikke" : "Under behandling"}</b>
            {h.status === "queued" && <p>Forespørselen din står i kø{h.ahead ? `, med ${h.ahead} ${h.ahead === 1 ? "rytter" : "ryttere"} foran` : ""}. Vi leter i resultatlistene i løpet av noen timer. Kom tilbake senere, så står det her hvordan det gikk.</p>}
            {h.status === "running" && <p>Vi leter etter rittene dine nå. Kom tilbake om litt.</p>}
            {h.status === "done" && <p>{/^\d+ ritt$/i.test((h.note || "").trim()) ? doneText("deg", h.note) : `Vi har hentet rittene dine.${h.note ? ` ${h.note}` : ""}`} Søk etter navnet ditt når siden er bygget på nytt, om noen minutter.</p>}
            {h.status === "needs_source" && <p>Vi må finne resultatlisten for rittet ditt for hånd.{h.note ? ` ${h.note}` : ""}</p>}
            {(h.status === "failed" || h.status === "skipped") && <p>Vi fant ikke rittene dine.{h.note ? ` ${h.note}` : ""} Prøv gjerne igjen med et annet ritt eller profillenken din fra EQ Timing.</p>}
          </div>
          <div className="find-actions">
            {(h.status === "done" || h.status === "failed" || h.status === "skipped") && <button type="button" className="btn" onClick={again}>Ny forespørsel</button>}
            <button type="button" className="btn" onClick={onDone}>Til forsiden</button>
          </div>
        </div>
      )}

      {h && !asked && (
        <form className="find-form card card-pad" onSubmit={send} noValidate>
          <fieldset className="find-how">
            <legend>Hvordan vil du finne deg?</legend>
            <label><input type="radio" name="how" checked={how === "eq"} onChange={() => { setHow("eq"); setErr(null); }} /> Med profilen min hos EQ Timing</label>
            <label><input type="radio" name="how" checked={how === "text"} onChange={() => { setHow("text"); setErr(null); }} /> Med navn og ett ritt jeg har kjørt</label>
          </fieldset>
          {how === "eq" ? (
            <label className="field">Lenke til profilen din
              <input type="url" inputMode="url" value={eq} onChange={(e) => setEq(e.target.value)} placeholder="https://live.eqtiming.com/#participanthistory:1234567" autoComplete="off" spellCheck={false} maxLength={300} />
              <small>Søk deg opp i deltakersøket på <a href="https://live.eqtiming.com/#participanthistory" target="_blank" rel="noopener">live.eqtiming.com</a>, åpne profilen din og kopier adressen.</small>
            </label>
          ) : (
            <>
              <label className="field">Fullt navn
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
              </label>
              <div className="field-row">
                <label className="field">Ritt
                  <input value={race} onChange={(e) => setRace(e.target.value)} placeholder="For eksempel Nordsjørittet" autoComplete="off" maxLength={100} />
                </label>
                <label className="field field-year">År
                  <select value={year} onChange={(e) => setYear(e.target.value)}>{years.map((y) => <option key={y}>{y}</option>)}</select>
                </label>
              </div>
            </>
          )}
          {err && <p className="err" role="alert">{err}</p>}
          <div className="find-actions">
            <button type="submit" className="btn primary" disabled={busy || !h.enabled}>{busy ? "Sender …" : "Finn meg"}</button>
            <button type="button" className="btn" onClick={onDone}>Avbryt</button>
          </div>
        </form>
      )}
    </section>
  );
}
