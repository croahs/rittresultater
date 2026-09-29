// «Fant du deg ikke?»: a rider the search can't find asks to be added, either with their EQ Timing
// profile link or with their name and one race they rode. Shared by the page and functions/api/history.ts,
// so both read the form the same way.

/** EQ Timing's participant id from a profile link (live.eqtiming.com/…#participanthistory:6753412), or null. */
export function eqParticipant(link: string): string | null {
  const s = link.trim();
  if (s.length > 300 || !/^(https?:\/\/)?([a-z0-9-]+\.)*eqtiming\.(com|no)\b/i.test(s)) return null;
  const m = /participanthistory:(\d{1,10})\b/i.exec(s);
  return m ? m[1] : null;
}

export const FIRST_YEAR = 2005;

export interface FreeText { name: string; race: string; year: number }

/** Name, race and year cleaned up, or an error message for the visitor. */
export function freeText(name: unknown, race: unknown, year: unknown, now = new Date()): FreeText | string {
  const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const n = clean(name), r = clean(race), y = typeof year === "string" ? Number(year) : year;
  if (n.length < 3 || n.length > 80 || !/\p{L}.*\s.*\p{L}/u.test(n)) return "Skriv hele navnet ditt, fornavn og etternavn.";
  if (r.length < 3 || r.length > 100) return "Skriv navnet på ett ritt du har kjørt.";
  if (typeof y !== "number" || !Number.isInteger(y) || y < FIRST_YEAR || y > now.getFullYear()) return `Velg et år fra ${FIRST_YEAR} til ${now.getFullYear()}.`;
  return { name: n, race: r, year: y };
}
