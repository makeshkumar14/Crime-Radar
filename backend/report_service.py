import re
from calendar import month_name
from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from chatbot_service import build_operations_context, build_scenario_context

REPORT_DIR = Path(__file__).resolve().parent / "generated_reports"
RISK_PALETTE = {
    "HIGH": {
        "fill": "#EF4444",
        "text": "#FFFFFF",
        "label": "High risk",
    },
    "MEDIUM": {
        "fill": "#F59E0B",
        "text": "#111827",
        "label": "Medium risk",
    },
    "LOW": {
        "fill": "#22C55E",
        "text": "#FFFFFF",
        "label": "Low risk",
    },
}


def _safe_slug(value, fallback="all"):
    text = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    return text or fallback


def _display_filter(value, empty_label):
    if value in (None, "", False):
        return empty_label
    return str(value)


def _report_now():
    return datetime.now().astimezone()


def _report_timestamp_label():
    return _report_now().strftime("%B %d, %Y %I:%M %p %Z")


def _styles():
    styles = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "ReportTitle",
            parent=styles["Title"],
            textColor=colors.HexColor("#7f1d1d"),
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=26,
        ),
        "kicker": ParagraphStyle(
            "ReportKicker",
            parent=styles["Normal"],
            textColor=colors.HexColor("#991b1b"),
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=12,
        ),
        "subtitle": ParagraphStyle(
            "ReportSubtitle",
            parent=styles["Normal"],
            textColor=colors.HexColor("#475569"),
            fontSize=10,
            leading=14,
        ),
        "section": ParagraphStyle(
            "SectionHeading",
            parent=styles["Heading3"],
            textColor=colors.HexColor("#0f172a"),
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=16,
            spaceAfter=8,
        ),
        "body": ParagraphStyle(
            "BodySmall",
            parent=styles["Normal"],
            textColor=colors.HexColor("#334155"),
            fontSize=9.5,
            leading=14,
        ),
    }


