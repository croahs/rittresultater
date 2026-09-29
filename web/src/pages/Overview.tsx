import { useEffect, useMemo } from "react";
import { getHistory, requestHistory, type HistoryState } from "../history";
import { median, mean, years, type Athlete, type PointsRace, type RaceType, type Result } from "../data";
import { TYPE_LABEL, TYPE_VAR, dateLong, dateShort, dec, firstName, hms, pct, span } from "../format";
import { useState } from "react";
import { raceKey, useSel } from "../state";
import { flags } from "../data";
import type { Tab } from "../App";

export default function Overview({ a, isMe, go }: { a: Athlete; isMe: boolean; go: (t: Tab) => void }) {
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
  const ys = years(a);
  const best = a.results.reduce<Result | null>((b, r) => (!b || r.beaten > b.beaten ? r : b), null);
  const typical = median(a.results.map((r) => r.beaten));
  // Development = the same races in the last two seasons, so a change in race mix does not fool it.
  const [y0, y1] = [ys[ys.length - 2], ys[ys.length - 1]];
  const pairs = a.results.filter((r) => r.year === y1).map((b) => [a.results.find((r) => r.year === y0 && r.race === b.race), b] as const).filter((p) => p[0]);
  const change = pairs.length >= 3 ? mean(pairs.map(([p, b]) => b.beaten - p!.beaten)) : null;
  const who = isMe ? "Du" : firstName(a.name);
  const { setSeason, setSel } = useSel();
  const jump = (t: Tab, id: string) => { go(t); setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 250); };
  return (
    <div className="hero">
      <div className="bib" aria-label={`Startnummer for ${a.name}`}>
        <div className="bib-top"><span>Turritt-ID</span><span>{a.ageClass || span(ys)}</span></div>
        <div className="bib-num" aria-label={a.id}>{[...a.id].map((d, i) => <span key={i} aria-hidden="true" style={{ animationDelay: `${120 + i * 70}ms` }}>{d}</span>)}</div>
        <div className="bib-stripe" aria-hidden="true" />
        <div>
          <div className="bib-name">{a.name}{isMe ? "" : ""}</div>
          <div className="bib-meta">{a.club || "Uten klubb"} · {a.results.length} ritt på tid{a.points.length ? ` og ${a.points.length} poengritt` : ""}{ys.length ? ` · ${span(ys)}` : ""}</div>
        </div>
      </div>
      <div className="stats">
        <button type="button" className="card stat" onClick={() => go("utvikling")}><span className="eyebrow">Slår typisk <i aria-hidden="true">→</i></span><b>{pct(typical)}</b><small>av feltet, median over alle ritt. Se utviklingen.</small></button>
        <button type="button" className="card stat" disabled={!best} onClick={() => { if (!best) return; setSeason("all"); setSel(raceKey(best)); setTimeout(() => document.getElementById("race-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }}><span className="eyebrow">Beste ritt <i aria-hidden="true">→</i></span><b>{best ? `Slo ${pct(best.beaten)}` : "–"}</b><small>{best ? `${best.place}. av ${best.field} ${best.basis} i ${best.race} ${best.year}` : "Ingen ritt ennå"}</small></button>
        <button type="button" className="card stat" onClick={() => jump("utvikling", "samme-ritt")}><span className="eyebrow">Utvikling <i aria-hidden="true">→</i></span>
          <b className={change == null ? "" : change >= 0 ? "pos" : "neg"}>{change == null ? "–" : `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(0)}`}</b>
          <small>{change == null ? "Trenger minst tre av de samme rittene i to sesonger" : `prosentpoeng ${change >= 0 ? "mer" : "mindre"} av feltet slått i ${y1} enn i ${y0}, snitt over ${pairs.length} ritt ${who.toLowerCase() === "du" ? "du" : who} kjørte begge år`}</small></button>
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
                <span className="place"><i style={{ background: "var(--pts)" }} />{p.place || "–"}<small>{p.n ? `av ${p.n}` : "poeng"}</small></span>
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
          return <text key={v} x={x} y={y + 4} textAnchor="middle" fontSize="11" fill="var(--muted)">{v} %</text>;
        })}
        <circle cx={pt(ang(value / 100), R).split(" ")[0]} cy={pt(ang(value / 100), R).split(" ")[1]} r="8" fill="var(--surface)" stroke="var(--ink)" strokeWidth="3" />
      </svg>
      <div className="mid"><small>{label}</small><strong>{Math.round(value)}<span style={{ fontSize: "1.4rem" }}> %</span></strong><span>{sub}</span></div>
    </div>
  );
}

