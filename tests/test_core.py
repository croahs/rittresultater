import csv
import json
import os
import tempfile
import unittest
from unittest import mock

import birken
import build
import dashboard
import eqtiming
import raceresult
import rivals
import sskcup
import sync
import turritt
import update


class TestRivalsCore(unittest.TestCase):
    def test_changed_counts_all_non_dnf_when_b_empty(self):
        old = [
            (["1", "1", "r1", "A", "", "Me", "", "Club", "M30-39", "3600"], None),
            (["2", "2", "r2", "A", "", "Opp1", "", "Club", "M30-39", "3700"], None),
            (["3", "3", "r3", "A", "", "Opp2", "", "Club", "M30-39", "3800"], None),
            (["99", "", "r4", "A", "", "DnfOpp", "", "Club", "M30-39", str(rivals.DNF_TIME)], None),
        ]
        # New pool does not contain r1 at all -> b is {} -> 2 non-DNF opponents lost
        new = [[(["1", "1", "r2", "A", "", "Opp1", "", "Club", "M30-39", "3700"], None)]]
        lost, other = rivals.changed(old, new, {"r1"})
        self.assertEqual(lost, 2)
        self.assertEqual(other, 0)

    def test_women_behind_pct_preserves_zero_and_handles_dnf(self):
        sheet = {
            "Race": "Test Race 2026", "Date": "10.05.26", "Type": "Road",
            "Distance (km)": "50", "Elevation gain (m)": "500", "Turritt": "https://example.com/r",
        }
        cats = [
            (["1", "1", "w1", "K", "", "Ada", "A", "CK", "K30-39", "3600"], "Racer"),
            (["2", "2", "w2", "K", "", "Bea", "B", "CK", "K30-39", "3960"], "Racer"),
            (["", "", "w3", "K", "", "Cia", "C", "CK", "K30-39", str(rivals.DNF_TIME)], "Racer"),
        ]
        ev = rivals._event(sheet, "test1", cats, False)
        ev["sex"] = ["K", "K", "K"]
        ev["women_times"] = [3600, 3960, rivals.DNF_TIME]
        with mock.patch.dict(rivals.SEX, {"w1": "K", "w2": "K", "w3": "K"}, clear=False):
            w1 = rivals.rider_object({"id": "w1", "name": "Ada A", "club": "CK", "age_class": "K30-39", "sex": "K"}, [ev], False)
            w3 = rivals.rider_object({"id": "w3", "name": "Cia C", "club": "CK", "age_class": "K30-39", "sex": "K"}, [ev], False)
        self.assertEqual(w1["results"][0]["women_behind_pct"], 0.0)
        self.assertIsNone(w3["results"][0]["women_behind_pct"])

    def test_all_dnf_class_winner_is_dnf(self):
        sheet = {
            "Race": "All DNF 2026", "Date": "10.05.26", "Type": "Road",
            "Distance (km)": "", "Elevation gain (m)": "", "Turritt": "",
        }
        cats = [
            (["", "", "r1", "A", "", "A", "A", "CK", "M30-39", str(rivals.DNF_TIME)], "Racer"),
            (["", "", "r2", "A", "", "B", "B", "CK", "M30-39", str(rivals.DNF_TIME)], "Racer"),
        ]
        ev = rivals._event(sheet, "dnf1", cats, False)
        _, analysis = rivals.build("r1", [ev], keep=[])
        self.assertEqual(analysis[0]["class_winner"], "DNF")
        self.assertEqual(analysis[0]["behind_class_winner_pct"], "")


class TestSyncCore(unittest.TestCase):
    def test_race_window_guards_empty_and_zero(self):
        self.assertIsNone(sync.race_window({"time": [], "watts": [], "distance": []}, 60))
        self.assertIsNone(sync.race_window({"time": [0, 1, 2], "watts": [200, 200, 200], "distance": [0, 10, 20]}, 0))
        self.assertIsNone(sync.race_window({"time": [0, 1, 2], "watts": [200, 200, 200], "distance": [0, 10, 20]}, -5))
        res = sync.race_window({"time": [0, 1, 2, 3], "watts": [200, 200, 300, 300], "distance": [0, 5, 20, 40]}, 2)
        self.assertIsNotNone(res)
        avg, np_, (s0, s1), metres = res
        self.assertEqual((s0, s1), (2, 4))
        self.assertEqual(avg, 300.0)
        self.assertEqual(metres, 20.0)

    def test_match_guards_zero_time(self):
        acts = [{"id": "1", "type": "Ride", "start_date_local": "2026-05-10T10:00:00", "distance": 50000, "elapsed_time": 3600}]
        race = {"Date": "10.05.26", "Time": "00:00:00", "Distance (km)": "50"}
        best, note = sync.match(race, acts)
        self.assertIsNone(best)
        self.assertIn("no valid race time", note)


