import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { loadAthlete } = await server.ssrLoadModule("/src/data.ts");
  const thomas = JSON.parse(readFileSync(new URL("../../data/riders/shard-45.json", import.meta.url), "utf8"))["29229"];
  const load = (results, full = false) => loadAthlete("29229", { profiles: full ? ["29229"] : [] }, [{ id: "29229", shard: "45" }], async (path) => {
    if (path === "videos.json") return {};
    const profile = { ...thomas, results };
    return full ? profile : { "29229": profile };
  });
  const dnf = thomas.results.find((r) => r.race === "Pyrineene rundt 2019");
  assert.equal(dnf.time, "DNF");
  const athlete = await load(thomas.results);
  assert.equal(athlete.results.length, thomas.results.length - 1);
  assert.ok(!athlete.results.some((r) => r.race === "Pyrineene rundt" && r.year === 2019));
  assert.equal(Math.min(...athlete.results.map((r) => r.place)), 1);

  // Both profile formats must reject missing/invalid places and DNF, even with a numeric top value.
  for (const full of [false, true]) {
    for (const place of [null, undefined, "", 0, -1, "invalid", Infinity, 97]) {
      assert.equal((await load([{ ...dnf, time: "01:40:00", overall_place: place, place, top: 0, top_pct: 0 }], full)).results.length, 0);
    }
    assert.equal((await load([{ ...dnf, place: 1, overall_place: 1, top: 1 }], full)).results.length, 0);
    // A missing overall place must still allow a valid class placing.
    const valid = await load([{ ...dnf, time: "01:40:00", place: 2, top_pct: 2 / 96 * 100 }], full);
    assert.equal(valid.results[0].place, 2);
    assert.ok(valid.results[0].beaten < 100);
  }
  console.log("Result loading: Thomas's DNF and both profile formats passed.");
} finally {
  await server.close();
}
