import os
import sys
import unittest
from unittest.mock import patch


sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

import insights_service as ins


class InsightsServiceTests(unittest.TestCase):
    def test_parse_natural_language_filters_detects_accident_view(self):
        with patch.object(
            ins,
            "_available_filter_metadata",
            return_value={
                "districts": ["CHENNAI", "MADURAI"],
                "categories": ["Accident", "Women Safety", "Property"],
                "years": [2024, 2025, 2026],
            },
        ):
            parsed = ins.parse_natural_language_filters(
                "show 2026 accident risk in Chennai",
            )

        self.assertEqual(parsed["active_view"], "accident-zones")
        self.assertEqual(parsed["filters"]["district"], "CHENNAI")
        self.assertEqual(parsed["filters"]["year"], 2026)

    def test_build_fir_impact_summary_compares_before_and_after_rankings(self):
        summary = ins.build_fir_impact_summary(
            {
                "district": "CHENNAI",
                "taluk_id": "TLK-1",
                "taluk": "T Nagar",
                "category": "Women Safety",
                "count": 4,
            },
            before_layers={
                "districts": [
                    {"district": "CHENNAI", "total": 100, "risk_level": "MEDIUM"},
                    {"district": "MADURAI", "total": 80, "risk_level": "LOW"},
                ],
                "zones": [
                    {"taluk_id": "TLK-2", "taluk": "Alpha", "total": 60, "risk_level": "HIGH"},
                    {"taluk_id": "TLK-1", "taluk": "T Nagar", "total": 40, "risk_level": "MEDIUM"},
                ],
            },
            after_layers={
                "districts": [
                    {"district": "CHENNAI", "total": 104, "risk_level": "HIGH"},
                    {"district": "MADURAI", "total": 80, "risk_level": "LOW"},
                ],
                "zones": [
                    {"taluk_id": "TLK-1", "taluk": "T Nagar", "total": 44, "risk_level": "HIGH"},
                    {"taluk_id": "TLK-2", "taluk": "Alpha", "total": 60, "risk_level": "HIGH"},
                ],
            },
        )

        self.assertEqual(summary["district_delta"], 4)
        self.assertEqual(summary["taluk_delta"], 4)
        self.assertEqual(summary["taluk_rank_before"], 2)
        self.assertEqual(summary["taluk_rank_after"], 1)

    def test_build_district_compare_uses_higher_metric_districts(self):
        with patch.object(
            ins,
            "build_district_profile",
            side_effect=[
                {
                    "district": "CHENNAI",
                    "incident_total": 250,
                    "risk_score": 81,
                    "women_safety_peak": {"predicted_count": 22},
                    "accident_peak": {"predicted_count": 18},
                },
                {
                    "district": "MADURAI",
                    "incident_total": 210,
                    "risk_score": 73,
                    "women_safety_peak": {"predicted_count": 16},
                    "accident_peak": {"predicted_count": 21},
                },
            ],
        ):
            comparison = ins.build_district_compare("CHENNAI", "MADURAI")

        self.assertEqual(comparison["comparison"]["higher_live_load"], "CHENNAI")
        self.assertEqual(comparison["comparison"]["higher_risk"], "CHENNAI")
        self.assertEqual(comparison["comparison"]["higher_women_safety_pressure"], "CHENNAI")
        self.assertEqual(comparison["comparison"]["higher_accident_pressure"], "MADURAI")


if __name__ == "__main__":
    unittest.main()
