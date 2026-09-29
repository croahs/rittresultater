// Copies the JSON the site reads into public/data before dev/build:
//   ../data/site/*   (export_web.py: your profile, season clips, site.json)
//   ../data/riders/* (rivals.py: search index + every rider, in 64 shards)
//   ../data/races.json (rivals.py: every result list, for head-to-head between any two riders)
//   ../data/summary.json (rivals.py: front page numbers from every followed rider's races)
//   ../data/videos.json (hand-kept: riders' YouTube channels and race videos)
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../data/", import.meta.url));
const out = fileURLToPath(new URL("../public/data/", import.meta.url));
for (const d of ["site", "riders"]) {
  if (!existsSync(root + d)) { console.error(`Missing data/${d}. Run python3 rivals.py and python3 export_web.py first.`); process.exit(1); }
}
rmSync(out, { recursive: true, force: true });
cpSync(root + "site", out, { recursive: true });
cpSync(root + "riders", out + "riders", { recursive: true });
for (const f of ["races.json", "summary.json", "videos.json"]) if (existsSync(root + f)) cpSync(root + f, out + f);
// ids.json: our rider id -> TurrittID, from data/aliases.json (riderids.py), for #/r/<id> URLs and the API
// while the data files are still keyed by TurrittID. Only the ids go out, not names or clubs.
if (existsSync(root + "aliases.json")) {
  const { riders } = JSON.parse(readFileSync(root + "aliases.json", "utf8"));
  // Riders without a TurrittID map to "eq<id>", so old #/eq<id> links still find them.
  const ids = Object.fromEntries(Object.entries(riders).filter(([, r]) => r.turritt || r.eq).map(([id, r]) => [id, r.turritt ? String(r.turritt) : `eq${r.eq}`]));
  writeFileSync(out + "ids.json", JSON.stringify(ids));
}
console.log("copied data/site and data/riders into web/public/data");
