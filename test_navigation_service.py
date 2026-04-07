import os
import sys
import unittest
from unittest.mock import patch


sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

import navigation_service as ns


def build_mock_candidate(request_points, source_label):
    route = [{"lat": point["lat"], "lng": point["lng"]} for point in request_points]
    distance_km = 0.0
    for index in range(len(route) - 1):
        distance_km += ns.haversine_km(
            route[index]["lat"],
            route[index]["lng"],
            route[index + 1]["lat"],
            route[index + 1]["lng"],
        )
    distance_km = ns.round_value(distance_km, 2)
    duration_min = ns.round_value(distance_km * 1.8, 1)
    return [
        {
            "source": source_label,
            "route": route,
            "geometry": {
                "type": "LineString",
                "coordinates": [[point["lng"], point["lat"]] for point in route],
            },
            "distanceKm": distance_km,
            "distance_km": distance_km,
            "durationMin": duration_min,
            "duration_min": duration_min,
            "weight": distance_km,
            "signature": ns.route_signature(route),
            "request_coordinates": route,
            "request_url": "mock://route",
        }
    ]


class NavigationServiceTests(unittest.TestCase):
    def test_trip_envelope_rejects_far_away_candidate(self):
        origin = {"lat": 12.9272685, "lng": 80.1281511, "radius_km": 5.46}
        destination = {"lat": 12.6888786, "lng": 79.9778257, "radius_km": 6.55}
        baseline_route = [
            {"lat": 12.927148, "lng": 80.128714},
            {"lat": 12.82, "lng": 80.07},
            {"lat": 12.688888, "lng": 79.977762},
        ]
        baseline_offset_km = ns.maximum_route_corridor_offset_km(
            origin,
            destination,
            baseline_route,
        )
        baseline_distance_km = 55.0
        far_candidate = {
            "route": [
                {"lat": 12.927148, "lng": 80.128714},
                {"lat": 11.92, "lng": 79.81},
                {"lat": 12.688888, "lng": 79.977762},
            ],
            "request_coordinates": [
                {"lat": origin["lat"], "lng": origin["lng"]},
                {"lat": 11.92, "lng": 79.81},
                {"lat": destination["lat"], "lng": destination["lng"]},
            ],
        }

        self.assertFalse(
            ns.candidate_within_trip_envelope(
                far_candidate,
                origin,
                destination,
                baseline_offset_km,
                baseline_distance_km,
            )
        )

    def test_compare_mode_builds_distinct_safer_route_when_fastest_crosses_accident_zone(self):
        origin = {"lat": 0.0, "lng": 0.0, "label": "Origin"}
        destination = {"lat": 0.0, "lng": 0.1, "label": "Destination"}
        accident_zone = {
            "zone_id": "zone-1",
            "taluk_id": "zone-1",
            "district": "Test District",
            "taluk": "Test Taluk",
            "lat": 0.0,
            "lng": 0.05,
            "radius_km": 4.0,
            "buffer_radius_m": 350.0,
            "buffer_radius_km": 0.35,
            "warning_radius_m": 900.0,
            "warning_radius_km": 0.9,
            "risk_score": 82.0,
            "risk_level": "HIGH",
            "predicted_total": 40.0,
            "predicted_accident": 18.0,
            "predicted_top_category": "Accident",
            "location_query": "Test Taluk, Test District, Tamil Nadu, India",
        }

        with patch.object(ns, "build_accident_zone_snapshot", return_value=[accident_zone]), patch.object(
            ns,
            "request_osrm_nearest",
            return_value={
                "status": "ok",
                "source": "mock-nearest",
                "request_url": "mock://nearest",
                "input": origin,
                "snapped": origin,
                "snap_distance_m": 0.0,
                "name": "Mock road",
            },
        ), patch.object(
            ns,
            "load_route_place_index",
            return_value=[
                {
                    "taluk_id": "zone-1",
                    "district": "Test District",
                    "taluk": "Test Taluk",
                    "lat": 0.0,
                    "lng": 0.05,
                    "radius_km": 4.0,
                    "label": "Test Taluk, Test District, Tamil Nadu, India",
                }
            ],
        ), patch.object(ns, "request_osrm_candidates") as mock_candidates:
            mock_candidates.side_effect = (
                lambda base_url, request_points, alternatives, source_label: build_mock_candidate(
                    request_points,
                    source_label,
                )
            )

            payload = ns.build_navigation_payload(
                origin,
                destination,
                mode="compare",
                target_year=2026,
                target_month=4,
            )

        self.assertEqual(payload["status"], "ok")
        self.assertGreater(mock_candidates.call_count, 1)
        self.assertEqual(payload["current_path"]["source"], "osrm-fast")
        self.assertGreater(payload["current_path"]["accidentZoneHits"], 0)
        self.assertEqual(payload["safer_path"]["accidentZoneHits"], 0)
        self.assertTrue(payload["route_diverges"])
        self.assertNotEqual(
            payload["current_path"]["signature"],
            payload["safer_path"]["signature"],
        )
        self.assertTrue(payload["safer_path"]["source"].startswith("osrm-detour-"))
        self.assertGreater(payload["comparison"]["zones_avoided"], 0)
        self.assertIn(
            "Test Taluk, Test District, Tamil Nadu, India",
            payload["safer_path"]["maps_waypoint_queries"],
        )

    def test_fast_mode_keeps_current_and_safe_paths_as_distinct_payload_objects(self):
        origin = {"lat": 0.0, "lng": 0.0, "label": "Origin"}
        destination = {"lat": 0.0, "lng": 0.1, "label": "Destination"}

        with patch.object(ns, "build_accident_zone_snapshot", return_value=[]), patch.object(
            ns,
            "request_osrm_nearest",
            return_value={
                "status": "ok",
                "source": "mock-nearest",
                "request_url": "mock://nearest",
                "input": origin,
                "snapped": origin,
                "snap_distance_m": 0.0,
                "name": "Mock road",
            },
        ), patch.object(ns, "request_osrm_candidates") as mock_candidates:
            mock_candidates.side_effect = (
                lambda base_url, request_points, alternatives, source_label: build_mock_candidate(
                    request_points,
                    source_label,
                )
            )

            payload = ns.build_navigation_payload(
                origin,
                destination,
                mode="fast",
                target_year=2026,
                target_month=4,
            )

        self.assertEqual(payload["status"], "ok")
        self.assertIsNot(payload["current_path"], payload["safer_path"])
        self.assertEqual(
            payload["current_path"]["signature"],
            payload["safer_path"]["signature"],
        )
        self.assertEqual(payload["comparison"]["selection_profile"], "fast_only")

    def test_build_navigation_payload_rejects_invalid_month(self):
        with self.assertRaisesRegex(ValueError, "Month must be between 1 and 12"):
            ns.build_navigation_payload(
                {"lat": 0.0, "lng": 0.0},
                {"lat": 0.0, "lng": 0.1},
                target_year=2026,
                target_month=13,
            )

    def test_build_navigation_from_coordinates_rejects_same_origin_and_destination(self):
        with self.assertRaisesRegex(ValueError, "Origin and destination must be different"):
            ns.build_navigation_from_coordinates(
                "80.1281511,12.9272685",
                "80.1281511,12.9272685",
            )


if __name__ == "__main__":
    unittest.main()
