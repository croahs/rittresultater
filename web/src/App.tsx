import { useEffect, useMemo, useRef, useState } from "react";
import { flags, getJSON, loadAthlete, withPower, withSaved, type Athlete, type IndexRider, type Site } from "./data";
import { fold } from "./format";
import { BrandMark, Icon, TipProvider } from "./ui";
import Overview from "./pages/Overview";
import Development from "./pages/Development";
import Rivals from "./pages/Rivals";
import Races from "./pages/Races";
import Clip from "./pages/Clip";
import { SelProvider } from "./state";
import type { RacePower } from "./intervals";
import { getSaved } from "./saved";

export type Tab = "oversikt" | "utvikling" | "rivaler" | "ritt" | "klipp";
const TABS: { id: Tab; label: string; icon: () => JSX.Element }[] = [
  { id: "oversikt", label: "Oversikt", icon: Icon.overview },
  { id: "utvikling", label: "Utvikling", icon: Icon.trend },
  { id: "rivaler", label: "Rivaler", icon: Icon.rivals },
  { id: "ritt", label: "Alle ritt", icon: Icon.races },
  { id: "klipp", label: "Sesongklipp", icon: Icon.clip },
];

/* Hash: #/<rider id>/<tab>. Plain #<tab> also works. */
function readHash(): { rider?: string; tab?: Tab } {
  try {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    const tab = parts.find((p): p is Tab => TABS.some((t) => t.id === p));
    const rider = parts.find((p) => /^\d+$/.test(p));
    return { rider, tab };
  } catch { return {}; }
}

type Theme = "system" | "light" | "dark";
function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem("theme") as Theme) || "system"; } catch { return "system"; }
  });
  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("theme", theme); } catch { /* private mode */ }
  }, [theme]);
  return [theme, setTheme];
}

export default function App() {
  const [site, setSite] = useState<Site | null>(null);
  const [index, setIndex] = useState<IndexRider[]>([]);
  const [riderId, setRiderId] = useState<string | null>(null);
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => readHash().tab || "oversikt");
  const [theme, setTheme] = useTheme();

  useEffect(() => {
    Promise.all([getJSON<Site>("site.json"), getJSON<IndexRider[]>("riders/index.json")])
      .then(([s, i]) => { flags.activityLinks = !!s.activity_links; setSite(s); setIndex(i); setRiderId(readHash().rider || s.default_rider); })
      .catch(() => setError("Fant ikke dataene. Kjør python3 export_web.py og bygg på nytt."));
    const onHash = () => { const h = readHash(); if (h.tab) setTab(h.tab); if (h.rider) setRiderId(h.rider); };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!site || !riderId) return;
    let live = true;
    setAthlete(null); setError(null);
    loadAthlete(riderId, site, index).then(async (a) => {
      if (!live) return;
      setAthlete(a);
      // Numbers the rider saved on the site (only riders without watts in the static data).
      if (a.power) return;
      const saved = await getSaved(a.id);
      if (live && (saved.power.size || saved.speed.size || saved.clipYears.length || saved.hidden)) setAthlete((x) => (x && x.id === a.id ? withSaved(x, saved) : x));
    }).catch(() => live && setError("Fant ikke denne rytteren i resultatlistene."));
    return () => { live = false; };
  }, [site, riderId, index]);

  useEffect(() => {
    if (!riderId) return;
    try { history.replaceState(null, "", `#/${riderId}/${tab}`); } catch { /* sandboxed preview */ }
  }, [riderId, tab]);

  const go = (t: Tab) => { setTab(t); window.scrollTo({ top: 0 }); };
  const isMe = !!site && athlete?.id === site.default_rider;

  return (
    <TipProvider>
      <div className="app">
        <button type="button" className="skip" onClick={() => { const m = document.getElementById("innhold"); m?.focus(); m?.scrollIntoView(); }}>Hopp til innholdet</button>
        <header className="topbar">
          <div className="brand"><BrandMark /><div>Ritt<br /><small>resultater</small></div></div>
          <nav className="nav" aria-label="Hovedmeny">
            {TABS.map((t) => (
              <button key={t.id} type="button" aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
                <t.icon /><span>{t.label}</span>
              </button>
            ))}
          </nav>
          <RiderPicker index={index} me={site?.default_rider} onPick={(id) => setRiderId(id)} />
          <div className="theme" role="group" aria-label="Fargetema">
            {([["system", "Følg systemet", Icon.auto], ["light", "Lys modus", Icon.sun], ["dark", "Mørk modus", Icon.moon]] as const).map(([k, l, I]) => (
              <button key={k} type="button" aria-pressed={theme === k} title={l} aria-label={l} onClick={() => setTheme(k)}><I /></button>
            ))}
          </div>
        </header>

        <main className="page" id="innhold" tabIndex={-1}>
          {error && <div className="card empty"><b>{error}</b>{riderId !== site?.default_rider && site && <button className="btn" onClick={() => setRiderId(site.default_rider)}>Tilbake til min side</button>}</div>}
          {!error && !athlete && <div className="loading">Henter resultater …</div>}
          {athlete && (
            <SelProvider key={athlete.id} a={athlete}>
              <Page key={tab} tab={tab} athlete={athlete} isMe={isMe} go={go} onRider={(id) => setRiderId(id)} index={index}
                onPower={(p) => setAthlete((a) => (a ? withPower(a, p) : a))}
                onSaved={async (id) => { const s = await getSaved(id); setAthlete((a) => (a && a.id === id ? withSaved(a, s) : a)); }} />
            </SelProvider>
          )}
          <footer className="site">
            <span>Plassering: DNF telles med i feltet. Watt og fart gjelder bare selve rittet.</span>
            <span>Resultater fra <a href="https://turritt.com" target="_blank" rel="noopener">Turritt</a>, <a href="https://live.eqtiming.com" target="_blank" rel="noopener">EQ Timing</a> og raceresult. Watt fra <a href="https://intervals.icu" target="_blank" rel="noopener">intervals.icu</a>.</span>
            {site?.contact && <span>Feil i dataene, eller vil du ikke være med? Skriv til <a href={`mailto:${site.contact}`}>{site.contact}</a>.</span>}
          </footer>
        </main>
      </div>
    </TipProvider>
  );
}

