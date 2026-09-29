# rittresultater

Pedår's cycling race results: placings from Turritt, power from intervals.icu.

## Run

```sh
pip install -r requirements.txt
cp .env.example .env   # add your intervals.icu API key
set -a; . ./.env; set +a
python3 update.py      # every rider in riders.json; or: python3 update.py 171101
```

- `race_results_original.csv` is the hand-kept sheet.
- Placings come from the timing systems themselves. Turritt is no longer fetched from (`turritt.LIVE = False`, 2026-09-29: it is a competitor, not a source); its cached lists are still read until the move to the original sources is done. EQ Timing (`eqtiming.py`, cached in `cache/eqtiming.json`) also gives the age-class placing. NM Landevei 2026 comes from raceresult (`raceresult.py`, events listed by hand, riders matched by name, cached in `cache/raceresult_events.json`). Bergen-Voss comes from Ultimate (`ultimate.py`, the same way, `cache/ultimate.json`).
- SSK Cup is a points race (no times), so it has its own file: `python3 sskcup.py points_races.csv` (raceresult, cached in `cache/raceresult.json`).
- `race_results_auto.csv` is the rebuilt sheet; `turritt_vs_sheet.md` lists where Turritt disagrees with it.
- `cache/turritt.json` caches every Turritt page fetched. Published results never change, so each race is fetched once and never again. Keep this file committed.
- Without `INTERVALS_API_KEY`, placings are still written; power and speed are left blank.
- Rivals: `python3 rivals.py` writes `rivals.json` (head-to-head per opponent, race by race), `rivals.csv` (one row per opponent, `rival_rank` for the closest ones) and `race_analysis.csv` (share of the field beaten per race, with type, field size, climbing). `python3 rivals.py søk <navn>` searches opponents. Uses only cached Turritt lists; no requests.
- Season clip: `python3 season_clip.py race_results_auto.csv season_clip.json [year]` writes every race of the year as a GPS track cut to the race window (from the gun to the official finish time), and `... season_clip.html` writes a standalone page. `season_clip.js` (`SeasonClip.mount(el, data)`, needs Leaflet) plays them all at once on one race clock, so the dashboard can show it as a tab.
- Every rider, for the dashboard: `python3 rivals.py` also writes `data/`:
  - `data/races.json`: each race (id, name, ISO date, type, distance, climbing) with its full result list as rows `[turritt_id, name, club, age_class, class, time_s]` (time `null` = DNF). Enough to compute head-to-head between any two riders in the browser.
  - `data/riders/index.json`: `[{id, name, club, age_class, races, shard}]` for search, most races first.
  - `data/riders/shard-NN.json` (64 shards, `int(id) % 64`): `{id: rider}` for every rider. A rider has `results` (class place, `top_pct`, `behind_pct`, time, winner, overall place, share of field beaten, over time), `by_type`, `by_year`, `correlations` and, for riders in `riders.json` (who asked for their data), `opponents` (compact head-to-head arrays for everyone met twice or more), `rivals` (ranked ids), `insights` (as in `rivals.json`, minus gap curves) and `record`. `python3 rivals.py rytter <id>` rebuilds one rider's full profile in place.
  - Scope: every Turritt race of every rider in `riders.json` (read from `data/results.json`, so run `update.py` first), so followed riders get rivals from their whole history; other riders' histories only cover those races.

## Dashboard (web/)

The dashboard is a static Vite + React + TypeScript site in `web/`. It reads only JSON: `data/riders/` (from `rivals.py`) and `data/site/` (from `python3 export_web.py`: your results with power, points races, rivals and season clips). `cd web && pnpm install && pnpm build` writes `web/dist/`; `pnpm dev` runs it locally. Publishing on Cloudflare Pages is described in `docs/DEPLOY.md`. Riders' own YouTube videos are hand-kept in `data/videos.json`: per rider id a `channel` URL (shown as an icon by the rider's name) and `videos` as `{date, race, url}`, matched to the rider's race on that date (the race name is only a label). Add a line there when a new video is up. The older single-file page (`dashboard.py`, `dashboard_template.html`) still builds, but the web app replaces it.

Output:
- `data/results.json`: what the dashboard reads (schema below).
- `race_results_auto.csv`: Pedår's rebuilt sheet; `turritt_vs_sheet.md` lists where Turritt disagrees with his hand sheet (`race_results_original.csv`). Other riders get `data/csv/<id>.csv`.
- `points_races.csv`: SSK Cup, a points race (no times), from raceresult.

## Riders

`riders.json` lists every rider. Adding someone is one entry: their Turritt ID and/or EQ Timing id, and optionally the name of an env var holding their intervals.icu key (`intervals_key_env`). Without a key they get placings but no watts. `since` limits how far back their history is fetched (each old race list is one request). `publish_power: false` keeps watts out of `results.json`.

## Weekly update

`.github/workflows/update-data.yml` runs Mondays 05:00 UTC and on "Run workflow". It does nothing until the repository secret `INTERVALS_API_KEY` is set (Settings > Secrets and variables > Actions). A run without a rider's key keeps that rider's earlier watts.

## Caching (be gentle)

Published results never change, so each result list is fetched once and kept in git:
`cache/turritt.json`, `cache/eqtiming.json`, `cache/raceresult.json`, `cache/raceresult_events.json`. The watts computed per ride are kept in `cache/metrics.json`, so old rides are never fetched again (raw ride files in `cache/intervals/` stay out of git). A normal week costs one request each to Turritt, EQ Timing and intervals.icu, with 2 s between requests.

## data/results.json

```
{ "schema": 1,
  "riders": [{id, name, turritt_id, eq_id, power}],
  "races": [{rider_id, race_id, name, series, date, year, type, class_name,
             class_place, class_n, overall_place, overall_n, percentile, overall_percentile,
             time, time_s, winner_time, behind_pct, distance_km, elevation_m, climb_per_km,
             speed_kmh, avg_power, np, age_class, age_place, age_n,
             source_ids: {turritt, eqtiming}, links: {turritt, eqtiming, intervals}}],
  "points_races": [{rider_id, race_id, name, series, date, year, class_name, place, field,
                    points, winner_points, laps, race_time, distance_km, speed_kmh,
                    avg_power, np, note, links: {raceresult, intervals}}] }
```

- `race_id` is shared by every rider in the same race: `turritt:<id>`, `eqtiming:<event>/<stage>`, `raceresult:<event>:cup<n>` (SSK Cup), `raceresult:<event>/<class>` (NM).
- `series` joins the same race across years.
- `avg_power`/`np` are null when the rider has no power data or doesn't publish it.
- Placing rules: DNS dropped, DNF counted and placed behind finishers; `class` is the race you rode (bike-type or distance groups split out), `overall` all sibling races of the event.
- Power and speed cover the race window only: the stretch of the ride file as long as the official time that covers the most distance. Speed = GPS distance in that window / official time.
