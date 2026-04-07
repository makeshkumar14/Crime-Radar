import os
import sys
import unittest
from unittest.mock import patch


sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

import patrol_service as ps


def mock_nearest(point):
    return {
        "lat": point["lat"],
        "lng": point["lng"],
        "distance_m": 1.2,
        "name": "Mock Road",
        "request_url": "mock://nearest",
    }


def mock_trip(stops):
    coordinates = [[stop["lng"], stop["lat"]] for stop in stops]
    return {
        "ordered_stops": [
            {
                **stop,
                "trip_order": index,
            }
            for index, stop in enumerate(stops)
        ],
        "geometry": {"type": "LineString", "coordinates": coordinates},
        "route": coordinates,
        "distance_km": 12.4,
        "duration_min": 28.0,
        "request_url": "mock://trip",
        "source": "osrm-trip",
    }


class PatrolServiceTests(unittest.TestCase):
    def test_build_grid_risk_map_boosts_event_affected_cell(self):
        incident_rows = [
            {
                "district": "TEST",
                "taluk_id": "T1",
                "taluk": "North",
                "lat": 13.0000,
                "lng": 80.0000,
                "category": "Accident",
                "severity": "HIGH",
                "year": 2026,
                "month": 4,
                "time_slot": "EVENING",
                "count": 24,
            },
            {
                "district": "TEST",
                "taluk_id": "T2",
                "taluk": "South",
                "lat": 13.0300,
                "lng": 80.0300,
                "category": "Accident",
                "severity": "MEDIUM",
                "year": 2026,
                "month": 4,
                "time_slot": "EVENING",
                "count": 20,
            },
            {
                "district": "TEST",
                "taluk_id": "T3",
                "taluk": "North",
                "lat": 13.0010,
                "lng": 80.0010,
                "category": "Women Safety",
                "severity": "MEDIUM",
                "year": 2026,
                "month": 4,
                "time_slot": "NIGHT",
                "count": 10,
            },
        ]

        payload = ps.build_grid_risk_map(
            incident_rows=incident_rows,
            target_year=2026,
            target_month=4,
            time_band="night",
            weather="rain",
            is_festival=True,
            event_zones=[
                {
                    "name": "Temple Festival",
                    "lat": 13.0005,
                    "lng": 80.0005,
                    "radius_km": 2.0,
                    "priority_boost": 1.25,
                }
            ],
        )

        self.assertGreaterEqual(payload["summary"]["cells_analyzed"], 2)
        top_cell = payload["grid_cells"][0]
        self.assertGreater(top_cell["event_multiplier"], 1.0)
        self.assertIn(top_cell["risk_level"], {"HIGH", "MEDIUM"})

    def test_calculate_required_unit_count_increases_units_when_requested_value_is_too_low(self):
        requirements = ps.calculate_required_unit_count(
            high_risk_grid_count=18,
            requested_unit_count=1,
        )

        self.assertEqual(requirements["minimum_required_units"], 2)
        self.assertGreaterEqual(requirements["actual_unit_count"], 2)

    def test_cluster_high_risk_grids_kmeans_balances_assignments(self):
        high_risk_grids = [
            {
                "grid_id": f"G-{index}",
                "center_lat": 13.0000 + (index * 0.001 if index < 5 else 0.0400 + (index - 5) * 0.001),
                "center_lng": 80.0000 + (index * 0.001 if index < 5 else 0.0400 + (index - 5) * 0.001),
                "risk_score": 85 - index,
                "risk_level": "HIGH",
                "incident_weight": 10 + index,
                "accident_count": 3,
                "crime_count": 2,
                "dominant_category": "Accident",
                "categories": {"ACCIDENT": 3},
            }
            for index in range(10)
        ]

        clusters = ps.cluster_high_risk_grids_kmeans(high_risk_grids, unit_count=2)

        self.assertEqual(len(clusters), 2)
        self.assertEqual(sum(cluster["grid_count"] for cluster in clusters), 10)
        self.assertLessEqual(abs(clusters[0]["grid_count"] - clusters[1]["grid_count"]), 1)

    def test_generate_patrol_plan_uses_balanced_clusters_and_road_routes(self):
        incidents = [
            {
                "district": "TEST",
                "taluk_id": "T1",
                "taluk": "North",
                "lat": 13.0000,
                "lng": 80.0000,
                "category": "Accident",
                "severity": "HIGH",
                "year": 2026,
                "month": 4,
                "time_slot": "EVENING",
                "count": 30,
            },
            {
                "district": "TEST",
                "taluk_id": "T2",
                "taluk": "North",
                "lat": 13.0040,
                "lng": 80.0040,
                "category": "Public Order",
                "severity": "MEDIUM",
                "year": 2026,
                "month": 4,
                "time_slot": "EVENING",
                "count": 8,
            },
            {
                "district": "TEST",
                "taluk_id": "T3",
                "taluk": "South",
                "lat": 13.0400,
                "lng": 80.0400,
                "category": "Accident",
                "severity": "HIGH",
                "year": 2026,
                "month": 4,
                "time_slot": "MORNING",
                "count": 28,
            },
            {
                "district": "TEST",
                "taluk_id": "T4",
                "taluk": "South",
                "lat": 13.0430,
                "lng": 80.0430,
                "category": "Women Safety",
                "severity": "MEDIUM",
                "year": 2026,
                "month": 4,
                "time_slot": "NIGHT",
                "count": 9,
            },
            {
                "district": "TEST",
                "taluk_id": "T5",
                "taluk": "West",
                "lat": 13.0800,
                "lng": 80.0800,
                "category": "Accident",
                "severity": "HIGH",
                "year": 2026,
                "month": 4,
                "time_slot": "EVENING",
                "count": 26,
            },
            {
                "district": "TEST",
                "taluk_id": "T6",
                "taluk": "West",
                "lat": 13.0830,
                "lng": 80.0830,
                "category": "Public Order",
                "severity": "MEDIUM",
                "year": 2026,
                "month": 4,
                "time_slot": "EVENING",
                "count": 7,
            },
        ]
        stations = [
            {"station_id": "S1", "station_name": "North Station", "lat": 12.9995, "lng": 79.9995, "coverage_priority": 2},
            {"station_id": "S2", "station_name": "South Station", "lat": 13.0410, "lng": 80.0410, "coverage_priority": 2},
            {"station_id": "S3", "station_name": "West Station", "lat": 13.0810, "lng": 80.0810, "coverage_priority": 2},
        ]

        with patch.object(ps, "load_incident_rows", return_value=incidents), patch.object(
            ps,
            "load_station_rows",
            return_value=stations,
        ), patch.object(ps, "request_osrm_nearest", side_effect=mock_nearest), patch.object(
            ps,
            "request_osrm_trip",
            side_effect=mock_trip,
        ):
            payload = ps.generate_patrol_plan(
                district="TEST",
                target_year=2026,
                target_month=4,
                unit_count=1,
            )

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["strategy_used"], "KMEANS + OSRM_TRIP")
        self.assertGreaterEqual(payload["unit_requirements"]["actual_unit_count"], 1)
        self.assertEqual(payload["coverage"]["high_risk_grids_uncovered"], 0)
        self.assertEqual(len(payload["patrol_units"]), payload["unit_requirements"]["actual_unit_count"])
        covered_ids = []
        for unit in payload["patrol_units"]:
            self.assertGreaterEqual(unit["zones_covered"], 1)
            self.assertEqual(unit["optimization_source"], "OSRM_TRIP")
            self.assertEqual(unit["routing_source"], "osrm-trip")
            covered_ids.extend(
                stop["grid_id"]
                for stop in unit["stops"]
                if stop["stop_type"] == "grid"
            )
            self.assertEqual(unit["route"][0], unit["route"][-1])

        self.assertEqual(len(covered_ids), len(set(covered_ids)))


if __name__ == "__main__":
    unittest.main()
