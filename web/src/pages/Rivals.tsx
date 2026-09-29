import MoreRaces from "../MoreRaces";
import { useMemo, useRef, useState, useEffect } from "react";
import { headToHead, median, record, type Athlete, type IndexRider, type Meeting, type Opponent, type RaceType, type Who } from "../data";
import { TYPE_LABEL, TYPE_LC, clock, dateLong, firstName, fold, initials, listNo } from "../format";
import { Empty, useTip } from "../ui";

type TabKey = "closest" | RaceType;

export default function Rivals({ a, isMe, onRider, index }: { a: Athlete; isMe: boolean; onRider: (id: string) => void; index: IndexRider[] }) {
  const [extra, setExtra] = useState<Map<string, Opponent>>(new Map());
  const O = useMemo(() => new Map([...a.opponents, ...extra]), [a.opponents, extra]);
  const ins = a.insights;
  const [sameOnly, setSameOnly] = useState(false);
  const TABS = useMemo(() => ([["closest", "Jevneste"], ["Road", "Landevei"], ["TT", "Tempo"], ["Gravel", "Gravel"], ["MTB", "Terreng"]] as [TabKey, string][])
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
  // Same rule as rivals.py: 3+ races together and a median gap within 5 %.
  const level = `Jevnbyrdige er ryttere ${isMe ? "du" : firstName(a.name)} har møtt minst tre ganger, og som vanligvis kommer i mål innen 5\u00a0% av ${isMe ? "tiden din" : `tiden til ${firstName(a.name)}`}, rundt 5 minutter på et ritt på 1:40.`;

  const open = (id: string) => {
    if (!O.has(id)) {
      const r = index.find((x) => x.id === id);
      if (!r) return;
      headToHead(a.id, r).then((o) => {
        setExtra((m) => new Map(m).set(id, o)); setCur(id); setTab("closest");
        duelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return;
    }
    setCur(id);
    if (!ids(tab).includes(id)) setTab("closest");
    duelRef.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };

  if (!a.opponents.size && !extra.size) return (
    <>
      <h1 className="h-display">Rivaler</h1>
      {!a.full && <MoreRaces a={a} rivals />}
      <div className="card"><Empty title="Ingen rivaler ennå">Rivaler regnes ut når en rytter har minst to ritt i resultatlistene vi har hentet.</Empty></div>
    </>
  );

  const typeIds = tab === "closest" ? null : tab;
  const listIds = ids(tab);
  return (
    <>
      <div className="section-head">
        <div><h1 className="h-display">Rivaler</h1>
          <p className="lead">{isMe ? `Du har møtt ${a.opponents.size} ulike ryttere i resultatlistene. ` : ""}Velg en rival i listen, eller søk opp en hvilken som helst rytter for å se hvordan {isMe ? "dere" : `${firstName(a.name)} og rytteren`} har gjort det mot hverandre.</p></div>
        <OppSearch O={O} index={index} self={a.id} onPick={open} />
      </div>
      {!a.full && <MoreRaces a={a} rivals />}

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
                    <span className="mini" aria-hidden="true">{ms.slice(-8).map((m, i) => <i key={i} className={m.res === "w" ? "" : m.res} />)}</span></span>
                </button></li>
              );
            })}
          </ul>
        </div>
        {cur && O.get(cur) ? <Duel a={a} o={O.get(cur)!} ms={pool(O.get(cur)!)} type={typeIds} isMe={isMe} sameOnly={sameOnly}
          inIndex={index.some((r) => r.id === cur)} onRider={onRider} /> : <Empty title="Velg en rival" />}
      </section>

      <div className="hl-cards">
        <HlCard title="Nemesis" sub={`Jevnbyrdige som slår ${you} oftest`} info={`${level} Nemesis er de blant dem som oftest slår ${you}.`} c="var(--loss)" rows={ins.nemesis} val={(r) => [`${r.wins}–${r.losses}`, `${r.races} ritt`]} onPick={open} />
        <HlCard title="Offer" sub={`Jevnbyrdige ${isMe ? "du slår" : `${firstName(a.name)} slår`} oftest`} info={`${level} Offer er de blant dem som ${isMe ? "du" : firstName(a.name)} oftest slår.`} c="var(--win)" rows={ins.victims} val={(r) => [`${r.wins}–${r.losses}`, `${r.races} ritt`]} onPick={open} />
        <HlCard title="Jakten" sub={`Ender oftest 1–3 plasser foran ${you}`} info={`Ryttere som oftest kommer i mål én til tre plasser foran ${you}. Dem er det nærmest å ta igjen.`} c="var(--gravel)" rows={ins.right_ahead} val={(r) => [`${(r as Who & { right_ahead?: number }).right_ahead}×`, `av ${r.races} ritt`]} onPick={open} />
        <HlCard title="I nakken" sub={`Ender oftest 1–3 plasser bak ${you}`} info={`Ryttere som oftest kommer i mål én til tre plasser bak ${you}. De er nærmest å ta ${isMe ? "deg" : firstName(a.name)} igjen.`} c="var(--road)" rows={ins.right_behind} val={(r) => [`${(r as Who & { right_behind?: number }).right_behind}×`, `av ${r.races} ritt`]} onPick={open} />
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
              <b>{s.name}</b> slo {you} hver gang i {s.lost_in}. I {s.beat_in} slo {isMe ? "du" : firstName(a.name)} {firstName(s.name)} hver gang.</button></li>)}
            {!(ins.specialists?.length || ins.overtaken?.length) && <li className="note">Ingen ennå. Listen vokser med hver sesong.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}

