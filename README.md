# rittresultater

Pedår's cycling race results: placings from Turritt, power from intervals.icu.

## Run

```sh
pip install -r requirements.txt
cp .env.example .env   # add your intervals.icu API key
set -a; . ./.env; set +a
python3 update.py      # every rider in riders.json; or: python3 update.py 171101
```

Output:
- `data/races.json`: what the dashboard reads (schema below).
- `race_results_auto.csv`: Pedår's rebuilt sheet; `turritt_vs_sheet.md` lists where Turritt disagrees with his hand sheet (`race_results_original.csv`). Other riders get `data/riders/<id>.csv`.
- `points_races.csv`: SSK Cup, a points race (no times), from raceresult.

## Riders

`riders.json` lists every rider. Adding someone is one entry: their Turritt ID and/or EQ Timing id, and optionally the name of an env var holding their intervals.icu key (`intervals_key_env`). Without a key they get placings but no watts. `since` limits how far back their history is fetched (each old race list is one request). `publish_power: false` keeps watts out of `races.json`.

## Weekly update

`.github/workflows/update-data.yml` runs Mondays 05:00 UTC and on "Run workflow". It does nothing until the repository secret `INTERVALS_API_KEY` is set (Settings > Secrets and variables > Actions). A run without a rider's key keeps that rider's earlier watts.

## Caching (be gentle)

Published results never change, so each result list is fetched once and kept in git:
`cache/turritt.json`, `cache/eqtiming.json`, `cache/raceresult.json`. The watts computed per ride are kept in `cache/metrics.json`, so old rides are never fetched again (raw ride files in `cache/intervals/` stay out of git). A normal week costs one request each to Turritt, EQ Timing and intervals.icu, with 2 s between requests.

## data/races.json

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

- `race_id` is shared by every rider in the same race: `turritt:<id>`, `eqtiming:<event>/<stage>`, `raceresult:<event>:cup<n>`.
- `series` joins the same race across years.
- `avg_power`/`np` are null when the rider has no power data or doesn't publish it.
- Placing rules: DNS dropped, DNF counted and placed behind finishers; `class` is the race you rode (bike-type or distance groups split out), `overall` all sibling races of the event.
- Power and speed cover the race window only: the stretch of the ride file as long as the official time that covers the most distance. Speed = GPS distance in that window / official time.
