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
