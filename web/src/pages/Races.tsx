import { useMemo, useState } from "react";
import { flags, years, type Athlete, type RaceType, type Result } from "../data";
import { TYPE_LABEL, TYPE_VAR, dateLong, dec, fold, hms, pct } from "../format";
import { SelChip, raceKey, useSel } from "../state";
import { Icon } from "../ui";

type SortKey = "date" | "beaten" | "behind" | "np";

export default function Races({ a }: { a: Athlete }) {
  const { sel, setSel, season, setSeason } = useSel();
  const ys = years(a);
  const [q, setQ] = useState("");
  const [type, setType] = useState<RaceType | "all">("all");
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: "date", desc: true });
  const pv = a.points.some((p) => p.video);
  const types = [...new Set(a.results.map((r) => r.type))];
  const rows = useMemo(() => {
    const s = fold(q.trim());
    const val = (r: Result) => (sort.k === "date" ? r.date : sort.k === "beaten" ? r.beaten : sort.k === "behind" ? r.behind ?? 999 : r.np ?? -1);
    return a.results.filter((r) => (season === "all" || r.year === season) && (type === "all" || r.type === type) && (!s || fold(`${r.race} ${r.year}`).includes(s)))
      .sort((x, y) => { const d = val(x) < val(y) ? -1 : val(x) > val(y) ? 1 : 0; return sort.desc ? -d : d; });
  }, [a, q, type, sort, season]);
  const th = (k: SortKey, label: string) => (
    <th aria-sort={sort.k === k ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button type="button" onClick={() => setSort((s) => ({ k, desc: s.k === k ? !s.desc : k !== "behind" }))}>{label}{sort.k === k ? (sort.desc ? " ↓" : " ↑") : ""}</button>
    </th>
  );
  return (
    <>
      <div><h1 className="h-display">Alle ritt</h1><p className="lead">Hele resultatlisten. Trykk på en kolonne for å sortere, og på et ritt for å velge det.</p><SelChip /></div>
      <section className="card">
        <div className="toolbar">
          <input type="search" id="race-filter" placeholder="Filtrer på rittnavn" aria-label="Filtrer på rittnavn" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="chips" role="group" aria-label="Rittype">
            <button type="button" className="chip" aria-pressed={type === "all"} onClick={() => setType("all")}>Alle typer</button>
            {types.map((t) => <button key={t} type="button" className="chip" aria-pressed={type === t} onClick={() => setType(t)}>{TYPE_LABEL[t]}</button>)}
          </div>
          {ys.length > 1 && <div className="chips" role="group" aria-label="År">
            {(["all", ...ys] as const).map((y) => <button key={y} type="button" className="chip" aria-pressed={season === y} onClick={() => setSeason(y)}>{y === "all" ? "Alle år" : y}</button>)}
          </div>}
          <span className="muted tnum" style={{ marginLeft: "auto" }}>{rows.length} av {a.results.length}</span>
        </div>
        {rows.length === 0 ? <div className="empty"><b>Ingen ritt passer filteret</b><button className="btn" onClick={() => { setQ(""); setType("all"); setSeason("all"); }}>Nullstill filter</button></div> : (
          <div className="table-wrap"><table className="sticky">
            <thead><tr><th className="l">Ritt</th><th>Plass</th>{th("beaten", "Slått")}{th("behind", "Bak vinner")}{th("date", "Dato")}<th className="l">Type</th><th>Tid</th><th>Km</th><th>Fart</th>{a.power && th("np", "NP")}{a.power && <th>Snitt W</th>}<th>Lenker</th></tr></thead>
            <tbody>{rows.map((r) => {
              const k = raceKey(r);
              return (
                <tr key={k} aria-selected={sel === k} tabIndex={0} style={{ cursor: "pointer" }} onClick={() => setSel(sel === k ? null : k)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(sel === k ? null : k); } }}>
                  <td className="l"><b style={{ fontWeight: 600 }}>{r.race}</b> <span className="muted">{r.year}</span></td>
                  <td>{r.place}/{r.field}{r.agePlace ? <span className="muted age"> ({r.agePlace}/{r.ageN} {r.ageClass})</span> : null}</td>
                  <td>{pct(r.beaten)}</td><td>{pct(r.behind)}</td>
                  <td>{dateLong(r.date)}</td>
                  <td className="l"><span className="swatch"><span className="dot" style={{ background: TYPE_VAR[r.type] }} />{TYPE_LABEL[r.type]}{r.cls ? ` · ${r.cls}` : ""}</span></td>
                  <td>{hms(r.time)}</td><td>{dec(r.km)}</td><td>{dec(r.speed)}</td>
                  {a.power && <td>{r.np ? (r.icu && flags.activityLinks ? <a href={r.icu} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>{r.np}</a> : r.np) : "–"}</td>}
                  {a.power && <td>{r.ap ?? "–"}</td>}
                  <td className="links">{r.video && <a className="vid" href={r.video} target="_blank" rel="noopener" title="Video fra rittet" aria-label={`Video fra ${r.race} ${r.year}`} onClick={(e) => e.stopPropagation()}><Icon.play /></a>}{r.link ? <a href={r.link} target="_blank" rel="noopener" aria-label={`Resultatliste for ${r.race} ${r.year}`} onClick={(e) => e.stopPropagation()}>↗</a> : ""}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
      {a.points.length > 0 && (
        <section className="card">
          <div className="card-pad"><h2 className="h-card">Poengritt</h2><p className="note" style={{ margin: "4px 0 0" }}>SSK Cup telles i poeng, ikke tid, og er ikke med i plasseringstallene over. Watt og fart gjelder bare rundene i selve rittet.</p></div>
          <div className="table-wrap"><table className="sticky">
            <thead><tr><th className="l">Ritt</th><th>Dato</th><th className="l">Klasse</th><th>Plass</th><th>Poeng</th><th>Runder</th><th>Tid</th><th>Fart</th><th>NP</th><th>Snitt W</th>{pv && <th>Video</th>}</tr></thead>
            <tbody>{a.points.map((p) => (
              <tr key={p.date}><td>{p.name}</td><td>{dateLong(p.date)}</td><td className="l">{p.cls}</td>
                <td>{p.place ? `${p.place}/${p.n}` : "Datt av"}</td><td>{p.pts ? `${p.pts} (vinner ${p.win})` : "–"}</td><td>{p.laps}</td><td>{p.time}</td><td>{p.speed}</td><td>{p.np}</td><td>{p.ap}</td>
                {pv && <td className="links">{p.video && <a className="vid" href={p.video} target="_blank" rel="noopener" title="Video fra rittet" aria-label={`Video fra ${p.name}`}><Icon.play /></a>}</td>}</tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </>
  );
}
