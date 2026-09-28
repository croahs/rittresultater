import { useMemo, useRef, useState, useEffect } from "react";
import { median, record, type Athlete, type IndexRider, type Meeting, type Opponent, type RaceType, type Who } from "../data";
import { TYPE_LABEL, TYPE_LC, clock, dateLong, firstName, fold, initials, listNo } from "../format";
import { Empty, useTip } from "../ui";

type TabKey = "closest" | RaceType;

export default function Rivals({ a, isMe, onRider, index }: { a: Athlete; isMe: boolean; onRider: (id: string) => void; index: IndexRider[] }) {
  const O = a.opponents;
  const ins = a.insights;
  const [sameOnly, setSameOnly] = useState(false);
  const TABS = useMemo(() => ([["closest", "Jevneste"], ["Road", "Landevei"], ["TT", "Tempo"], ["Gravel", "Gravel"]] as [TabKey, string][])
    .filter(([k]) => ids(k).length), [a]); // eslint-disable-line react-hooks/exhaustive-deps
  function ids(k: TabKey): string[] {
    return (k === "closest" ? a.rivals : (ins.rivals_by_type?.[k] || []).map((r) => r.turritt_id)).filter((id) => O.has(id));
  }
  const [tab, setTab] = useState<TabKey>("closest");
  const [cur, setCur] = useState<string | undefined>(() => ids("closest")[0]);
  const duelRef = useRef<HTMLDivElement>(null);
  const pool = (o: Opponent) => (sameOnly ? o.ms.filter((m) => m.same) : o.ms);
  const hasClass = useMemo(() => [...O.values()].some((o) => o.ms.some((m) => m.mc || m.tc)), [O]);
  const you = isMe ? "deg" : firstName(a.name);
  const You = isMe ? "Du" : firstName(a.name);

  const open = (id: string) => {
    if (!O.has(id)) return;
    setCur(id);
    if (!ids(tab).includes(id)) setTab("closest");
    duelRef.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };

  if (!O.size) return (
    <>
      <h1 className="h-display">Rivaler</h1>
      <div className="card"><Empty title="Ingen rivaler ennå">Rivaler regnes ut når en rytter har minst to ritt i resultatlistene vi har hentet.</Empty></div>
    </>
  );

  const typeIds = tab === "closest" ? null : tab;
  const listIds = ids(tab);
  return (
    <>
      <div className="section-head">
        <div><h1 className="h-display">Rivaler</h1>
          <p className="lead">{You} har møtt {O.size} ulike ryttere i resultatlistene. Velg en rival, eller søk opp hvem som helst {isMe ? "du" : firstName(a.name)} har kjørt mot.</p></div>
        <OppSearch O={O} onPick={open} />
      </div>

      <section className="card duel-wrap" ref={duelRef} style={{ scrollMarginTop: 80 }}>
        <div className="rpick">
          {hasClass && <label className="switch"><input type="checkbox" id="same-class" checked={sameOnly} onChange={(e) => setSameOnly(e.target.checked)} /> Bare samme klasse som {you}</label>}
          <div className="tabs" role="tablist" aria-label="Rivaler etter rittype">
            {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setCur(ids(k)[0]); }}>{l}</button>)}
          </div>
          <ul className="rlist">
            {listIds.map((id) => {
              const o = O.get(id)!;
              const ms = pool(o).filter((m) => !typeIds || m.type === typeIds || (typeIds === "TT" && m.type === "TTT"));
              const r = record(ms);
              return (
                <li key={id}><button type="button" className="rrow" aria-pressed={cur === id} onClick={() => setCur(id)}>
                  <span className="avatar">{initials(o.name)}</span>
                  <span style={{ minWidth: 0 }}><b>{o.name}</b><small>{o.club || "Uten klubb"}</small></span>
                  <span className="rec"><span className="w">{r.w}</span>–<span className="l">{r.l}</span>
                    <span className="mini" aria-hidden="true">{ms.map((m, i) => <i key={i} className={m.res === "w" ? "" : m.res} />)}</span></span>
                </button></li>
              );
            })}
          </ul>
        </div>
        {cur && O.get(cur) ? <Duel a={a} o={O.get(cur)!} ms={pool(O.get(cur)!)} type={typeIds} isMe={isMe} sameOnly={sameOnly}
          inIndex={index.some((r) => r.id === cur)} onRider={onRider} /> : <Empty title="Velg en rival" />}
      </section>

      <div className="hl-cards">
        <HlCard title="Nemesis" sub={`Jevnbyrdige som slår ${you} oftest`} c="var(--loss)" rows={ins.nemesis} val={(r) => [`${r.wins}–${r.losses}`, `${r.races} ritt`]} onPick={open} />
        <HlCard title="Offer" sub={`Jevnbyrdige ${isMe ? "du slår" : `${firstName(a.name)} slår`} oftest`} c="var(--win)" rows={ins.victims} val={(r) => [`${r.wins}–${r.losses}`, `${r.races} ritt`]} onPick={open} />
        <HlCard title="Jakten" sub={`Ender oftest 1–3 plasser foran ${you}`} c="var(--gravel)" rows={ins.right_ahead} val={(r) => [`${(r as Who & { right_ahead?: number }).right_ahead}×`, `av ${r.races} ritt`]} onPick={open} />
        <HlCard title="I nakken" sub={`Ender oftest 1–3 plasser bak ${you}`} c="var(--road)" rows={ins.right_behind} val={(r) => [`${(r as Who & { right_behind?: number }).right_behind}×`, `av ${r.races} ritt`]} onPick={open} />
      </div>

      <div className="grid-2">
        <Clubs clubs={ins.clubs || []} />
        <section className="card card-pad section" style={{ alignContent: "start" }}>
          <div><h2 className="h-card">Spesialister og forbikjørt</h2>
            <p className="note" style={{ margin: "4px 0 0" }}>Ryttere som er sterkere enn {you} på én type ritt og svakere på en annen, og de {isMe ? "du" : firstName(a.name)} har gått forbi fra ett år til det neste.</p></div>
          <ul className="odd">
            {(ins.specialists || []).map((s) => <li key={`s${s.turritt_id}`}><button type="button" onClick={() => open(s.turritt_id)}>
              <b>{s.name}</b> slår {you} på {listNo(s.stronger_than_you_in.map((t) => TYPE_LC[t]))}, men taper på {listNo(s.weaker_than_you_in.map((t) => TYPE_LC[t]))}.</button></li>)}
            {(ins.overtaken || []).map((s) => <li key={`o${s.turritt_id}`}><button type="button" onClick={() => open(s.turritt_id)}>
              <b>{s.name}</b> slo {you} hver gang i {s.lost_in}. I {s.beat_in} slo {isMe ? "du" : firstName(a.name)} hen hver gang.</button></li>)}
            {!(ins.specialists?.length || ins.overtaken?.length) && <li className="note">Ingen ennå. Listen vokser med hver sesong.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}

