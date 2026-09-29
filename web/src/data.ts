import { idsLoader } from "./ids";
import { clsLabel, fold } from "./format";
// Data model and loading. The site only reads static JSON under data/ (written by export_web.py).

export type RaceType = "Road" | "Gravel" | "MTB" | "TT" | "TTT" | "Unknown";

export interface Result {
  race: string; date: string; year: number; type: RaceType; cls: string | null;
  place: number; field: number;
  basis: "i klassen" | "totalt" | "blant kvinnene"; // what place/field count: the rider's class, the whole field, or the women in it
  top: number;        // place as % of field, lower is better
  beaten: number;     // % of the field beaten (100 - top), higher is better
  behind: number | null; // % behind the winner
  time: string; winner: string;
  np: number | null; ap: number | null; speed: number | null; km: number | null; climb: number | null;
  ageClass: string; agePlace: number | null; ageN: number | null;
  link: string; icu: string;
  video?: string;     // the rider's own video from this race (data/videos.json)
  videos?: RaceVideo[]; // every rider's video from this race, the rider's own first
  women: Women | null; // placing among the women in the same race (rivals.py); null for TTT, DNF or unknown sex
}

/** A result counted among the women only: place and field among them, with DNF behind finishers. */
export interface Women { place: number; field: number; beaten: number; behind: number | null }
export type Sex = "K" | "M" | null;

export interface PointsRace {
  name: string; date: string; cls: string; place: string; n: string; pts: string; win: string;
  laps: string; time: string; speed: string; np: string; ap: string; note: string; icu: string;
  video?: string;
}

export interface Meeting {
  race: string; date: string; type: RaceType; res: "w" | "l" | "d";
  gs: number | null; gp: number | null; pl: number | null;
  mc: string | null; tc: string | null; same: boolean;
}

export interface Opponent { id: string; name: string; club: string; w: number; l: number; med: number | null; ms: Meeting[]; sex: Sex }

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
  sex: Sex;            // from the classes the result lists put the rider in (rivals.py); never from the name
  rivalsWomen: string[]; // closest rivals among the women (rivals_women)
  power: boolean; clips: number[];
  full: boolean;       // own profile from the pipeline (every race), not rebuilt from the shared result lists
  livePower?: boolean; // watt fetched in this browser from intervals.icu
  savedPower?: boolean; // watts come from the site's database (the rider saved them), not the static files
  savedHidden?: boolean; // the rider saved watts but keeps them hidden
  savedClipYears?: number[]; // season clips built from GPS tracks the rider saved (api/clip), not static files
  channel?: string;    // the rider's own video channel (data/videos.json)
  results: Result[]; points: PointsRace[];
  opponents: Map<string, Opponent>; rivals: string[]; insights: Insights;
}

export interface IndexRider { id: string; name: string; club: string; races: number; shard: string | null; sex?: Sex }
export interface Site { default_rider: string; profiles: string[]; activity_links?: boolean; contact?: string }

/** Site-wide switches from site.json. Links to intervals.icu activities are off unless the owner turns them on. */
export const flags = { activityLinks: false };

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

/** Our rider ids and the data files' keys (see ids.ts). */
export const ids = idsLoader(getJSON);
/** Our id ("r17179") for a data key, for URLs and the API. Falls back to the key itself. */
export const ridOf = async (key: string) => (await ids()).toRid(key) ?? key;

type RawOpp = [string, string, string, number, number, number | null,
  [string, string, RaceType, string, number | null, number | null, number | null, (string | null)?, (string | null)?, number?][], Sex?];

