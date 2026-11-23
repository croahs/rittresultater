import { useEffect, useState } from "react";
import { loadAlleRace, loadAlleRider, type AlleRace, type AlleRider } from "../alle";
import { dateLong } from "../format";

/* A rider or race from every harvested list (alle.py, api/alle), for riders without a profile of their own
   yet: their results as the timer's lists give them, and each race's whole list. Rivals, watts and
   charts come when they ask for their own profile («Fant du deg ikke?» with their EQ Timing link). */

const eqLink = (uid: number) => `https://live.eqtiming.com/#participanthistory:${uid}`;
export const openAlleRider = (uid: number) => { location.hash = `#/alle/rytter/${uid}`; };
const openAlleRace = (id: string) => { location.hash = `#/alle/ritt/${id}`; };

function where(r: AlleRace) { return [r.place, r.organizer].filter(Boolean).join(" · "); }
const placeText = (place: number | null, status: string) => (place == null ? status || "DNF" : `${place}`);

export default function Alle({ path, profileFor, onProfile, onFind }: {
  path: string;
  /** The rider's own profile (data key) when they have one, else null. */
  profileFor: (uid: number) => Promise<string | null>;
  /** Open a rider's own profile; redirect: in place of this page in the history. */
  onProfile: (key: string, redirect?: boolean) => void;
  onFind: (name: string, eqLink: string) => void;
}) {
  const [kind, id] = path.split("/");
  return kind === "ritt" ? <AlleRacePage key={id} id={id} profileFor={profileFor} onProfile={onProfile} />
    : <AlleRiderPage key={id} uid={id} profileFor={profileFor} onProfile={onProfile} onFind={onFind} />;
}

function AlleRiderPage({ uid, profileFor, onProfile, onFind }: { uid: string; profileFor: (uid: number) => Promise<string | null>; onProfile: (key: string, redirect?: boolean) => void; onFind: (name: string, eqLink: string) => void }) {
  const [r, setR] = useState<AlleRider | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    // A rider with a profile of their own goes there: it has everything this page has, and more.
    profileFor(Number(uid)).then((key) => {
      if (!live) return;
      if (key) { onProfile(key, true); return; }
      loadAlleRider(uid).then((x) => live && setR(x)).catch(() => live && setR(null));
    });
    return () => { live = false; };
  }, [uid]);
  if (r === undefined) return <div className="loading">Henter resultater …</div>;
  if (!r) return <div className="card empty"><b>Fant ikke rytteren</b>Lenken kan være gammel. Søk etter navnet øverst.</div>;
  const done = r.results.filter((x) => x[6] != null);
  const wins = done.filter((x) => x[6] === 1).length;
  return (
    <section className="race-page" aria-labelledby="h-alle">
      <div className="section-head">
        <div>
          <p className="eyebrow">{r.club || "Uten klubb"}</p>
          <h1 className="h-display" id="h-alle">{r.name}</h1>
          <p className="lead">{r.results.length} ritt i resultatlistene fra <a href="https://www.eqtiming.com" target="_blank" rel="noopener">EQ Timing</a>{wins ? `, ${wins} ${wins === 1 ? "seier" : "seiere"}` : ""}.
            {" "}Plassen er i listen rytteren står i (distanse eller klasse), med DNF i feltet.</p>
        </div>
      </div>
      <div className="card alle-ask">
        <p><b>Er dette deg?</b> Be om din egen profil, så får du rivalene dine, utviklingen over år og watt fra intervals.icu.
          {" "}<button type="button" className="linkish" onClick={() => onFind(r.name, eqLink(r.uid))}>Be om profilen</button></p>
      </div>
      <div className="card"><div className="table-wrap"><table className="sticky race-table">
        <thead><tr><th className="l">Dato</th><th className="l">Ritt</th><th>Plass</th><th>Tid</th><th className="l">Liste</th><th className="l">Klasse</th></tr></thead>
        <tbody>{r.results.map(([eid, date, race, sport, stage, cls, place, field, time, status], i) => (
          <tr key={`${eid}-${i}`}>
            <td className="l tnum muted">{date.split("-").reverse().join(".")}</td>
            <td className="l"><button type="button" className="linkish" onClick={() => openAlleRace(eid)}>{race}</button> <small className="muted">{sport}</small></td>
            <td className="tnum">{placeText(place, status)}<small className="muted"> / {field}</small></td>
            <td className="tnum">{time}{place != null && status ? <small className="muted"> {status}</small> : null}</td>
            <td className="l muted">{stage}</td>
            <td className="l muted">{cls}</td>
          </tr>
        ))}</tbody>
      </table></div></div>
    </section>
  );
}

function AlleRacePage({ id, profileFor, onProfile }: { id: string; profileFor: (uid: number) => Promise<string | null>; onProfile: (key: string) => void }) {
  const [race, setRace] = useState<AlleRace | null | undefined>(undefined);
  const [stage, setStage] = useState(0);
  useEffect(() => { let live = true; loadAlleRace(id).then((x) => live && setRace(x)).catch(() => live && setRace(null)); return () => { live = false; }; }, [id]);
  if (race === undefined) return <div className="loading">Henter resultatlisten …</div>;
  if (!race) return <div className="card empty"><b>Fant ikke rittet</b></div>;
  const st = race.stages[Math.min(stage, race.stages.length - 1)];
  const finished = st.rows.filter((r) => r[4] != null).length;
  const rider = async (uid: number) => { const key = await profileFor(uid); if (key) onProfile(key); else openAlleRider(uid); };
  return (
    <section className="race-page" aria-labelledby="h-alle-race">
      <div className="section-head">
        <div>
          <p className="eyebrow">{race.sport} · {dateLong(race.date)}{where(race) ? ` · ${where(race)}` : ""}</p>
          <h1 className="h-display" id="h-alle-race">{race.name}</h1>
          <p className="lead">{finished} i mål{st.rows.length > finished ? `, ${st.rows.length - finished} DNF` : ""}{st.km ? `, ${Math.round(st.km)} km` : ""}.
            {" "}<a href={`https://live.eqtiming.com/${id.replace(/^eq:/, "")}#result`} target="_blank" rel="noopener">Original resultatliste</a>.</p>
        </div>
        {race.stages.length > 1 && (
          <div className="filters">
            <label className="muted">Liste{" "}
              <select value={stage} onChange={(e) => setStage(Number(e.target.value))}>
                {race.stages.map((s, i) => <option key={s.id} value={i}>{s.name || `Liste ${i + 1}`} ({s.rows.length})</option>)}
              </select>
            </label>
          </div>
        )}
      </div>
      <div className="card"><div className="table-wrap"><table className="sticky race-table">
        <thead><tr><th>Plass</th><th className="l">Rytter</th><th>Tid</th><th className="l">Klubb</th><th className="l">Klasse</th></tr></thead>
        <tbody>{st.rows.map(([uid, name, club, cls, place, time, status], i) => (
          <tr key={`${uid}-${i}`}>
            <td className="tnum">{placeText(place, status)}</td>
            <td className="l">{uid != null ? <button type="button" className="linkish" onClick={() => rider(uid)}>{name}</button> : <span className="muted">Anonym</span>}</td>
            <td className="tnum">{time}{place != null && status ? <small className="muted"> {status}</small> : null}</td>
            <td className="l muted">{club}</td>
            <td className="l muted">{cls}</td>
          </tr>
        ))}</tbody>
      </table></div></div>
    </section>
  );
}
