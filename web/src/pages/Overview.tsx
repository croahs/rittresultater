import { useMemo } from "react";
import { median, mean, years, type Athlete, type PointsRace, type RaceType, type Result } from "../data";
import { TYPE_LABEL, TYPE_VAR, dateLong, dateShort, dec, firstName, pct } from "../format";
import { raceKey, useSel } from "../state";
import type { Tab } from "../App";

export default function Overview({ a, isMe, go }: { a: Athlete; isMe: boolean; go: (t: Tab) => void }) {
  const { season, setSeason, sel, setSel, rows } = useSel();
  const ys = years(a);
  const last = a.results[a.results.length - 1];
  const selected = rows.find((r) => raceKey(r) === sel) || null;
  const who = isMe ? "Du" : firstName(a.name);

  return (
    <>
      <Hero a={a} isMe={isMe} />
      {!isMe && <p className="note" style={{ margin: "-12px 0 0" }}>Viser de {a.results.length} rittene med {firstName(a.name)} som er hentet inn så langt. {firstName(a.name)} kan ha kjørt flere ritt som ikke er med her. Watt vises når rytteren kobler til intervals.icu.</p>}
      {last && (
        <div className="latest" role="note">
          <span>Siste ritt: {last.race} {last.year}, {last.place}. av {last.field}. {who} slo {Math.round(last.beaten)} % av feltet.</span>
          <button type="button" onClick={() => { setSeason("all"); setSel(raceKey(last)); }}>Vis rittet</button>
        </div>
      )}

      <section className="section" aria-labelledby="h-sesong">
        <div className="section-head">
          <div><h2 className="h-section" id="h-sesong">Sesongen</h2><p className="lead">Velg et ritt i listen for å se detaljene. Tallene i skiven gjelder hele perioden når ingen ritt er valgt.</p></div>
          <div className="chips" role="group" aria-label="Sesong">
            {(["all", ...ys] as const).map((y) => (
              <button key={y} type="button" className="chip" aria-pressed={season === y} onClick={() => setSeason(y)}>{y === "all" ? "Alle år" : y}</button>
            ))}
          </div>
        </div>
        <div className="board">
          <FinishSheet a={a} isMe={isMe} />
          <div className="board-side" id="race-detail" style={{ display: "grid", gap: 20, minWidth: 0 }}>
            <DialCard a={a} r={selected} rows={rows} isMe={isMe} go={go} />
            <TypeCards rows={rows} />
          </div>
        </div>
      </section>
    </>
  );
}

function Hero({ a, isMe }: { a: Athlete; isMe: boolean }) {
  const ys = years(a);
  const best = a.results.reduce<Result | null>((b, r) => (!b || r.top < b.top ? r : b), null);
  const typical = median(a.results.map((r) => r.beaten));
  // Development = the same races in the last two seasons, so a change in race mix does not fool it.
  const [y0, y1] = [ys[ys.length - 2], ys[ys.length - 1]];
  const pairs = a.results.filter((r) => r.year === y1).map((b) => [a.results.find((r) => r.year === y0 && r.race === b.race), b] as const).filter((p) => p[0]);
  const change = pairs.length >= 2 ? mean(pairs.map(([p, b]) => b.beaten - p!.beaten)) : null;
  const who = isMe ? "Du" : firstName(a.name);
  return (
    <div className="hero">
      <div className="bib" aria-label={`Startnummer for ${a.name}`}>
        <div className="bib-top"><span>Turritt-ID</span><span>{a.ageClass || (ys.length ? `${ys[0]}–${ys[ys.length - 1]}` : "")}</span></div>
        <div className="bib-num">{a.id}</div>
        <div className="bib-stripe" aria-hidden="true" />
        <div>
          <div className="bib-name">{a.name}{isMe ? "" : ""}</div>
          <div className="bib-meta">{a.club || "Uten klubb"} · {a.results.length} ritt på tid{a.points.length ? ` og ${a.points.length} poengritt` : ""}{ys.length ? ` · ${ys[0]}–${ys[ys.length - 1]}` : ""}</div>
        </div>
      </div>
      <div className="stats">
        <div className="card stat"><span className="eyebrow">Slår typisk</span><b>{pct(typical)}</b><small>av feltet, median over alle ritt</small></div>
        <div className="card stat"><span className="eyebrow">Beste ritt</span><b>{best ? `Topp ${Math.round(best.top)} %` : "–"}</b><small>{best ? `${best.place}. av ${best.field} i ${best.race} ${best.year}` : "Ingen ritt ennå"}</small></div>
        <div className="card stat"><span className="eyebrow">Utvikling</span>
          <b className={change == null ? "" : change >= 0 ? "pos" : "neg"}>{change == null ? "–" : `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(0)} pp`}</b>
          <small>{change == null ? "Trenger de samme rittene i to sesonger" : `${change >= 0 ? "mer" : "mindre"} av feltet slått i ${y1} enn i ${y0}, snitt over ${pairs.length} ritt ${who.toLowerCase() === "du" ? "du" : who} kjørte begge år`}</small></div>
        <div className="card stat"><span className="eyebrow">{a.power ? "Snitt NP" : "Watt"}</span>
          <b>{a.power ? `${Math.round(mean(a.results.filter((r) => r.np).map((r) => r.np!)))} W` : "–"}</b>
          <small>{a.power ? "normalisert watt i rittene med wattdata" : "Kommer når rytteren kobler til intervals.icu"}</small></div>
      </div>
    </div>
  );
}

