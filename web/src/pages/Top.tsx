import { useEffect, useState } from "react";
import { getJSON, type RaceType } from "../data";
import { TYPE_LABEL, TYPE_VAR, dateLong, dec } from "../format";
import { openRace } from "./Race";

/* Top lists behind the front page's «Fra resultatlistene» cards: the biggest fields, the closest time trials
   and the highest winning average speeds. rivals.py writes them into summary.json with the cards, so a
   corrected result list changes both the next time the data job runs. */

export type Who = { id: string; name: string; page: boolean };
type TopRace = { id: string; name: string; date: string; type: RaceType };
export interface TopLists {
  biggest: (TopRace & { riders: number })[];
  closest_tt: (TopRace & { gap_s: number; a: Who; b: Who })[];
  fastest_avg: (TopRace & { km: number; kmh: number; rider: Who })[];
}
export type TopKind = "felt" | "tempo" | "snittfart";
export const TOP_KINDS: TopKind[] = ["felt", "tempo", "snittfart"];

/** Opens a top list (App reads the hash). */
export const openTop = (kind: TopKind) => { location.hash = `#/topp/${kind}`; };

const TITLE: Record<TopKind, [string, string]> = {
  felt: ["Største felt", "Rittene med flest ryttere i resultatlisten, alle klasser."],
  tempo: ["Jevneste tempo", "Temporittene der vinneren slo nummer to med minst."],
  snittfart: ["Høyeste snittfart", "Vinnerens snittfart: rittets lengde delt på vinnertiden. Lagtempo er ikke med."],
};

export default function Top({ kind, onRider }: { kind: TopKind; onRider: (id: string) => void }) {
  const [top, setTop] = useState<TopLists | null | undefined>(undefined);
  useEffect(() => { getJSON<{ top?: TopLists }>("summary.json").then((s) => setTop(s.top ?? null)).catch(() => setTop(null)); }, []);
  const who = (w: Who) => w.page ? <button type="button" className="linkish" onClick={() => onRider(w.id)}>{w.name}</button> : <span>{w.name}</span>;
  const race = (r: TopRace) => <button type="button" className="linkish" onClick={() => openRace(r.id)}>{r.name}</button>;
  const type = (r: TopRace) => <span style={{ color: TYPE_VAR[r.type] }}>{TYPE_LABEL[r.type]}</span>;
  const [title, lead] = TITLE[kind];
  if (top === undefined) return <div className="loading">Henter topplisten …</div>;
  if (!top) return <div className="card empty"><b>Fant ikke topplisten</b></div>;
  return (
    <section className="race-page" aria-labelledby="h-top">
      <div className="section-head">
        <div>
          <p className="eyebrow">Toppliste</p>
          <h1 className="h-display" id="h-top">{title}</h1>
          <p className="lead">{lead}</p>
        </div>
        <nav className="top-switch" aria-label="Andre topplister">
          {TOP_KINDS.filter((k) => k !== kind).map((k) => <button key={k} type="button" className="btn" onClick={() => openTop(k)}>{TITLE[k][0]}</button>)}
        </nav>
      </div>
      <div className="card"><div className="table-wrap"><table className="sticky race-table">
        {kind === "felt" && <>
          <thead><tr><th>#</th><th>Ryttere</th><th className="l">Ritt</th><th className="l">Type</th><th className="l">Dato</th></tr></thead>
          <tbody>{top.biggest.map((r, i) => (
            <tr key={r.id}><td className="tnum">{i + 1}</td><td className="tnum">{r.riders.toLocaleString("nb-NO")}</td><td className="l">{race(r)}</td><td className="l">{type(r)}</td><td className="l muted">{dateLong(r.date)}</td></tr>
          ))}</tbody>
        </>}
        {kind === "tempo" && <>
          <thead><tr><th>#</th><th>Skilte</th><th className="l">Ritt</th><th className="l">Vinner</th><th className="l">Nummer to</th><th className="l">Dato</th></tr></thead>
          <tbody>{top.closest_tt.map((r, i) => (
            <tr key={r.id}><td className="tnum">{i + 1}</td><td className="tnum">{r.gap_s} s</td><td className="l">{race(r)}</td><td className="l">{who(r.a)}</td><td className="l">{who(r.b)}</td><td className="l muted">{dateLong(r.date)}</td></tr>
          ))}</tbody>
        </>}
        {kind === "snittfart" && <>
          <thead><tr><th>#</th><th>Snittfart</th><th className="l">Ritt</th><th className="l">Vinner</th><th>Lengde</th><th className="l">Type</th><th className="l">Dato</th></tr></thead>
          <tbody>{top.fastest_avg.map((r, i) => (
            <tr key={r.id}><td className="tnum">{i + 1}</td><td className="tnum">{dec(r.kmh, 1)} km/t</td><td className="l">{race(r)}</td><td className="l">{who(r.rider)}</td><td className="tnum muted">{dec(r.km, 0)} km</td><td className="l">{type(r)}</td><td className="l muted">{dateLong(r.date)}</td></tr>
          ))}</tbody>
        </>}
      </table></div></div>
    </section>
  );
}
