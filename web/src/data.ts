// Data model and loading. The site only reads static JSON under data/ (written by export_web.py).

export type RaceType = "Road" | "Gravel" | "TT" | "TTT";

export interface Result {
  race: string; date: string; year: number; type: RaceType; cls: string | null;
  place: number; field: number;
  top: number;        // place as % of field, lower is better
  beaten: number;     // % of the field beaten (100 - top), higher is better
  behind: number | null; // % behind the winner
  time: string; winner: string;
  np: number | null; ap: number | null; speed: number | null; km: number | null; climb: number | null;
  ageClass: string; agePlace: number | null; ageN: number | null;
  link: string; icu: string;
}

export interface PointsRace {
  name: string; date: string; cls: string; place: string; n: string; pts: string; win: string;
  laps: string; time: string; speed: string; np: string; ap: string; note: string; icu: string;
}

export interface Meeting {
  race: string; date: string; type: RaceType; res: "w" | "l" | "d";
  gs: number | null; gp: number | null; pl: number | null;
  mc: string | null; tc: string | null; same: boolean;
}

export interface Opponent { id: string; name: string; club: string; w: number; l: number; med: number | null; ms: Meeting[] }

export interface Who { turritt_id: string; name: string; club: string; races?: number; wins?: number; losses?: number }
export interface Insights {
  rivals_by_type?: Partial<Record<RaceType, (Who & { median_gap_pct: number })[]>>;
  nemesis?: Who[]; victims?: Who[];
  specialists?: (Who & { stronger_than_you_in: RaceType[]; weaker_than_you_in: RaceType[] })[];
  overtaken?: (Who & { lost_in: string; beat_in: string })[];
  clubs?: { club: string; riders: number; wins: number; losses: number; win_pct: number }[];
  right_ahead?: (Who & { right_ahead: number })[];
  right_behind?: (Who & { right_behind: number })[];
}

export interface Athlete {
  id: string; name: string; club: string; ageClass: string;
  power: boolean; clips: number[];
  results: Result[]; points: PointsRace[];
  opponents: Map<string, Opponent>; rivals: string[]; insights: Insights;
}

export interface IndexRider { id: string; name: string; club: string; races: number; shard: string | null }
export interface Site { default_rider: string; profiles: string[] }

export interface ClipData {
  year: number; step: number; skipped: string[];
  races: { name: string; date: string; type: RaceType; time: number; place: number; field: number; km: number; pts: [number, number][] }[];
}

const cache = new Map<string, Promise<unknown>>();
export function getJSON<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(path, fetch(`data/${path}`).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    }).catch((e) => { cache.delete(path); throw e; }));
  }
  return cache.get(path) as Promise<T>;
}

type RawOpp = [string, string, string, number, number, number | null,
  [string, string, RaceType, string, number | null, number | null, number | null, (string | null)?, (string | null)?, number?][]];

function opponents(raw: RawOpp[] | undefined): Map<string, Opponent> {
  return new Map((raw || []).map(([id, name, club, w, l, med, ms]) => [id, {
    id, name, club, w, l, med,
    ms: ms.map(([race, date, type, res, gs, gp, pl, mc, tc, same]) => ({
      race: race.replace(/\s+20\d\d$/, ""), date: toIso(date), type, res: res[0] as Meeting["res"],
      gs, gp, pl, mc: mc ?? null, tc: tc ?? null, same: same === undefined ? true : !!same,
    })).sort((a, b) => a.date.localeCompare(b.date)),
  }]));
}

/** "14.09.25" or "2025-09-14" -> "2025-09-14" */
export function toIso(d: string): string {
  const m = /^(\d\d)\.(\d\d)\.(\d\d)$/.exec(d);
  return m ? `20${m[3]}-${m[2]}-${m[1]}` : d;
}

