import { useEffect, useMemo } from "react";
import MoreRaces from "../MoreRaces";
import { median, mean, raceFor, years, type Athlete, type PointsRace, type RaceType, type Result } from "../data";
import { TYPE_LABEL, TYPE_VAR, dateLong, dateShort, dec, firstName, hms, pct, span } from "../format";
import { useState } from "react";
import { raceKey, useSel } from "../state";
import { flags, ridOf } from "../data";
import type { Tab } from "../App";
import { KlasseToggle, useFelt } from "../klasse";
import { openRace } from "./Race";

export default function Overview({ a, isMe, go }: { a: Athlete; isMe: boolean; go: (t: Tab) => void }) {
  const felt = useFelt();
  const { season, setSeason, sel, setSel, rows } = useSel();
  const ys = years(a);
  const last = a.results[a.results.length - 1];
  const selected = rows.find((r) => raceKey(r) === sel) || null;
  const who = isMe ? "Du" : firstName(a.name);

  return (
    <>
      <Hero a={a} isMe={isMe} go={go} />
      {!a.full && <MoreRaces a={a} />}
      {last && (
        <div className="latest" role="note">
          <span>Siste ritt: {last.race} {last.year}, {last.place}. av {last.field}. {who} slo {Math.round(last.beaten)} % av {felt}.</span>
          <button type="button" onClick={() => { setSeason("all"); setSel(raceKey(last)); }}>Vis rittet</button>
        </div>
      )}

      <section className="section" aria-labelledby="h-sesong">
        <div className="section-head">
          <div><h2 className="h-section" id="h-sesong">Sesongen</h2><p className="lead">Velg et ritt i listen for å se detaljene. Tallene i skiven gjelder hele perioden når ingen ritt er valgt.</p></div>
          <div className="filters"><KlasseToggle />
          <div className="chips" role="group" aria-label="Sesong">
            {(["all", ...ys] as const).map((y) => (
              <button key={y} type="button" className="chip" aria-pressed={season === y} onClick={() => setSeason(y)}>{y === "all" ? "Alle år" : y}</button>
            ))}
          </div></div>
        </div>
        <div className="board">
          <FinishSheet a={a} />
          <div className="board-side">
            <DialCard a={a} r={selected} rows={rows} go={go} />
            <TypeCards rows={rows} />
          </div>
        </div>
      </section>
    </>
  );
}

