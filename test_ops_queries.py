import os
import sqlite3
import sys
import unittest
from unittest.mock import patch


sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

import ops_queries


def _build_test_connection():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute(
        """
        CREATE TABLE districts (
            district TEXT,
            lat REAL,
            lng REAL,
            taluk_count INTEGER,
            station_count INTEGER,
            profile TEXT
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE taluks (
            taluk_id TEXT,
            district TEXT,
            taluk TEXT,
            lat REAL,
            lng REAL,
            radius_km REAL,
            primary_station_id TEXT
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE police_stations (
            station_id TEXT,
            station_name TEXT,
            district TEXT,
            taluk TEXT,
            lat REAL,
            lng REAL,
            source_type TEXT,
            coverage_priority INTEGER
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE fir_records (
            district TEXT,
            taluk_id TEXT,
            taluk TEXT,
            station_id TEXT,
            station_name TEXT,
            category TEXT,
            count INTEGER,
            year INTEGER
        )
        """
    )

    cursor.executemany(
        "INSERT INTO districts VALUES (?, ?, ?, ?, ?, ?)",
        [
            ("TESTDIST", 11.0, 79.0, 2, 2, "test-profile"),
        ],
    )
    cursor.executemany(
        "INSERT INTO taluks VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            ("TLK-1", "TESTDIST", "Alpha", 11.1, 79.1, 5.2, "ST-1"),
            ("TLK-2", "TESTDIST", "Beta", 11.2, 79.2, 5.0, "ST-2"),
        ],
    )
    cursor.executemany(
        "INSERT INTO police_stations VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            ("ST-1", "Alpha PS", "TESTDIST", "Alpha", 11.1, 79.1, "seeded", 1),
            ("ST-2", "Beta PS", "TESTDIST", "Beta", 11.2, 79.2, "seeded", 1),
        ],
    )
    cursor.executemany(
        "INSERT INTO fir_records VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            ("TESTDIST", "TLK-1", "Alpha", "ST-1", "Alpha PS", "Women Safety", 7, 2026),
            ("TESTDIST", "TLK-1", "Alpha", "ST-1", "Alpha PS", "Accident", 3, 2026),
            ("TESTDIST", "TLK-2", "Beta", "ST-2", "Beta PS", "Accident", 5, 2026),
        ],
    )
    conn.commit()
    return conn


