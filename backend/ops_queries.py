import json
from collections import defaultdict

from database import get_connection
from ml_engine import patrol_ml_prediction

STATEWIDE_HOTSPOT_LAYER_LIMIT = 20
STATEWIDE_WOMEN_ZONE_LAYER_LIMIT = 50
STATEWIDE_ACCIDENT_ZONE_LAYER_LIMIT = 50
STATEWIDE_PATROL_DISTRICT_LIMIT = 16
DISTRICT_TALUK_LAYER_LIMITS = {
    "CHENNAI": 10,
}
HOTSPOT_RISK_MIX = (
    ("HIGH", 0.40),
    ("MEDIUM", 0.35),
    ("LOW", 0.25),
)


def _filters_sql(year=None, category=None, district=None):
    clauses = []
    params = []

    if year:
        clauses.append("year = ?")
        params.append(year)
    if category:
        clauses.append("category = ?")
        params.append(category)
    if district:
        clauses.append("district = ?")
        params.append(district)

    if not clauses:
        return "", params
    return " WHERE " + " AND ".join(clauses), params


def risk_score(total, maximum):
    if maximum <= 0:
        return 18
    return round(18 + (total / maximum) * 77, 1)


def risk_level(score):
    if score >= 70:
        return "HIGH"
    if score >= 42:
        return "MEDIUM"
    return "LOW"


def _normalize_district_name(value):
    return str(value or "").strip().upper()


def _resolve_zone_limit(district, zone_count, default_limit=None):
    if zone_count <= 0:
        return 0

    district_cap = DISTRICT_TALUK_LAYER_LIMITS.get(_normalize_district_name(district))
    if default_limit is None:
        return min(zone_count, district_cap) if district_cap else zone_count
    if district_cap:
        return min(zone_count, district_cap)
    return min(zone_count, default_limit)


def _select_balanced_zones(zones, limit, metric_key, risk_key, balanced=False):
    if limit <= 0:
        return []

    ranked_zones = [
        zone
        for zone in sorted(
            zones,
            key=lambda item: (-item[metric_key], item["district"], item["taluk"]),
        )
        if zone[metric_key] > 0
    ]
    if not balanced or len(ranked_zones) <= limit:
        return ranked_zones[:limit]

    by_risk = {
        "HIGH": [zone for zone in ranked_zones if zone[risk_key] == "HIGH"],
        "MEDIUM": [zone for zone in ranked_zones if zone[risk_key] == "MEDIUM"],
        "LOW": [zone for zone in ranked_zones if zone[risk_key] == "LOW"],
    }

    selected = []
    selected_ids = set()
    allocated = 0
    mix_targets = []
    for index, (risk_name, share) in enumerate(HOTSPOT_RISK_MIX):
        if index == len(HOTSPOT_RISK_MIX) - 1:
            target = max(0, limit - allocated)
        else:
            target = int(limit * share)
            allocated += target
        mix_targets.append((risk_name, target))

    for risk_name, target in mix_targets:
        bucket = by_risk[risk_name]
        if not bucket or target <= 0:
            continue
        for zone in bucket[:target]:
            selected.append(zone)
            selected_ids.add(zone["taluk_id"])

    if len(selected) < limit:
        for zone in ranked_zones:
            if zone["taluk_id"] in selected_ids:
                continue
            selected.append(zone)
            selected_ids.add(zone["taluk_id"])
            if len(selected) >= limit:
                break

    return selected[:limit]


