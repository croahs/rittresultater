// Riders this browser opened last, shown when the search box gets focus. Kept in localStorage only;
// the list never goes to the server.

export interface Recent { id: string; name: string; club: string }

const KEY = "rittresultater.sist";
export const MAX_RECENT = 8;

export function getRecent(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((r): r is Recent => r && typeof r.id === "string" && typeof r.name === "string").slice(0, MAX_RECENT) : [];
  } catch { return []; }
}

/** Puts the rider first, dropping an older entry for the same rider. */
export function addRecent(r: Recent, list = getRecent()): Recent[] {
  const next = [{ id: r.id, name: r.name, club: r.club || "" }, ...list.filter((x) => x.id !== r.id)].slice(0, MAX_RECENT);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private window: the list just isn't kept */ }
  return next;
}

export function clearRecent() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
