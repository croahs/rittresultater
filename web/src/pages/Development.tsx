import { useMemo, useRef, useEffect, useState } from "react";
import { median, years, type Athlete, type Result } from "../data";
import { TYPE_LABEL, TYPE_VAR, dateLong, firstName, pct } from "../format";
import { raceKey, useSel } from "../state";
import { Icon, useTip } from "../ui";

export default function Development({ a, isMe }: { a: Athlete; isMe: boolean }) {
  const { rows, season, setSeason } = useSel();
  const ys = years(a);
  const who = isMe ? "du" : firstName(a.name);
  const types = [...new Set(rows.map((r) => (r.type === "TTT" ? "TT" : r.type)))];
  return (
    <>
      <div className="section-head">
        <div><h1 className="h-display">Utvikling</h1><p className="lead">Hvordan {who} har plassert {isMe ? "deg" : "seg"} over tid. Hvert punkt er ett ritt, i datorekkefølge. Den tykke linjen er medianen av de siste fem rittene.</p></div>
        <div className="chips" role="group" aria-label="Sesong">
          {(["all", ...ys] as const).map((y) => <button key={y} type="button" className="chip" aria-pressed={season === y} onClick={() => setSeason(y)}>{y === "all" ? "Alle år" : y}</button>)}
        </div>
      </div>
      {rows.length < 2 ? <div className="card empty"><b>For få ritt til å vise en utvikling</b>Det trengs minst to ritt i perioden.</div> : (
        <>
          <section className="card card-pad section">
            <div className="section-head"><div><h2 className="h-card">Andel av feltet slått</h2><p className="note" style={{ margin: 0 }}>Høyere er bedre</p></div>
              <div className="legend">{types.map((t) => <span key={t} className="swatch"><span className="dot" style={{ background: TYPE_VAR[t] }} />{TYPE_LABEL[t]}</span>)}</div></div>
            <RaceChart rows={rows} value={(r) => r.beaten} max={100} ticks={[0, 25, 50, 75, 100]} unit=" %" label="slått" />
          </section>
          <section className="card card-pad section">
            <div className="section-head"><div><h2 className="h-card">Tid bak vinneren</h2><p className="note" style={{ margin: 0 }}>Lavere er bedre</p></div></div>
            <RaceChart rows={rows.filter((r) => r.behind != null)} value={(r) => r.behind!} max={niceMax(rows.map((r) => r.behind ?? 0))} unit=" %" label="bak vinneren" invert />
          </section>
          <section className="card card-pad section">
            <div className="section-head"><div><h2 className="h-card">Watt per ritt</h2><p className="note" style={{ margin: 0 }}>Normalisert watt (NP) over selve rittet</p></div></div>
            {a.power && isMe ? <PowerChart rows={rows} /> : <Connect name={firstName(a.name)} />}
          </section>
        </>
      )}
      <SameRace a={a} who={who} />
    </>
  );
}