function FinishSheet({ a, isMe }: { a: Athlete; isMe: boolean }) {
  const { season, sel, setSel, rows } = useSel();
  const selected = rows.find((r) => raceKey(r) === sel);
  const pts = a.points.filter((p) => season === "all" || p.date.startsWith(String(season)));
  const items: { d: string; r?: Result; p?: PointsRace }[] = [...rows.map((r) => ({ d: r.date, r })), ...pts.map((p) => ({ d: p.date, p }))].sort((x, y) => y.d.localeCompare(x.d));
  return (
    <div className="card sheet" aria-label="Rittliste">
      <div className="sheet-head">
        <div className="row"><h3 className="h-card">Målgangsliste</h3><span className="muted tnum">{items.length} ritt</span></div>
        {selected ? (
          <div className="selected-bar" role="status">
            <span><small>Valgt ritt</small>{selected.race} {selected.year}</span>
            <button type="button" onClick={() => setSel(null)}>Alle ritt</button>
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
                <span className="place"><i style={{ background: "var(--pts)" }} />{p.place || "–"}<small>{p.n ? `av ${p.n}` : "poeng"}</small></span>
                <div><div className="t" style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: 600 }}><span>{p.name}</span><small className="muted">{dateShort(p.date)}</small></div>
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
                  <p>{TYPE_LABEL[r.type]}{r.cls ? ` (${r.cls})` : ""}. Slo {Math.round(r.beaten)} %{r.behind != null ? `, ${r.behind} % bak vinner` : ""}{isMe && r.np ? `, NP ${r.np} W` : ""}.</p>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Dial({ value, label, sub }: { value: number; label: string; sub: string }) {
  const N = 72, R = 120, C = 150, lit = Math.round((value / 100) * N);
  const pt = (a: number, r: number) => `${(C + r * Math.cos(a)).toFixed(1)} ${(C + r * Math.sin(a)).toFixed(1)}`;
  const ang = (f: number) => f * 2 * Math.PI - Math.PI / 2;
  return (
    <div className="dial">
      <svg viewBox="0 0 300 300" role="img" aria-label={`${Math.round(value)} prosent av feltet slått`}>
        <circle cx={C} cy={C} r={R + 18} fill="none" stroke="var(--line)" strokeWidth="1" strokeDasharray="1 5" />
        {Array.from({ length: N }, (_, i) => {
          const on = i < lit, t = i / (N - 1);
          return <path key={i} d={`M ${pt(ang(i / N), R)} A ${R} ${R} 0 0 1 ${pt(ang((i + 0.62) / N), R)}`} fill="none" strokeLinecap="round"
            strokeWidth={on ? 9 : 6} style={{ stroke: on ? `color-mix(in oklab, var(--road) ${Math.round((1 - t) * 100)}%, var(--tt))` : "var(--surface-2)", animation: `fade .3s ${i * 8}ms both` }} />;
        })}
        {[0, 25, 50, 75].map((v) => {
          const a = ang(v / 100), [x, y] = pt(a, R + 32).split(" ").map(Number);
          return <text key={v} x={x} y={y + 4} textAnchor="middle" fontSize="11" fill="var(--muted)">{v}</text>;
        })}
        <circle cx={pt(ang(value / 100), R).split(" ")[0]} cy={pt(ang(value / 100), R).split(" ")[1]} r="8" fill="var(--surface)" stroke="var(--ink)" strokeWidth="3" />
      </svg>
      <div className="mid"><small>{label}</small><strong>{Math.round(value)}<span style={{ fontSize: "1.4rem" }}> %</span></strong><span>{sub}</span></div>
    </div>
  );
}

function DialCard({ a, r, rows, isMe, go }: { a: Athlete; r: Result | null; rows: Result[]; isMe: boolean; go: (t: Tab) => void }) {
  const { season } = useSel();
  if (!rows.length) return <div className="card empty"><b>Ingen ritt i denne perioden</b></div>;
  if (r) {
    return (
      <div className="card dial-card">
        <Dial value={r.beaten} label={`${r.race} ${r.year}`} sub={`av feltet slått (${r.place}. av ${r.field})`} />
        <div className="facts">
          <span className="eyebrow">{TYPE_LABEL[r.type]} · {dateLong(r.date)}</span>
          <div className="fact"><span>Plassering</span><b>{r.place}. av {r.field}{r.cls ? ` (${r.cls})` : ""}</b></div>
          {r.agePlace && <div className="fact"><span>Aldersklasse</span><b>{r.agePlace}. av {r.ageN} i {r.ageClass}</b></div>}
          <div className="fact"><span>Tid / vinnertid</span><b>{r.time} / {r.winner}</b></div>
          {r.behind != null && <div className="fact"><span>Bak vinneren</span><b>{r.behind} %</b></div>}
          {isMe && r.np && <div className="fact"><span>Watt (NP / snitt)</span><b>{r.np} / {r.ap} W</b></div>}
          {r.speed && <div className="fact"><span>Fart / distanse</span><b>{dec(r.speed)} km/t · {dec(r.km)} km{r.climb ? ` · ${Math.round(r.climb)} hm` : ""}</b></div>}
          <div className="fact"><span>Kilder</span><b>{r.link && <a href={r.link} target="_blank" rel="noopener">Resultatliste</a>}{r.icu && isMe && <> · <a href={r.icu} target="_blank" rel="noopener">intervals.icu</a></>}</b></div>
          <button type="button" className="btn" onClick={() => go("rivaler")}>Se rivalene</button>
        </div>
      </div>
    );
  }
  const typical = median(rows.map((x) => x.beaten));
  const behind = median(rows.filter((x) => x.behind != null).map((x) => x.behind!));
  const best = rows.reduce((b, x) => (x.top < b.top ? x : b));
  const np = rows.filter((x) => x.np).map((x) => x.np!);
  return (
    <div className="card dial-card">
      <Dial value={typical} label={season === "all" ? "Typisk ritt, alle år" : `Typisk ritt i ${season}`} sub="av feltet slått (median)" />
      <div className="facts">
        <span className="eyebrow">{season === "all" ? "Alle år" : `Sesongen ${season}`}</span>
        <div className="fact"><span>Ritt på tid</span><b>{rows.length}</b></div>
        <div className="fact"><span>Typisk bak vinneren</span><b>{pct(behind)}</b></div>
        <div className="fact"><span>Beste ritt</span><b>{best.race} {best.year}, {best.place}. av {best.field}</b></div>
        {a.power && isMe && np.length > 0 && <div className="fact"><span>Snitt NP</span><b>{Math.round(mean(np))} W</b></div>}
        <button type="button" className="btn" onClick={() => go("utvikling")}>Se utviklingen</button>
      </div>
    </div>
  );
}

function TypeCards({ rows }: { rows: Result[] }) {
  const groups = useMemo(() => {
    const g: [RaceType[], string][] = [[["Road"], "Landevei"], [["Gravel"], "Gravel"], [["TT", "TTT"], "Tempo"]];
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
