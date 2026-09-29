import { useMemo, useRef, useEffect, useState } from "react";
import { median, years, type Athlete, type Result } from "../data";
import { IcuError, NameMismatch, fetchRacePower, validKey, type RacePower } from "../intervals";
import { TYPE_LABEL, TYPE_VAR, dateLong, firstName, pct } from "../format";
import { SelChip, raceKey, useSel } from "../state";
import { Icon, useTip } from "../ui";
import { deleteRides, getSaved, saveRides } from "../saved";

export default function Development({ a, isMe, onPower, onSaved }: { a: Athlete; isMe: boolean; onPower: (p: Map<string, RacePower>) => void; onSaved: (id: string) => void }) {
  const { rows, season, setSeason } = useSel();
  const ys = years(a);
  const who = isMe ? "du" : firstName(a.name);
  const types = [...new Set(rows.map((r) => r.type))];
  const [powerNote, setPowerNote] = useState<string | null>(null);
  useEffect(() => { if (location.hash.endsWith("#watt")) document.getElementById("watt")?.scrollIntoView(); }, []);
  return (
    <>
      <div className="section-head">
        <div><h1 className="h-display">Utvikling</h1><p className="lead">Hvordan {who} har plassert {isMe ? "deg" : "seg"} over tid. Hvert punkt er ett ritt, i datorekkefølge. Den tykke linjen er medianen av de siste fem rittene.</p><SelChip /></div>
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
          <section className="card card-pad section" id="watt" style={{ scrollMarginTop: 80 }}>
            <div className="section-head"><div><h2 className="h-card">Watt per ritt</h2><p className="note" style={{ margin: 0 }}>Normalisert watt (NP) og snittwatt over selve rittet{a.savedPower ? `. Hentet fra intervals.icu og lagret av ${firstName(a.name)}` : a.livePower ? ". Hentet fra intervals.icu i denne nettleseren, ikke lagret" : ""}</p></div></div>
            {a.power ? <PowerChart rows={rows} /> : <Connect a={a} isMe={isMe} onPower={onPower} onSaved={onSaved} onNote={setPowerNote} />}
            {a.power && powerNote && <p className="note" role="status" style={{ margin: 0 }}>{powerNote}</p>}
            {(a.savedPower || !!a.savedClipYears?.length) && <Forget a={a} />}
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
  const selI = rows.findIndex((r) => raceKey(r) === sel);
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
        {selI >= 0 && <SelLabel x={x(selI)} y={y(value(rows[selI]))} W={W} L={L} R={R} text={`${rows[selI].race} ${rows[selI].year}`} />}
        {rows.map((r, i) => (i % labelEvery === 0 || (i === n - 1 && (n - 1) % labelEvery > labelEvery / 2)) && (
          <text key={i} x={i === n - 1 && n > 1 ? x(i) + 6 : x(i)} y={H - B + 18} textAnchor={i === n - 1 && n > 1 ? "end" : "middle"} fontSize="10.5" fill="var(--muted)">{r.race.split(/[\s-]/)[0].slice(0, 11)}</text>
        ))}
      </svg>
      {selI >= 0 ? <SelDetail r={rows[selI]} extra={`${pct(value(rows[selI]))} ${label}`} onClear={() => setSel(null)} />
        : <div className="chart-foot"><span>{rows[0] && `${dateLong(rows[0].date)} til ${dateLong(rows[n - 1].date)}`}</span><span>Trykk på et punkt for å se rittet</span></div>}
    </div>
  );
}

/** Name of the selected race above its point, kept inside the chart. */
function SelLabel({ x, y, W, L, R, text }: { x: number; y: number; W: number; L: number; R: number; text: string }) {
  const w = Math.min(W - L - R, text.length * 6.6 + 16), bx = Math.max(L, Math.min(W - R - w, x - w / 2)), by = Math.max(0, y - 40);
  return (
    <g pointerEvents="none">
      <rect x={bx} y={by} width={w} height={22} rx={6} fill="var(--accent)" />
      <text x={bx + w / 2} y={by + 15} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--accent-ink)">{text}</text>
    </g>
  );
}