function Page({ tab, athlete, isMe, go, onRider, index, onPower, onSaved }: { tab: Tab; athlete: Athlete; isMe: boolean; go: (t: Tab) => void; onRider: (id: string) => void; index: IndexRider[]; onPower: (p: Map<string, RacePower>) => void; onSaved: (id: string) => void }) {
  switch (tab) {
    case "oversikt": return <Overview a={athlete} isMe={isMe} go={go} />;
    case "utvikling": return <Development a={athlete} isMe={isMe} onPower={onPower} onSaved={onSaved} />;
    case "rivaler": return <Rivals a={athlete} isMe={isMe} onRider={onRider} index={index} />;
    case "ritt": return <Races a={athlete} />;
    case "klipp": return <Clip a={athlete} isMe={isMe} />;
  }
}

function RiderPicker({ index, me, onPick }: { index: IndexRider[]; me?: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const keyed = useMemo(() => index.map((r) => [fold(`${r.name} ${r.club}`), r] as const), [index]);
  const hits = useMemo(() => {
    const s = fold(q.trim());
    if (s.length < 2) return [];
    const words = s.split(/\s+/);
    return keyed.filter(([k]) => words.every((w) => k.includes(w))).map(([, r]) => r)
      .sort((a, b) => b.races - a.races).slice(0, 12);
  }, [q, keyed]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const pick = (r: IndexRider) => { onPick(r.id); setQ(""); setOpen(false); (document.activeElement as HTMLElement)?.blur(); };
  return (
    <div className="picker" ref={box}>
      <Icon.search />
      <input type="search" id="rider-search" role="combobox" aria-expanded={open && q.length >= 2} aria-controls="rider-hits" aria-autocomplete="list"
        placeholder="Søk etter rytter …"
        aria-label="Søk etter rytter" value={q} autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, hits.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          if (e.key === "Enter" && hits[hi]) { e.preventDefault(); pick(hits[hi]); }
          if (e.key === "Escape") setOpen(false);
        }} />
      {open && q.trim().length >= 2 && (
        <ul className="hits" id="rider-hits" role="listbox" aria-label="Ryttere">
          {hits.length === 0 && <li className="none">Ingen ryttere med det navnet i resultatlistene.</li>}
          {hits.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === hi} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(r); }}>
              <span className="who"><b>{r.name}{r.id === me ? " (deg)" : ""}</b><small>{r.club || "Uten klubb"}</small></span>
              <small className="tnum">{r.races} ritt</small>
            </li>
          ))}
          {index.length <= 1 && <li className="note">Bare din egen profil er lastet inn ennå.</li>}
        </ul>
      )}
    </div>
  );
}