def load_map_layers(year=None, category=None, district=None):
    conn = get_connection()
    cursor = conn.cursor()

    district_query = "SELECT * FROM districts"
    taluk_query = "SELECT * FROM taluks"
    station_query = "SELECT * FROM police_stations"
    meta_params = []
    if district:
        district_query += " WHERE district = ?"
        taluk_query += " WHERE district = ?"
        station_query += " WHERE district = ?"
        meta_params = [district]

    cursor.execute(district_query, meta_params)
    district_rows = [dict(row) for row in cursor.fetchall()]
    cursor.execute(taluk_query, meta_params)
    taluk_rows = [dict(row) for row in cursor.fetchall()]
    cursor.execute(station_query, meta_params)
    station_rows = [dict(row) for row in cursor.fetchall()]

    where_sql, params = _filters_sql(year=year, category=category, district=district)

    cursor.execute(
        f"""
        SELECT district, taluk_id, taluk, station_id, station_name, category,
               SUM(count) AS total
        FROM fir_records
        {where_sql}
        GROUP BY district, taluk_id, taluk, station_id, station_name, category
        """,
        params,
    )
    grouped_rows = [dict(row) for row in cursor.fetchall()]
    conn.close()

    taluk_meta = {row["taluk_id"]: row for row in taluk_rows}
    station_meta = {row["station_id"]: row for row in station_rows}
    district_meta = {row["district"]: row for row in district_rows}

    zone_totals = defaultdict(int)
    zone_categories = defaultdict(lambda: defaultdict(int))
    station_totals = defaultdict(int)
    district_totals = defaultdict(int)

    for row in grouped_rows:
        zone_totals[row["taluk_id"]] += row["total"]
        zone_categories[row["taluk_id"]][row["category"]] += row["total"]
        if row["station_id"]:
            station_totals[row["station_id"]] += row["total"]
        district_totals[row["district"]] += row["total"]

    max_zone_total = max(zone_totals.values(), default=1)
    max_district_total = max(district_totals.values(), default=1)
    max_station_total = max(station_totals.values(), default=1)
    show_only_reported_areas = bool(year or category or district)

    districts = []
    for row in district_rows:
        total = district_totals.get(row["district"], 0)
        score = risk_score(total, max_district_total)
        districts.append(
            {
                "district": row["district"],
                "lat": row["lat"],
                "lng": row["lng"],
                "total": total,
                "taluk_count": row["taluk_count"],
                "station_count": row["station_count"],
                "profile": row["profile"],
                "risk_score": score,
                "risk_level": risk_level(score),
            }
        )

    zones = []
    for row in taluk_rows:
        totals = zone_categories.get(row["taluk_id"], {})
        total = zone_totals.get(row["taluk_id"], 0)
        if show_only_reported_areas and total <= 0:
            continue
        dominant = max(totals, key=totals.get) if totals else "Property"
        score = risk_score(total, max_zone_total)
        women_total = totals.get("Women Safety", 0)
        accident_total = totals.get("Accident", 0)
        ndps_total = totals.get("NDPS", 0)
        zones.append(
            {
                "taluk_id": row["taluk_id"],
                "district": row["district"],
                "taluk": row["taluk"],
                "lat": row["lat"],
                "lng": row["lng"],
                "radius_km": row["radius_km"],
                "primary_station_id": row["primary_station_id"],
                "total": total,
                "dominant_category": dominant,
                "risk_score": score,
                "risk_level": risk_level(score),
                "women_safety_total": women_total,
                "accident_total": accident_total,
                "ndps_total": ndps_total,
                "categories": dict(sorted(totals.items(), key=lambda item: item[1], reverse=True)),
            }
        )

    max_women_total = max((zone["women_safety_total"] for zone in zones), default=1)
    max_accident_total = max((zone["accident_total"] for zone in zones), default=1)
    for zone in zones:
        women_score = risk_score(zone["women_safety_total"], max_women_total)
        accident_score = risk_score(zone["accident_total"], max_accident_total)
        zone["women_safety_risk_score"] = women_score
        zone["women_safety_risk_level"] = risk_level(women_score)
        zone["accident_risk_score"] = accident_score
        zone["accident_risk_level"] = risk_level(accident_score)

    stations = []
    for row in station_rows:
        total = station_totals.get(row["station_id"], 0)
        if show_only_reported_areas and total <= 0:
            continue
        score = risk_score(total, max_station_total)
        stations.append(
            {
                "station_id": row["station_id"],
                "station_name": row["station_name"],
                "district": row["district"],
                "taluk": row["taluk"],
                "lat": row["lat"],
                "lng": row["lng"],
                "source_type": row["source_type"],
                "coverage_priority": row["coverage_priority"],
                "total": total,
                "risk_score": score,
                "risk_level": risk_level(score),
            }
        )

    all_zones = zones
    zone_layer_limit = _resolve_zone_limit(district, len(all_zones))
    zones = _select_balanced_zones(
        all_zones,
        zone_layer_limit,
        metric_key="total",
        risk_key="risk_level",
        balanced=bool(district and zone_layer_limit < len(all_zones)),
    )

    if district and zones:
        visible_station_ids = {
            zone["primary_station_id"]
            for zone in zones
            if zone.get("primary_station_id")
        }
        if visible_station_ids:
            stations = [
                station
                for station in stations
                if station["station_id"] in visible_station_ids
            ]

    hotspot_layer_limit = _resolve_zone_limit(
        district,
        len(all_zones),
        STATEWIDE_HOTSPOT_LAYER_LIMIT,
    )
    women_zone_layer_limit = _resolve_zone_limit(
        district,
        len(all_zones),
        STATEWIDE_WOMEN_ZONE_LAYER_LIMIT,
    )
    accident_zone_layer_limit = _resolve_zone_limit(
        district,
        len(all_zones),
        STATEWIDE_ACCIDENT_ZONE_LAYER_LIMIT,
    )

    hotspot_source_zones = _select_balanced_zones(
        all_zones,
        hotspot_layer_limit,
        metric_key="total",
        risk_key="risk_level",
        balanced=not district or hotspot_layer_limit < len(all_zones),
    )
    hotspots = []
    for zone in hotspot_source_zones:
        hotspots.append(
            {
                "taluk_id": zone["taluk_id"],
                "district": zone["district"],
                "zone_name": zone["taluk"],
                "center_lat": zone["lat"],
                "center_lng": zone["lng"],
                "radius_km": round(max(4.5, zone["radius_km"] * 0.92), 2),
                "risk_level": zone["risk_level"],
                "risk_score": zone["risk_score"],
                "crime_count": zone["total"],
                "top_crime": zone["dominant_category"],
            }
        )

    women_zone_source = _select_balanced_zones(
        all_zones,
        women_zone_layer_limit,
        metric_key="women_safety_total",
        risk_key="women_safety_risk_level",
        balanced=not district or women_zone_layer_limit < len(all_zones),
    )
    women_zones = [
        {
            "taluk_id": zone["taluk_id"],
            "district": zone["district"],
            "zone_name": zone["taluk"],
            "lat": zone["lat"],
            "lng": zone["lng"],
            "radius_km": round(max(5.0, zone["radius_km"] * 0.88), 2),
            "count": zone["women_safety_total"],
            "risk_score": zone["women_safety_risk_score"],
            "risk_level": zone["women_safety_risk_level"],
        }
        for zone in women_zone_source
    ]

    accident_zone_source = _select_balanced_zones(
        all_zones,
        accident_zone_layer_limit,
        metric_key="accident_total",
        risk_key="accident_risk_level",
        balanced=not district or accident_zone_layer_limit < len(all_zones),
    )
    accident_zones = [
        {
            "taluk_id": zone["taluk_id"],
            "district": zone["district"],
            "zone_name": zone["taluk"],
            "lat": zone["lat"],
            "lng": zone["lng"],
            "radius_km": round(max(6.0, zone["radius_km"] * 0.95), 2),
            "count": zone["accident_total"],
            "risk_score": zone["accident_risk_score"],
            "risk_level": zone["accident_risk_level"],
        }
        for zone in accident_zone_source
    ]

    district_ranking = sorted(
        district_totals.items(),
        key=lambda item: item[1],
        reverse=True,
    )
    allowed_districts = (
        {name for name, _ in district_ranking[:STATEWIDE_PATROL_DISTRICT_LIMIT]}
        if not district
        else {district}
    )
    patrol_routes = []
    for district_name in allowed_districts:
        patrol = patrol_ml_prediction(district_name)
        if not patrol["route_points"]:
            continue
        patrol_routes.append(
            {
                "route_id": f"PATROL-{district_name}",
                "district": district_name,
                "route_name": f"{district_name} ML PATROL",
                "risk_level": patrol["risk_level"],
                "summary": patrol["summary"],
                "path": [
                    {
                        "lat": point["lat"],
                        "lng": point["lng"],
                        "name": point["taluk"],
                        "risk_score": point["risk_score"],
                        "predicted_total": point["predicted_total"],
                        "predicted_top_category": point["predicted_top_category"],
                    }
                    for point in patrol["route_points"]
                ],
            }
        )

    return {
        "summary": {
            "districts": len(district_rows),
            "taluks": len(zones),
            "stations": len(stations),
            "incidents": sum(zone_totals.values()),
        },
        "districts": sorted(districts, key=lambda item: item["total"], reverse=True),
        "zones": sorted(zones, key=lambda item: item["total"], reverse=True),
        "stations": sorted(stations, key=lambda item: item["total"], reverse=True),
        "hotspots": hotspots,
        "women_zones": women_zones,
        "accident_zones": accident_zones,
        "patrol_routes": patrol_routes,
    }


def load_patrol_routes(district=None):
    conn = get_connection()
    cursor = conn.cursor()
    if district:
        cursor.execute(
            "SELECT * FROM patrol_routes WHERE district = ? ORDER BY district",
            [district],
        )
    else:
        cursor.execute("SELECT * FROM patrol_routes ORDER BY district")
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()

    for row in rows:
        row["path"] = json.loads(row["path_json"])
    return rows