def _build_dense_chennai_connection(taluk_count=12):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute(
        """
        CREATE TABLE districts (
            district TEXT,
            lat REAL,
            lng REAL,
            taluk_count INTEGER,
            station_count INTEGER,
            profile TEXT
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE taluks (
            taluk_id TEXT,
            district TEXT,
            taluk TEXT,
            lat REAL,
            lng REAL,
            radius_km REAL,
            primary_station_id TEXT
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE police_stations (
            station_id TEXT,
            station_name TEXT,
            district TEXT,
            taluk TEXT,
            lat REAL,
            lng REAL,
            source_type TEXT,
            coverage_priority INTEGER
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE fir_records (
            district TEXT,
            taluk_id TEXT,
            taluk TEXT,
            station_id TEXT,
            station_name TEXT,
            category TEXT,
            count INTEGER,
            year INTEGER
        )
        """
    )

    cursor.execute(
        "INSERT INTO districts VALUES (?, ?, ?, ?, ?, ?)",
        ("CHENNAI", 13.0827, 80.2707, taluk_count, taluk_count, "metro"),
    )

    taluk_rows = []
    station_rows = []
    fir_rows = []
    for index in range(taluk_count):
        taluk_id = f"TLK-CHE-{index + 1:03d}"
        station_id = f"ST-CHE-{index + 1:03d}"
        taluk_name = f"Zone {index + 1:02d}"
        lat = 13.0 + (index * 0.01)
        lng = 80.18 + (index * 0.01)
        taluk_rows.append((taluk_id, "CHENNAI", taluk_name, lat, lng, 4.8, station_id))
        station_rows.append((station_id, f"{taluk_name} PS", "CHENNAI", taluk_name, lat, lng, "seeded", 1))
        fir_rows.extend(
            [
                ("CHENNAI", taluk_id, taluk_name, station_id, f"{taluk_name} PS", "Property", 80 - index, 2026),
                ("CHENNAI", taluk_id, taluk_name, station_id, f"{taluk_name} PS", "Women Safety", 30 - (index // 2), 2026),
                ("CHENNAI", taluk_id, taluk_name, station_id, f"{taluk_name} PS", "Accident", 24 - (index // 2), 2026),
            ]
        )

    cursor.executemany("INSERT INTO taluks VALUES (?, ?, ?, ?, ?, ?, ?)", taluk_rows)
    cursor.executemany("INSERT INTO police_stations VALUES (?, ?, ?, ?, ?, ?, ?, ?)", station_rows)
    cursor.executemany("INSERT INTO fir_records VALUES (?, ?, ?, ?, ?, ?, ?, ?)", fir_rows)
    conn.commit()
    return conn


class OpsQueriesTests(unittest.TestCase):
    def test_select_balanced_zones_balances_statewide_risk_mix(self):
        zones = []
        for index in range(12):
            zones.append(
                {
                    "taluk_id": f"H-{index}",
                    "district": "TESTDIST",
                    "taluk": f"High {index}",
                    "total": 120 - index,
                    "risk_level": "HIGH",
                }
            )
        for index in range(8):
            zones.append(
                {
                    "taluk_id": f"M-{index}",
                    "district": "TESTDIST",
                    "taluk": f"Medium {index}",
                    "total": 55 - index,
                    "risk_level": "MEDIUM",
                }
            )
        for index in range(8):
            zones.append(
                {
                    "taluk_id": f"L-{index}",
                    "district": "TESTDIST",
                    "taluk": f"Low {index}",
                    "total": 20 - index,
                    "risk_level": "LOW",
                }
            )

        selected = ops_queries._select_balanced_zones(
            zones,
            limit=12,
            metric_key="total",
            risk_key="risk_level",
            balanced=True,
        )
        selected_levels = {zone["risk_level"] for zone in selected}

        self.assertEqual(len(selected), 12)
        self.assertIn("HIGH", selected_levels)
        self.assertIn("MEDIUM", selected_levels)
        self.assertIn("LOW", selected_levels)

    def test_select_balanced_zones_balances_women_safety_mix(self):
        zones = []
        for index in range(10):
            zones.append(
                {
                    "taluk_id": f"WH-{index}",
                    "district": "TESTDIST",
                    "taluk": f"Women High {index}",
                    "women_safety_total": 48 - index,
                    "women_safety_risk_level": "HIGH",
                }
            )
        for index in range(8):
            zones.append(
                {
                    "taluk_id": f"WM-{index}",
                    "district": "TESTDIST",
                    "taluk": f"Women Medium {index}",
                    "women_safety_total": 24 - index,
                    "women_safety_risk_level": "MEDIUM",
                }
            )
        for index in range(8):
            zones.append(
                {
                    "taluk_id": f"WL-{index}",
                    "district": "TESTDIST",
                    "taluk": f"Women Low {index}",
                    "women_safety_total": 9 - index,
                    "women_safety_risk_level": "LOW",
                }
            )

        selected = ops_queries._select_balanced_zones(
            zones,
            limit=12,
            metric_key="women_safety_total",
            risk_key="women_safety_risk_level",
            balanced=True,
        )
        selected_levels = {zone["women_safety_risk_level"] for zone in selected}

        self.assertEqual(len(selected), 12)
        self.assertIn("HIGH", selected_levels)
        self.assertIn("MEDIUM", selected_levels)
        self.assertIn("LOW", selected_levels)

    def test_load_map_layers_hides_unreported_taluks_for_filtered_category(self):
        connection = _build_test_connection()
        try:
            with patch.object(ops_queries, "get_connection", return_value=connection), patch.object(
                ops_queries,
                "patrol_ml_prediction",
                return_value={"route_points": [], "risk_level": "LOW", "summary": {}},
            ):
                layers = ops_queries.load_map_layers(
                    year=2026,
                    district="TESTDIST",
                    category="Women Safety",
                )
        finally:
            connection.close()

        self.assertEqual(layers["summary"]["taluks"], 1)
        self.assertEqual(layers["summary"]["stations"], 1)
        self.assertEqual([zone["taluk"] for zone in layers["zones"]], ["Alpha"])
        self.assertEqual([station["station_name"] for station in layers["stations"]], ["Alpha PS"])
        self.assertEqual([hotspot["zone_name"] for hotspot in layers["hotspots"]], ["Alpha"])

    def test_load_map_layers_caps_dense_chennai_display_layers(self):
        connection = _build_dense_chennai_connection()
        try:
            with patch.object(ops_queries, "get_connection", return_value=connection), patch.object(
                ops_queries,
                "patrol_ml_prediction",
                return_value={"route_points": [], "risk_level": "LOW", "summary": {}},
            ):
                layers = ops_queries.load_map_layers(district="CHENNAI")
        finally:
            connection.close()

        self.assertEqual(layers["summary"]["taluks"], 10)
        self.assertEqual(layers["summary"]["stations"], 10)
        self.assertEqual(len(layers["zones"]), 10)
        self.assertEqual(len(layers["stations"]), 10)
        self.assertEqual(len(layers["hotspots"]), 10)
        self.assertEqual(len(layers["women_zones"]), 10)
        self.assertEqual(len(layers["accident_zones"]), 10)
        self.assertTrue(all(zone["district"] == "CHENNAI" for zone in layers["zones"]))


if __name__ == "__main__":
    unittest.main()
