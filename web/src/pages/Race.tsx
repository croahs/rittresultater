import { Fragment, useEffect, useMemo, useState } from "react";
import { loadVideos, raceLists, videosFor, type IndexRider, type RaceList, type RaceVideo, type VideoFile } from "../data";
import { TYPE_LABEL, TYPE_VAR, ageLabel, clock, clsLabel, dateLong } from "../format";
import { KlasseToggle, useKlasse } from "../klasse";
import RaceVideos from "../RaceVideos";
import { Icon } from "../ui";

/* One race's whole result list (data/races.json), for anyone: «Åpen» is everybody, «Kvinner» the women only,
   placed among themselves. DNF comes after everyone who finished. */
/** Opens a race's result list (App reads the hash). */
export const openRace = (id: string) => { location.hash = `#/ritt/${encodeURIComponent(id)}`; };

export default function Race({ id, index, onRider }: { id: string; index: IndexRider[]; onRider: (id: string) => void }) {
  const [race, setRace] = useState<RaceList | null | undefined>(undefined);
  const { women } = useKlasse();
  useEffect(() => { let live = true; raceLists().then((l) => live && setRace(l.find((r) => r.id === id) ?? null)).catch(() => live && setRace(null)); return () => { live = false; }; }, [id]);
  const known = useMemo(() => new Set(index.map((r) => r.id)), [index]);
  // Riders' own videos from this race (data/videos.json), shown by their name.
  const [vfile, setVfile] = useState<VideoFile | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { let live = true; loadVideos().then((f) => live && setVfile(f)); return () => { live = false; }; }, []);
  const vids = useMemo(() => new Map(race ? videosFor(vfile, race.date, race.name).map((v) => [v.rid, v.url]) : []), [vfile, race]);
  const rows = useMemo(() => {
    if (!race) return [];
    const pick = race.rows.filter((r) => !women || r[6] === "K");
    const done = pick.filter((r) => r[5] != null).sort((a, b) => a[5]! - b[5]!);
    return [...done, ...pick.filter((r) => r[5] == null)];
  }, [race, women]);
  if (race === undefined) return <div className="loading">Henter resultatlisten …</div>;
  if (!race) return <div className="card empty"><b>Fant ikke rittet</b></div>;
  const best = rows[0]?.[5] ?? null;
  const finished = rows.filter((r) => r[5] != null).length;
  const name = race.name.replace(/\s+20\d\d$/, "");
  return (
    <section className="race-page" aria-labelledby="h-race">
      <div className="section-head">
        <div>
          <p className="eyebrow" style={{ color: TYPE_VAR[race.type] }}>{TYPE_LABEL[race.type]} · {dateLong(race.date)}{race.distance_km ? ` · ${Math.round(race.distance_km)} km` : ""}</p>
          <h1 className="h-display" id="h-race">{name} {race.date.slice(0, 4)}</h1>
          <p className="lead">{women ? `${finished} kvinner i mål` : `${finished} i mål`}{rows.length > finished ? `, ${rows.length - finished} DNF` : ""}. {women ? "Plassene er regnet blant kvinnene." : "Alle klasser i samme liste."}{race.turritt && <> <a href={race.turritt} target="_blank" rel="noopener">Original resultatliste</a>.</>}</p>
        </div>
        <div className="filters"><KlasseToggle /></div>
      </div>
      {rows.length === 0 ? <div className="card empty"><b>{women ? "Ingen kvinner i denne resultatlisten" : "Tom resultatliste"}</b></div> : (
        <div className="card"><div className="table-wrap"><table className="sticky race-table">
          <thead><tr><th>Plass</th><th className="l">Rytter</th><th>Tid</th><th>Bak</th><th className="l">Klubb</th><th className="l">Klasse</th></tr></thead>
          <tbody>{rows.map((r, i) => {
            const t = r[5], down = r[7], shown = down ? r[8]! : t;
            return (
              <Fragment key={`${r[0]}-${i}`}>
              <tr>
                <td className="tnum">{t == null ? "DNF" : i + 1}</td>
                <td className="l">{known.has(r[0]) ? <button type="button" className="linkish" onClick={() => onRider(r[0])}>{r[1]}</button> : r[1]}
                  {vids.has(r[0]) && <button type="button" className="vid media-btn name-vid" aria-expanded={open === r[0]} title={`Video fra ${r[1]}`} aria-label={`Video fra ${r[1]}`}
                    onClick={() => setOpen(open === r[0] ? null : r[0])}><Icon.play /></button>}</td>
                <td className="tnum">{shown == null ? "–" : clock(shown)}</td>
                <td className="tnum muted">{down ? `−${down} ${down === 1 ? "runde" : "runder"}` : t == null || best == null || i === 0 ? "" : `+${clock(t - best)}`}</td>
                <td className="l muted">{r[2]}</td>
                <td className="l muted">{r[4] ? clsLabel(r[4]) : ageLabel(r[3])}</td>
              </tr>
              {open === r[0] && vids.has(r[0]) && <tr className="media-row"><td colSpan={99}>
                <RaceVideos videos={[{ rid: r[0], by: r[1], url: vids.get(r[0])!, own: false } satisfies RaceVideo]} race={`${name} ${race.date.slice(0, 4)}`} autoOpen /></td></tr>}
              </Fragment>
            );
          })}</tbody>
        </table></div></div>
      )}
    </section>
  );
}