function Duel({ a, o, ms: all, type, isMe, sameOnly, inIndex, onRider }: { a: Athlete; o: Opponent; ms: Meeting[]; type: RaceType | null; isMe: boolean; sameOnly: boolean; inIndex: boolean; onRider: (id: string) => void }) {
  // Same race type as the list the rival was picked from, so the list and the duel agree.
  const ms = type ? all.filter((m) => m.type === type || (type === "TT" && m.type === "TTT")) : all;
  const r = record(ms), rAll = record(all);
  if (!o.ms.length) return <Empty title={`${firstName(a.name)} og ${o.name} har ikke kjørt samme ritt`}>Ingen av resultatlistene vi har hentet har med begge to.</Empty>;
  if (!all.length) return <Empty title={`Ingen møter med ${o.name} i samme klasse`}>Slå av «Bare samme klasse» for å se alle møtene.</Empty>;
  if (!ms.length) return <Empty title={`Ingen ${TYPE_LC[type!]}ritt mot ${o.name}`}>Velg «Jevneste» for å se alle rittypene.</Empty>;
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
      <div className="strip" aria-hidden="true">{ms.map((m, i) => <i key={i} className={m.res === "w" ? "" : m.res} />)}</div>
      <div className="kv">
        <div><small>Møtt i</small><b>{ms.length} ritt</b></div>
        <div><small>Typisk tidsforskjell</small><b>{med == null ? "–" : med === 0 ? "Helt likt" : med < 0 ? `${me} ${Math.abs(med).toFixed(1).replace(".", ",")} % foran` : `${them} ${med.toFixed(1).replace(".", ",")} % foran`}</b></div>
        {type && rAll.w + rAll.l !== r.w + r.l && <div><small>Alle rittyper</small><b>{rAll.w}–{rAll.l}</b></div>}
        {!sameOnly && same.w + same.l > 0 && same.w + same.l !== r.w + r.l && <div><small>I samme klasse</small><b>{same.w}–{same.l}</b></div>}
        <div><small>Siste møte</small><b>{last.race} {last.date.slice(0, 4)}, {resTxt(last)}</b></div>
      </div>
      <GapChart key={`${o.id}-${type}-${sameOnly}`} ms={ms} them={them} me={me} />
      {inIndex && <div><button type="button" className="btn" onClick={() => onRider(o.id)}>Se siden til {them}</button></div>}
    </div>
  );
}

