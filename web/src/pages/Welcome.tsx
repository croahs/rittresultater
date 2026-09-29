import { useEffect, useState, type ReactNode } from "react";
import { getJSON, type RaceType } from "../data";
import { TYPE_LABEL, TYPE_VAR, clock, dateLong, dec, span } from "../format";
import { Icon } from "../ui";
import type { Tab } from "../App";
import { openRace } from "./Race";

/* The front page: what is in here, a taste of the numbers, and a search box to find yourself. */

type Who = { id: string; name: string; page: boolean };
interface Summary {
  races: number; results: number; riders: number; km: number; years: number[];
  recent: { id: string; name: string; date: string; type: RaceType; km: number | null; finishers: number; fastest: (Who & { time: number }) | null; fastest_women?: (Who & { time: number }) | null }[];
  biggest: { name: string; riders: number } | null;
  busiest: (Who & { club: string; races: number })[];
  closest_tt: { name: string; gap_s: number; a: Who; b: Who } | null;
  fastest_avg: { name: string; kmh: number; rider: Who } | null;
}

export default function Welcome({ example, onRider, search }: {
  example?: string; onRider: (id: string, tab?: Tab) => void; search: ReactNode;
}) {
  // summary.json is rebuilt by the weekly data job from every followed rider's race lists, so nothing here is hardcoded.
  const [facts, setFacts] = useState<Summary | null>(null);
  useEffect(() => { getJSON<Summary>("summary.json").then(setFacts).catch(() => setFacts(null)); }, []);

  // Riders outside the search pool have no page yet: show the name without a link.
  const who = (w: Who) => w.page ? <button type="button" className="linkish" onClick={() => onRider(w.id)}>{w.name}</button> : <span>{w.name}</span>;
  const num = (n?: number) => (n == null ? "–" : Math.round(n).toLocaleString("nb-NO"));

  return (
    <>
      <section className="welcome" aria-labelledby="h-velkommen">
        <div className="welcome-copy">
          <p className="eyebrow">Sykkelritt{facts ? ` ${span(facts.years)}` : ""}</p>
          <h1 className="h-display welcome-title" id="h-velkommen">Hvor godt kjørte du egentlig?</h1>
          <p className="lead">Søk opp deg selv og se hver plassering, hvor stor del av feltet du slo, hvem du kjemper mot fra ritt til ritt, og om du blir bedre. Alt hentet fra de offisielle resultatlistene.</p>
          <div className="welcome-search">{search}</div>
          {example && <p className="fine">Eller <button type="button" className="linkish" onClick={() => onRider(example)}>se et eksempel</button> først.</p>}
        </div>
        <dl className="welcome-stats">
          <div><dt>Ritt</dt><dd className="tnum">{num(facts?.races)}</dd></div>
          <div><dt>Resultater</dt><dd className="tnum">{num(facts?.results)}</dd></div>
          <div><dt>Ryttere</dt><dd className="tnum">{num(facts?.riders)}</dd></div>
          <div><dt>Km kjørt til sammen</dt><dd className="tnum">{num(facts?.km)}</dd></div>
        </dl>
      </section>

      <section className="section" aria-labelledby="h-siste">
        <div className="section-head"><div><h2 className="h-section" id="h-siste">Siste ritt</h2><p className="lead">Trykk på et navn for å se rytterens side.</p></div></div>
        <div className="recent">
          {facts?.recent.map((r) => (
            <article key={r.id} className="card card-pad recent-card" style={{ ["--c" as string]: TYPE_VAR[r.type] }}>
              <p className="eyebrow">{TYPE_LABEL[r.type]} · {dateLong(r.date)}</p>
              <h3 className="recent-name"><button type="button" className="linkish" onClick={() => openRace(r.id)}>{r.name}</button></h3>
              <p className="muted">{r.finishers} i mål{r.km ? `, ${dec(r.km, 0)} km` : ""}</p>
              {r.fastest && <p className="recent-win"><span className="eyebrow">Raskest</span>{who(r.fastest)}<span className="tnum muted">{clock(r.fastest.time)}</span></p>}
              {r.fastest_women && <p className="recent-win"><span className="eyebrow">Raskeste kvinne</span>{who(r.fastest_women)}<span className="tnum muted">{clock(r.fastest_women.time)}</span></p>}
            </article>
          ))}
          {!facts && <div className="loading">Henter rittene …</div>}
        </div>
      </section>

      {facts && (
        <section className="section" aria-labelledby="h-fakta">
          <h2 className="h-section" id="h-fakta">Fra resultatlistene</h2>
          <div className="w-facts">
            {facts.biggest && <div className="card card-pad w-fact"><p className="eyebrow">Største felt</p><b className="w-fact-num tnum">{num(facts.biggest.riders)}</b>
              <p className="muted">ryttere i {facts.biggest.name}</p></div>}
            {facts.closest_tt && <div className="card card-pad w-fact"><p className="eyebrow">Jevneste tempo</p><b className="w-fact-num tnum">{facts.closest_tt.gap_s} s</b>
              <p className="muted">skilte {who(facts.closest_tt.a)} og {who(facts.closest_tt.b)} i {facts.closest_tt.name}</p></div>}
            {facts.fastest_avg && <div className="card card-pad w-fact"><p className="eyebrow">Høyeste snittfart</p><b className="w-fact-num tnum">{dec(facts.fastest_avg.kmh, 1)} km/t</b>
              <p className="muted">{who(facts.fastest_avg.rider)} i {facts.fastest_avg.name}</p></div>}
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
        <div className="section-head"><div><h2 className="h-section" id="h-flest">Flest ritt</h2><p className="lead">Ryttere med flest ritt i resultatlistene her.</p></div></div>
        <ol className="busy">
          {facts?.busiest.map((r, i) => (
            <li key={r.id}>{r.page ? <button type="button" onClick={() => onRider(r.id)}>{busyRow(r, i)}</button> : <div className="busy-row">{busyRow(r, i)}</div>}</li>
          ))}
        </ol>
      </section>

      <p className="note">Med er {facts ? `${facts.races} ritt, ${span(facts.years)}` : "rittene"}: alle rittene til rytterne siden følger. Tallene oppdateres av seg selv når nye ritt og ryttere kommer til. Watt vises bare når rytteren selv kobler til intervals.icu.</p>
    </>
  );
}

const busyRow = (r: Who & { club: string; races: number }, i: number) => (
  <><span className="busy-n tnum">{i + 1}</span><span className="who"><b>{r.name}</b><small>{r.club || "Uten klubb"}</small></span><span className="tnum muted">{r.races} ritt</span></>
);
