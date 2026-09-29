import { useEffect, useMemo, useRef, useState } from "react";
import { flags, getJSON, ids, loadAthlete, withPower, withSaved, type Athlete, type IndexRider, type Site } from "./data";
import { firstName, fold, initials } from "./format";
import { BrandMark, Icon, TipProvider } from "./ui";
import { Sources } from "./sources";
import Overview from "./pages/Overview";
import Development from "./pages/Development";
import Rivals from "./pages/Rivals";
import Races from "./pages/Races";
import Clip from "./pages/Clip";
import Welcome from "./pages/Welcome";
import FindMe from "./pages/FindMe";
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

/* Hash: #/r/<our id without the r>/<tab>, e.g. #/r/17179/oversikt. No rider means the front page.
   Old links (#/<TurrittID>/<tab>) still open the right rider and are rewritten to the new form. */
function readHash(): { rid?: string; legacy?: string; tab?: Tab; find?: boolean } {
  try {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (parts[0] === "finn") return { find: true }; // «Fant du deg ikke?»
    const tab = parts.find((p): p is Tab => TABS.some((t) => t.id === p));
    if (parts[0] === "r" && /^\d+$/.test(parts[1] || "")) return { rid: "r" + parts[1], tab };
    const legacy = parts.find((p) => /^(eq)?\d+$/.test(p)); // a TurrittID, or eq<id> for a rider not yet given an id of ours
    return { legacy, tab };
  } catch { return {}; }
}

/** The data key for the rider in the hash, or null. */
async function hashRider(index: IndexRider[]): Promise<string | null> {
  const h = readHash();
  if (!h.rid && !h.legacy) return null;
  const inData = (k: string) => index.some((r) => r.id === k);
  if (h.legacy && inData(h.legacy)) return h.legacy;
  const m = await ids();
  const rid = h.rid || (h.legacy ? m.toRid(h.legacy) : null);
  return rid ? m.toKey(rid, inData) : null;
}