/** The selected race under a chart: what it was and how it went, with a way back. */
function SelDetail({ r, extra, onClear }: { r: Result; extra: string; onClear: () => void }) {
  return (
    <div className="chart-sel" role="status">
      <div><b>{r.race} {r.year}</b>
        <span>{dateLong(r.date)} · {TYPE_LABEL[r.type]}{r.cls ? ` · ${r.cls}` : ""}</span>
        <span>{r.place}. av {r.field} {r.basis} · {extra}</span></div>
      <button type="button" onClick={onClear}>Fjern valg</button>
    </div>
  );
}

function PowerChart({ rows }: { rows: Result[] }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const { sel, setSel } = useSel();
  const withNp = rows.filter((r) => r.np);
  if (!withNp.length) return <div className="empty"><b>Ingen wattdata i perioden</b></div>;
  const vals = withNp.flatMap((r) => [r.np!, r.ap ?? r.np!]);
  const LO = Math.floor((Math.min(...vals) - 10) / 25) * 25, HI = Math.ceil((Math.max(...vals) + 10) / 25) * 25;
  const H = 240, L = 46, R = 12, T = 12, B = 34, n = withNp.length;
  const step = (W - L - R) / Math.max(n - 1, 1), x = (i: number) => L + (n === 1 ? (W - L - R) / 2 : i * step);
  const y = (v: number) => T + (1 - (v - LO) / (HI - LO)) * (H - T - B);
  const every = (HI - LO) / 25 > 6 ? 50 : 25, ticks: number[] = [];
  for (let v = Math.ceil(LO / every) * every; v <= HI; v += every) ticks.push(v);
  const yearStarts = withNp.map((r, i) => (i && r.year !== withNp[i - 1].year ? i : -1)).filter((i) => i > 0);
  const labelEvery = Math.ceil(n / Math.max(1, Math.floor((W - L - R) / 70)));
  const types = [...new Set(withNp.map((r) => r.type))];
  const selI = withNp.findIndex((r) => raceKey(r) === sel);
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Normalisert watt og snittwatt per ritt">
        {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray="2 4" />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{v} W</text></g>)}
        {yearStarts.map((i) => <g key={i}><line x1={x(i) - step / 2} x2={x(i) - step / 2} y1={T} y2={H - B} stroke="var(--ink-2)" strokeOpacity=".35" />
          <text x={x(i) - step / 2 + 6} y={T + 10} fontSize="11" fontWeight="700" fill="var(--ink-2)">{withNp[i].year}</text></g>)}
        {withNp.map((r, i) => {
          const k = raceKey(r), on = !sel || sel === k;
          return (
            <g key={k} className="hit" onClick={() => setSel(sel === k ? null : k)} opacity={on ? 1 : 0.35}
              onPointerMove={(e) => tip(e, <><b>{r.race} {r.year}</b><span>NP {r.np} W{r.ap ? `, snitt ${r.ap} W` : ""}<br />{TYPE_LABEL[r.type]}, {r.place}. av {r.field}</span></>)} onPointerLeave={() => tip(null)}>
              <rect x={x(i) - Math.max(step, 20) / 2} y={T} width={Math.max(step, 20)} height={H - T - B} fill="transparent" />
              {r.ap && <line x1={x(i)} x2={x(i)} y1={y(r.ap)} y2={y(r.np!)} stroke={TYPE_VAR[r.type]} strokeWidth="2" strokeOpacity=".5" />}
              {r.ap && <circle cx={x(i)} cy={y(r.ap)} r="3.5" fill="var(--surface)" stroke={TYPE_VAR[r.type]} strokeWidth="2" />}
              {sel === k && <circle cx={x(i)} cy={y(r.np!)} r="10" fill="none" stroke="var(--accent)" strokeWidth="2.5" />}
              <circle cx={x(i)} cy={y(r.np!)} r="6" fill={TYPE_VAR[r.type]} stroke="var(--surface)" strokeWidth="2" />
            </g>
          );
        })}
        {selI >= 0 && <SelLabel x={x(selI)} y={y(withNp[selI].np!)} W={W} L={L} R={R} text={`${withNp[selI].race} ${withNp[selI].year}`} />}
        {withNp.map((r, i) => (i % labelEvery === 0 || (i === n - 1 && (n - 1) % labelEvery > labelEvery / 2)) && (
          <text key={`l${i}`} x={i === n - 1 && n > 1 ? x(i) + 6 : x(i)} y={H - B + 18} textAnchor={i === n - 1 && n > 1 ? "end" : "middle"} fontSize="10.5" fill="var(--muted)">{r.race.split(/[\s-]/)[0].slice(0, 11)}</text>
        ))}
      </svg>
      {selI >= 0 && <SelDetail r={withNp[selI]} extra={`NP ${withNp[selI].np} W${withNp[selI].ap ? `, snitt ${withNp[selI].ap} W` : ""}`} onClear={() => setSel(null)} />}
      <div className="chart-foot"><span className="legend">
        {types.map((t) => <span key={t} className="swatch"><span className="dot" style={{ background: TYPE_VAR[t] }} />{TYPE_LABEL[t]}</span>)}
        <span className="swatch"><span className="dot" style={{ background: "var(--muted)" }} />Fylt: NP</span>
        <span className="swatch"><span className="dot" style={{ border: "2px solid var(--muted)" }} />Hul: snittwatt</span>
      </span><span>Aksen starter på {LO} W</span></div>
    </div>
  );
}