function Hero({ a, isMe, go }: { a: Athlete; isMe: boolean; go: (t: Tab) => void }) {
  const felt = useFelt();
  const ys = years(a);
  const best = a.results.reduce<Result | null>((b, r) => (!b || r.beaten > b.beaten ? r : b), null);
  const typical = median(a.results.map((r) => r.beaten));
  // Development = the same races in the last two seasons, so a change in race mix does not fool it.
  const [y0, y1] = [ys[ys.length - 2], ys[ys.length - 1]];
  const pairs = a.results.filter((r) => r.year === y1).map((b) => [a.results.find((r) => r.year === y0 && r.race === b.race), b] as const).filter((p) => p[0]);
  const change = pairs.length >= 3 ? mean(pairs.map(([p, b]) => b.beaten - p!.beaten)) : null;
  const who = isMe ? "Du" : firstName(a.name);
  const { setSeason, setSel } = useSel();
  // The rider card: three numbers that say something about the rider; our id is only small print at the bottom.
  const [rid, setRid] = useState<string | null>(null);
  useEffect(() => { let live = true; setRid(null); ridOf(a.id).then((r) => live && setRid(r)); return () => { live = false; }; }, [a.id]);
  const idText = rid === null ? "" : /^r\d+$/.test(rid) ? `Rytter ${rid.slice(1)}` : /^eq\d+$/.test(rid) ? `EQ-ID ${rid.slice(2)}` : `Turritt-ID ${rid}`;
  const top = a.results.reduce<Result | null>((b, r) => (!b || r.place < b.place || (r.place === b.place && r.field > b.field) ? r : b), null);
  const roll = (text: string, from: number) => [...text].map((d, i) => <span key={i} aria-hidden="true" style={{ animationDelay: `${from + i * 70}ms` }}>{d}</span>);
  const jump = (t: Tab, id: string) => { go(t); setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 250); };
  return (
    <div className="hero">
      <div className="bib" aria-label={`Rytterkort for ${a.name}`}>
        <div className="bib-top"><span>Rytterkort</span><span>{a.ageClass || span(ys)}</span></div>
        <div>
          <h1 className="bib-name">{a.name}</h1>
          <div className="bib-meta">{a.club || "Uten klubb"}{a.points.length ? ` · ${a.points.length} poengritt i tillegg` : ""}</div>
        </div>
        <div className="bib-stripe" aria-hidden="true" />
        <dl className="bib-trio">
          <div><dt>ritt på tid</dt><dd aria-label={String(a.results.length)}>{roll(String(a.results.length), 120)}</dd></div>
          <div title={top ? `${top.place}. av ${top.field} ${top.basis} i ${top.race} ${top.year}` : undefined}><dt>beste plass</dt><dd aria-label={top ? `${top.place}. av ${top.field} i ${top.race} ${top.year}` : "ingen"}>{top ? roll(`${top.place}.`, 260) : "–"}</dd></div>
          <div><dt>slår typisk</dt><dd aria-label={pct(typical)}>{a.results.length ? roll(pct(typical), 400) : "–"}</dd></div>
        </dl>
        <div className="bib-foot">{[idText, span(ys)].filter(Boolean).join(" · ")}</div>
      </div>
      <div className="stats">
        <button type="button" className="card stat" onClick={() => go("utvikling")}><span className="eyebrow">Slår typisk <i aria-hidden="true">→</i></span><b>{pct(typical)}</b><small>av {felt}, median over alle ritt. Se utviklingen.</small></button>
        <button type="button" className="card stat" disabled={!best} onClick={() => { if (!best) return; setSeason("all"); setSel(raceKey(best)); setTimeout(() => document.getElementById("race-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }}><span className="eyebrow">Beste ritt <i aria-hidden="true">→</i></span><b>{best ? `Slo ${pct(best.beaten)}` : "–"}</b><small>{best ? `${best.place}. av ${best.field} ${best.basis} i ${best.race} ${best.year}` : "Ingen ritt ennå"}</small></button>
        <button type="button" className="card stat" onClick={() => jump("utvikling", "samme-ritt")}><span className="eyebrow">Utvikling <i aria-hidden="true">→</i></span>
          <b className={change == null ? "" : change >= 0 ? "pos" : "neg"}>{change == null ? "–" : `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(0)}`}</b>
          <small>{change == null ? "Trenger minst tre av de samme rittene i to sesonger" : `prosentpoeng ${change >= 0 ? "mer" : "mindre"} av ${felt} slått i ${y1} enn i ${y0}, snitt over ${pairs.length} ritt ${who.toLowerCase() === "du" ? "du" : who} kjørte begge år`}</small></button>
        <button type="button" className="card stat" onClick={() => jump("utvikling", "watt")}><span className="eyebrow">{a.power ? "Snitt NP" : "Watt"} <i aria-hidden="true">→</i></span>
          <b>{a.power ? `${Math.round(mean(a.results.filter((r) => r.np).map((r) => r.np!)))} W` : "–"}</b>
          <small>{a.power ? "normalisert watt i rittene med wattdata" : "Ikke delt ennå. Trykk for å hente watt fra intervals.icu."}</small></button>
      </div>
    </div>
  );
}

function FinishSheet({ a }: { a: Athlete }) {
  const { season, sel, setSel, rows } = useSel();
  const [all, setAll] = useState(false);
  const selected = rows.find((r) => raceKey(r) === sel);
  const pts = a.points.filter((p) => season === "all" || p.date.startsWith(String(season)));
  const items: { d: string; r?: Result; p?: PointsRace }[] = [...rows.map((r) => ({ d: r.date, r })), ...pts.map((p) => ({ d: p.date, p }))].sort((x, y) => y.d.localeCompare(x.d));
  return (
    <div className={`card sheet${all ? "" : " short"}`} aria-label="Rittliste">
      <div className="sheet-head">
        <div className="row"><h3 className="h-card">Målgangsliste</h3><span className="muted tnum">{items.length} ritt</span></div>
        {selected ? (
          <div className="selected-bar" role="status">
            <span><small>Valgt ritt</small>{selected.race} {selected.year}</span>
            <button type="button" onClick={() => setSel(null)}>Fjern valg</button>
          </div>
        ) : <p className="note" style={{ margin: 0 }}>Viser alle ritt{season === "all" ? "" : ` i ${season}`}. Trykk på et ritt for å velge det.</p>}
      </div>
      <ol>
        {items.length === 0 && <li className="empty">Ingen ritt i denne perioden.</li>}
        {items.map((it) => {
          if (it.p) {
            const p = it.p;
            return (
              <li key={`p${p.date}`} className="pts-row">
                <span className="place"><i style={{ background: "var(--pts)" }} />{p.place ? p.place.replace(" (shared)", "").replace("-", "–") : "–"}<small>{p.n ? `av ${p.n}` : "poeng"}</small></span>
                <div><div className="t" style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: 600 }}><span>{p.name}</span><small className="muted">{dateShort(p.date)} {p.date.slice(2, 4)}</small></div>
                  <p style={{ margin: "1px 0 0", color: "var(--ink-2)", fontSize: ".82rem" }}>{p.cls}. {p.pts ? `${p.pts} poeng` : `Datt av etter ${p.laps} runder`}. NP {p.np} W.</p></div>
              </li>
            );
          }
          const r = it.r!, k = raceKey(r), on = k === sel;
          return (
            <li key={k}>
              <button type="button" aria-pressed={on} onClick={() => {
                setSel(on ? null : k);
                if (!on && innerWidth < 1000) document.getElementById("race-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}>
                <span className="place"><i style={{ background: TYPE_VAR[r.type] }} />{r.place}<small>av {r.field}</small></span>
                <span style={{ minWidth: 0 }}>
                  <span className="t"><span>{r.race}</span><small>{dateShort(r.date)} {String(r.year).slice(2)}</small></span>
                  <p>{TYPE_LABEL[r.type]}{r.cls ? ` (${r.cls})` : ""}. Slo {Math.round(r.beaten)} %{r.behind != null ? `, ${pct(r.behind)} bak vinner` : ""}{r.np ? `, NP ${r.np} W` : ""}.</p>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {items.length > 8 && <button type="button" className="more" onClick={() => setAll(!all)}>{all ? "Vis færre" : `Vis alle ${items.length}`}</button>}
    </div>
  );
}

function Dial({ value, label, sub }: { value: number; label: string; sub: string }) {
  const felt = useFelt();
  const N = 72, R = 120, C = 150, lit = Math.round((value / 100) * N);
  const pt = (a: number, r: number) => `${(C + r * Math.cos(a)).toFixed(1)} ${(C + r * Math.sin(a)).toFixed(1)}`;
  const ang = (f: number) => f * 2 * Math.PI - Math.PI / 2;
  return (
    <div className="dial">
      <svg viewBox="0 0 300 300" role="img" aria-label={`${Math.round(value)} prosent av ${felt} slått`}>
        <circle cx={C} cy={C} r={R + 18} fill="none" stroke="var(--line)" strokeWidth="1" strokeDasharray="1 5" />
        {Array.from({ length: N }, (_, i) => {
          const on = i < lit, t = i / (N - 1);
          return <path key={i} d={`M ${pt(ang(i / N), R)} A ${R} ${R} 0 0 1 ${pt(ang((i + 0.62) / N), R)}`} fill="none" strokeLinecap="round"
            strokeWidth={on ? 9 : 6} style={{ stroke: on ? `color-mix(in oklab, var(--road) ${Math.round((1 - t) * 100)}%, var(--tt))` : "var(--surface-2)", animation: `fade .3s ${i * 8}ms both` }} />;
        })}
        {[0, 25, 50, 75].map((v) => {
          const a = ang(v / 100), [x, y] = pt(a, R + 32).split(" ").map(Number);
          return <text key={v} x={x} y={y + 4} textAnchor="middle" fontSize="11" fill="var(--muted)">{v} %</text>;
        })}
        <circle cx={pt(ang(value / 100), R).split(" ")[0]} cy={pt(ang(value / 100), R).split(" ")[1]} r="8" fill="var(--surface)" stroke="var(--ink)" strokeWidth="3" />
      </svg>
      <div className="mid"><small>{label}</small><strong>{Math.round(value)}<span style={{ fontSize: "1.4rem" }}> %</span></strong><span>{sub}</span></div>
    </div>
  );
}

function DialCard({ a, r, rows, go }: { a: Athlete; r: Result | null; rows: Result[]; go: (t: Tab) => void }) {
  const felt = useFelt();
  const { season, setSel } = useSel();
  // The race's whole result list, when the shared lists have it (every race of the riders the site follows).
  const [list, setList] = useState<string | null>(null);
  useEffect(() => { setList(null); if (!r) return; let live = true; raceFor(r).then((x) => live && setList(x?.id ?? null)).catch(() => {}); return () => { live = false; }; }, [r]);
  if (!rows.length) return <div className="card empty"><b>Ingen ritt i denne perioden</b></div>;
  if (r) {
    return (
      <div className="card dial-card" id="race-detail">
        <div className="selected-bar" role="status" style={{ gridColumn: "1 / -1" }}>
          <span><small>Valgt ritt</small>{r.race} {r.year}</span>
          <button type="button" onClick={() => setSel(null)}>Fjern valg</button>
        </div>
        <Dial value={r.beaten} label={`${r.race} ${r.year}`} sub={`av ${felt} slått (${r.place}. av ${r.field})`} />
        <div className="facts">
          <span className="eyebrow">{TYPE_LABEL[r.type]} · {dateLong(r.date)}</span>
          <div className="fact"><span>Plassering</span><b>{r.place}. av {r.field} {r.basis}{r.cls ? ` (${r.cls})` : ""}</b></div>
          {r.agePlace && <div className="fact"><span title="Aldersklassen slik resultatlista for dette rittet oppgir den">Aldersklasse</span><b>{r.agePlace}. av {r.ageN} i {r.ageClass}</b></div>}
          <div className="fact"><span>Tid / vinnertid</span><b>{hms(r.time)} / {hms(r.winner)}</b></div>
          {r.behind != null && <div className="fact"><span>Bak vinneren</span><b>{pct(r.behind, r.behind % 1 ? 1 : 0)}</b></div>}
          {r.np && <div className="fact"><span>Watt (NP / snitt)</span><b>{r.np} / {r.ap} W</b></div>}
          {r.speed && <div className="fact"><span>Fart / distanse</span><b>{dec(r.speed)} km/t · {dec(r.km)} km{r.climb ? ` · ${Math.round(r.climb)} hm` : ""}</b></div>}
          <div className="fact"><span>Kilder</span><b>{r.link && <a href={r.link} target="_blank" rel="noopener">Resultatliste</a>}{r.icu && flags.activityLinks && <> · <a href={r.icu} target="_blank" rel="noopener">intervals.icu</a></>}{r.video && <>{r.link || (r.icu && flags.activityLinks) ? " · " : ""}<a href={r.video} target="_blank" rel="noopener">Video fra rittet</a></>}</b></div>
          <div className="find-actions">
            {list && <button type="button" className="btn" onClick={() => openRace(list)}>Hele resultatlisten</button>}
            <button type="button" className="btn" onClick={() => go("rivaler")}>Se rivalene</button>
          </div>
        </div>
      </div>
    );
  }
  const typical = median(rows.map((x) => x.beaten));
  const behind = median(rows.filter((x) => x.behind != null).map((x) => x.behind!));
  const best = rows.reduce((b, x) => (x.beaten > b.beaten ? x : b));
  const np = rows.filter((x) => x.np).map((x) => x.np!);
  return (
    <div className="card dial-card" id="race-detail">
      <Dial value={typical} label={season === "all" ? "Typisk ritt, alle år" : `Typisk ritt i ${season}`} sub={`av ${felt} slått (median)`} />
      <div className="facts">
        <span className="eyebrow">{season === "all" ? "Alle år" : `Sesongen ${season}`}</span>
        <div className="fact"><span>Ritt på tid</span><b>{rows.length}</b></div>
        <div className="fact"><span>Typisk tid bak vinneren</span><b>{pct(behind)}</b></div>
        <div className="fact"><span>Beste ritt</span><b>{best.race} {best.year}, {best.place}. av {best.field}</b></div>
        {a.power && np.length > 0 && <div className="fact"><span>Snitt NP</span><b>{Math.round(mean(np))} W</b></div>}
        <button type="button" className="btn" onClick={() => go("utvikling")}>Se utviklingen</button>
      </div>
    </div>
  );
}

function TypeCards({ rows }: { rows: Result[] }) {
  const groups = useMemo(() => {
    const g: [RaceType[], string][] = [[["Road"], "Landevei"], [["Gravel"], "Gravel"], [["MTB"], "Terreng"], [["TT", "TTT"], "Tempo"]];
    return g.map(([ts, label]) => ({ label, t: ts[0], rs: rows.filter((r) => ts.includes(r.type)) })).filter((x) => x.rs.length);
  }, [rows]);
  if (!groups.length) return null;
  return (
    <div className="types">
      {groups.map(({ label, t, rs }) => {
        const m = median(rs.map((r) => r.beaten));
        return (
          <article key={label} className="card type-card" style={{ ["--c" as string]: TYPE_VAR[t] }}>
            <header><h3 className="h-card">{label}</h3><span className="muted tnum">{rs.length} ritt</span></header>
            <div><span className="big">{Math.round(m)} %</span> <span className="muted">slått, median</span></div>
            <div className="bar" aria-hidden="true"><i style={{ width: `${m}%` }} /></div>
            <ul>{[...rs].sort((x, y) => x.top - y.top).slice(0, 3).map((r) => (
              <li key={raceKey(r)}><span>{r.race} {r.year}</span><span className="tnum">{r.place}/{r.field}</span></li>
            ))}</ul>
          </article>
        );
      })}
    </div>
  );
}