function GapChart({ ms, them, me }: { ms: Meeting[]; them: string; me: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(620);
  const [pick, setPick] = useState<number | null>(null);
  const tip = useTip();
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.min(760, Math.round(e.contentRect.width)))));
    ro.observe(ref.current); return () => ro.disconnect();
  }, []);
  const n = ms.length, L = 46, R = 10, T = 14;
  const slot = (W - L - R) / Math.max(n, 1), bw = Math.max(8, Math.min(32, slot * 0.6));
  const tilt = slot < 70; // names turn sideways when they no longer fit under their bar
  const B = tilt ? 78 : 44, H = 250 + (tilt ? 34 : 0);
  const top = Math.max(2, ...ms.filter((m) => m.gp != null).map((m) => Math.abs(m.gp!)));
  const step = top <= 4 ? 1 : top <= 10 ? 2.5 : top <= 20 ? 5 : 10, M = Math.ceil(top / step) * step;
  const y = (v: number) => T + (H - T - B) / 2 - (v / M) * (H - T - B) / 2, y0 = y(0);
  const other = ms.some((m) => !m.same);
  const tv: number[] = [];
  for (let v = -M; v <= M + 1e-9; v += step) tv.push(v);
  const short = (m: Meeting) => m.race.replace(/^(Tempo|Temporittet|Ritt)\s+/, "").split(/[\s-]/)[0].slice(0, 14);
  const toggle = (i: number) => setPick((p) => (p === i ? null : i));
  const m = pick != null ? ms[pick] : null;
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Tidsforskjell mot ${them} per ritt`}>
        {tv.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v ? "var(--line)" : "var(--ink-2)"} strokeDasharray={v ? "2 4" : undefined} strokeOpacity={v ? 1 : 0.6} />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{String(Math.abs(v)).replace(".", ",")} %</text></g>)}
        <text x={L + 6} y={T + 11} fontSize="11" fontWeight="700" fill="var(--win)">▲ {me} raskere</text>
        <text x={L + 6} y={H - B - 6} fontSize="11" fontWeight="700" fill="var(--loss)">▼ {them} raskere</text>
        {ms.map((mm, i) => {
          const cx = L + slot * (i + 0.5), on = pick === i, dim = pick != null && !on ? 0.4 : 1;
          const ev = {
            onClick: () => toggle(i), tabIndex: 0, role: "button", "aria-label": `${mm.race} ${mm.date.slice(0, 4)}`, "aria-pressed": on,
            onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(i); } },
            onPointerMove: (e: React.PointerEvent) => e.pointerType === "mouse" && tip(e, <><b>{mm.race} {mm.date.slice(0, 4)}</b><span>Trykk for detaljer</span></>),
            onPointerLeave: () => tip(null),
          };
          const lx = cx, ly = H - B + 14;
          const label = tilt
            ? <text x={lx} y={ly} fontSize="10.5" fill={on ? "var(--ink)" : "var(--ink-2)"} fontWeight={on ? 700 : 400} textAnchor="end" transform={`rotate(-40 ${lx} ${ly})`}>{short(mm)} {mm.date.slice(2, 4)}</text>
            : <><text x={lx} y={ly + 3} textAnchor="middle" fontSize="10.5" fill={on ? "var(--ink)" : "var(--ink-2)"} fontWeight={on ? 700 : 400}>{short(mm)}</text>
              <text x={lx} y={ly + 17} textAnchor="middle" fontSize="10" fill="var(--muted)">{mm.date.slice(0, 4)}</text></>;
          if (mm.gp == null) return <g key={i} className="hit" {...ev}><rect x={cx - slot / 2} y={T} width={slot} height={H - T} fill="transparent" /><circle cx={cx} cy={y0} r="5" fill="var(--muted)" opacity={dim} />{label}</g>;
          const v = -mm.gp, yy = y(v), h = Math.max(2, Math.abs(yy - y0)), col = v >= 0 ? "var(--win)" : "var(--loss)";
          return (
            <g key={i} className="hit" {...ev}>
              <rect x={cx - slot / 2} y={T} width={slot} height={H - T} fill="transparent" />
              {on && <rect x={cx - bw / 2 - 5} y={(v >= 0 ? y0 - h : y0) - 5} width={bw + 10} height={h + 10} rx="6" fill="none" stroke="var(--accent)" strokeWidth="2.5" />}
              <rect x={cx - bw / 2} y={v >= 0 ? y0 - h : y0} width={bw} height={h} rx="3" fill={mm.same ? col : "var(--surface)"} stroke={col} strokeWidth={mm.same ? 0 : 2} opacity={dim} />
              {label}
            </g>
          );
        })}
      </svg>
      {m ? <MeetingDetail m={m} me={me} them={them} onClose={() => setPick(null)} /> : <p className="note" style={{ margin: "0 0 4px" }}>Trykk på en stolpe for å se rittet, klassene og tidsforskjellen.</p>}
      <div className="chart-foot"><span className="legend">
        <span className="swatch"><span className="dot" style={{ background: "var(--win)" }} />{me} raskere</span>
        <span className="swatch"><span className="dot" style={{ background: "var(--loss)" }} />{them} raskere</span>
        {other && <span className="swatch"><span className="dot" style={{ border: "2px solid var(--muted)" }} />Hul: ulik klasse</span>}
      </span><span>Høyde: tidsforskjell i prosent av vinnertiden mellom dere</span></div>
    </div>
  );
}

function MeetingDetail({ m, me, them, onClose }: { m: Meeting; me: string; them: string; onClose: () => void }) {
  const you = me === "Du";
  const who = m.res === "w" ? me : m.res === "l" ? them : null;
  const lead = m.pl ? (m.pl < 0 ? me : them) : null;
  return (
    <div className="chart-sel" role="status">
      <div>
        <b>{m.race} {m.date.slice(0, 4)}</b>
        <span>{dateLong(m.date)} · {TYPE_LABEL[m.type]}</span>
        <span>{m.gs != null && who ? `${who} var ${clock(m.gs)} raskere (${Math.abs(m.gp!).toFixed(1).replace(".", ",")} %)` : m.gs === 0 ? "Helt likt i tid" : who ? `${who} fullførte, den andre har ingen tid (DNF)` : "Ingen av dere har tid"}
          {lead ? `, ${Math.abs(m.pl!)} ${Math.abs(m.pl!) === 1 ? "plass" : "plasser"} foran` : ""}</span>
        {(m.mc || m.tc) && <span>Klasse: {you ? "du" : me} {m.mc || "ukjent"}, {them} {m.tc || "ukjent"}{m.same ? " (samme klasse)" : " (ulik klasse)"}</span>}
      </div>
      <button type="button" onClick={onClose}>Lukk</button>
    </div>
  );
}

function HlCard({ title, sub, info, c, rows, val, onPick }: { title: string; sub: string; info: string; c: string; rows?: Who[]; val: (r: Who) => [string, string]; onPick: (id: string) => void }) {
  return (
    <article className="card hl" style={{ ["--c" as string]: c }}>
      <header><h2 className="h-card">{title} <Info text={info} /></h2><small>{sub}</small></header>
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
  // Result lists spell clubs differently ("Sandnes" and "Sandnes Sykleklubb"); count them as one.
  const merged = new Map<string, { club: string; riders: number; wins: number; losses: number; win_pct: number }>();
  for (const c of clubs) {
    const k = fold(c.club).replace(/[.,]/g, "").replace(/\s+(sykkelklubb|sykleklubb|sykkelklubben|sk|ck|cycling club|il|if)$/, "").trim();
    const m = merged.get(k);
    merged.set(k, m ? { ...m, club: c.club.length > m.club.length ? c.club : m.club, riders: m.riders + c.riders, wins: m.wins + c.wins, losses: m.losses + c.losses } : { ...c });
  }
  const top = [...merged.values()].filter((c) => c.wins + c.losses >= 10).sort((x, y) => y.wins + y.losses - (x.wins + x.losses)).slice(0, 12);
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

function OppSearch({ O, index, self, onPick }: { O: Map<string, Opponent>; index: IndexRider[]; self: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(0);
  const keyed = useMemo(() => index.filter((r) => r.id !== self).map((r) => [fold(`${r.name} ${r.club}`), r] as const), [index, self]);
  const hits = useMemo(() => {
    const s = fold(q.trim());
    if (s.length < 2) return [];
    return keyed.filter(([k]) => s.split(/\s+/).every((w) => k.includes(w))).map(([, r]) => r)
      .sort((x, y) => (O.get(y.id)?.ms.length ?? 0) - (O.get(x.id)?.ms.length ?? 0) || y.races - x.races).slice(0, 8);
  }, [q, keyed, O]);
  const pick = (r: IndexRider) => { onPick(r.id); setQ(r.name); setOpen(false); };
  return (
    <div className="rsearch picker" style={{ marginLeft: 0 }}>
      <input type="search" id="opp-search" placeholder="Sammenlign med en rytter" aria-label="Sammenlign med en rytter" value={q} autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setAct(0); }}
        role="combobox" aria-expanded={open && hits.length > 0} aria-controls="opp-hits" aria-activedescendant={open && hits[act] ? `opp-${hits[act].id}` : undefined} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setAct((i) => (i + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % Math.max(hits.length, 1)); }
          if (e.key === "Enter" && hits[act]) pick(hits[act]);
          if (e.key === "Escape") setOpen(false);
        }} style={{ paddingLeft: 12 }} />
      {open && q.trim().length >= 2 && <ul className="hits" role="listbox" id="opp-hits" aria-label="Ryttere">
        {hits.length === 0 && <li className="none">Ingen treff</li>}
        {hits.map((r, i) => { const o = O.get(r.id); return <li key={r.id} id={`opp-${r.id}`} role="option" aria-selected={i === act} onMouseDown={(e) => { e.preventDefault(); pick(r); }}>
          <span className="who"><b>{r.name}</b><small>{r.club || "Uten klubb"}</small></span><small className="tnum">{o ? `${o.w}–${o.l}` : `${r.races} ritt`}</small></li>; })}
      </ul>}
    </div>
  );
}

/* A small "i" that explains a term: shown on hover or keyboard focus, toggled by a tap on phones. */
function Info({ text }: { text: string }) {
  const [on, setOn] = useState(false);
  return (
    <span className="info-wrap">
      <button type="button" className="info" aria-label="Forklaring" aria-expanded={on} onClick={() => setOn(!on)} onBlur={() => setOn(false)}>i</button>
      <span className="info-pop" role="tooltip">{text}</span>
    </span>
  );
}
