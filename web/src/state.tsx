import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Athlete, Result } from "./data";

/* Season filter and the selected race, shared by every tab so a race picked on one tab stays picked. */
interface Sel { season: number | "all"; setSeason: (s: number | "all") => void; sel: string | null; setSel: (k: string | null) => void; rows: Result[] }
const Ctx = createContext<Sel | null>(null);
export const raceKey = (r: Result) => `${r.date}|${r.race}`;
export const useSel = () => useContext(Ctx)!;
export function SelProvider({ a, children }: { a: Athlete; children: ReactNode }) {
  const [season, setSeason] = useState<number | "all">("all");
  const [sel, setSel] = useState<string | null>(null);
  const rows = useMemo(() => a.results.filter((r) => season === "all" || r.year === season), [a, season]);
  const v = useMemo(() => ({
    season, sel, rows,
    setSeason: (s: number | "all") => { setSeason(s); setSel(null); },
    setSel,
  }), [season, sel, rows]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

/** Shows which race is selected, with a way back to all races. Renders nothing when none is. */
export function SelChip() {
  const { sel, setSel, rows } = useSel();
  const r = rows.find((x) => raceKey(x) === sel);
  if (!r) return null;
  return <div className="sel-chip" role="status"><span>Valgt: {r.race} {r.year}</span><button type="button" onClick={() => setSel(null)}>Fjern valg ✕</button></div>;
}