function Duel({ a, o, ms: all, type, isMe, sameOnly, inIndex, onRider }: { a: Athlete; o: Opponent; ms: Meeting[]; type: RaceType | null; isMe: boolean; sameOnly: boolean; inIndex: boolean; onRider: (id: string) => void }) {
  const ms = all;
  const r = record(ms);
  if (!ms.length) return <Empty title={`Ingen møter med ${o.name} i samme klasse`}>Slå av «Bare samme klasse» for å se alle møtene.</Empty>;
  const same = record(o.ms.filter((m) => m.same));
  const gaps = ms.filter((m) => m.gp != null).map((m) => m.gp!);
  const med = gaps.length ? median(gaps) : null;
  const last = ms[ms.length - 1];
  const me = isMe ? "Du" : firstName(a.name);
  const them = firstName(o.name);
  const resTxt = (m: Meeting) => (m.res === "w" ? `${me.toLowerCase() === "du" ? "du" : me} vant` : m.res === "l" ? `${them} vant` : "likt");
  return (
    <div className="duel" aria-live="polite">
      <div className="vs">
        <div><b>{a.name.split(" ")[0]}</b><small>{r.w} seire</small></div>
        <div className="score" aria-label={`${r.w} seire og ${r.l} tap`}><span className="w">{r.w}</span><span className="sep">–</span><span className="l">{r.l}</span></div>
        <div><b>{o.name}</b><small>{o.club || "Uten klubb"}</small></div>
      </div>
      <div className="strip" aria-hidden="true">{ms.map((m, i) => <i key={i} className={`${m.res === "w" ? "" : m.res} ${type && m.type !== type ? "o" : ""}`} />)}</div>
      <div className="kv">
        <div><small>Møtt i</small><b>{ms.length} ritt</b></div>
        <div><small>Typisk tidsforskjell</small><b>{med == null ? "–" : med === 0 ? "Helt likt" : med < 0 ? `${me} ${Math.abs(med).toFixed(1).replace(".", ",")} % foran` : `${them} ${med.toFixed(1).replace(".", ",")} % foran`}</b></div>
        {!sameOnly && same.w + same.l > 0 && same.w + same.l !== r.w + r.l && <div><small>I samme klasse</small><b>{same.w}–{same.l}</b></div>}
        <div><small>Siste møte</small><b>{last.race} {last.date.slice(0, 4)}, {resTxt(last)}</b></div>
      </div>
      <GapChart ms={ms} type={type} them={them} me={me} />
      {inIndex && <div><button type="button" className="btn" onClick={() => onRider(o.id)}>Åpne {them} sin side</button></div>}
    </div>
  );
}

