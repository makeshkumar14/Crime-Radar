import os
import sys
import unittest
from pathlib import Path


sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

import report_service as rs


class ReportServiceTests(unittest.TestCase):
    def test_risk_palette_matches_map_colors(self):
        self.assertEqual(rs._risk_palette("HIGH")["fill"], "#EF4444")
        self.assertEqual(rs._risk_palette("MEDIUM")["fill"], "#F59E0B")
        self.assertEqual(rs._risk_palette("LOW")["fill"], "#22C55E")

    def test_build_operations_report_pdf_creates_pdf_file(self):
        output_dir = Path("backend") / "generated_reports"
        path = None
        try:
            path = rs.build_operations_report_pdf(
                {"district": "CHENNAI", "year": 2026},
                output_dir=output_dir,
            )

            self.assertTrue(Path(path).exists())
            self.assertGreater(Path(path).stat().st_size, 0)
            self.assertTrue(Path(path).read_bytes().startswith(b"%PDF"))
        finally:
            if path and Path(path).exists():
                Path(path).unlink()

    def test_build_scenario_report_pdf_creates_pdf_file(self):
        output_dir = Path("backend") / "generated_reports"
        path = None
        try:
            path = rs.build_scenario_report_pdf(
                {
                    "scenario": "women_safety",
                    "district": "CHENNAI",
                    "year": 2026,
                    "month": 4,
                    "limit": 10,
                },
                output_dir=output_dir,
            )

            self.assertTrue(Path(path).exists())
            self.assertGreater(Path(path).stat().st_size, 0)
            self.assertTrue(Path(path).read_bytes().startswith(b"%PDF"))
        finally:
            if path and Path(path).exists():
                Path(path).unlink()


if __name__ == "__main__":
    unittest.main()
