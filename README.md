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
- Season clip: `python3 season_clip.py race_results_auto.csv season_clip.json [year]` writes every race of the year as a GPS track cut to the race window (from the gun to the official finish time), and `... season_clip.html` writes a standalone page. `season_clip.js` (`SeasonClip.mount(el, data)`, needs Leaflet) plays them all at once on one race clock, so the dashboard can show it as a tab.