function DialCard({ a, r, rows, go }: { a: Athlete; r: Result | null; rows: Result[]; go: (t: Tab) => void }) {
  const { season, setSel } = useSel();
  if (!rows.length) return <div className="card empty"><b>Ingen ritt i denne perioden</b></div>;
  if (r) {
    return (
      <div className="card dial-card" id="race-detail">
        <div className="selected-bar" role="status" style={{ gridColumn: "1 / -1" }}>
          <span><small>Valgt ritt</small>{r.race} {r.year}</span>
          <button type="button" onClick={() => setSel(null)}>Fjern valg</button>
        </div>
        <Dial value={r.beaten} label={`${r.race} ${r.year}`} sub={`av feltet slått (${r.place}. av ${r.field})`} />
        <div className="facts">
          <span className="eyebrow">{TYPE_LABEL[r.type]} · {dateLong(r.date)}</span>
          <div className="fact"><span>Plassering</span><b>{r.place}. av {r.field} {r.basis}{r.cls ? ` (${r.cls})` : ""}</b></div>
          {r.agePlace && <div className="fact"><span title="Aldersklassen slik resultatlista for dette rittet oppgir den">Aldersklasse</span><b>{r.agePlace}. av {r.ageN} i {r.ageClass}</b></div>}
          <div className="fact"><span>Tid / vinnertid</span><b>{hms(r.time)} / {hms(r.winner)}</b></div>
          {r.behind != null && <div className="fact"><span>Bak vinneren</span><b>{pct(r.behind, r.behind % 1 ? 1 : 0)}</b></div>}
          {r.np && <div className="fact"><span>Watt (NP / snitt)</span><b>{r.np} / {r.ap} W</b></div>}
          {r.speed && <div className="fact"><span>Fart / distanse</span><b>{dec(r.speed)} km/t · {dec(r.km)} km{r.climb ? ` · ${Math.round(r.climb)} hm` : ""}</b></div>}
          <div className="fact"><span>Kilder</span><b>{r.link && <a href={r.link} target="_blank" rel="noopener">Resultatliste</a>}{r.icu && flags.activityLinks && <> · <a href={r.icu} target="_blank" rel="noopener">intervals.icu</a></>}</b></div>
          <button type="button" className="btn" onClick={() => go("rivaler")}>Se rivalene</button>
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
      <Dial value={typical} label={season === "all" ? "Typisk ritt, alle år" : `Typisk ritt i ${season}`} sub="av feltet slått (median)" />
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

/* Riders rebuilt from the shared result lists only have the races the site already covers.
   The button asks for the rest; the weekly data job fetches it later, never during the visit. */
function MoreRaces({ a }: { a: Athlete }) {
  const [h, setH] = useState<HistoryState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let live = true; getHistory(a.id).then((x) => live && setH(x)); return () => { live = false; }; }, [a.id]);
  const name = firstName(a.name);
  const shown = `Viser ${a.results.length === 1 ? "det ene rittet" : `de ${a.results.length} rittene`} med ${name} som er hentet inn så langt.`;
  if (!h?.enabled) return <p className="note" style={{ margin: "-12px 0 0" }}>{shown} {name} kan ha kjørt flere ritt som ikke er med her. Watt vises når rytteren kobler til intervals.icu.</p>;
  const ask = async () => {
    setBusy(true); setErr(null);
    try { setH(await requestHistory(a.id)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="more-races card card-pad" role="note">
      <div>
        <b>{h.status === "none" || h.status === "failed" || h.status === "skipped" ? "Mangler det ritt?" : "Under behandling"}</b>
        {h.status === "none" && <p>{shown} Er du {name}? Da kan du be om alle rittene dine fra Turritt, helt tilbake til 2005. Vi henter dem rolig i natt og regner ut rivalene dine på nytt, så kom tilbake i morgen.</p>}
        {h.status === "queued" && <p>Alle rittene til {name} står i kø{h.ahead ? `, med ${h.ahead} ${h.ahead === 1 ? "rytter" : "ryttere"} foran` : ""}. Vi henter ritt og rivaler i natt. Kom tilbake i morgen, så ligger alt her.</p>}
        {h.status === "running" && <p>Ritt og rivaler for {name} hentes nå. Kom tilbake i morgen, så ligger alt her.</p>}
        {h.status === "done" && <p>Alle rittene til {name} er hentet. Ritt og rivaler vises når siden er bygget på nytt, senest i morgen.</p>}
        {(h.status === "failed" || h.status === "skipped") && <p>Vi fikk ikke hentet alle rittene til {name}.{h.note ? ` ${h.note}` : ""}</p>}
        {err && <p className="err" role="alert">{err}</p>}
      </div>
      {(h.status === "none" || h.status === "failed" || h.status === "skipped") && <button type="button" className="btn primary" onClick={ask} disabled={busy}>{busy ? "Sender …" : h.status === "none" ? "Hent alle mine ritt" : "Prøv igjen"}</button>}
    </div>
  );
}
