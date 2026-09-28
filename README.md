# rittresultater

Pedår's cycling race results: placings from Turritt, power from intervals.icu.

## Run

```sh
pip install -r requirements.txt
cp .env.example .env   # add your intervals.icu API key
set -a; . ./.env; set +a
python3 build.py race_results_original.csv race_results_auto.csv turritt_vs_sheet.md
```

- `race_results_original.csv` is the hand-kept sheet.
- Placings come from Turritt, or from EQ Timing (`eqtiming.py`, cached in `cache/eqtiming.json`) for races Turritt lacks; EQ Timing also gives the age-class placing.
- SSK Cup is a points race (no times), so it has its own file: `python3 sskcup.py points_races.csv` (raceresult, cached in `cache/raceresult.json`).
- `race_results_auto.csv` is the rebuilt sheet; `turritt_vs_sheet.md` lists where Turritt disagrees with it.
- `cache/turritt.json` caches every Turritt page fetched. Published results never change, so each race is fetched once and never again. Keep this file committed.
- Without `INTERVALS_API_KEY`, placings are still written; power and speed are left blank.
- Rivals: `python3 rivals.py` writes `rivals.json` (head-to-head per opponent, race by race), `rivals.csv` (one row per opponent, `rival_rank` for the closest ones) and `race_analysis.csv` (share of the field beaten per race, with type, field size, climbing). `python3 rivals.py søk <navn>` searches opponents. Uses only cached Turritt lists; no requests.
- Season clip: `python3 season_clip.py race_results_auto.csv season_clip.json [year]` writes every race of the year as a GPS track cut to the race window (from the gun to the official finish time), and `... season_clip.html` writes a standalone page. `season_clip.js` (`SeasonClip.mount(el, data)`, needs Leaflet) plays them all at once on one race clock, so the dashboard can show it as a tab.
- Every rider, for the dashboard: `python3 rivals.py` also writes `data/`:
  - `data/races.json`: each race (id, name, ISO date, type, distance, climbing) with its full result list as rows `[turritt_id, name, club, age_class, class, time_s]` (time `null` = DNF). Enough to compute head-to-head between any two riders in the browser.
  - `data/riders/index.json`: `[{id, name, club, age_class, races, shard}]` for search, most races first.
  - `data/riders/shard-NN.json` (64 shards, `int(id) % 64`): `{id: rider}` for every rider. A rider has `results` (class place, `top_pct`, `behind_pct`, time, winner, overall place, share of field beaten, over time) and, with 2+ races, `opponents` (compact head-to-head arrays for opponents met 3+ times or named in rivals/insights), `rivals` (ranked ids), `insights` (as in `rivals.json`, minus gap curves), `record`, `by_type`, `by_year`, `correlations`.
  - Scope: only the races Pedår rode, so other riders' histories are partial.
