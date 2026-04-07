import json
import os
from datetime import date
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from database import get_connection
from insights_service import build_district_compare
from ml_engine import area_safety_snapshot, scenario_zone_prediction, seasonal_ml_prediction
from navigation_service import build_navigation_from_taluks, normalize_target_period
from ops_queries import load_map_layers


def load_local_env(search_paths=None):
    search_paths = search_paths or [
        Path(__file__).resolve().parent.parent / ".env",
        Path(__file__).resolve().parent / ".env",
    ]
    for path in search_paths:
        if not path.exists():
            continue
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("'\"")
            # Fill missing or blank runtime env vars from the local .env file.
            if key and not os.environ.get(key):
                os.environ[key] = value


load_local_env()

DEFAULT_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
DEFAULT_GEMINI_TIMEOUT_SECONDS = float(os.getenv("GEMINI_TIMEOUT_SECONDS", "20"))
DEFAULT_HISTORY_LIMIT = max(2, min(12, int(os.getenv("CHAT_HISTORY_LIMIT", "8"))))

VIEW_LABELS = {
    "map": "Operations",
    "compare": "District Compare",
    "women-safety": "Women Safety Prediction",
    "accident-zones": "Accident Zone Prediction",
    "travel": "Travel Advisor",
    "relocation": "Relocation Safety",
    "analytics": "Analytics",
}


def _normalize_text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_int(value):
    if value in (None, "", False):
        return None
    return int(value)


def _normalize_message_text(value):
    return " ".join(str(value or "").lower().split())


def _normalize_language(value):
    text = _normalize_message_text(value)
    if text in {"ta", "tamil", "தமிழ்"}:
        return "ta"
    return "en"


def _normalize_filters(filters=None):
    filters = filters or {}
    return {
        "year": _normalize_int(filters.get("year")),
        "district": _normalize_text(filters.get("district")),
        "category": _normalize_text(filters.get("category")),
    }


def _query_category_breakdown(year=None, district=None, category=None, limit=8):
    conn = get_connection()
    cursor = conn.cursor()
    query = """
        SELECT category, SUM(count) AS total_count
        FROM fir_records
        WHERE 1=1
    """
    params = []
    if year:
        query += " AND year = ?"
        params.append(year)
    if district:
        query += " AND district = ?"
        params.append(district)
    if category:
        query += " AND category = ?"
        params.append(category)

    query += """
        GROUP BY category
        ORDER BY total_count DESC, category
        LIMIT ?
    """
    params.append(limit)
    cursor.execute(query, params)
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows


