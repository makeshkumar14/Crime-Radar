import math
import re
from collections import defaultdict
from datetime import date
from functools import lru_cache

from database import get_connection
from ml_engine import haversine_km, prediction_snapshot, scenario_zone_prediction
from ops_queries import load_map_layers

RISK_COLORS = {
    "HIGH": "#EF4444",
    "MEDIUM": "#F59E0B",
    "LOW": "#22C55E",
}


def _clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def _normalize_text(value):
    return " ".join(str(value or "").strip().split())


def _normalize_match_key(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _history_filters_sql(year=None, district=None, category=None, taluk_id=None):
    query = " WHERE 1=1"
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
    if taluk_id:
        query += " AND taluk_id = ?"
        params.append(taluk_id)
    return query, params


def _query_category_breakdown(year=None, district=None, category=None, taluk_id=None, limit=8):
    conn = get_connection()
    cursor = conn.cursor()
    where_sql, params = _history_filters_sql(
        year=year,
        district=district,
        category=category,
        taluk_id=taluk_id,
    )
    cursor.execute(
        f"""
        SELECT category, SUM(count) AS total_count
        FROM fir_records
        {where_sql}
        GROUP BY category
        ORDER BY total_count DESC, category
        LIMIT ?
        """,
        params + [limit],
    )
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows


def _query_coverage_stats(district=None, category=None, taluk_id=None):
    conn = get_connection()
    cursor = conn.cursor()
    where_sql, params = _history_filters_sql(
        district=district,
        category=category,
        taluk_id=taluk_id,
    )
    cursor.execute(
        f"""
        SELECT
            COUNT(DISTINCT printf('%04d-%02d', year, month)) AS coverage_months,
            COUNT(DISTINCT category) AS category_count,
            COALESCE(SUM(count), 0) AS total_incidents
        FROM fir_records
        {where_sql}
        """,
        params,
    )
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else {
        "coverage_months": 0,
        "category_count": 0,
        "total_incidents": 0,
    }


def _confidence_summary(coverage_months, total_incidents, category_count):
    score = 36.0
    score += min(28.0, float(coverage_months or 0) * 1.55)
    score += min(22.0, math.log1p(float(total_incidents or 0)) * 4.8)
    score += min(14.0, float(category_count or 0) * 2.1)
    score = round(_clamp(score, 22.0, 96.0), 1)

    if score >= 78:
        label = "STRONG"
    elif score >= 58:
        label = "MODERATE"
    else:
        label = "CAUTION"

    return {
        "score": score,
        "label": label,
        "coverage_months": int(coverage_months or 0),
        "total_incidents": int(total_incidents or 0),
        "category_count": int(category_count or 0),
    }


def _taluk_rankings(year=None, district=None, category=None):
    layers = load_map_layers(year=year, district=district, category=category)
    rankings = []
    for index, zone in enumerate(layers.get("zones", []), start=1):
        rankings.append(
            {
                "rank": index,
                "taluk_id": zone.get("taluk_id"),
                "district": zone.get("district"),
                "taluk": zone.get("taluk"),
                "total": zone.get("total", 0),
                "risk_level": zone.get("risk_level"),
                "risk_score": zone.get("risk_score"),
                "dominant_category": zone.get("dominant_category"),
                "women_safety_total": zone.get("women_safety_total", 0),
                "accident_total": zone.get("accident_total", 0),
            }
        )
    return rankings


def _district_rankings(year=None, category=None):
    layers = load_map_layers(year=year, category=category)
    rankings = []
    for index, district in enumerate(layers.get("districts", []), start=1):
        rankings.append(
            {
                "rank": index,
                "district": district.get("district"),
                "total": district.get("total", 0),
                "risk_level": district.get("risk_level"),
                "risk_score": district.get("risk_score"),
            }
        )
    return rankings


def build_taluk_explanation(
    taluk_id,
    *,
    year=None,
    district=None,
    category=None,
    target_year=None,
    target_month=None,
):
    taluk_rankings = _taluk_rankings(year=year, district=district, category=category)
    target_zone = next((zone for zone in taluk_rankings if zone["taluk_id"] == taluk_id), None)
    if not target_zone:
        taluk_rankings = _taluk_rankings(year=year, category=category)
        target_zone = next((zone for zone in taluk_rankings if zone["taluk_id"] == taluk_id), None)
    if not target_zone:
        return None

    district_totals = [zone["total"] for zone in taluk_rankings if zone["district"] == target_zone["district"]]
    district_average = (sum(district_totals) / len(district_totals)) if district_totals else 0
    category_breakdown = _query_category_breakdown(
        year=year,
        district=target_zone["district"],
        category=category,
        taluk_id=taluk_id,
    )
    total_incidents = sum(item["total_count"] for item in category_breakdown) or target_zone["total"] or 0
    dominant_row = category_breakdown[0] if category_breakdown else None
    dominant_share = (
        round((dominant_row["total_count"] / total_incidents) * 100, 1)
        if dominant_row and total_incidents
        else 0
    )

    snapshot = prediction_snapshot(
        target_year=target_year or date.today().year,
        target_month=target_month or date.today().month,
        district=target_zone["district"],
    )
    predicted_zone = next((row for row in snapshot if row["taluk_id"] == taluk_id), None)
    predicted_total = predicted_zone.get("predicted_total", 0) if predicted_zone else 0
    predicted_women = predicted_zone.get("predicted_women_safety", 0) if predicted_zone else 0
    predicted_accident = predicted_zone.get("predicted_accident", 0) if predicted_zone else 0

    coverage = _query_coverage_stats(
        district=target_zone["district"],
        category=category,
        taluk_id=taluk_id,
    )
    confidence = _confidence_summary(
        coverage_months=coverage.get("coverage_months"),
        total_incidents=coverage.get("total_incidents"),
        category_count=coverage.get("category_count"),
    )

    reasons = []
    if district_average and target_zone["total"] >= district_average * 1.15:
        reasons.append(
            f"Current incident load is {round(target_zone['total'] / district_average, 1)}x the district average."
        )
    if dominant_row and dominant_share >= 24:
        reasons.append(
            f"{dominant_row['category']} contributes {dominant_share}% of the live incident load here."
        )
    if target_zone.get("women_safety_total", 0) > 0:
        reasons.append(
            f"Women safety incidents contribute {target_zone['women_safety_total']} live cases in this taluk."
        )
    if target_zone.get("accident_total", 0) > 0:
        reasons.append(
            f"Accident incidents add {target_zone['accident_total']} live cases to the risk picture."
        )
    if predicted_total > 0:
        reasons.append(
            f"The forecast engine still projects {predicted_total} total cases for the current period."
        )
    if not reasons:
        reasons.append("This taluk is still in view because it remains part of the live filtered operational picture.")

    return {
        **target_zone,
        "color": RISK_COLORS.get(target_zone.get("risk_level"), RISK_COLORS["LOW"]),
        "category_breakdown": category_breakdown,
        "dominant_share_pct": dominant_share,
        "district_average_total": round(district_average, 1) if district_average else 0,
        "predicted_total": predicted_total,
        "predicted_women_safety": predicted_women,
        "predicted_accident": predicted_accident,
        "confidence": confidence,
        "reasons": reasons[:4],
    }


def _accident_blackspot_reasoning(district, target_year=None, target_month=None):
    scenario = scenario_zone_prediction(
        scenario="accident",
        district=district,
        target_year=target_year,
        target_month=target_month,
        limit=8,
    )
    top_zone = (scenario.get("zones") or [None])[0]
    if not top_zone:
        return None

    neighbours = []
    for zone in scenario.get("zones", [])[1:]:
        distance_km = haversine_km(
            top_zone["lat"],
            top_zone["lng"],
            zone["lat"],
            zone["lng"],
        )
        if distance_km <= 30:
            neighbours.append(
                {
                    "taluk": zone["taluk"],
                    "district": zone["district"],
                    "risk_level": zone["risk_level"],
                    "predicted_count": zone["predicted_count"],
                    "distance_km": round(distance_km, 1),
                }
            )

    coverage = _query_coverage_stats(district=district, category="Accident")
    confidence = _confidence_summary(
        coverage_months=coverage.get("coverage_months"),
        total_incidents=coverage.get("total_incidents"),
        category_count=coverage.get("category_count"),
    )

    factors = [
        f"Exposure rank is #{top_zone['rank']} in the current accident forecast.",
        f"Predicted accident load is {top_zone['predicted_count']} with a {top_zone['risk_level']} risk label.",
        f"Prediction index is {top_zone['prediction_index']}, showing sustained road-risk intensity.",
    ]
    if neighbours:
        factors.append(
            f"{len(neighbours)} nearby high-risk stretch{'es' if len(neighbours) != 1 else ''} sit within 30 km."
        )

    return {
        "zone": {
            "taluk_id": top_zone["taluk_id"],
            "taluk": top_zone["taluk"],
            "district": top_zone["district"],
            "rank": top_zone["rank"],
            "predicted_count": top_zone["predicted_count"],
            "prediction_index": top_zone["prediction_index"],
            "risk_level": top_zone["risk_level"],
            "risk_score": top_zone["risk_score"],
        },
        "nearby_stretches": neighbours[:3],
        "factors": factors,
        "confidence": confidence,
    }


def build_district_profile(district, year=None, category=None, target_year=None, target_month=None):
    layers = load_map_layers(year=year, district=district, category=category)
    district_row = (layers.get("districts") or [None])[0]
    top_taluks = layers.get("zones", [])[:5]
    top_categories = _query_category_breakdown(year=year, district=district, category=category, limit=5)
    women_prediction = scenario_zone_prediction(
        scenario="women_safety",
        district=district,
        target_year=target_year,
        target_month=target_month,
        limit=5,
    )
    accident_prediction = scenario_zone_prediction(
        scenario="accident",
        district=district,
        target_year=target_year,
        target_month=target_month,
        limit=5,
    )
    top_zone = top_taluks[0] if top_taluks else None
    explanation = (
        build_taluk_explanation(
            top_zone["taluk_id"],
            year=year,
            district=district,
            category=category,
            target_year=target_year,
            target_month=target_month,
        )
        if top_zone
        else None
    )
    coverage = _query_coverage_stats(district=district, category=category)
    confidence = _confidence_summary(
        coverage_months=coverage.get("coverage_months"),
        total_incidents=coverage.get("total_incidents"),
        category_count=coverage.get("category_count"),
    )

    return {
        "district": district,
        "filters": {
            "year": year,
            "category": category,
            "target_year": target_year or date.today().year,
            "target_month": target_month or date.today().month,
        },
        "summary": layers.get("summary", {}),
        "risk_score": district_row.get("risk_score", 0) if district_row else 0,
        "risk_level": district_row.get("risk_level", "LOW") if district_row else "LOW",
        "risk_color": RISK_COLORS.get(district_row.get("risk_level", "LOW"), RISK_COLORS["LOW"])
        if district_row
        else RISK_COLORS["LOW"],
        "incident_total": district_row.get("total", 0) if district_row else 0,
        "top_categories": top_categories,
        "top_taluks": top_taluks,
        "women_safety_peak": (women_prediction.get("zones") or [None])[0],
        "accident_peak": (accident_prediction.get("zones") or [None])[0],
        "explanation": explanation,
        "accident_reasoning": _accident_blackspot_reasoning(
            district,
            target_year=target_year,
            target_month=target_month,
        ),
        "confidence": confidence,
    }


def build_district_compare(
    left_district,
    right_district,
    *,
    year=None,
    category=None,
    target_year=None,
    target_month=None,
):
    left = build_district_profile(
        left_district,
        year=year,
        category=category,
        target_year=target_year,
        target_month=target_month,
    )
    right = build_district_profile(
        right_district,
        year=year,
        category=category,
        target_year=target_year,
        target_month=target_month,
    )

    comparison = {
        "higher_live_load": left["district"]
        if left["incident_total"] >= right["incident_total"]
        else right["district"],
        "higher_risk": left["district"]
        if left["risk_score"] >= right["risk_score"]
        else right["district"],
        "higher_women_safety_pressure": left["district"]
        if (left.get("women_safety_peak") or {}).get("predicted_count", 0)
        >= (right.get("women_safety_peak") or {}).get("predicted_count", 0)
        else right["district"],
        "higher_accident_pressure": left["district"]
        if (left.get("accident_peak") or {}).get("predicted_count", 0)
        >= (right.get("accident_peak") or {}).get("predicted_count", 0)
        else right["district"],
    }

    return {
        "filters": {
            "year": year,
            "category": category,
            "target_year": target_year or date.today().year,
            "target_month": target_month or date.today().month,
        },
        "left": left,
        "right": right,
        "comparison": comparison,
    }


def build_watchlist_snapshot(taluk_ids, target_year=None, target_month=None):
    target_year = target_year or date.today().year
    target_month = target_month or date.today().month
    snapshot = {
        row["taluk_id"]: row
        for row in prediction_snapshot(target_year=target_year, target_month=target_month)
    }
    rankings = {row["taluk_id"]: row for row in _taluk_rankings()}
    rows = []
    for taluk_id in taluk_ids:
        predicted = snapshot.get(taluk_id)
        live = rankings.get(taluk_id)
        if not predicted or not live:
            continue
        rows.append(
            {
                "taluk_id": taluk_id,
                "district": live["district"],
                "taluk": live["taluk"],
                "risk_level": live["risk_level"],
                "risk_score": live["risk_score"],
                "color": RISK_COLORS.get(live["risk_level"], RISK_COLORS["LOW"]),
                "live_total": live["total"],
                "predicted_total": predicted["predicted_total"],
                "predicted_women_safety": predicted["predicted_women_safety"],
                "predicted_accident": predicted["predicted_accident"],
                "dominant_category": live["dominant_category"],
            }
        )
    rows.sort(
        key=lambda item: (
            {"HIGH": 0, "MEDIUM": 1, "LOW": 2}.get(item["risk_level"], 3),
            -(item["live_total"] or 0),
            item["district"],
            item["taluk"],
        )
    )
    return {
        "target_year": target_year,
        "target_month": target_month,
        "zones": rows,
    }


def build_fir_impact_summary(entry, before_layers, after_layers):
    district = entry.get("district")
    taluk_id = entry.get("taluk_id")

    before_district_rows = before_layers.get("districts", [])
    after_district_rows = after_layers.get("districts", [])
    before_taluk_rows = before_layers.get("zones", [])
    after_taluk_rows = after_layers.get("zones", [])

    before_district = next((row for row in before_district_rows if row.get("district") == district), None)
    after_district = next((row for row in after_district_rows if row.get("district") == district), None)
    before_taluk = next((row for row in before_taluk_rows if row.get("taluk_id") == taluk_id), None)
    after_taluk = next((row for row in after_taluk_rows if row.get("taluk_id") == taluk_id), None)

    district_rank_before = next(
        (index for index, row in enumerate(before_district_rows, start=1) if row.get("district") == district),
        None,
    )
    district_rank_after = next(
        (index for index, row in enumerate(after_district_rows, start=1) if row.get("district") == district),
        None,
    )
    taluk_rank_before = next(
        (index for index, row in enumerate(before_taluk_rows, start=1) if row.get("taluk_id") == taluk_id),
        None,
    )
    taluk_rank_after = next(
        (index for index, row in enumerate(after_taluk_rows, start=1) if row.get("taluk_id") == taluk_id),
        None,
    )

    district_delta = (after_district or {}).get("total", 0) - (before_district or {}).get("total", 0)
    taluk_delta = (after_taluk or {}).get("total", 0) - (before_taluk or {}).get("total", 0)

    return {
        "district": district,
        "taluk_id": taluk_id,
        "taluk": entry.get("taluk"),
        "category": entry.get("category"),
        "count": entry.get("count"),
        "district_total_before": (before_district or {}).get("total", 0),
        "district_total_after": (after_district or {}).get("total", 0),
        "district_delta": district_delta,
        "district_rank_before": district_rank_before,
        "district_rank_after": district_rank_after,
        "district_risk_before": (before_district or {}).get("risk_level"),
        "district_risk_after": (after_district or {}).get("risk_level"),
        "taluk_total_before": (before_taluk or {}).get("total", 0),
        "taluk_total_after": (after_taluk or {}).get("total", 0),
        "taluk_delta": taluk_delta,
        "taluk_rank_before": taluk_rank_before,
        "taluk_rank_after": taluk_rank_after,
        "taluk_risk_before": (before_taluk or {}).get("risk_level"),
        "taluk_risk_after": (after_taluk or {}).get("risk_level"),
        "summary": (
            f"{entry.get('taluk')}, {district} moved by +{taluk_delta} live incidents after the FIR injection, "
            f"while {district} moved by +{district_delta} incidents in the active yearly view."
        ),
    }


@lru_cache(maxsize=1)
def _available_filter_metadata():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT district FROM districts ORDER BY district")
    districts = [row["district"] for row in cursor.fetchall()]
    cursor.execute("SELECT DISTINCT category FROM crime_categories ORDER BY category")
    categories = [row["category"] for row in cursor.fetchall()]
    cursor.execute("SELECT DISTINCT year FROM fir_records ORDER BY year")
    years = [row["year"] for row in cursor.fetchall()]
    conn.close()
    return {
        "districts": districts,
        "categories": categories,
        "years": years,
    }


def parse_natural_language_filters(text):
    raw_text = _normalize_text(text)
    normalized = _normalize_match_key(raw_text)
    metadata = _available_filter_metadata()

    active_view = "map"
    if "women safety" in normalized or "women" in normalized:
        active_view = "women-safety"
    elif "accident" in normalized:
        active_view = "accident-zones"
    elif "travel" in normalized or "route" in normalized:
        active_view = "travel"
    elif "relocation" in normalized or "move" in normalized:
        active_view = "relocation"

    district = None
    district_match_length = -1
    for item in metadata["districts"]:
        match_key = _normalize_match_key(item)
        if match_key and match_key in normalized and len(match_key) > district_match_length:
            district = item
            district_match_length = len(match_key)

    category = None
    category_match_length = -1
    for item in metadata["categories"]:
        match_key = _normalize_match_key(item)
        if match_key and match_key in normalized and len(match_key) > category_match_length:
            category = item
            category_match_length = len(match_key)

    year = None
    for item in sorted(metadata["years"], reverse=True):
        if re.search(rf"\b{item}\b", normalized):
            year = item
            break

    if active_view in {"women-safety", "accident-zones"}:
        category = None

    summary_parts = []
    if district:
        summary_parts.append(district)
    else:
        summary_parts.append("All districts")
    if year:
        summary_parts.append(str(year))
    else:
        summary_parts.append("All years")
    if category:
        summary_parts.append(category)

    return {
        "status": "ok",
        "active_view": active_view,
        "filters": {
            "district": district,
            "year": year,
            "category": category,
        },
        "summary": " | ".join(summary_parts),
        "matched": bool(district or year or category or active_view != "map"),
    }
