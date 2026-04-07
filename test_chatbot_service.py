import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

import chatbot_service as cs


class ChatbotServiceTests(unittest.TestCase):
    def test_load_local_env_fills_blank_runtime_value(self):
        original_value = os.environ.get("GEMINI_API_KEY")
        try:
            os.environ["GEMINI_API_KEY"] = ""
            env_path = Path("mock-dotenv")
            with patch.object(Path, "exists", return_value=True), patch.object(
                Path,
                "read_text",
                return_value="GEMINI_API_KEY=test-key-from-dotenv\nGEMINI_MODEL=gemini-2.5-flash\n",
            ):
                cs.load_local_env([env_path])

            self.assertEqual(os.environ.get("GEMINI_API_KEY"), "test-key-from-dotenv")
        finally:
            if original_value is None:
                os.environ.pop("GEMINI_API_KEY", None)
            else:
                os.environ["GEMINI_API_KEY"] = original_value

    def test_answer_chat_message_returns_local_operations_summary_for_prompt(self):
        with patch.object(
            cs,
            "build_operations_context",
            return_value={
                "status": "ok",
                "view_label": "Operations",
                "filters": {"year": 2026, "district": "CHENNAI", "category": None},
                "summary": {"districts": 1, "taluks": 3, "stations": 7, "incidents": 310},
                "focus_district": {
                    "district": "CHENNAI",
                    "total": 310,
                    "risk_level": "HIGH",
                },
                "top_categories": [{"category": "Women Safety", "total_count": 124}],
                "top_districts": [
                    {"district": "CHENNAI", "total": 310, "risk_level": "HIGH"}
                ],
                "top_taluks": [
                    {
                        "taluk": "T Nagar",
                        "district": "CHENNAI",
                        "total": 128,
                        "risk_level": "HIGH",
                        "dominant_category": "Women Safety",
                    }
                ],
                "top_hotspots": [],
                "top_stations": [],
                "patrol_routes": [],
            },
        ), patch.object(cs, "request_gemini_response") as request_gemini_response:
            response = cs.answer_chat_message(
                message="Summarize the current operations picture from these filters.",
                history=[],
                context_payload={"active_view": "map", "filters": {"district": "CHENNAI"}},
            )

        self.assertEqual(response["status"], "ok")
        self.assertEqual(response["source"], "local")
        self.assertIn("filtered to year 2026 and CHENNAI", response["answer"])
        self.assertIn("T Nagar, CHENNAI", response["answer"])
        request_gemini_response.assert_not_called()

    def test_answer_chat_message_returns_local_attention_answer_for_prompt(self):
        with patch.object(
            cs,
            "build_operations_context",
            return_value={
                "status": "ok",
                "view_label": "Operations",
                "filters": {"year": 2026, "district": None, "category": None},
                "summary": {"districts": 3, "taluks": 8, "stations": 15, "incidents": 890},
                "focus_district": None,
                "top_categories": [],
                "top_districts": [
                    {"district": "CHENNAI", "total": 320, "risk_level": "HIGH"},
                    {"district": "MADURAI", "total": 280, "risk_level": "HIGH"},
                    {"district": "COIMBATORE", "total": 190, "risk_level": "MEDIUM"},
                ],
                "top_taluks": [
                    {
                        "taluk": "T Nagar",
                        "district": "CHENNAI",
                        "total": 140,
                        "risk_level": "HIGH",
                    },
                    {
                        "taluk": "Madurai South",
                        "district": "MADURAI",
                        "total": 126,
                        "risk_level": "HIGH",
                    },
                ],
                "top_hotspots": [],
                "top_stations": [],
                "patrol_routes": [],
            },
        ), patch.object(cs, "request_gemini_response") as request_gemini_response:
            response = cs.answer_chat_message(
                message="Which districts and taluks need the most attention right now?",
                history=[],
                context_payload={"active_view": "map", "filters": {}},
            )

        self.assertEqual(response["source"], "local")
        self.assertIn("Districts needing the most attention right now are", response["answer"])
        self.assertIn("Top taluks needing attention are", response["answer"])
        request_gemini_response.assert_not_called()

    def test_answer_chat_message_returns_local_category_answer_for_prompt(self):
        with patch.object(
            cs,
            "build_operations_context",
            return_value={
                "status": "ok",
                "view_label": "Operations",
                "filters": {"year": 2026, "district": None, "category": None},
                "summary": {"districts": 3, "taluks": 8, "stations": 15, "incidents": 890},
                "focus_district": None,
                "top_categories": [
                    {"category": "Women Safety", "total_count": 320},
                    {"category": "Accident", "total_count": 260},
                ],
                "top_districts": [],
                "top_taluks": [],
                "top_hotspots": [],
                "top_stations": [],
                "patrol_routes": [],
            },
        ), patch.object(cs, "request_gemini_response") as request_gemini_response:
            response = cs.answer_chat_message(
                message="What category is dominating in the current operations view?",
                history=[],
                context_payload={"active_view": "map", "filters": {}},
            )

        self.assertEqual(response["source"], "local")
        self.assertIn("Women Safety is dominating", response["answer"])
        self.assertIn("The next largest category is Accident", response["answer"])
        request_gemini_response.assert_not_called()

    def test_build_operations_context_respects_filters(self):
        context = cs.build_operations_context({"district": "CHENNAI", "year": 2026})

        self.assertEqual(context["status"], "ok")
        self.assertEqual(context["filters"]["district"], "CHENNAI")
        self.assertEqual(context["filters"]["year"], 2026)
        self.assertIn("summary", context)
        if context["focus_district"]:
            self.assertEqual(context["focus_district"]["district"], "CHENNAI")

    def test_build_scenario_context_returns_ranked_zones(self):
        context = cs.build_scenario_context(
            {
                "scenario": "women_safety",
                "year": 2026,
                "month": 4,
                "limit": 5,
            }
        )

        self.assertEqual(context["status"], "ok")
        self.assertEqual(context["scenario"], "women_safety")
        self.assertLessEqual(len(context["top_zones"]), 5)
        self.assertEqual(context["target_year"], 2026)
        self.assertEqual(context["target_month"], 4)

    def test_build_travel_context_requires_generated_result(self):
        context = cs.build_travel_context(
            {
                "origin_taluk_id": "TLK-CHENNAI-001",
                "destination_taluk_id": "TLK-CHENNAI-002",
                "has_result": False,
            }
        )

        self.assertEqual(context["status"], "unavailable")
        self.assertIn("Generate a route", context["message"])

    def test_build_travel_context_trims_route_payload(self):
        with patch.object(
            cs,
            "build_navigation_from_taluks",
            return_value={
                "status": "ok",
                "target_year": 2026,
                "target_month": 4,
                "origin_query": "Origin Taluk, Chennai, Tamil Nadu, India",
                "destination_query": "Destination Taluk, Chennai, Tamil Nadu, India",
                "recommendation": "Use the safer route.",
                "route_diverges": True,
                "route_overlap_ratio": 0.54,
                "risk_reduction": 18.2,
                "distance_delta_km": 3.1,
                "duration_delta_min": 6.2,
                "comparison": {"zones_avoided": 2, "selection_profile": "strict_safe_balanced"},
                "fastest_route": {"distance_km": 18.4, "eta_min": 31.0},
                "safer_route": {"distance_km": 21.5, "eta_min": 37.2},
                "alerts": [
                    {
                        "taluk": "Risk Taluk",
                        "district": "Chennai",
                        "predicted_accident": 11.0,
                        "min_distance_km": 0.22,
                        "strict_buffer_m": 350.0,
                    }
                ],
                "accident_zones": [
                    {
                        "taluk": "Risk Taluk",
                        "district": "Chennai",
                        "predicted_accident": 11.0,
                        "crossed_by_fastest": True,
                        "crossed_by_safer": False,
                        "avoided_by_safer": True,
                    }
                ],
            },
        ):
            context = cs.build_travel_context(
                {
                    "origin_taluk_id": "TLK-CHENNAI-001",
                    "destination_taluk_id": "TLK-CHENNAI-002",
                    "has_result": True,
                    "year": 2026,
                    "month": 4,
                }
            )

        self.assertEqual(context["status"], "ok")
        self.assertEqual(context["comparison"]["zones_avoided"], 2)
        self.assertEqual(context["alerts"][0]["taluk"], "Risk Taluk")
        self.assertTrue(context["accident_zones"][0]["avoided_by_safer"])

    def test_answer_chat_message_falls_back_when_gemini_is_unavailable(self):
        with patch.object(cs, "request_gemini_response", side_effect=RuntimeError("Missing GEMINI_API_KEY")):
            response = cs.answer_chat_message(
                message="Give me a leadership briefing for this operations view.",
                history=[],
                context_payload={"active_view": "map", "filters": {"district": "CHENNAI"}},
            )

        self.assertEqual(response["status"], "ok")
        self.assertEqual(response["source"], "fallback")
        self.assertIn("Operations summary", response["answer"])


if __name__ == "__main__":
    unittest.main()
