// Copies the JSON the site reads into public/data before dev/build:
//   ../data/site/*   (export_web.py: your profile, season clips, site.json)
//   ../data/riders/* (rivals.py: search index + every rider, in 64 shards)
//   ../data/races.json (rivals.py: every result list, for head-to-head between any two riders)
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../data/", import.meta.url));
const out = fileURLToPath(new URL("../public/data/", import.meta.url));
for (const d of ["site", "riders"]) {
  if (!existsSync(root + d)) { console.error(`Missing data/${d}. Run python3 rivals.py and python3 export_web.py first.`); process.exit(1); }
}
rmSync(out, { recursive: true, force: true });
cpSync(root + "site", out, { recursive: true });
cpSync(root + "riders", out + "riders", { recursive: true });
if (existsSync(root + "races.json")) cpSync(root + "races.json", out + "races.json");
console.log("copied data/site and data/riders into web/public/data");