function GapChart({ ms, type, them, me }: { ms: Meeting[]; type: RaceType | null; them: string; me: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(620);
  const tip = useTip();
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.min(760, Math.round(e.contentRect.width)))));
    ro.observe(ref.current); return () => ro.disconnect();
  }, []);
  const H = 230, L = 46, R = 10, T = 14, B = 40, n = ms.length;
  const top = Math.max(2, ...ms.filter((m) => m.gp != null).map((m) => Math.abs(m.gp!)));
  const step = top <= 4 ? 1 : top <= 10 ? 2.5 : top <= 20 ? 5 : 10, M = Math.ceil(top / step) * step;
  const y = (v: number) => T + (H - T - B) / 2 - (v / M) * (H - T - B) / 2, y0 = y(0);
  const slot = (W - L - R) / Math.max(n, 1), bw = Math.max(6, Math.min(32, slot * 0.55));
  const every = Math.ceil(n / Math.max(1, Math.floor((W - L - R) / 64)));
  const other = ms.some((m) => !m.same);
  const tv: number[] = [];
  for (let v = -M; v <= M + 1e-9; v += step) tv.push(v);
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Tidsforskjell mot ${them} per ritt`}>
        {tv.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v ? "var(--line)" : "var(--ink-2)"} strokeDasharray={v ? "2 4" : undefined} strokeOpacity={v ? 1 : 0.6} />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{v > 0 ? "+" : v < 0 ? "−" : ""}{Math.abs(v)} %</text></g>)}
        {ms.map((m, i) => {
          const cx = L + slot * (i + 0.5), dim = type && m.type !== type && !(type === "TT" && m.type === "TTT") ? 0.3 : 1;
          const tipC = <><b>{m.race} {m.date.slice(0, 4)}</b><span>{TYPE_LABEL[m.type]}, {dateLong(m.date)}<br />
            {m.gs != null ? `${m.res === "w" ? me : m.res === "l" ? them : "Ingen"} var ${clock(m.gs)} raskere (${Math.abs(m.gp!).toFixed(1).replace(".", ",")} %)` : "Mangler tid for en av dere"}
            {m.pl ? `, ${Math.abs(m.pl)} plasser mellom` : ""}.{(m.mc || m.tc) && <><br />Klasse: {m.mc || "–"} mot {m.tc || "–"}{m.same ? "" : " (ulik)"}</>}</span></>;
          const ev = { onPointerMove: (e: React.PointerEvent) => tip(e, tipC), onPointerLeave: () => tip(null) };
          if (m.gp == null) return <g key={i} {...ev}><rect x={cx - slot / 2} y={T} width={slot} height={H - T - B} fill="transparent" /><circle cx={cx} cy={y0} r="5" fill="var(--muted)" opacity={dim} /></g>;
          const v = -m.gp, yy = y(v), h = Math.max(2, Math.abs(yy - y0)), col = v >= 0 ? "var(--win)" : "var(--loss)";
          return (
            <g key={i} {...ev}>
              <rect x={cx - slot / 2} y={T} width={slot} height={H - T - B} fill="transparent" />
              <rect x={cx - bw / 2} y={v >= 0 ? y0 - h : y0} width={bw} height={h} rx="3" fill={m.same ? col : "var(--surface)"} stroke={col} strokeWidth={m.same ? 0 : 2} opacity={dim} />
            </g>
          );
        })}
        {ms.map((m, i) => (i % every === 0 || (i === n - 1 && (n - 1) % every > every / 2)) && <g key={`l${i}`}>
          <text x={L + slot * (i + 0.5)} y={H - B + 17} textAnchor="middle" fontSize="10.5" fill="var(--ink-2)">{m.race.split(/[\s-]/)[0].slice(0, 10)}</text>
          <text x={L + slot * (i + 0.5)} y={H - B + 31} textAnchor="middle" fontSize="10" fill="var(--muted)">{m.date.slice(0, 4)}</text></g>)}
      </svg>
      <div className="chart-foot"><span className="legend">
        <span className="swatch"><span className="dot" style={{ background: "var(--win)" }} />{me} raskere</span>
        <span className="swatch"><span className="dot" style={{ background: "var(--loss)" }} />{them} raskere</span>
        {other && <span className="swatch"><span className="dot" style={{ border: "2px solid var(--muted)" }} />Hul: ulik klasse</span>}
      </span><span>Høyde: tidsforskjell i prosent</span></div>
    </div>
  );
}

function HlCard({ title, sub, c, rows, val, onPick }: { title: string; sub: string; c: string; rows?: Who[]; val: (r: Who) => [string, string]; onPick: (id: string) => void }) {
  return (
    <article className="card hl" style={{ ["--c" as string]: c }}>
      <header><h2 className="h-card">{title}</h2><small>{sub}</small></header>
      {rows?.length ? <ul>{rows.slice(0, 5).map((r) => {
        const [v, s] = val(r);
        return <li key={r.turritt_id}><button type="button" className="rrow" onClick={() => onPick(r.turritt_id)}>
          <span className="avatar">{initials(r.name)}</span><span style={{ minWidth: 0 }}><b>{r.name}</b><small>{r.club || "Uten klubb"}</small></span>
          <span className="v">{v}<small>{s}</small></span></button></li>;
      })}</ul> : <Empty title="Ingen ennå" />}
    </article>
  );
}

function Clubs({ clubs }: { clubs: NonNullable<Athlete["insights"]["clubs"]> }) {
  const top = [...clubs].filter((c) => c.wins + c.losses >= 10).sort((x, y) => y.wins + y.losses - (x.wins + x.losses)).slice(0, 12);
  const max = Math.max(1, ...top.flatMap((c) => [c.wins, c.losses]));
  return (
    <section className="card card-pad section" style={{ alignContent: "start" }}>
      <div><h2 className="h-card">Klubbtabellen</h2><p className="note" style={{ margin: "4px 0 0" }}>Møter mot hver klubb: tap til venstre, seire til høyre. Klubber med minst 10 møter; tallet etter navnet er antall ryttere.</p></div>
      {top.length ? <div className="clubs">
        <span /><span className="eyebrow" style={{ textAlign: "right", paddingRight: 8 }}>Tap</span><span className="eyebrow" style={{ paddingLeft: 8 }}>Seier</span>
        {top.map((c) => <Row key={c.club} c={c} max={max} />)}
      </div> : <Empty title="For få møter ennå" />}
    </section>
  );
}
const Row = ({ c, max }: { c: { club: string; riders: number; wins: number; losses: number }; max: number }) => (
  <>
    <span className="nm" title={c.club}>{c.club} <small>{c.riders}</small></span>
    <span className="lo"><span>{c.losses}</span><i style={{ width: `${(c.losses / max) * 82}%` }} /></span>
    <span className="hi"><i style={{ width: `${(c.wins / max) * 82}%` }} /><span>{c.wins}</span></span>
  </>
);

function OppSearch({ O, onPick }: { O: Map<string, Opponent>; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const keyed = useMemo(() => [...O.values()].map((o) => [fold(`${o.name} ${o.club}`), o] as const), [O]);
  const hits = useMemo(() => {
    const s = fold(q.trim());
    if (s.length < 2) return [];
    return keyed.filter(([k]) => s.split(/\s+/).every((w) => k.includes(w))).map(([, o]) => o).sort((x, y) => y.ms.length - x.ms.length).slice(0, 8);
  }, [q, keyed]);
  const pick = (id: string) => { onPick(id); setQ(O.get(id)!.name); setOpen(false); };
  return (
    <div className="rsearch picker" style={{ marginLeft: 0 }}>
      <input type="search" id="opp-search" placeholder="Søk etter en motstander" aria-label="Søk etter en motstander" value={q} autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) pick(hits[0].id); if (e.key === "Escape") setOpen(false); }} style={{ paddingLeft: 12 }} />
      {open && q.trim().length >= 2 && <ul className="hits" role="listbox" aria-label="Motstandere">
        {hits.length === 0 && <li className="none">Ingen treff</li>}
        {hits.map((o) => <li key={o.id} role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); pick(o.id); }}>
          <span className="who"><b>{o.name}</b><small>{o.club}</small></span><small className="tnum">{o.w}–{o.l}</small></li>)}
      </ul>}
    </div>
  );
}