def _table(rows, col_widths, header=True, left_band=False):
    table = Table(rows, colWidths=col_widths, repeatRows=1 if header else 0)
    table_style = [
        ("GRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("LEADING", (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]
    if header:
        table_style.extend(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#7f1d1d")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ]
        )
    if left_band:
        start_row = 0 if not header else 1
        table_style.extend(
            [
                ("BACKGROUND", (0, start_row), (0, -1), colors.HexColor("#f8fafc")),
                ("FONTNAME", (0, start_row), (0, -1), "Helvetica-Bold"),
            ]
        )
    table.setStyle(TableStyle(table_style))
    return table


def _risk_palette(level):
    return RISK_PALETTE.get(str(level or "").upper())


def _apply_risk_column_style(table, rows, risk_column, header=True):
    start_row = 1 if header else 0
    commands = []
    for row_index in range(start_row, len(rows)):
        palette = _risk_palette(rows[row_index][risk_column])
        if not palette:
            continue
        commands.extend(
            [
                ("BACKGROUND", (risk_column, row_index), (risk_column, row_index), colors.HexColor(palette["fill"])),
                ("TEXTCOLOR", (risk_column, row_index), (risk_column, row_index), colors.HexColor(palette["text"])),
                ("FONTNAME", (risk_column, row_index), (risk_column, row_index), "Helvetica-Bold"),
                ("ALIGN", (risk_column, row_index), (risk_column, row_index), "CENTER"),
            ]
        )
    if commands:
        table.setStyle(TableStyle(commands))
    return table


def _append_risk_legend(story, styles):
    story.append(Paragraph("Risk Color Legend", styles["section"]))
    legend_rows = [
        ["HIGH", "MEDIUM", "LOW"],
        [
            "Red circles on the map and PDF",
            "Yellow circles on the map and PDF",
            "Green circles on the map and PDF",
        ],
    ]
    legend = Table(legend_rows, colWidths=[173, 173, 174])
    legend.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#cbd5e1")),
                ("BACKGROUND", (0, 0), (0, 0), colors.HexColor(RISK_PALETTE["HIGH"]["fill"])),
                ("BACKGROUND", (1, 0), (1, 0), colors.HexColor(RISK_PALETTE["MEDIUM"]["fill"])),
                ("BACKGROUND", (2, 0), (2, 0), colors.HexColor(RISK_PALETTE["LOW"]["fill"])),
                ("TEXTCOLOR", (0, 0), (0, 0), colors.HexColor(RISK_PALETTE["HIGH"]["text"])),
                ("TEXTCOLOR", (1, 0), (1, 0), colors.HexColor(RISK_PALETTE["MEDIUM"]["text"])),
                ("TEXTCOLOR", (2, 0), (2, 0), colors.HexColor(RISK_PALETTE["LOW"]["text"])),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ALIGN", (0, 0), (-1, 0), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("LEADING", (0, 0), (-1, -1), 12),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(legend)
    story.append(Spacer(1, 14))


def _base_story(title, subtitle, context_note):
    styles = _styles()
    return styles, [
        Paragraph("CRIMERADAR REPORT", styles["kicker"]),
        Spacer(1, 4),
        Paragraph(title, styles["title"]),
        Spacer(1, 6),
        Paragraph(subtitle, styles["subtitle"]),
        Spacer(1, 6),
        Paragraph(context_note, styles["subtitle"]),
        Spacer(1, 16),
    ]


def build_operations_report_pdf(filters=None, output_dir=None):
    context = build_operations_context(filters or {})
    summary = context.get("summary", {})
    filters = context.get("filters", {})
    top_categories = context.get("top_categories") or []
    top_districts = context.get("top_districts") or []
    top_taluks = context.get("top_taluks") or []
    top_hotspots = context.get("top_hotspots") or []
    patrol_routes = context.get("patrol_routes") or []

    timestamp = _report_timestamp_label()
    report_dir = Path(output_dir) if output_dir else REPORT_DIR
    report_dir.mkdir(parents=True, exist_ok=True)
    filename = (
        f"operations_report_"
        f"{_safe_slug(filters.get('district'), 'statewide')}_"
        f"{_safe_slug(filters.get('category'), 'all-categories')}_"
        f"{filters.get('year') or 'all-years'}.pdf"
    )
    path = report_dir / filename

    styles, story = _base_story(
        "Operations Situation Report",
        "Operational summary generated from the current map filters.",
        f"Downloaded on {timestamp}",
    )

    story.append(Paragraph("Applied Filters", styles["section"]))
    story.append(
        _table(
            [
                ["Filter", "Value"],
                ["Year", _display_filter(filters.get("year"), "All years")],
                ["District", _display_filter(filters.get("district"), "All districts")],
                ["Category", _display_filter(filters.get("category"), "All categories")],
                ["Grounding Scope", context.get("view_label") or "Operations"],
            ],
            [170, 350],
            left_band=True,
        )
    )
    story.append(Spacer(1, 14))

    story.append(Paragraph("Current Load Summary", styles["section"]))
    story.append(
        _table(
            [
                ["Metric", "Value"],
                ["Districts in scope", str(summary.get("districts", 0))],
                ["Taluks in scope", str(summary.get("taluks", 0))],
                ["Stations in scope", str(summary.get("stations", 0))],
                ["Total incidents", f"{summary.get('incidents', 0):,}"],
            ],
            [170, 350],
            left_band=True,
        )
    )
    story.append(Spacer(1, 14))

    _append_risk_legend(story, styles)

    if top_categories:
        story.append(Paragraph("Dominant Categories", styles["section"]))
        category_rows = [["Category", "Incidents"]]
        for item in top_categories[:8]:
            category_rows.append([item.get("category") or "Unknown", f"{int(item.get('total_count') or 0):,}"])
        story.append(_table(category_rows, [320, 200]))
        story.append(Spacer(1, 14))

    if top_districts:
        story.append(Paragraph("Districts Requiring Attention", styles["section"]))
        district_rows = [["District", "Incidents", "Risk Level", "Risk Score"]]
        for item in top_districts[:6]:
            district_rows.append(
                [
                    item.get("district") or "Unknown",
                    f"{int(item.get('total') or 0):,}",
                    item.get("risk_level") or "N/A",
                    str(item.get("risk_score") or "N/A"),
                ]
            )
        district_table = _table(district_rows, [180, 110, 110, 120])
        story.append(_apply_risk_column_style(district_table, district_rows, 2))
        story.append(Spacer(1, 14))

    if top_taluks:
        story.append(Paragraph("Highest Pressure Taluks", styles["section"]))
        taluk_rows = [["Taluk", "District", "Incidents", "Dominant Category", "Risk"]]
        for item in top_taluks[:8]:
            taluk_rows.append(
                [
                    item.get("taluk") or "Unknown",
                    item.get("district") or "Unknown",
                    f"{int(item.get('total') or 0):,}",
                    item.get("dominant_category") or "N/A",
                    item.get("risk_level") or "N/A",
                ]
            )
        taluk_table = _table(taluk_rows, [110, 115, 75, 135, 75])
        story.append(_apply_risk_column_style(taluk_table, taluk_rows, 4))
        story.append(Spacer(1, 14))

    if top_hotspots:
        story.append(Paragraph("Priority Hotspots", styles["section"]))
        hotspot_rows = [["Zone", "District", "Crime Count", "Top Crime", "Risk"]]
        for item in top_hotspots[:6]:
            hotspot_rows.append(
                [
                    item.get("zone_name") or "Unknown",
                    item.get("district") or "Unknown",
                    f"{int(item.get('crime_count') or 0):,}",
                    item.get("top_crime") or "N/A",
                    item.get("risk_level") or "N/A",
                ]
            )
        hotspot_table = _table(hotspot_rows, [120, 115, 90, 130, 55])
        story.append(_apply_risk_column_style(hotspot_table, hotspot_rows, 4))
        story.append(Spacer(1, 14))

    if patrol_routes:
        story.append(Paragraph("Patrol Route Notes", styles["section"]))
        patrol_rows = [["District", "Route", "Risk", "Summary"]]
        for item in patrol_routes[:4]:
            patrol_rows.append(
                [
                    item.get("district") or "Unknown",
                    item.get("route_name") or "N/A",
                    item.get("risk_level") or "N/A",
                    item.get("summary") or "No summary available",
                ]
            )
        patrol_table = _table(patrol_rows, [75, 115, 55, 275])
        story.append(_apply_risk_column_style(patrol_table, patrol_rows, 2))
        story.append(Spacer(1, 14))

    if not summary.get("incidents"):
        story.append(
            Paragraph(
                "No incidents matched the current operations filters at the time of download.",
                styles["body"],
            )
        )
    else:
        story.append(
            Paragraph(
                "This PDF reflects the same filtered operations grounding used by Radar AI and the live operations map.",
                styles["body"],
            )
        )

    doc = SimpleDocTemplate(str(path), pagesize=A4, topMargin=32, bottomMargin=32)
    doc.build(story)
    return path


def build_scenario_report_pdf(payload=None, output_dir=None):
    payload = payload or {}
    context = build_scenario_context(payload)
    summary = context.get("summary", {})
    top_zones = context.get("top_zones") or []
    notes = context.get("notes") or []
    timestamp = _report_timestamp_label()
    report_dir = Path(output_dir) if output_dir else REPORT_DIR
    report_dir.mkdir(parents=True, exist_ok=True)
    filename = (
        f"{_safe_slug(context.get('scenario'), 'scenario')}_forecast_report_"
        f"{_safe_slug(context.get('district_filter'), 'statewide')}_"
        f"{context.get('target_year') or 'year'}_{context.get('target_month') or 'month'}.pdf"
    )
    path = report_dir / filename

    month_label = month_name[int(context.get("target_month") or 1)]
    styles, story = _base_story(
        f"{context.get('view_label') or 'Scenario'} Report",
        "Forecast report generated from the current prediction controls.",
        f"Downloaded on {timestamp}",
    )

    story.append(Paragraph("Scenario Window", styles["section"]))
    story.append(
        _table(
            [
                ["Field", "Value"],
                ["Scenario", context.get("view_label") or "Scenario"],
                ["District Filter", _display_filter(context.get("district_filter"), "All districts")],
                ["Forecast Window", f"{month_label} {context.get('target_year')}"],
                ["Zone Limit", str(payload.get("limit") or len(top_zones) or 0)],
            ],
            [170, 350],
            left_band=True,
        )
    )
    story.append(Spacer(1, 14))

    story.append(Paragraph("Prediction Summary", styles["section"]))
    story.append(
        _table(
            [
                ["Metric", "Value"],
                ["Zones ranked", str(summary.get("zones", 0))],
                ["Derived incident points", str(summary.get("derived_points", 0))],
                ["Peak district", _display_filter(summary.get("peak_district"), "N/A")],
                ["Peak taluk", _display_filter(summary.get("peak_zone"), "N/A")],
                ["Peak forecast", str(summary.get("peak_prediction") or 0)],
            ],
            [170, 350],
            left_band=True,
        )
    )
    story.append(Spacer(1, 14))

    _append_risk_legend(story, styles)

    if top_zones:
        story.append(Paragraph("Top Forecast Zones", styles["section"]))
        zone_rows = [["#", "Taluk", "District", "Predicted", "Index", "Risk", "Top Category"]]
        for item in top_zones[:10]:
            zone_rows.append(
                [
                    str(item.get("rank") or "-"),
                    item.get("taluk") or "Unknown",
                    item.get("district") or "Unknown",
                    str(item.get("predicted_count") or 0),
                    str(item.get("prediction_index") or 0),
                    item.get("risk_level") or "N/A",
                    item.get("predicted_top_category") or "N/A",
                ]
            )
        zone_table = _table(zone_rows, [24, 86, 95, 60, 48, 50, 145])
        story.append(_apply_risk_column_style(zone_table, zone_rows, 5))
        story.append(Spacer(1, 14))
    else:
        story.append(
            Paragraph(
                "No forecast zones matched the current district and time filters.",
                styles["body"],
            )
        )
        story.append(Spacer(1, 14))

    if notes:
        story.append(Paragraph("Operational Notes", styles["section"]))
        for note in notes:
            story.append(Paragraph(f"- {note}", styles["body"]))
            story.append(Spacer(1, 4))

    doc = SimpleDocTemplate(str(path), pagesize=A4, topMargin=32, bottomMargin=32)
    doc.build(story)
    return path