function opponents(raw: RawOpp[] | undefined): Map<string, Opponent> {
  return new Map((raw || []).map(([id, name, club, w, l, med, ms, sex]) => [id, {
    id, name, club, w, l, med, sex: sex ?? null,
    ms: ms.map(([race, date, type, res, gs, gp, pl, mc, tc, same]) => ({
      race: race.replace(/\s+20\d\d$/, ""), date: toIso(date), type, res: res[0] as Meeting["res"],
      gs, gp, pl, mc: clsLabel(mc) ?? null, tc: clsLabel(tc) ?? null, same: same === undefined ? true : !!same,
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
  sex?: Sex; rivals_women?: string[];
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

function result(r: Record<string, unknown>): Result {
  // Two shapes: the sheet export (place/field/top/np...) and rivals.py's per-rider rows (top_pct/behind_pct).
  const date = toIso(String(r.date));
  // Riders from the shared lists are placed against the whole field, not tiny age/bike classes.
  const overall = r.overall_place != null && r.overall_field != null;
  const place = Number(overall ? r.overall_place : r.place), field = Number(overall ? r.overall_field : r.field);
  const rawTop = overall ? (place / field) * 100 : r.top ?? r.top_pct;
  const top = rawTop === null || rawTop === undefined || rawTop === "" ? NaN : Number(rawTop); // DNF has no placing
  // Share of the others beaten: the winner beat 100 %, last beat 0 %.
  const beaten = field > 1 ? ((field - place) / (field - 1)) * 100 : 100;
  return {
    race: String(r.name ?? r.race).replace(/\s+20\d\d$/, ""), date, year: Number(date.slice(0, 4)),
    type: r.type as RaceType, cls: clsLabel(r.class as string) ?? null,
    place, field, basis: overall || r.class == null && r.top === undefined ? "totalt" : "i klassen", top, beaten: Math.max(0, Math.min(100, beaten)),
    behind: num(r.behind ?? r.behind_pct), time: String(r.time ?? ""), winner: String(r.winner ?? ""),
    np: num(r.np), ap: num(r.ap), speed: num(r.speed), km: num(r.km), climb: num(r.climb),
    ageClass: clsLabel(String(r.age_class ?? "")), agePlace: num(r.age_place), ageN: num(r.age_n),
    link: String(r.turritt ?? r.link ?? ""), icu: String(r.icu ?? ""),
    women: r.women_place != null && r.women_field != null ? {
      place: Number(r.women_place), field: Number(r.women_field),
      beaten: Number(r.women_beaten_pct ?? (Number(r.women_field) > 1 ? ((Number(r.women_field) - Number(r.women_place)) / (Number(r.women_field) - 1)) * 100 : 100)),
      behind: num(r.women_behind_pct),
    } : null,
  };
}

function athlete(p: RawProfile, full = false): Athlete {
  const ins = { ...(p.insights || {}) } as Insights & { closest?: string[] };
  const closest = ins.closest; delete ins.closest;
  return {
    id: p.id, name: p.name, club: p.club, ageClass: p.age_class || "",
    sex: p.sex ?? null, rivalsWomen: p.rivals_women || [],
    power: !!p.power, clips: p.clips || [], full,
    results: p.results.map(result).filter((r) => r.field > 0 && Number.isFinite(r.top)).sort((a, b) => a.date.localeCompare(b.date)),
    points: p.points || [],
    opponents: opponents(p.opponents), rivals: p.rivals?.length ? p.rivals : closest || [], insights: ins,
  };
}

/* Riders' videos, hand-kept in data/videos.json: a channel per rider, and per race the videos riders made of it.
   A race is found by date and name, so a video shows on the race for everyone who rode it. */
export interface VideoFile {
  channels?: Record<string, string>;
  races?: { date: string; race: string; videos: { rid: string; url: string }[] }[];
}
export interface RaceVideo { rid: string; by: string; url: string; own: boolean }

const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ø/g, "o").replace(/æ/g, "ae").replace(/[^a-z0-9]/g, "");

/** The videos shared from the race on this date with this name (the name may carry the year). */
export function videosFor(file: VideoFile | null, date: string, name: string) {
  const n = plain(name.replace(/\s+20\d\d$/, ""));
  return file?.races?.find((x) => x.date === date && (n.startsWith(plain(x.race)) || plain(x.race).startsWith(n)))?.videos || [];
}

export const loadVideos = () => getJSON<VideoFile>("videos.json").catch(() => null); // optional: a missing file just means no videos

export function withVideos(a: Athlete, file: VideoFile | null, names: (rid: string) => string): Athlete {
  const races = file?.races || [];
  const channel = file?.channels?.[a.id];
  if (!races.length && !channel) return a;
  const find = (date: string, name: string): RaceVideo[] | undefined => {
    const vs = videosFor(file, date, name);
    if (!vs.length) return undefined;
    return vs.map((v) => ({ rid: v.rid, by: v.rid === a.id ? a.name : names(v.rid), url: v.url, own: v.rid === a.id }))
      .sort((x, y) => Number(y.own) - Number(x.own));
  };
  const own = (vs?: RaceVideo[]) => vs?.find((v) => v.own)?.url;
  return {
    ...a, channel,
    results: a.results.map((r) => { const vs = find(r.date, r.race); return vs ? { ...r, videos: vs, video: own(vs) } : r; }),
    points: a.points.map((p) => { const u = own(find(p.date, p.name)); return u ? { ...p, video: u } : p; }),
  };
}

export async function loadAthlete(id: string, site: Site, index: IndexRider[], get: <T>(path: string) => Promise<T> = getJSON): Promise<Athlete> {
  const videos = get<VideoFile>("videos.json").catch(() => null); // optional: a missing file just means no videos
  return withVideos(await loadRaw(id, site, index, get), await videos, (rid) => index.find((r) => r.id === rid)?.name || "");
}

async function loadRaw(id: string, site: Site, index: IndexRider[], get: <T>(path: string) => Promise<T>): Promise<Athlete> {
  const entry = index.find((r) => r.id === id);
  if (site.profiles.includes(id)) {
    const p = athlete(await get<RawProfile>(`athletes/${id}.json`), true);
    // The followed riders' own profiles (export_web.py) have no women's placings; rivals.py's copy in the shard has.
    if (entry?.sex !== "K" || !entry.shard) return { ...p, sex: entry?.sex ?? p.sex };
    const raw = (await get<Record<string, RawProfile>>(`riders/shard-${entry.shard}.json`).catch(() => ({})) as Record<string, RawProfile>)[id];
    return raw ? withWomen(p, athlete({ ...raw, id })) : { ...p, sex: "K" };
  }
  if (!entry?.shard) throw new Error("Fant ikke rytteren");
  const shard = await get<Record<string, RawProfile>>(`riders/shard-${entry.shard}.json`);
  const raw = shard[id];
  if (!raw) throw new Error("Fant ikke rytteren");
  return athlete({ ...raw, id });
}

/** A full profile with the women's placings, sexes and women's rivals from rivals.py's copy of the same rider. */
function withWomen(p: Athlete, s: Athlete): Athlete {
  const key = (r: Result) => `${r.date}|${fold(r.race)}`;
  const w = new Map(s.results.map((r) => [key(r), r.women]));
  return {
    ...p, sex: s.sex, rivalsWomen: s.rivalsWomen,
    results: p.results.map((r) => ({ ...r, women: w.get(key(r)) ?? null })),
    opponents: new Map([...p.opponents].map(([id, o]) => [id, { ...o, sex: s.opponents.get(id)?.sex ?? o.sex }])),
  };
}

/** The athlete counted among the women only: every placing, rival and head-to-head is against women. Races with
    no women's placing (team time trials, DNF) drop out. The rider is a woman, so this is what her own class looks like. */
export function womenOnly(a: Athlete): Athlete {
  const opponents = new Map([...a.opponents].filter(([, o]) => o.sex === "K"));
  const keep = (w: { turritt_id: string }) => opponents.has(w.turritt_id);
  const ins = a.insights;
  return {
    ...a,
    results: a.results.flatMap((r) => (r.women ? [{
      ...r, place: r.women.place, field: r.women.field, beaten: r.women.beaten, top: (r.women.place / r.women.field) * 100,
      behind: r.women.behind, basis: "blant kvinnene" as const, cls: null,
    }] : [])),
    opponents, rivals: a.rivalsWomen.filter((id) => opponents.has(id)),
    insights: {
      ...ins,
      rivals_by_type: ins.rivals_by_type && Object.fromEntries(Object.entries(ins.rivals_by_type).map(([t, l]) => [t, l?.filter(keep)])),
      nemesis: ins.nemesis?.filter(keep), victims: ins.victims?.filter(keep), specialists: ins.specialists?.filter(keep),
      overtaken: ins.overtaken?.filter(keep), right_ahead: ins.right_ahead?.filter(keep), right_behind: ins.right_behind?.filter(keep),
      clubs: undefined, // counted over everyone; there is no women-only version
    },
  };
}

/** The athlete with race power from intervals.icu merged in: fetched in this browser, or saved by the rider (saved = true). */
export function withPower(a: Athlete, p: Map<string, { np: number; ap: number }>, saved = false): Athlete {
  return { ...a, power: true, savedPower: saved || a.savedPower, livePower: !saved || a.livePower, results: a.results.map((r) => { const x = p.get(`${r.date}|${r.race}`); return x ? { ...r, np: x.np, ap: x.ap } : r; }) };
}

/** Numbers the rider saved on the site: watts, GPS speed and the years that have a season clip. */
export function withSaved(a: Athlete, s: { power: Map<string, { np: number; ap: number }>; speed: Map<string, number>; clipYears: number[]; hidden?: boolean }): Athlete {
  const b = s.power.size ? withPower(a, s.power, true) : a;
  const extra = s.clipYears.filter((y) => !a.clips.includes(y));
  return {
    ...b,
    results: b.results.map((r) => { const v = s.speed.get(`${r.date}|${r.race}`); return v != null ? { ...r, speed: v } : r; }),
    clips: [...a.clips, ...extra].sort(), savedClipYears: extra, savedHidden: !!s.hidden,
  };
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
/** One row of a result list: rider key, name, club, age class, class, time in s (null = DNF), sex,
 *  and for a lapped rider in a lap race: laps down and the official time (the time before is then the ranking time). */
export type RaceRow = [string, string, string, string, string | null, number | null, Sex?, number?, number?];
export interface RaceList { id: string; name: string; date: string; type: RaceType; distance_km?: number | null; turritt?: string; rows: RaceRow[] }
interface RacesFile { races: RaceList[] }
export const raceLists = async () => (await getJSON<RacesFile>("races.json")).races;
/** The shared result list for one of a rider's races (same date, same name), if there is one. */
export async function raceFor(r: { date: string; race: string }): Promise<RaceList | undefined> {
  const n = fold(r.race);
  return (await raceLists()).find((x) => x.date === r.date && fold(x.name.replace(/\s+20\d\d$/, "")) === n);
}
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
  return { id: other.id, name: other.name, club: other.club, w: rec.w, l: rec.l, med: gaps.length ? median(gaps) : null, ms, sex: other.sex ?? null };
}