interface RawProfile {
  id: string; name: string; club: string; age_class?: string; power?: boolean; clips?: number[];
  results: Record<string, unknown>[]; points?: PointsRace[];
  opponents?: RawOpp[]; rivals?: string[]; insights?: Insights & { closest?: string[] };
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

function result(r: Record<string, unknown>): Result {
  // Two shapes: the sheet export (place/field/top/np...) and rivals.py's per-rider rows (top_pct/behind_pct).
  const date = toIso(String(r.date));
  const rawTop = r.top ?? r.top_pct;
  const top = rawTop === null || rawTop === undefined || rawTop === "" ? NaN : Number(rawTop); // DNF has no placing
  return {
    race: String(r.name ?? r.race).replace(/\s+20\d\d$/, ""), date, year: Number(date.slice(0, 4)),
    type: r.type as RaceType, cls: (r.class as string) ?? null,
    place: Number(r.place), field: Number(r.field), top, beaten: Math.max(0, Math.min(100, 100 - top)),
    behind: num(r.behind ?? r.behind_pct), time: String(r.time ?? ""), winner: String(r.winner ?? ""),
    np: num(r.np), ap: num(r.ap), speed: num(r.speed), km: num(r.km), climb: num(r.climb),
    ageClass: String(r.age_class ?? ""), agePlace: num(r.age_place), ageN: num(r.age_n),
    link: String(r.turritt ?? r.link ?? ""), icu: String(r.icu ?? ""),
  };
}

function athlete(p: RawProfile): Athlete {
  const ins = { ...(p.insights || {}) } as Insights & { closest?: string[] };
  const closest = ins.closest; delete ins.closest;
  return {
    id: p.id, name: p.name, club: p.club, ageClass: p.age_class || "",
    power: !!p.power, clips: p.clips || [],
    results: p.results.map(result).filter((r) => r.field > 0 && Number.isFinite(r.top)).sort((a, b) => a.date.localeCompare(b.date)),
    points: p.points || [],
    opponents: opponents(p.opponents), rivals: p.rivals?.length ? p.rivals : closest || [], insights: ins,
  };
}

export async function loadAthlete(id: string, site: Site, index: IndexRider[]): Promise<Athlete> {
  if (site.profiles.includes(id)) return athlete(await getJSON<RawProfile>(`athletes/${id}.json`));
  const entry = index.find((r) => r.id === id);
  if (!entry?.shard) throw new Error("Fant ikke rytteren");
  const shard = await getJSON<Record<string, RawProfile>>(`riders/shard-${entry.shard}.json`);
  const raw = shard[id];
  if (!raw) throw new Error("Fant ikke rytteren");
  return athlete({ ...raw, id });
}

/* ---------- derived numbers ---------- */

export const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
export const years = (a: Athlete) => [...new Set(a.results.map((r) => r.year))].sort();
export const record = (ms: Meeting[]) => ({ w: ms.filter((m) => m.res === "w").length, l: ms.filter((m) => m.res === "l").length });

/* Head-to-head against any rider, computed from the shared result lists (data/races.json). */
interface RacesFile { races: { name: string; date: string; type: RaceType; rows: [string, string, string, string, string | null, number | null][] }[] }
export async function headToHead(meId: string, other: IndexRider): Promise<Opponent> {
  const { races } = await getJSON<RacesFile>("races.json");
  const ms: Meeting[] = [];
  for (const race of races) {
    const me = race.rows.find((r) => r[0] === meId), o = race.rows.find((r) => r[0] === other.id);
    if (!me || !o) continue;
    const t = me[5], x = o[5];
    let res: Meeting["res"], gs: number | null = null, gp: number | null = null, pl: number | null = null;
    if (t == null && x == null) res = "d";
    else if (x == null) res = "w";
    else if (t == null) res = "l";
    else {
      res = t < x ? "w" : t > x ? "l" : "d";
      gs = t - x; gp = Math.round((1000 * gs) / x) / 10;
      const times = race.rows.map((r) => r[5]).filter((v): v is number => v != null);
      pl = x < t ? 1 + times.filter((v) => v > x && v < t).length : t < x ? -(1 + times.filter((v) => v > t && v < x).length) : null;
    }
    ms.push({ race: race.name.replace(/\s+20\d\d$/, ""), date: race.date, type: race.type, res, gs, gp, pl, mc: me[4], tc: o[4], same: me[4] === o[4] });
  }
  ms.sort((a, b) => a.date.localeCompare(b.date));
  const gaps = ms.filter((m) => m.gp != null).map((m) => m.gp!);
  const rec = record(ms);
  return { id: other.id, name: other.name, club: other.club, w: rec.w, l: rec.l, med: gaps.length ? median(gaps) : null, ms };
}
