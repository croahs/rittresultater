import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getJSON, type IndexRider, type RaceType } from "../data";
import { TYPE_LABEL, TYPE_VAR, clock, dateLong, dec } from "../format";
import { Icon } from "../ui";
import type { Tab } from "../App";

/* The front page: what is in here, a taste of the numbers, and a search box to find yourself. */

const title = (r: Race) => `${r.name.replace(/\s+20\d\d$/, "")} ${r.date.slice(0, 4)}`;

type Row = [string, string, string, string, string | null, number | null];
interface Race { id: string; name: string; date: string; type: RaceType; distance_km?: number; rows: Row[] }

export default function Welcome({ index, example, onRider, search }: {
  index: IndexRider[]; example?: string; onRider: (id: string, tab?: Tab) => void; search: ReactNode;
}) {
  const [races, setRaces] = useState<Race[] | null>(null);
  useEffect(() => { getJSON<{ races: Race[] }>("races.json").then((d) => setRaces(d.races)).catch(() => setRaces([])); }, []);

  const facts = useMemo(() => {
    if (!races) return null;
    const rs = [...races].sort((a, b) => a.date.localeCompare(b.date));
    const results = rs.reduce((n, r) => n + r.rows.length, 0);
    // Every finisher's distance added up: how far the whole field has raced together.
    const km = rs.reduce((n, r) => n + (r.distance_km || 0) * r.rows.filter((x) => x[5] != null).length, 0);
    const ys = [...new Set(rs.map((r) => r.date.slice(0, 4)))];
    const fastest = (r: Race) => r.rows.filter((x) => x[5] != null).sort((a, b) => a[5]! - b[5]!)[0];
    const recent = rs.slice(-4).reverse().map((r) => ({ r, win: fastest(r), n: r.rows.filter((x) => x[5] != null).length }));
    const biggest = rs.reduce((b, r) => (r.rows.length > b.rows.length ? r : b), rs[0]);
    // Closest finish in a race against the clock: gap between the two fastest.
    const tt = rs.filter((r) => r.type === "TT").map((r) => {
      const [a, b] = r.rows.filter((x) => x[5] != null).sort((x, y) => x[5]! - y[5]!);
      return a && b ? { r, a, b, gap: b[5]! - a[5]! } : null;
    }).filter((x): x is NonNullable<typeof x> => !!x && x.gap > 0).sort((x, y) => x.gap - y.gap)[0];
    const quick = rs.filter((r) => r.distance_km && r.type !== "TTT").map((r) => { const w = fastest(r); return w ? { r, w, kmh: r.distance_km! / (w[5]! / 3600) } : null; })
      .filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.kmh - a.kmh)[0];
    return { n: rs.length, results, km, ys, recent, biggest, tt, quick };
  }, [races, index]);

  const busiest = useMemo(() => [...index].sort((a, b) => b.races - a.races).slice(0, 8), [index]);
  const who = (id: string, name: string) => <button type="button" className="linkish" onClick={() => onRider(id)}>{name}</button>;

  return (
    <>
      <section className="welcome" aria-labelledby="h-velkommen">
        <div className="welcome-copy">
          <p className="eyebrow">Sykkelritt i Rogaland{facts ? `, ${facts.ys.join("–")}` : ""}</p>
          <h1 className="h-display welcome-title" id="h-velkommen">Hvor godt kjørte du egentlig?</h1>
          <p className="lead">Søk opp deg selv og se hver plassering, hvor stor del av feltet du slo, hvem du kjemper mot fra ritt til ritt, og om du blir bedre. Alt hentet fra de offisielle resultatlistene.</p>
          <div className="welcome-search">{search}</div>
          {example && <p className="fine">Eller <button type="button" className="linkish" onClick={() => onRider(example)}>se et eksempel</button> først.</p>}
        </div>
        <dl className="welcome-stats">
          <div><dt>Ritt</dt><dd className="tnum">{facts?.n ?? "–"}</dd></div>
          <div><dt>Resultater</dt><dd className="tnum">{facts ? facts.results.toLocaleString("nb-NO") : "–"}</dd></div>
          <div><dt>Ryttere</dt><dd className="tnum">{index.length ? index.length.toLocaleString("nb-NO") : "–"}</dd></div>
          <div><dt>Km kjørt til sammen</dt><dd className="tnum">{facts ? Math.round(facts.km).toLocaleString("nb-NO") : "–"}</dd></div>
        </dl>
      </section>

      <section className="section" aria-labelledby="h-siste">
        <div className="section-head"><div><h2 className="h-section" id="h-siste">Siste ritt</h2><p className="lead">Trykk på et navn for å se rytterens side.</p></div></div>
        <div className="recent">
          {facts?.recent.map(({ r, win, n }) => (
            <article key={r.id} className="card card-pad recent-card" style={{ ["--c" as string]: TYPE_VAR[r.type] }}>
              <p className="eyebrow">{TYPE_LABEL[r.type]} · {dateLong(r.date)}</p>
              <h3 className="recent-name">{r.name.replace(/\s+20\d\d$/, "")}</h3>
              <p className="muted">{n} i mål{r.distance_km ? `, ${dec(r.distance_km, 0)} km` : ""}</p>
              {win && <p className="recent-win"><span className="eyebrow">Raskest</span>{who(win[0], win[1])}<span className="tnum muted">{clock(win[5]!)}</span></p>}
            </article>
          ))}
          {!facts && <div className="loading">Henter rittene …</div>}
        </div>
      </section>

      {facts && (
        <section className="section" aria-labelledby="h-fakta">
          <h2 className="h-section" id="h-fakta">Fra resultatlistene</h2>
          <div className="w-facts">
            <div className="card card-pad w-fact"><p className="eyebrow">Største felt</p><b className="w-fact-num tnum">{facts.biggest.rows.length}</b>
              <p className="muted">ryttere i {title(facts.biggest)}</p></div>
            {facts.tt && <div className="card card-pad w-fact"><p className="eyebrow">Jevneste tempo</p><b className="w-fact-num tnum">{facts.tt.gap} s</b>
              <p className="muted">skilte {who(facts.tt.a[0], facts.tt.a[1])} og {who(facts.tt.b[0], facts.tt.b[1])} i {title(facts.tt.r)}</p></div>}
            {facts.quick && <div className="card card-pad w-fact"><p className="eyebrow">Høyeste snittfart</p><b className="w-fact-num tnum">{dec(facts.quick.kmh, 1)} km/t</b>
              <p className="muted">{who(facts.quick.w[0], facts.quick.w[1])} i {title(facts.quick.r)}</p></div>}
          </div>
        </section>
      )}

      <section className="section" aria-labelledby="h-far">
        <h2 className="h-section" id="h-far">Dette får du</h2>
        <div className="features">
          {([
            ["oversikt", Icon.overview, "Hvert ritt", "Plassering, andel av feltet du slo og tiden bak vinneren, på én skala for alle ritt."],
            ["rivaler", Icon.rivals, "Rivalene dine", "Hvem du møter oftest, stillingen mellom dere og hvem som er sterkest på landevei, grus og tempo."],
            ["utvikling", Icon.trend, "Utvikling og watt", "Om du klatrer i feltet fra år til år. Koble til intervals.icu for watt i hvert ritt; nøkkelen lagres ikke."],
            ["klipp", Icon.clip, "Sesongklipp", "Hele sesongen som ett animert kart, alle ritt kjørt samtidig."],
          ] as const).map(([tab, I, t, d]) => (
            <button key={tab} type="button" className="card card-pad feature" disabled={!example} onClick={() => example && onRider(example, tab)}>
              <I /><b>{t}</b><span className="muted">{d}</span>{example && <span className="feature-go">Se eksempel →</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="h-flest">
        <div className="section-head"><div><h2 className="h-section" id="h-flest">Flest ritt</h2><p className="lead">Ryttere som har vært med i flest av rittene her.</p></div></div>
        <ol className="busy">
          {busiest.map((r, i) => (
            <li key={r.id}><button type="button" onClick={() => onRider(r.id)}>
              <span className="busy-n tnum">{i + 1}</span><span className="who"><b>{r.name}</b><small>{r.club || "Uten klubb"}</small></span><span className="tnum muted">{r.races} ritt</span>
            </button></li>
          ))}
        </ol>
      </section>

      <p className="note">Med er {facts ? `${facts.n} ritt` : "rittene"} fra Turritt i Rogaland. Flere ritt kommer etter hvert. Watt vises bare når rytteren selv kobler til intervals.icu.</p>
    </>
  );
}