type Theme = "light" | "dark";
function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return localStorage.getItem("theme") === "dark" ? "dark" : "light"; } catch { return "light"; }
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0f1022" : "#eef0f6");
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
  const indexRef = useRef<IndexRider[]>([]);
  // «Fant du deg ikke?»: null when closed, else the name the visitor searched for.
  const [find, setFind] = useState<string | null>(() => (readHash().find ? "" : null));

  useEffect(() => {
    Promise.all([getJSON<Site>("site.json"), getJSON<IndexRider[]>("riders/index.json")])
      .then(async ([s, i]) => { flags.activityLinks = !!s.activity_links; indexRef.current = i; const r = await hashRider(i); setSite(s); setIndex(i); setRiderId(r); })
      .catch(() => setError("Fant ikke dataene. Kjør python3 export_web.py og bygg på nytt."));
    const onHash = async () => { const h = readHash(); const r = await hashRider(indexRef.current); setTab(h.tab || "oversikt"); setRiderId(r); setFind((f) => (h.find ? f ?? "" : null)); };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!site || !riderId) { setAthlete(null); setError(null); return; }
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
    // A new rider (or the front page) gets its own history entry, so Back returns to where you were; a tab change does not.
    if (!site) return; // until the data has loaded, the hash is still the link the visitor opened
    let live = true;
    (async () => {
      const rid = riderId ? (await ids()).toRid(riderId) : null;
      if (!live) return;
      const want = find !== null ? "#/finn" : !riderId ? "#/" : rid ? `#/r/${rid.slice(1)}/${tab}` : `#/${riderId}/${tab}`;
      try {
        if (location.hash === want || (!riderId && find === null && !location.hash)) return;
        // Same rider (a tab change, or an old link being rewritten): replace. A new rider: its own history entry.
        const h = readHash();
        const same = find === null && ((h.rid && h.rid === rid) || (h.legacy && h.legacy === riderId) || (!h.rid && !h.legacy && !h.find && !riderId));
        if (same) history.replaceState(null, "", want);
        else history.pushState(null, "", want);
      } catch { /* sandboxed preview */ }
    })();
    return () => { live = false; };
  }, [site, riderId, tab, find]);

  const go = (t: Tab) => { setTab(t); window.scrollTo({ top: 0 }); };
  const open = (id: string | null, t: Tab = "oversikt") => { setFind(null); setRiderId(id); setTab(t); window.scrollTo({ top: 0 }); };
  const findMe = (q: string) => { setRiderId(null); setFind(q); window.scrollTo({ top: 0 }); };
  // Public site: every profile, the owner's included, is written in the third person.
  const isMe = false;
  const home = !riderId && find === null;
  const riderName = athlete?.name || index.find((r) => r.id === riderId)?.name || "";
  const search = <RiderPicker index={index} onPick={(id) => open(id)} onFind={findMe} />;

  return (
    <TipProvider>
      <div className="app">
        <button type="button" className="skip" onClick={() => { const m = document.getElementById("innhold"); m?.focus(); m?.scrollIntoView(); }}>Hopp til innholdet</button>
        <header className="topbar">
          <a className="brand" href="#/" aria-label="Rittresultater, til forsiden" onClick={(e) => { e.preventDefault(); open(null); }}><BrandMark /><div>Ritt<br /><small>resultater</small></div></a>
          {riderId && (
            // The tabs are views of one rider, so they sit in one group with that rider's name in front.
            <div className="rider-nav">
              {riderName && <span className="who-chip"><button type="button" className="who-btn" title={`${riderName}: oversikt`} aria-label={`${riderName}, til oversikten`} onClick={() => go("oversikt")}><span className="ini" aria-hidden="true">{initials(riderName)}</span><span className="nm">{firstName(riderName)}</span></button>
                {athlete?.channel && <a className="yt-link" href={athlete.channel} target="_blank" rel="noopener" title={`${firstName(riderName)} på YouTube`} aria-label={`${riderName} på YouTube`}><Icon.youtube /></a>}</span>}
              <nav className="nav" aria-label={riderName ? `Sider for ${riderName}` : "Sider for rytteren"}>
                {TABS.map((t) => (
                  <button key={t.id} type="button" aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
                    <t.icon /><span>{t.label}</span>
                  </button>
                ))}
              </nav>
            </div>
          )}
          {home ? <div className="spacer" /> : search}
          <div className="theme" role="group" aria-label="Fargetema">
            {([["light", "Lys modus", Icon.sun], ["dark", "Mørk modus", Icon.moon]] as const).map(([k, l, I]) => (
              <button key={k} type="button" aria-pressed={theme === k} title={l} aria-label={l} onClick={() => setTheme(k)}><I /></button>
            ))}
          </div>
        </header>

        <main className="page" id="innhold" tabIndex={-1}>
          {error && <div className="card empty"><b>{error}</b><button className="btn" onClick={() => open(null)}>Til forsiden</button></div>}
          {home && site && <Welcome example={site.default_rider} onRider={(id, t) => open(id, t)} search={search} />}
          {find !== null && <FindMe key={find} name={find} onDone={() => open(null)} />}
          {riderId && !error && !athlete && <div className="loading">Henter resultater …</div>}
          {athlete && (
            <SelProvider key={athlete.id} a={athlete}>
              <Page key={tab} tab={tab} athlete={athlete} isMe={isMe} go={go} onRider={(id) => setRiderId(id)} index={index}
                onPower={(p) => setAthlete((a) => (a ? withPower(a, p) : a))}
                onSaved={async (id) => { const s = await getSaved(id); setAthlete((a) => (a && a.id === id ? withSaved(a, s) : a)); }} />
            </SelProvider>
          )}
          <footer className="site">
            <span>Plassering: DNF telles med i feltet. Watt og fart gjelder bare selve rittet.</span>
            <span>Resultater fra <Sources />. Watt fra <a href="https://intervals.icu" target="_blank" rel="noopener">intervals.icu</a>.</span>
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

function RiderPicker({ index, onPick, onFind }: { index: IndexRider[]; onPick: (id: string) => void; onFind: (q: string) => void }) {
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
          else if (e.key === "Enter" && !hits.length && q.trim().length >= 2) { e.preventDefault(); const v = q.trim(); setQ(""); setOpen(false); onFind(v); }
          if (e.key === "Escape") setOpen(false);
        }} />
      {open && q.trim().length >= 2 && (
        <ul className="hits" id="rider-hits" role="listbox" aria-label="Ryttere">
          {hits.length === 0 && <li className="none">Ingen ryttere med det navnet i resultatlistene.
            {" "}<button type="button" className="linkish" onMouseDown={(e) => { e.preventDefault(); const v = q.trim(); setQ(""); setOpen(false); onFind(v); }}>Fant du deg ikke?</button></li>}
          {hits.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === hi} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(r); }}>
              <span className="who"><b>{r.name}</b><small>{r.club || "Uten klubb"}</small></span>
              <small className="tnum">{r.races} ritt</small>
            </li>
          ))}
          {index.length <= 1 && <li className="note">Bare din egen profil er lastet inn ennå.</li>}
        </ul>
      )}
    </div>
  );
}