class TestBuildAndUpdate(unittest.TestCase):
    def test_build_eq_same_day_dedup_keeps_adjacent_days(self):
        eq_races = [
            {
                "event_id": 100, "stage_id": 1, "name": "Stage 1 2026", "stage": "Stage 1", "group": "",
                "date": "2026-05-10", "class_place": 1, "class_n": 10, "age_class": "M30-39",
                "age_place": 1, "age_n": 5, "time": "01:00:00", "class_winner": "01:00:00",
                "url": "https://live.eqtiming.com/100#result",
            },
            {
                "event_id": 100, "stage_id": 2, "name": "Stage 2 2026", "stage": "Stage 2", "group": "",
                "date": "2026-05-11", "class_place": 2, "class_n": 10, "age_class": "M30-39",
                "age_place": 2, "age_n": 5, "time": "01:05:00", "class_winner": "01:00:00",
                "url": "https://live.eqtiming.com/100#result",
            },
        ]
        rider = {"id": "test", "name": "Test Rider", "eq_id": 123}
        with mock.patch("eqtiming.races", return_value=eq_races), \
             mock.patch("eqtiming.stage_km", return_value=40.0), \
             mock.patch("registry.races", return_value=[]), \
             mock.patch("registry.load", return_value=[]), \
             mock.patch("build.add_power"):
            rows, _ = build.build_rider(rider, log=lambda *_: None)
        self.assertEqual([r["Date"] for r in rows], ["10.05.26", "11.05.26"])

    def test_update_prev_power_keyed_on_date_and_race(self):
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = os.path.join(tmp, "rider.csv")
            prev_rows = [
                {"Date": "10.05.26", "Race": "Morning TT", "Average Power": "310", "Normalized Power": "320",
                 "Average speed (km/h)": "42.0", "intervals.icu activity": "https://intervals.icu/activities/1", "Match note": ""},
                {"Date": "10.05.26", "Race": "Afternoon Crit", "Average Power": "280", "Normalized Power": "305",
                 "Average speed (km/h)": "40.0", "intervals.icu activity": "https://intervals.icu/activities/2", "Match note": ""},
            ]
            with open(csv_path, "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=build.CSV_COLS, extrasaction="ignore")
                w.writeheader()
                w.writerows(prev_rows)
            new_rows = [
                {"Date": "10.05.26", "Race": "Morning TT", "Time": "00:20:00"},
                {"Date": "10.05.26", "Race": "Evening Race", "Time": "01:00:00"},
            ]
            rider = {"id": "test", "name": "Test", "csv": csv_path}
            with mock.patch("build.build_rider", return_value=(new_rows, [])), \
                 mock.patch("update.kermesse_rows", return_value=[]), \
                 mock.patch("update.rider_csv", return_value=csv_path):
                rows, _ = update.run_rider(rider, log=lambda *_: None)
            self.assertEqual(rows[0].get("Average Power"), "310")
            # Ambiguous same-date race must not copy another race's power
            self.assertEqual(rows[1].get("Average Power", ""), "")


class TestPiiAndScrapers(unittest.TestCase):
    def test_eqtiming_is_youth(self):
        for cls in ("G6-9", "J6-9", "M10", "K10", "M11-12", "K11-12", "M13-14", "M15-16", "Menn 15-16",
                    "Aktiv menn 10", "Aktiv kvinner 15-16", "Trim (barn)"):
            self.assertTrue(eqtiming.is_youth(cls), f"expected youth: {cls}")
        for cls in ("M17+", "K17-19", "M 17-19", "M20-24", "K30-39", "M Senior", "K Junior", "Trim kl. 10.00"):
            self.assertFalse(eqtiming.is_youth(cls), f"expected adult: {cls}")

    def test_eqtiming_total_drops_dns_and_youth(self):
        fake_items = [
            {"StatusTekst": "TIME", "AkkumulertTid": 3600000, "Deltaker": {
                "Utover": {"UID": 1, "NavnFormatert": "Adult One"}, "Klasse": {"Navn": "M30-34"}, "Pulje": {"Navn": "P1"}}},
            {"StatusTekst": "DNS", "AkkumulertTid": 0, "Deltaker": {
                "Utover": {"UID": 2, "NavnFormatert": "Dns Two"}, "Klasse": {"Navn": "M30-34"}, "Pulje": {"Navn": "P1"}}},
            {"StatusTekst": "TIME", "AkkumulertTid": 1800000, "Deltaker": {
                "Utover": {"UID": 3, "NavnFormatert": "Kid Three"}, "Klasse": {"Navn": "J6-9"}, "Pulje": {"Navn": "P1"}}},
        ]
        fake_cache = {}
        with mock.patch.object(eqtiming, "_cache", fake_cache), \
             mock.patch.object(eqtiming, "stage_laps", return_value={"1": 0}), \
             mock.patch.object(eqtiming, "_get", return_value={"Items": fake_items}), \
             mock.patch.object(eqtiming, "_save"):
            eqtiming._total(999999, 1)
        self.assertEqual(len(fake_cache["named:999999:1"]), 1)
        self.assertEqual(fake_cache["named:999999:1"][0][0], 1)
        self.assertEqual(len(fake_cache["results:999999:1"]), 1)

    def test_birken_stores_bucket_only_and_rejects_duplicate_names(self):
        fake_cache = {
            "list:9999": [
                ["1", "Ola Nordmann", "CK A", "M30", "3:00:00", "rid1"],
                ["2", "Ola Nordmann", "CK B", "M40", "3:10:00", "rid2"],
                ["3", "Kari Hansen", "CK C", "K30", "3:20:00", "rid3"],
            ],
        }
        with mock.patch.object(birken, "_cache", fake_cache), \
             mock.patch.object(birken, "_get", return_value=json.dumps([{"Alder": 37}])), \
             mock.patch.object(birken, "_save"):
            bucket = birken.uci_for("rid3", "K30", 2026)
            self.assertEqual(bucket, "K35-39")
            self.assertEqual(fake_cache.get("uci:rid3"), "K35-39")
            self.assertNotIn("age:rid3", fake_cache)
            # Duplicate name must return [] instead of guessing
            entry = {"event": 9999, "name": "Test Birken 2026", "date": "2026-08-29"}
            self.assertEqual(birken.races(entry, "Ola Nordmann"), [])

    def test_sskcup_fold_matches_raceresult_punctuation(self):
        self.assertEqual(sskcup.fold("SKAILAND, Odd."), raceresult.fold("SKAILAND, Odd."))

    def test_dashboard_handles_dnf_and_uci_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = os.path.join(tmp, "r.csv")
            with open(p, "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=build.CSV_COLS)
                w.writeheader()
                w.writerow({
                    "Race": "GravelBirken 2026", "Date": "29.08.26", "Type": "Gravel",
                    "Placement in class": "", "Class participants (not officials or DNS, DNF included)": "100",
                    "Time": "DNF", "Class winner": "03:00:00",
                    "UCI class": "M35-39", "UCI class placement": "12", "UCI class participants": "80",
                })
            rows = dashboard.rows(p)
            self.assertIsNone(rows[0]["place"])
            self.assertEqual(rows[0]["uci_class"], "M35-39")
            self.assertEqual(rows[0]["uci_place"], 12)
            self.assertEqual(rows[0]["uci_n"], 80)

    def test_turritt_excludes_dns_and_funksjonaer(self):
        self.assertFalse(turritt._counts(["99998", "", "1", "Pulje 1", "", "A", "B", "CK", "M30-39", "359990"]))
        self.assertFalse(turritt._counts(["1", "", "1", "Funksjonærritt", "", "A", "B", "CK", "M30-39", "3600"]))


if __name__ == "__main__":
    unittest.main()