function Connect({ a, isMe, onPower, onSaved, onNote }: { a: Athlete; isMe: boolean; onPower: (p: Map<string, RacePower>) => void; onSaved: (id: string) => void; onNote: (s: string) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Held in memory only while the person confirms an unfamiliar account name, then dropped.
  const pending = useRef<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  // Saving is offered only when the site has its database (functions/api/power.ts).
  const [canSave, setCanSave] = useState(false);
  const [save, setSave] = useState(false); // power is private by default (architecture decision)
  useEffect(() => { let live = true; getSaved(a.id).then((s) => live && setCanSave(s.enabled)); return () => { live = false; }; }, [a.id]);
  const name = firstName(a.name);
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    const k = key.trim();
    setKey(""); // the key lives only in this function call from here on
    if (!validKey(k)) { setMsg({ ok: false, text: "Det ser ikke ut som en API-nøkkel fra intervals.icu." }); return; }
    if (canSave && save) saveWith(k); else fetchWith(k, a.name);
  };
  const drop = () => { pending.current = null; setOwner(null); };
  const saveWith = async (k: string) => {
    setMsg(null); setBusy("Kobler til intervals.icu …");
    try {
      // Worked out here in the browser; the server checks the key is this rider's before storing.
      const res = await fetchRacePower(k, a.results, a.name, (d, n) => setBusy(`Henter ritt ${d} av ${n} …`), true);
      if (!res.power.size && !res.tracks.size) { setMsg({ ok: false, text: "Fant ingen økter på rittdatoene i intervals.icu-kontoen din." }); return; }
      setBusy("Lagrer …");
      const s = await saveRides(k, a.id, res, (d, n) => setBusy(`Lagrer GPS-spor ${d} av ${n} …`));
      onNote(`Lagret watt for ${s.power} og fart og GPS-spor for ${s.tracks} av ${a.results.length} ritt.${res.failed ? ` ${res.failed} ${res.failed === 1 ? "fil" : "filer"} fikk vi ikke lastet; lagre på nytt senere for dem.` : ""} Alle som ser siden, ser nå tallene, og sesongklippet er klart.`);
      if (res.power.size) onPower(res.power);
      onSaved(a.id);
    } catch (err) {
      if (err instanceof NameMismatch) { setMsg({ ok: false, text: `Nøkkelen tilhører «${err.owner}» i intervals.icu, ikke ${a.name}. Bare rytteren selv kan lagre. Fjern krysset hvis du bare vil se wattene.` }); return; }
      setMsg({ ok: false, text: err instanceof IcuError || (err instanceof Error && !(err instanceof TypeError)) ? err.message : "Fikk ikke kontakt med intervals.icu. Prøv igjen." });
    } finally { setBusy(null); }
  };
  const fetchWith = async (k: string, rider: string | null) => {
    drop();
    setMsg(null); setBusy("Kobler til intervals.icu …");
    try {
      const res = await fetchRacePower(k, a.results, rider, (d, n) => setBusy(`Henter ritt ${d} av ${n} …`));
      if (!res.power.size) { setMsg({ ok: false, text: `Fant ingen økter med watt på rittdatoene i kontoen${res.athlete ? ` til ${res.athlete}` : ""}.` }); return; }
      const got = res.power.size, n = a.results.length;
      onNote(`Hentet watt for ${got} av ${n} ritt fra intervals.icu.${res.failed ? ` ${res.failed} ${res.failed === 1 ? "fil" : "filer"} fikk vi ikke lastet; prøv igjen senere for dem.` : ""} Tallene lagres ikke.`);
      onPower(res.power);
    } catch (err) {
      if (err instanceof NameMismatch) { pending.current = k; setOwner(err.owner); return; }
      setMsg({ ok: false, text: err instanceof IcuError ? err.message : "Fikk ikke kontakt med intervals.icu. Prøv igjen." });
    } finally { setBusy(null); }
  };
  const saving = canSave && save;
  return (
    <div className="connect">
      <span className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon.bolt /> Wattdata</span>
      <p>{isMe ? "Du" : <b>{name}</b>} har ikke delt watt. {isMe ? "" : `Er du ${name}? `}Lim inn API-nøkkelen din fra intervals.icu, så henter vi watt for akkurat disse rittene, bare for selve rittet.</p>
      <form className="keyform" onSubmit={run}>
        <input type="password" id="icu-key" aria-label="API-nøkkel fra intervals.icu" placeholder="API-nøkkel fra intervals.icu" autoComplete="off" spellCheck={false}
          value={key} onChange={(e) => setKey(e.target.value)} disabled={!!busy} />
        <button type="submit" className="btn" disabled={!!busy || !key.trim()}>{busy ? "Henter …" : saving ? "Hent og lagre" : "Hent watt"}</button>
      </form>
      {canSave && <label className="fine" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} disabled={!!busy} />
        <span>Lagre wattene, farten og GPS-sporet fra rittene på siden, så de er her neste gang, andre også ser dem, og du får sesongklipp. Du kan slette dem igjen.</span>
      </label>}
      {busy && <p className="fine" role="status">{busy}</p>}
      {msg && <p className={msg.ok ? "ok" : "err"} role="alert">{msg.text}</p>}
      {owner && <div className="confirm" role="alert">
        <p>Nøkkelen tilhører kontoen «{owner}» i intervals.icu, ikke {a.name}. Watt skal bare vises på rytterens egen side.</p>
        <div className="keyform"><button type="button" className="btn" onClick={() => pending.current && fetchWith(pending.current, null)}>Det er meg, hent likevel</button>
          <button type="button" className="btn ghost" onClick={drop}>Avbryt</button></div>
      </div>}
      <p className="fine">Nøkkelen finner du under Settings, Developer Settings i intervals.icu. {saving
        ? "Den brukes bare mens tallene hentes og lagres, og blir ikke lagret. Vi lagrer snittwatt, NP, fart og GPS-sporet fra start til mål per ritt, aldri hele ridefilene, og bare hvis navnet i intervals.icu stemmer med navnet i resultatlistene."
        : "Den sendes bare til intervals.icu, lagres ikke, og wattallene forsvinner når du lukker siden."}</p>
    </div>
  );
}

