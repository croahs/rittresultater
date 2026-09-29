import type { RaceType } from "./data";

export const TYPE_LABEL: Record<RaceType, string> = { Road: "Landevei", Gravel: "Gravel", MTB: "Terreng", TT: "Tempo", TTT: "Lagtempo", Unknown: "Ukjent" };
export const TYPE_LC: Record<RaceType, string> = { Road: "landevei", Gravel: "gravel", MTB: "terreng", TT: "tempo", TTT: "lagtempo", Unknown: "ukjent type" };
export const TYPE_VAR: Record<RaceType, string> = { Road: "var(--road)", Gravel: "var(--gravel)", MTB: "var(--mtb)", TT: "var(--tt)", TTT: "var(--ttt)", Unknown: "var(--unknown)" };

const MON = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];
export const dateLong = (s: string) => { const [y, m, d] = s.split("-").map(Number); return `${d}. ${MON[m - 1]} ${y}`; };
export const dateShort = (s: string) => { const [, m, d] = s.split("-").map(Number); return `${d}. ${MON[m - 1]}`; };

export const pct = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || Number.isNaN(v) ? "–" : `${v.toFixed(digits).replace(".", ",")}\u00a0%`;
export const dec = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || Number.isNaN(v) ? "–" : v.toFixed(digits).replace(".", ",");

/** "00:21:44" -> "21:44", "01:28:08" -> "1:28:08" */
export const hms = (t: string) => t.replace(/^00:/, "").replace(/^0(\d)/, "$1");

/** "2025" or "2024–2026" */
export const span = (ys: number[]) => (!ys.length ? "" : ys[0] === ys[ys.length - 1] ? String(ys[0]) : `${ys[0]}–${ys[ys.length - 1]}`);

export const clock = (s: number) => {
  s = Math.abs(Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};

export const initials = (n: string) =>
  n.replace(/[^\p{L} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

export const firstName = (n: string) => n.split(" ")[0];

export const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ø/g, "o").replace(/æ/g, "ae");

export const listNo = (a: string[]) => (a.length > 1 ? `${a.slice(0, -1).join(", ")} og ${a[a.length - 1]}` : a.join(""));