const niceMax = (vals: number[]) => { const m = Math.max(10, ...vals); const step = m > 40 ? 20 : 10; return Math.ceil(m / step) * step; };

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(760);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function RaceChart({ rows, value, max, ticks, unit, label, invert }: { rows: Result[]; value: (r: Result) => number; max: number; ticks?: number[]; unit: string; label: string; invert?: boolean }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const { sel, setSel } = useSel();
  const H = 240, L = 40, R = 12, T = 12, B = 34;
  const n = rows.length, step = (W - L - R) / Math.max(n - 1, 1);
  const x = (i: number) => L + (n === 1 ? (W - L - R) / 2 : i * step);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const tk = ticks || Array.from({ length: 5 }, (_, i) => Math.round((max / 4) * i));
  const roll = rows.map((_, i) => median(rows.slice(Math.max(0, i - 4), i + 1).map(value)));
  const yearStarts = rows.map((r, i) => (i && r.year !== rows[i - 1].year ? i : -1)).filter((i) => i > 0);
  const labelEvery = Math.ceil(n / Math.max(1, Math.floor((W - L - R) / 70)));
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Prosent ${label} per ritt`}>
        {tk.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={v ? "2 4" : undefined} />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{v}{unit.trim() === "%" ? " %" : ""}</text></g>)}
        {yearStarts.map((i) => <g key={i}><line x1={x(i) - step / 2} x2={x(i) - step / 2} y1={T} y2={H - B} stroke="var(--ink-2)" strokeOpacity=".35" />
          <text x={x(i) - step / 2 + 6} y={T + 10} fontSize="11" fontWeight="700" fill="var(--ink-2)">{rows[i].year}</text></g>)}
        <polyline points={rows.map((r, i) => `${x(i)},${y(value(r))}`).join(" ")} fill="none" stroke="var(--muted)" strokeOpacity=".35" strokeWidth="1" />
        <polyline points={roll.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {rows.map((r, i) => {
          const k = raceKey(r), on = k === sel;
          return (
            <g key={k} className="hit" onClick={() => setSel(on ? null : k)}
              onPointerMove={(e) => tip(e, <><b>{r.race} {r.year}</b><span>{dateLong(r.date)}, {TYPE_LABEL[r.type]}<br />{r.place}. av {r.field}, {Math.round(value(r))} % {label}{invert ? "" : ""}</span></>)}
              onPointerLeave={() => tip(null)}>
              <circle cx={x(i)} cy={y(value(r))} r="14" fill="transparent" />
              {on && <circle cx={x(i)} cy={y(value(r))} r="10" fill="none" stroke="var(--accent)" strokeWidth="2.5" />}
              <circle cx={x(i)} cy={y(value(r))} r={on ? 6 : 5} fill={TYPE_VAR[r.type]} stroke="var(--surface)" strokeWidth="2" />
            </g>
          );
        })}
        {rows.map((r, i) => (i % labelEvery === 0 || (i === n - 1 && (n - 1) % labelEvery > labelEvery / 2)) && (
          <text key={i} x={x(i)} y={H - B + 18} textAnchor="middle" fontSize="10.5" fill="var(--muted)">{r.race.split(/[\s-]/)[0].slice(0, 11)}</text>
        ))}
      </svg>
      <div className="chart-foot"><span>{rows[0] && dateLong(rows[0].date)}</span><span>Trykk på et punkt for å velge rittet</span><span>{rows[n - 1] && dateLong(rows[n - 1].date)}</span></div>
    </div>
  );
}

function PowerChart({ rows }: { rows: Result[] }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const { sel, setSel } = useSel();
  const withNp = rows.filter((r) => r.np);
  if (!withNp.length) return <div className="empty"><b>Ingen wattdata i perioden</b></div>;
  const H = 220, L = 44, R = 12, T = 12, B = 30, LO = 150, HI = 320;
  const n = withNp.length, slot = (W - L - R) / n, bw = Math.max(4, Math.min(22, slot * 0.55));
  const y = (v: number) => T + (1 - (v - LO) / (HI - LO)) * (H - T - B);
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Normalisert watt per ritt">
        {[150, 200, 250, 300].map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={v === LO ? undefined : "2 4"} />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{v} W</text></g>)}
        {withNp.map((r, i) => {
          const k = raceKey(r), on = !sel || sel === k, cx = L + slot * (i + 0.5);
          return (
            <g key={k} className="hit" onClick={() => setSel(sel === k ? null : k)}
              onPointerMove={(e) => tip(e, <><b>{r.race} {r.year}</b><span>NP {r.np} W, snitt {r.ap} W<br />{TYPE_LABEL[r.type]}, {r.place}. av {r.field}</span></>)} onPointerLeave={() => tip(null)}>
              <rect x={cx - slot / 2} y={T} width={slot} height={H - T - B} fill="transparent" />
              <rect className="anim-rise" style={{ animationDelay: `${i * 25}ms` }} x={cx - bw / 2} y={y(r.np!)} width={bw} height={H - B - y(r.np!)} rx={Math.min(4, bw / 2)} fill={TYPE_VAR[r.type]} opacity={on ? 1 : 0.3} />
              {r.ap && <line x1={cx - bw / 2 - 2} x2={cx + bw / 2 + 2} y1={y(r.ap)} y2={y(r.ap)} stroke="var(--ink)" strokeWidth="2" opacity={on ? 0.8 : 0.25} />}
            </g>
          );
        })}
      </svg>
      <div className="chart-foot"><span className="legend"><span className="swatch"><span className="dot" style={{ background: "var(--road)" }} />Stolpe: NP</span><span className="swatch"><span style={{ width: 14, height: 2, background: "var(--ink)", display: "inline-block" }} />Strek: snittwatt</span></span><span>Skala 150–320 W</span></div>
    </div>
  );
}

function Connect({ name }: { name: string }) {
  return (
    <div className="connect">
      <span className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon.bolt /> Wattdata</span>
      <p><b>{name}</b> har ikke koblet til intervals.icu. Når en rytter logger inn med intervals.icu, henter vi watt for akkurat rittene i resultatlisten, bare for selve rittet. Watt er privat med mindre rytteren velger å dele.</p>
      <div><button type="button" className="btn" disabled title="Kommer">Koble til intervals.icu (kommer)</button></div>
    </div>
  );
}

function SameRace({ a, who }: { a: Athlete; who: string }) {
  const ys = years(a);
  const pairs = useMemo(() => {
    const by = new Map<string, Result[]>();
    for (const r of a.results) by.set(r.race, [...(by.get(r.race) || []), r]);
    return [...by.values()].filter((rs) => new Set(rs.map((r) => r.year)).size > 1);
  }, [a]);
  if (!pairs.length) return null;
  const [y0, y1] = [ys[ys.length - 2], ys[ys.length - 1]];
  const chg = (d: number, unit: string, lowerBetter: boolean) => {
    const r = Math.round(d);
    if (!r) return <span className="chg muted">±0</span>;
    const good = lowerBetter ? r < 0 : r > 0;
    return <span className={`chg ${good ? "pos" : "neg"}`}>{good ? "▲" : "▼"} {Math.abs(r)}{unit}</span>;
  };
  return (
    <section className="card section" style={{ gap: 0 }}>
      <div className="card-pad"><h2 className="h-card">Samme ritt, {y0} mot {y1}</h2><p className="note" style={{ margin: "4px 0 0" }}>Ritt {who} har kjørt begge år. Grønn pil betyr bedre.</p></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Ritt</th><th>Slått {y0}</th><th>{y1}</th><th>Bak vinner {y0}</th><th>{y1}</th>{a.power && <><th>NP {y0}</th><th>{y1}</th></>}</tr></thead>
        <tbody>{pairs.map((rs) => {
          const p = rs.find((r) => r.year === y0), b = rs.find((r) => r.year === y1);
          if (!p || !b) return null;
          return (
            <tr key={b.race}><td>{b.race}</td><td>{pct(p.beaten)}</td><td>{pct(b.beaten)}{chg(b.beaten - p.beaten, " pp", false)}</td>
              <td>{pct(p.behind)}</td><td>{pct(b.behind)}{p.behind != null && b.behind != null && chg(b.behind - p.behind, " pp", true)}</td>
              {a.power && <><td>{p.np ?? "–"}</td><td>{b.np ?? "–"}{p.np && b.np && chg(b.np - p.np, " W", false)}</td></>}</tr>
          );
        })}</tbody>
      </table></div>
    </section>
  );
}