/** Delete saved watts. Takes the key again: whoever saved them is whoever holds that intervals.icu account. */
function Forget({ a }: { a: Athlete }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    const k = key.trim();
    setKey("");
    if (!validKey(k)) { setMsg({ ok: false, text: "Det ser ikke ut som en API-nøkkel fra intervals.icu." }); return; }
    setBusy(true); setMsg(null);
    try {
      const n = await deleteRides(k, a.id);
      if (!n) { setMsg({ ok: false, text: "Denne intervals.icu-kontoen har ikke lagret noe her." }); return; }
      setMsg({ ok: true, text: "Slettet watt, fart og GPS-spor." });
      setTimeout(() => location.reload(), 1200);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Noe gikk galt. Prøv igjen." });
    } finally { setBusy(false); }
  };
  if (!open) return <p className="fine" style={{ margin: 0 }}><button type="button" className="btn ghost" onClick={() => setOpen(true)}>Slett lagrede watt og spor</button></p>;
  return (
    <div className="connect">
      <p>Lim inn den samme API-nøkkelen fra intervals.icu som ble brukt til å lagre, så sletter vi watt, fart og GPS-spor.</p>
      <form className="keyform" onSubmit={run}>
        <input type="password" aria-label="API-nøkkel fra intervals.icu" placeholder="API-nøkkel fra intervals.icu" autoComplete="off" spellCheck={false}
          value={key} onChange={(e) => setKey(e.target.value)} disabled={busy} />
        <button type="submit" className="btn" disabled={busy || !key.trim()}>{busy ? "Sletter …" : "Slett"}</button>
        <button type="button" className="btn ghost" onClick={() => { setOpen(false); setMsg(null); }} disabled={busy}>Avbryt</button>
      </form>
      {msg && <p className={msg.ok ? "ok" : "err"} role="alert">{msg.text}</p>}
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
    return <span className={`chg ${good ? "pos" : "neg"}`} title={good ? "Bedre" : "Dårligere"}>{r > 0 ? "↑" : "↓"} {Math.abs(r)}{unit}</span>;
  };
  return (
    <section className="card section" id="samme-ritt" style={{ gap: 0, scrollMarginTop: 80 }}>
      <div className="card-pad"><h2 className="h-card">Samme ritt, {y0} mot {y1}</h2><p className="note" style={{ margin: "4px 0 0" }}>Ritt {who} har kjørt begge år. Pilen viser om tallet gikk opp eller ned; grønn betyr bedre. Endringer i prosent står i prosentpoeng.</p></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Ritt</th><th>Slått {y0}</th><th>{y1}</th><th>Bak vinner {y0}</th><th>{y1}</th>{a.power && <><th>NP {y0}</th><th>{y1}</th></>}</tr></thead>
        <tbody>{pairs.map((rs) => {
          const p = rs.find((r) => r.year === y0), b = rs.find((r) => r.year === y1);
          if (!p || !b) return null;
          return (
            <tr key={b.race}><td>{b.race}</td><td>{pct(p.beaten)}</td><td>{pct(b.beaten)}{chg(b.beaten - p.beaten, " poeng", false)}</td>
              <td>{pct(p.behind)}</td><td>{pct(b.behind)}{p.behind != null && b.behind != null && chg(b.behind - p.behind, " poeng", true)}</td>
              {a.power && <><td>{p.np ?? "–"}</td><td>{b.np ?? "–"}{p.np && b.np && chg(b.np - p.np, " W", false)}</td></>}</tr>
          );
        })}</tbody>
      </table></div>
    </section>
  );
}