def _query_high_risk_districts(limit=8):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT district,
               SUM(count) AS total_crimes,
               COUNT(DISTINCT category) AS crime_types
        FROM fir_records
        GROUP BY district
        ORDER BY total_crimes DESC, district
        LIMIT ?
        """,
        [limit],
    )
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows


def _trim_zone(zone):
    return {
        "taluk_id": zone.get("taluk_id"),
        "district": zone.get("district"),
        "taluk": zone.get("taluk"),
        "total": zone.get("total"),
        "risk_score": zone.get("risk_score"),
        "risk_level": zone.get("risk_level"),
        "dominant_category": zone.get("dominant_category"),
        "women_safety_total": zone.get("women_safety_total"),
        "accident_total": zone.get("accident_total"),
    }


def _trim_hotspot(hotspot):
    return {
        "district": hotspot.get("district"),
        "zone_name": hotspot.get("zone_name"),
        "risk_level": hotspot.get("risk_level"),
        "risk_score": hotspot.get("risk_score"),
        "crime_count": hotspot.get("crime_count"),
        "top_crime": hotspot.get("top_crime"),
    }


def _trim_station(station):
    return {
        "station_name": station.get("station_name"),
        "district": station.get("district"),
        "taluk": station.get("taluk"),
        "total": station.get("total"),
        "risk_score": station.get("risk_score"),
        "risk_level": station.get("risk_level"),
        "source_type": station.get("source_type"),
    }


def _trim_patrol_route(route):
    return {
        "district": route.get("district"),
        "route_name": route.get("route_name"),
        "risk_level": route.get("risk_level"),
        "summary": route.get("summary"),
    }


def _format_number(value):
    try:
        numeric = float(value or 0)
    except (TypeError, ValueError):
        return str(value)
    if numeric.is_integer():
        return f"{int(numeric):,}"
    return f"{numeric:,.1f}"


def _join_readable(parts):
    filtered_parts = [str(part) for part in parts if part]
    if not filtered_parts:
        return ""
    if len(filtered_parts) == 1:
        return filtered_parts[0]
    if len(filtered_parts) == 2:
        return " and ".join(filtered_parts)
    return ", ".join(filtered_parts[:-1]) + f", and {filtered_parts[-1]}"


def _top_positive_rows(rows, key):
    return [row for row in (rows or []) if (row.get(key) or 0) > 0]


def _describe_operations_scope(filters):
    parts = []
    if filters.get("year"):
        parts.append(f"year {filters['year']}")
    if filters.get("district"):
        parts.append(filters["district"])
    if filters.get("category"):
        parts.append(filters["category"])
    return _join_readable(parts)


def build_operations_context(filters=None):
    normalized_filters = _normalize_filters(filters)
    layers = load_map_layers(
        year=normalized_filters["year"],
        district=normalized_filters["district"],
        category=normalized_filters["category"],
    )
    focus_district = None
    if normalized_filters["district"]:
        focus_district = next(
            (
                district
                for district in layers.get("districts", [])
                if district.get("district") == normalized_filters["district"]
            ),
            None,
        )

    return {
        "status": "ok",
        "view_label": VIEW_LABELS["map"],
        "filters": normalized_filters,
        "summary": layers.get("summary", {}),
        "focus_district": focus_district,
        "top_categories": _query_category_breakdown(
            year=normalized_filters["year"],
            district=normalized_filters["district"],
            category=normalized_filters["category"],
        ),
        "top_districts": layers.get("districts", [])[:6],
        "top_taluks": [_trim_zone(zone) for zone in layers.get("zones", [])[:8]],
        "top_hotspots": [_trim_hotspot(hotspot) for hotspot in layers.get("hotspots", [])[:6]],
        "top_stations": [_trim_station(station) for station in layers.get("stations", [])[:5]],
        "patrol_routes": [_trim_patrol_route(route) for route in layers.get("patrol_routes", [])[:4]],
    }


def build_scenario_context(payload=None):
    payload = payload or {}
    scenario = _normalize_text(payload.get("scenario")) or "women_safety"
    district = _normalize_text(payload.get("district"))
    year, month = normalize_target_period(payload.get("year"), payload.get("month"))
    limit = max(5, min(60, int(payload.get("limit") or 20)))
    scenario_data = scenario_zone_prediction(
        scenario=scenario,
        district=district,
        target_year=year,
        target_month=month,
        limit=limit,
    )

    return {
        "status": "ok",
        "view_label": VIEW_LABELS.get(
            "women-safety" if scenario == "women_safety" else "accident-zones",
            "Scenario Prediction",
        ),
        "scenario": scenario,
        "district_filter": district,
        "target_year": year,
        "target_month": month,
        "summary": scenario_data.get("summary", {}),
        "top_zones": [
            {
                "rank": zone.get("rank"),
                "district": zone.get("district"),
                "taluk": zone.get("taluk"),
                "predicted_count": zone.get("predicted_count"),
                "prediction_index": zone.get("prediction_index"),
                "risk_score": zone.get("risk_score"),
                "risk_level": zone.get("risk_level"),
                "predicted_top_category": zone.get("predicted_top_category"),
            }
            for zone in scenario_data.get("zones", [])[:8]
        ],
        "notes": scenario_data.get("notes", []),
    }


def build_travel_context(payload=None):
    payload = payload or {}
    origin_taluk_id = _normalize_text(payload.get("origin_taluk_id"))
    destination_taluk_id = _normalize_text(payload.get("destination_taluk_id"))
    has_result = bool(payload.get("has_result"))
    if not origin_taluk_id or not destination_taluk_id:
        return {
            "status": "unavailable",
            "view_label": VIEW_LABELS["travel"],
            "message": "Select origin and destination zones in the Travel Advisor first.",
        }
    if not has_result:
        return {
            "status": "unavailable",
            "view_label": VIEW_LABELS["travel"],
            "message": "Generate a route in the Travel Advisor first so I can answer from the current route output.",
            "origin_taluk_id": origin_taluk_id,
            "destination_taluk_id": destination_taluk_id,
        }

    year, month = normalize_target_period(payload.get("year"), payload.get("month"))
    route_data = build_navigation_from_taluks(
        origin_taluk_id=origin_taluk_id,
        destination_taluk_id=destination_taluk_id,
        mode="compare",
        target_year=year,
        target_month=month,
    )
    if route_data.get("status") != "ok":
        return {
            "status": "error",
            "view_label": VIEW_LABELS["travel"],
            "message": route_data.get("message") or "Travel route data could not be generated.",
        }

    return {
        "status": "ok",
        "view_label": VIEW_LABELS["travel"],
        "target_year": route_data.get("target_year"),
        "target_month": route_data.get("target_month"),
        "origin": {
            "taluk_id": origin_taluk_id,
            "label": route_data.get("origin_query"),
        },
        "destination": {
            "taluk_id": destination_taluk_id,
            "label": route_data.get("destination_query"),
        },
        "recommendation": route_data.get("recommendation"),
        "route_diverges": route_data.get("route_diverges"),
        "route_overlap_ratio": route_data.get("route_overlap_ratio"),
        "risk_reduction": route_data.get("risk_reduction"),
        "distance_delta_km": route_data.get("distance_delta_km"),
        "duration_delta_min": route_data.get("duration_delta_min"),
        "comparison": route_data.get("comparison", {}),
        "fastest_route": route_data.get("fastest_route", {}),
        "safer_route": route_data.get("safer_route", {}),
        "alerts": [
            {
                "taluk": alert.get("taluk"),
                "district": alert.get("district"),
                "predicted_accident": alert.get("predicted_accident"),
                "min_distance_km": alert.get("min_distance_km"),
                "strict_buffer_m": alert.get("strict_buffer_m"),
            }
            for alert in route_data.get("alerts", [])[:6]
        ],
        "accident_zones": [
            {
                "taluk": zone.get("taluk"),
                "district": zone.get("district"),
                "predicted_accident": zone.get("predicted_accident"),
                "crossed_by_fastest": zone.get("crossed_by_fastest"),
                "crossed_by_safer": zone.get("crossed_by_safer"),
                "avoided_by_safer": zone.get("avoided_by_safer"),
            }
            for zone in route_data.get("accident_zones", [])[:10]
        ],
    }


def build_relocation_context(payload=None):
    payload = payload or {}
    taluk_id = _normalize_text(payload.get("taluk_id"))
    has_report = bool(payload.get("has_report"))
    if not taluk_id:
        return {
            "status": "unavailable",
            "view_label": VIEW_LABELS["relocation"],
            "message": "Choose an area in the relocation page first.",
        }
    if not has_report:
        return {
            "status": "unavailable",
            "view_label": VIEW_LABELS["relocation"],
            "message": "Generate the area safety view first so I can answer from the current relocation report.",
            "taluk_id": taluk_id,
        }

    year, month = normalize_target_period(payload.get("year"), payload.get("month"))
    report = area_safety_snapshot(taluk_id, target_year=year, target_month=month)
    if not report:
        return {
            "status": "error",
            "view_label": VIEW_LABELS["relocation"],
            "message": "That area safety report is not available.",
        }

    return {
        "status": "ok",
        "view_label": VIEW_LABELS["relocation"],
        "target_year": report.get("target_year"),
        "target_month": report.get("target_month"),
        "district": report.get("district"),
        "taluk": report.get("taluk"),
        "grade": report.get("grade"),
        "recommendation": report.get("recommendation"),
        "predicted_total": report.get("predicted_total"),
        "predicted_top_category": report.get("predicted_top_category"),
        "risk_score": report.get("risk_score"),
        "risk_level": report.get("risk_level"),
        "safety_index": report.get("safety_index"),
        "women_safety_index": report.get("women_safety_index"),
        "accident_exposure_index": report.get("accident_exposure_index"),
        "nearby_comparison": report.get("nearby_comparison", [])[:4],
        "categories": report.get("categories", {}),
    }


def build_analytics_context():
    predictions = seasonal_ml_prediction(horizon=6)
    monthly_totals = {}
    for row in predictions:
        key = f"{row['year']}-{row['month']:02d}"
        if key not in monthly_totals:
            monthly_totals[key] = {
                "year": row["year"],
                "month": row["month"],
                "month_name": row["month_name"],
                "predicted_total": 0.0,
            }
        monthly_totals[key]["predicted_total"] += row["predicted_cases"]

    return {
        "status": "ok",
        "view_label": VIEW_LABELS["analytics"],
        "top_categories": _query_category_breakdown(),
        "high_risk_districts": _query_high_risk_districts(),
        "seasonal_outlook": list(monthly_totals.values())[:6],
    }


def build_compare_context(payload=None):
    payload = payload or {}
    left_district = _normalize_text(payload.get("left_district"))
    right_district = _normalize_text(payload.get("right_district"))
    if not left_district or not right_district:
        return {
            "status": "unavailable",
            "view_label": VIEW_LABELS["compare"],
            "message": "Select two districts in the compare view first.",
        }

    comparison = build_district_compare(
        left_district,
        right_district,
        year=_normalize_int(payload.get("year")),
        category=_normalize_text(payload.get("category")),
        target_year=_normalize_int(payload.get("target_year")),
        target_month=_normalize_int(payload.get("target_month")),
    )
    return {
        "status": "ok",
        "view_label": VIEW_LABELS["compare"],
        "comparison": comparison,
    }


def build_chat_grounding(payload):
    active_view = _normalize_text(payload.get("active_view")) or "map"
    filters = payload.get("filters") or {}
    scenario_context = payload.get("scenario_context") or {}
    travel_context = payload.get("travel_context") or {}
    relocation_context = payload.get("relocation_context") or {}
    compare_context = payload.get("compare_context") or {}

    if active_view == "compare":
        grounding = build_compare_context(compare_context)
    elif active_view == "women-safety":
        grounding = build_scenario_context(
            {
                **scenario_context,
                "scenario": "women_safety",
            }
        )
    elif active_view == "accident-zones":
        grounding = build_scenario_context(
            {
                **scenario_context,
                "scenario": "accident",
            }
        )
    elif active_view == "travel":
        grounding = build_travel_context(travel_context)
    elif active_view == "relocation":
        grounding = build_relocation_context(relocation_context)
    elif active_view == "analytics":
        grounding = build_analytics_context()
    else:
        grounding = build_operations_context(filters)
        active_view = "map"

    return {
        "active_view": active_view,
        "view_label": VIEW_LABELS.get(active_view, "Operations"),
        "today": date.today().isoformat(),
        "grounding": grounding,
    }


def build_system_instruction():
    return (
        "You are Radar AI, an operational assistant for Tamil Nadu policing. "
        "Answer only from the grounded application data provided in the latest user message. "
        "Do not invent facts, routes, crime counts, forecasts, districts, taluks, or recommendations. "
        "If the grounded data is missing or incomplete, say exactly what is missing and what the user should generate or filter in the app. "
        "Keep answers practical, direct, and decision-oriented. "
        "When giving route advice, prefer the safer route only when the grounded comparison shows lower exposure or avoided accident zones. "
        "When asked for a summary, mention the most important numbers, places, and risk labels from the grounded data."
    )


def build_user_prompt(message, grounding_payload, language="en"):
    grounded_json = json.dumps(grounding_payload, ensure_ascii=False, indent=2)
    response_language = "Tamil" if language == "ta" else "English"
    return (
        "Current grounded application data:\n"
        f"{grounded_json}\n\n"
        "User question:\n"
        f"{message.strip()}\n\n"
        f"Respond in {response_language}.\n"
        "Answer using only the grounded application data above. "
        "If a detail is unavailable in the data, say so clearly."
    )


def _extract_text_from_gemini(payload):
    parts = (
        payload.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [])
    )
    text_chunks = [part.get("text", "").strip() for part in parts if part.get("text")]
    return "\n".join(chunk for chunk in text_chunks if chunk).strip()


def request_gemini_response(message, history, grounding_payload, language="en"):
    load_local_env()
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("Missing GEMINI_API_KEY")

    model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    contents = []
    for item in (history or [])[-DEFAULT_HISTORY_LIMIT:]:
        role = "model" if item.get("role") == "assistant" else "user"
        text = (item.get("content") or "").strip()
        if not text:
            continue
        contents.append(
            {
                "role": role,
                "parts": [{"text": text}],
            }
        )

    contents.append(
        {
            "role": "user",
            "parts": [{"text": build_user_prompt(message, grounding_payload, language=language)}],
        }
    )

    request_body = {
        "systemInstruction": {
            "parts": [{"text": build_system_instruction()}],
        },
        "contents": contents,
        "generationConfig": {
            "temperature": 0.2,
            "topP": 0.9,
            "maxOutputTokens": 700,
        },
        "store": False,
    }
    request = Request(
        url,
        data=json.dumps(request_body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=DEFAULT_GEMINI_TIMEOUT_SECONDS) as response:
            payload = json.load(response)
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Gemini API error: {detail or error.reason}") from error
    except (URLError, TimeoutError, ValueError) as error:
        raise RuntimeError(f"Gemini request failed: {error}") from error

    text = _extract_text_from_gemini(payload)
    if not text:
        raise RuntimeError("Gemini returned an empty response")

    return {
        "answer": text,
        "model": model,
    }


def _build_operations_summary_answer(grounding):
    summary = grounding.get("summary", {})
    filters = grounding.get("filters", {})
    total_incidents = summary.get("incidents", 0)
    if total_incidents <= 0:
        return "No incidents match the current operations filters right now."

    scope = _describe_operations_scope(filters)
    top_district = (grounding.get("top_districts") or [None])[0]
    if filters.get("district") and grounding.get("focus_district"):
        top_district = grounding.get("focus_district")
    top_taluk = (grounding.get("top_taluks") or [None])[0]
    top_category = (grounding.get("top_categories") or [None])[0]

    segments = []
    if scope:
        segments.append(f"Current operations view is filtered to {scope}.")
    else:
        segments.append("Current operations view is statewide.")
    segments.append(
        f"It covers {_format_number(summary.get('districts', 0))} districts, "
        f"{_format_number(summary.get('taluks', 0))} taluks, "
        f"{_format_number(summary.get('stations', 0))} stations, and "
        f"{_format_number(total_incidents)} incidents."
    )
    if top_district and (top_district.get("total") or 0) > 0:
        segments.append(
            f"The heaviest district in scope is {top_district.get('district')} "
            f"with {_format_number(top_district.get('total'))} incidents and "
            f"{top_district.get('risk_level')} risk."
        )
    if top_taluk and (top_taluk.get("total") or 0) > 0:
        segments.append(
            f"The highest-pressure taluk is {top_taluk.get('taluk')}, {top_taluk.get('district')} "
            f"with {_format_number(top_taluk.get('total'))} incidents, "
            f"{top_taluk.get('risk_level')} risk, and "
            f"{top_taluk.get('dominant_category')} as the dominant category there."
        )
    if top_category and (top_category.get("total_count") or 0) > 0:
        segments.append(
            f"The leading category in this view is {top_category.get('category')} "
            f"at {_format_number(top_category.get('total_count'))} incidents."
        )
    return " ".join(segments)


def _build_operations_attention_answer(grounding):
    summary = grounding.get("summary", {})
    filters = grounding.get("filters", {})
    total_incidents = summary.get("incidents", 0)
    if total_incidents <= 0:
        return "No districts or taluks need attention in the current operations view because the filters returned no incidents."

    top_districts = _top_positive_rows(grounding.get("top_districts"), "total")
    top_taluks = _top_positive_rows(grounding.get("top_taluks"), "total")
    focus_district = grounding.get("focus_district")

    segments = []
    if filters.get("district") and focus_district and (focus_district.get("total") or 0) > 0:
        segments.append(
            f"District attention is currently concentrated in {focus_district.get('district')} "
            f"because the filters are already narrowed there; it carries "
            f"{_format_number(focus_district.get('total'))} incidents at "
            f"{focus_district.get('risk_level')} risk."
        )
    elif top_districts:
        district_text = _join_readable(
            [
                (
                    f"{row.get('district')} ({row.get('risk_level')} risk, "
                    f"{_format_number(row.get('total'))} incidents)"
                )
                for row in top_districts[:3]
            ]
        )
        segments.append(f"Districts needing the most attention right now are {district_text}.")

    if top_taluks:
        taluk_text = _join_readable(
            [
                (
                    f"{row.get('taluk')}, {row.get('district')} "
                    f"({row.get('risk_level')} risk, {_format_number(row.get('total'))} incidents)"
                )
                for row in top_taluks[:4]
            ]
        )
        segments.append(f"Top taluks needing attention are {taluk_text}.")

    if not segments:
        return "The current operations view does not have enough ranked district or taluk data to identify attention areas."
    return " ".join(segments)


def _build_operations_dominant_category_answer(grounding):
    filters = grounding.get("filters", {})
    top_categories = _top_positive_rows(grounding.get("top_categories"), "total_count")
    if not top_categories:
        return "I can't identify a dominant category because no category totals are available for the current operations filters."

    top_category = top_categories[0]
    if filters.get("category"):
        return (
            f"The view is already filtered to {filters.get('category')}, so "
            f"{top_category.get('category')} is the dominant category in scope with "
            f"{_format_number(top_category.get('total_count'))} incidents."
        )

    answer = (
        f"{top_category.get('category')} is dominating the current operations view with "
        f"{_format_number(top_category.get('total_count'))} incidents."
    )
    if len(top_categories) > 1:
        second_category = top_categories[1]
        lead = (top_category.get("total_count") or 0) - (second_category.get("total_count") or 0)
        answer += (
            f" The next largest category is {second_category.get('category')} at "
            f"{_format_number(second_category.get('total_count'))}, "
            f"so the lead is {_format_number(lead)} incidents."
        )
    return answer


def build_local_answer(message, grounding_payload):
    active_view = grounding_payload.get("active_view")
    grounding = grounding_payload.get("grounding", {})
    if grounding.get("status") not in {"ok", None}:
        return None

    message_text = _normalize_message_text(message)
    if active_view != "map":
        return None

    if "category" in message_text and any(
        phrase in message_text
        for phrase in ("dominating", "dominant", "leading category", "top category")
    ):
        return _build_operations_dominant_category_answer(grounding)

    if ("district" in message_text or "districts" in message_text) and (
        "taluk" in message_text or "taluks" in message_text
    ) and any(
        phrase in message_text
        for phrase in ("attention", "focus", "watch", "priority", "prioritize")
    ):
        return _build_operations_attention_answer(grounding)

    if any(
        phrase in message_text
        for phrase in (
            "summarize the current operations picture",
            "summarise the current operations picture",
            "current operations picture",
            "operations picture",
        )
    ) or ("summarize" in message_text and "operations" in message_text):
        return _build_operations_summary_answer(grounding)

    return None


def _build_compare_fallback_answer(grounding):
    comparison = grounding.get("comparison", {})
    left = comparison.get("left", {})
    right = comparison.get("right", {})
    summary = comparison.get("comparison", {})
    if not left or not right:
        return "District compare is not ready yet."
    return (
        f"District compare is live for {left.get('district')} and {right.get('district')}. "
        f"{summary.get('higher_live_load')} currently carries the higher live load, "
        f"{summary.get('higher_risk')} has the higher risk score, "
        f"{summary.get('higher_women_safety_pressure')} shows stronger women safety pressure, "
        f"and {summary.get('higher_accident_pressure')} shows stronger accident pressure."
    )


def build_fallback_answer(grounding_payload):
    grounding = grounding_payload.get("grounding", {})
    status = grounding.get("status")
    view_label = grounding.get("view_label") or grounding_payload.get("view_label") or "current view"
    if status in {"unavailable", "error"}:
        return grounding.get("message") or f"I need more data from the {view_label} before I can answer accurately."

    if grounding_payload.get("active_view") == "compare":
        return _build_compare_fallback_answer(grounding)

    if grounding_payload.get("active_view") == "travel":
        fastest = grounding.get("fastest_route", {})
        safer = grounding.get("safer_route", {})
        comparison = grounding.get("comparison", {})
        return (
            f"{grounding.get('recommendation')} "
            f"Fastest route: {fastest.get('distance_km')} km, {fastest.get('eta_min')} min, "
            f"{fastest.get('accident_zones_crossed')} crossed accident zones. "
            f"Safer route: {safer.get('distance_km')} km, {safer.get('eta_min')} min, "
            f"{safer.get('accident_zones_crossed')} crossed accident zones, "
            f"{comparison.get('zones_avoided')} zones avoided."
        ).strip()

    if grounding_payload.get("active_view") in {"women-safety", "accident-zones"}:
        top_zone = (grounding.get("top_zones") or [None])[0]
        if not top_zone:
            return "No scenario zones are available for the current filters."
        return (
            f"{view_label} is grounded on {grounding.get('target_month')}/{grounding.get('target_year')}. "
            f"Top zone: {top_zone.get('taluk')}, {top_zone.get('district')} with predicted count "
            f"{top_zone.get('predicted_count')} and {top_zone.get('risk_level')} risk."
        )

    if grounding_payload.get("active_view") == "relocation":
        return (
            f"{grounding.get('taluk')}, {grounding.get('district')} is graded {grounding.get('grade')}. "
            f"Recommendation: {grounding.get('recommendation')} "
            f"Risk score {grounding.get('risk_score')} and safety index {grounding.get('safety_index')}."
        )

    if grounding_payload.get("active_view") == "analytics":
        top_district = (grounding.get("high_risk_districts") or [None])[0]
        top_category = (grounding.get("top_categories") or [None])[0]
        return (
            f"Analytics summary: highest crime district is {top_district.get('district') if top_district else 'n/a'} "
            f"and the top category is {top_category.get('category') if top_category else 'n/a'}."
        )

    summary = grounding.get("summary", {})
    top_district = (grounding.get("top_districts") or [None])[0]
    top_taluk = (grounding.get("top_taluks") or [None])[0]
    return (
        f"Operations summary for the current filters: {summary.get('districts', 0)} districts, "
        f"{summary.get('taluks', 0)} taluks, {summary.get('stations', 0)} stations, "
        f"and {summary.get('incidents', 0)} total incidents. "
        f"Top district: {top_district.get('district') if top_district else 'n/a'}. "
        f"Top taluk: {top_taluk.get('taluk') if top_taluk else 'n/a'}."
    )


def _build_action_cards(grounding_payload):
    active_view = grounding_payload.get("active_view")
    grounding = grounding_payload.get("grounding", {})
    if grounding.get("status") not in {"ok", None}:
        return []

    actions = []
    if active_view == "map":
        top_district = (grounding.get("top_districts") or [None])[0]
        top_taluk = (grounding.get("top_taluks") or [None])[0]
        filters = grounding.get("filters") or {}
        if top_district:
            actions.append(
                {
                    "type": "focus_district",
                    "label": f"Focus {top_district.get('district')}",
                    "district": top_district.get("district"),
                }
            )
        if top_taluk:
            actions.append(
                {
                    "type": "highlight_taluk",
                    "label": f"Highlight {top_taluk.get('taluk')}",
                    "district": top_taluk.get("district"),
                    "taluk_id": top_taluk.get("taluk_id"),
                    "taluk": top_taluk.get("taluk"),
                }
            )
        actions.append(
            {
                "type": "download_report",
                "label": "Download Ops PDF",
                "report": "operations",
                "params": {
                    "year": filters.get("year"),
                    "district": filters.get("district"),
                    "category": filters.get("category"),
                },
            }
        )
        top_districts = grounding.get("top_districts") or []
        if len(top_districts) >= 2:
            actions.append(
                {
                    "type": "compare_districts",
                    "label": f"Compare {top_districts[0].get('district')} vs {top_districts[1].get('district')}",
                    "left_district": top_districts[0].get("district"),
                    "right_district": top_districts[1].get("district"),
                    "filters": {
                        "year": filters.get("year"),
                        "category": filters.get("category"),
                    },
                }
            )
    elif active_view in {"women-safety", "accident-zones"}:
        top_zone = (grounding.get("top_zones") or [None])[0]
        scenario = grounding.get("scenario")
        if top_zone:
            actions.append(
                {
                    "type": "highlight_taluk",
                    "label": f"Highlight {top_zone.get('taluk')}",
                    "district": top_zone.get("district"),
                    "taluk_id": top_zone.get("taluk_id"),
                    "taluk": top_zone.get("taluk"),
                }
            )
        actions.append(
            {
                "type": "download_report",
                "label": "Download Scenario PDF",
                "report": "scenario",
                "params": {
                    "scenario": scenario,
                    "district": grounding.get("district_filter"),
                    "year": grounding.get("target_year"),
                    "month": grounding.get("target_month"),
                },
            }
        )
    elif active_view == "travel":
        actions.append(
            {
                "type": "switch_view",
                "label": "Open Travel Advisor",
                "view": "travel",
            }
        )
    elif active_view == "compare":
        comparison = grounding.get("comparison", {})
        actions.append(
            {
                "type": "switch_view",
                "label": "Open Compare View",
                "view": "compare",
            }
        )
        actions.append(
            {
                "type": "focus_district",
                "label": f"Focus {comparison.get('comparison', {}).get('higher_risk')}",
                "district": comparison.get("comparison", {}).get("higher_risk"),
            }
        )

    return [action for action in actions if action.get("label")]


def request_gemini_translation(text, language):
    load_local_env()
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key or language == "en":
        return text

    model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    prompt = (
        "Translate the following operational answer into Tamil. "
        "Keep all numbers, district names, taluk names, risk labels, and factual meaning unchanged. "
        "Return only the translated answer.\n\n"
        f"{text}"
    )
    request_body = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "topP": 0.8,
            "maxOutputTokens": 700,
        },
        "store": False,
    }
    request = Request(
        url,
        data=json.dumps(request_body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=DEFAULT_GEMINI_TIMEOUT_SECONDS) as response:
            payload = json.load(response)
        translated = _extract_text_from_gemini(payload)
        return translated or text
    except (HTTPError, URLError, TimeoutError, ValueError):
        return text


def answer_chat_message(message, history=None, context_payload=None, language="en"):
    grounding_payload = build_chat_grounding(context_payload or {})
    language = _normalize_language(language)
    actions = _build_action_cards(grounding_payload)
    local_answer = build_local_answer(message, grounding_payload)
    if local_answer:
        localized_answer = request_gemini_translation(local_answer, language)
        return {
            "status": "ok",
            "answer": localized_answer,
            "source": "local",
            "model": None,
            "view": grounding_payload["active_view"],
            "view_label": grounding_payload["view_label"],
            "grounding_status": grounding_payload["grounding"].get("status"),
            "actions": actions,
            "language": language,
        }

    try:
        gemini_response = request_gemini_response(
            message=message,
            history=history or [],
            grounding_payload=grounding_payload,
            language=language,
        )
        return {
            "status": "ok",
            "answer": gemini_response["answer"],
            "source": "gemini",
            "model": gemini_response["model"],
            "view": grounding_payload["active_view"],
            "view_label": grounding_payload["view_label"],
            "grounding_status": grounding_payload["grounding"].get("status"),
            "actions": actions,
            "language": language,
        }
    except RuntimeError as error:
        fallback_answer = build_fallback_answer(grounding_payload)
        localized_answer = request_gemini_translation(fallback_answer, language)
        return {
            "status": "ok",
            "answer": localized_answer,
            "source": "fallback",
            "model": None,
            "view": grounding_payload["active_view"],
            "view_label": grounding_payload["view_label"],
            "grounding_status": grounding_payload["grounding"].get("status"),
            "warning": str(error),
            "actions": actions,
            "language": language,
        }
