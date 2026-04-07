import json
import math
import os
from collections import defaultdict, deque
from datetime import UTC, date, datetime, timedelta
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import numpy as np

os.environ.setdefault("LOKY_MAX_CPU_COUNT", "1")
from sklearn.cluster import KMeans

from database import get_connection

try:
    from ortools.constraint_solver import pywrapcp, routing_enums_pb2
except ImportError:  # pragma: no cover - optional dependency
    pywrapcp = None
    routing_enums_pb2 = None


DEFAULT_OSRM_ROUTE_URL = os.getenv(
    "OSRM_FAST_URL",
    "https://router.project-osrm.org/route/v1/driving",
).rstrip("/")
DEFAULT_OSRM_NEAREST_URL = DEFAULT_OSRM_ROUTE_URL.replace("/route/v1/", "/nearest/v1/").rstrip("/")
DEFAULT_OSRM_TRIP_URL = DEFAULT_OSRM_ROUTE_URL.replace("/route/v1/", "/trip/v1/").rstrip("/")
DEFAULT_OSRM_TIMEOUT_SECONDS = float(os.getenv("OSRM_TIMEOUT_SECONDS", "8"))
DEFAULT_GRID_SIZE_KM = 1.0
DEFAULT_LOOKBACK_MONTHS = 12
DEFAULT_REROUTE_INTERVAL_MIN = 45
DEFAULT_PRIORITY_ZONE_LIMIT_PER_UNIT = 4
DEFAULT_MAX_WAYPOINTS_PER_UNIT = 6
RISK_WEIGHTS = {
    "accident_frequency": 0.35,
    "severity": 0.20,
    "crime": 0.15,
    "time": 0.15,
    "season": 0.15,
}
SEVERITY_WEIGHTS = {
    "LOW": 1.0,
    "MEDIUM": 1.22,
    "HIGH": 1.48,
    "CRITICAL": 1.82,
}
CRIME_CATEGORY_WEIGHTS = {
    "ACCIDENT": 1.25,
    "VIOLENT": 1.18,
    "WOMEN SAFETY": 1.16,
    "PUBLIC ORDER": 1.10,
    "PROPERTY": 1.05,
    "NDPS": 1.04,
    "BURGLARY": 1.08,
    "KIDNAPPING": 1.14,
    "FRAUD": 0.92,
}
TIME_SLOT_MAP = {
    "PEAK": {"MORNING": 1.22, "EVENING": 1.32, "AFTERNOON": 0.95, "NIGHT": 0.82},
    "MORNING": {"MORNING": 1.28, "AFTERNOON": 0.96, "EVENING": 0.92, "NIGHT": 0.78},
    "AFTERNOON": {"MORNING": 0.96, "AFTERNOON": 1.22, "EVENING": 1.02, "NIGHT": 0.80},
    "EVENING": {"MORNING": 0.88, "AFTERNOON": 1.02, "EVENING": 1.28, "NIGHT": 0.92},
    "NIGHT": {"MORNING": 0.72, "AFTERNOON": 0.82, "EVENING": 1.02, "NIGHT": 1.34},
    "OFF_PEAK": {"MORNING": 0.96, "AFTERNOON": 1.02, "EVENING": 0.98, "NIGHT": 0.96},
}
TIME_CATEGORY_BOOST = {
    "PEAK": {"ACCIDENT": 1.14, "PUBLIC ORDER": 1.08},
    "NIGHT": {"VIOLENT": 1.16, "WOMEN SAFETY": 1.18, "PROPERTY": 1.10, "NDPS": 1.08},
    "EVENING": {"ACCIDENT": 1.08, "PUBLIC ORDER": 1.10, "WOMEN SAFETY": 1.06},
}
WEATHER_CATEGORY_BOOST = {
    "CLEAR": {},
    "RAIN": {"ACCIDENT": 1.30, "PUBLIC ORDER": 1.05},
    "FOG": {"ACCIDENT": 1.34},
    "STORM": {"ACCIDENT": 1.40, "PUBLIC ORDER": 1.08},
    "HEAT": {"ACCIDENT": 1.06, "PUBLIC ORDER": 1.05},
}
FESTIVAL_CATEGORY_BOOST = {
    "PUBLIC ORDER": 1.26,
    "WOMEN SAFETY": 1.18,
    "PROPERTY": 1.10,
    "ACCIDENT": 1.08,
}
DEFAULT_GRID_THRESHOLDS = {
    "HIGH": 70.0,
    "MEDIUM": 40.0,
}


def round_value(value, digits=2):
    return round(float(value), digits)


def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def normalize_text(value):
    return " ".join(str(value or "").strip().upper().split())


def normalize_category(value):
    return normalize_text(value)


def normalize_time_band(value):
    normalized = normalize_text(value).replace(" ", "_")
    if normalized in {"PEAK", "NIGHT", "MORNING", "AFTERNOON", "EVENING", "OFF_PEAK"}:
        return normalized
    return "PEAK"


def normalize_weather(value):
    normalized = normalize_text(value)
    return normalized if normalized in WEATHER_CATEGORY_BOOST else "CLEAR"


def risk_level(score):
    if score >= DEFAULT_GRID_THRESHOLDS["HIGH"]:
        return "HIGH"
    if score >= DEFAULT_GRID_THRESHOLDS["MEDIUM"]:
        return "MEDIUM"
    return "LOW"


def haversine_km(lat1, lng1, lat2, lng2):
    radius = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def to_km_projection(lat, lng, ref_lat):
    radius = 6371.0
    x = math.radians(lng) * radius * math.cos(math.radians(ref_lat))
    y = math.radians(lat) * radius
    return x, y


def from_km_projection(x, y, ref_lat):
    radius = 6371.0
    latitude = math.degrees(y / radius)
    cos_lat = max(math.cos(math.radians(ref_lat)), 0.18)
    longitude = math.degrees(x / (radius * cos_lat))
    return latitude, longitude


def months_ago(target_year, target_month, year, month):
    return (int(target_year) - int(year)) * 12 + (int(target_month) - int(month))


def recency_weight(target_year, target_month, year, month):
    lag = max(0, months_ago(target_year, target_month, year, month))
    return math.exp(-lag / 6.0)


def severity_weight(value):
    return SEVERITY_WEIGHTS.get(normalize_text(value), 1.0)


def category_weight(category):
    return CRIME_CATEGORY_WEIGHTS.get(normalize_category(category), 1.0)


def time_slot_weight(target_band, incident_slot, category):
    target_band = normalize_time_band(target_band)
    incident_slot = normalize_text(incident_slot)
    slot_weights = TIME_SLOT_MAP.get(target_band, TIME_SLOT_MAP["PEAK"])
    weight = slot_weights.get(incident_slot, 1.0)
    category_boost = TIME_CATEGORY_BOOST.get(target_band, {}).get(normalize_category(category), 1.0)
    return weight * category_boost


def seasonal_multiplier(category, weather, is_festival):
    category = normalize_category(category)
    weather = normalize_weather(weather)
    weight = WEATHER_CATEGORY_BOOST.get(weather, {}).get(category, 1.0)
    if is_festival:
        weight *= FESTIVAL_CATEGORY_BOOST.get(category, 1.0)
    return weight


def event_zone_multiplier(lat, lng, event_zones):
    if not event_zones:
        return 1.0
    best = 1.0
    for zone in event_zones:
        distance = haversine_km(lat, lng, zone["lat"], zone["lng"])
        if distance <= zone["radius_km"]:
            best = max(best, zone["priority_boost"])
    return best


def percentile_min_max_normalize(values, lower=5, upper=95):
    if not values:
        return []
    arr = np.array(values, dtype=float)
    lo = float(np.percentile(arr, lower))
    hi = float(np.percentile(arr, upper))
    if hi <= lo:
        lo = float(arr.min())
        hi = float(arr.max())
    if hi <= lo:
        return [50.0 if hi > 0 else 0.0 for _ in values]

    normalized = []
    for value in arr:
        clipped = float(clamp(value, lo, hi))
        normalized.append(round_value(((clipped - lo) / (hi - lo)) * 100, 1))
    return normalized


def normalize_component(grid_cells, source_key, target_key):
    normalized_values = percentile_min_max_normalize([cell[source_key] for cell in grid_cells])
    for cell, value in zip(grid_cells, normalized_values):
        cell[target_key] = value


def build_grid_cell_id(grid_x, grid_y):
    return f"G-{grid_x}-{grid_y}"


def load_incident_rows(district, target_year, target_month, lookback_months=DEFAULT_LOOKBACK_MONTHS):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT f.district, f.taluk_id, f.taluk, f.station_id, f.station_name,
               f.lat, f.lng, f.category, f.severity, f.year, f.month,
               f.day_of_week, f.time_slot, f.incident_date, f.count,
               t.radius_km, t.primary_station_id,
               COALESCE(ps.station_name, f.station_name, t.taluk || ' PATROL BASE') AS patrol_station_name,
               COALESCE(ps.lat, t.lat) AS patrol_station_lat,
               COALESCE(ps.lng, t.lng) AS patrol_station_lng,
               d.profile AS district_profile
        FROM fir_records f
        JOIN taluks t ON t.taluk_id = f.taluk_id
        LEFT JOIN police_stations ps ON ps.station_id = t.primary_station_id
        LEFT JOIN districts d ON d.district = f.district
        WHERE f.district = ?
          AND ((? - f.year) * 12 + (? - f.month)) BETWEEN 0 AND ?
        ORDER BY f.year DESC, f.month DESC, f.count DESC
        """,
        [district, target_year, target_month, lookback_months],
    )
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows


def load_station_rows(district):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT station_id, station_name, district, taluk, lat, lng, coverage_priority
        FROM police_stations
        WHERE district = ?
        ORDER BY coverage_priority DESC, station_name
        """,
        [district],
    )
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows


def normalize_event_zones(event_zones):
    normalized = []
    for index, zone in enumerate(event_zones or [], start=1):
        lat = zone.get("lat")
        lng = zone.get("lng")
        if lat is None or lng is None:
            continue
        normalized.append(
            {
                "event_id": zone.get("event_id") or f"E{index}",
                "name": zone.get("name") or f"Event Zone {index}",
                "lat": float(lat),
                "lng": float(lng),
                "radius_km": float(zone.get("radius_km") or 2.0),
                "priority_boost": float(zone.get("priority_boost") or 1.15),
            }
        )
    return normalized


def build_grid_risk_map(
    incident_rows,
    target_year,
    target_month,
    cell_size_km=DEFAULT_GRID_SIZE_KM,
    time_band="PEAK",
    weather="CLEAR",
    include_crime=True,
    is_festival=False,
    event_zones=None,
):
    if not incident_rows:
        return {
            "grid_cells": [],
            "priority_zones": [],
            "summary": {
                "cells_analyzed": 0,
                "high_risk_cells": 0,
                "medium_risk_cells": 0,
                "low_risk_cells": 0,
            },
        }

    time_band = normalize_time_band(time_band)
    weather = normalize_weather(weather)
    event_zones = normalize_event_zones(event_zones)
    ref_lat = sum(row["lat"] for row in incident_rows if row.get("lat") is not None) / max(len(incident_rows), 1)
    buckets = {}

    for row in incident_rows:
        lat = row.get("lat")
        lng = row.get("lng")
        if lat is None or lng is None:
            continue

        x, y = to_km_projection(lat, lng, ref_lat)
        grid_x = int(math.floor(x / cell_size_km))
        grid_y = int(math.floor(y / cell_size_km))
        key = (grid_x, grid_y)
        if key not in buckets:
            buckets[key] = {
                "grid_id": build_grid_cell_id(grid_x, grid_y),
                "grid_x": grid_x,
                "grid_y": grid_y,
                "cell_size_km": round_value(cell_size_km, 2),
                "ref_lat": ref_lat,
                "incident_weight": 0.0,
                "accident_frequency_raw": 0.0,
                "severity_raw": 0.0,
                "crime_raw": 0.0,
                "time_raw": 0.0,
                "season_raw": 0.0,
                "event_multiplier": 1.0,
                "incident_count": 0,
                "accident_count": 0.0,
                "crime_count": 0.0,
                "categories": defaultdict(float),
                "taluks": defaultdict(float),
                "sample_points": [],
            }

        bucket = buckets[key]
        count = float(row.get("count") or 1.0)
        category = normalize_category(row.get("category"))
        recency = recency_weight(target_year, target_month, row.get("year"), row.get("month"))
        sev_weight = severity_weight(row.get("severity"))
        time_weight = time_slot_weight(time_band, row.get("time_slot"), category)
        season_weight = seasonal_multiplier(category, weather, is_festival)
        zone_weight = event_zone_multiplier(lat, lng, event_zones)
        weighted_count = count * recency

        bucket["incident_weight"] += weighted_count
        bucket["severity_raw"] += weighted_count * sev_weight
        bucket["time_raw"] += weighted_count * time_weight
        bucket["season_raw"] += weighted_count * season_weight * zone_weight
        bucket["event_multiplier"] = max(bucket["event_multiplier"], zone_weight)
        bucket["incident_count"] += int(max(1, round(count)))
        bucket["categories"][category] += count
        bucket["taluks"][row.get("taluk") or "UNKNOWN"] += count
        if len(bucket["sample_points"]) < 4:
            bucket["sample_points"].append({"lat": round_value(lat, 6), "lng": round_value(lng, 6)})

        if category == "ACCIDENT":
            bucket["accident_frequency_raw"] += weighted_count
            bucket["accident_count"] += count
        elif include_crime:
            bucket["crime_raw"] += weighted_count * category_weight(category)
            bucket["crime_count"] += count

    grid_cells = []
    for bucket in buckets.values():
        center_x = (bucket["grid_x"] + 0.5) * cell_size_km
        center_y = (bucket["grid_y"] + 0.5) * cell_size_km
        center_lat, center_lng = from_km_projection(center_x, center_y, ref_lat)
        dominant_category = max(bucket["categories"], key=bucket["categories"].get) if bucket["categories"] else "ACCIDENT"
        dominant_taluk = max(bucket["taluks"], key=bucket["taluks"].get) if bucket["taluks"] else "UNKNOWN"
        grid_cells.append(
            {
                **bucket,
                "center_lat": round_value(center_lat, 6),
                "center_lng": round_value(center_lng, 6),
                "dominant_category": dominant_category.title(),
                "dominant_taluk": dominant_taluk,
            }
        )

    normalize_component(grid_cells, "accident_frequency_raw", "accident_frequency_norm")
    normalize_component(grid_cells, "severity_raw", "severity_norm")
    normalize_component(grid_cells, "crime_raw", "crime_norm")
    normalize_component(grid_cells, "time_raw", "time_norm")
    normalize_component(grid_cells, "season_raw", "season_norm")

    for cell in grid_cells:
        risk_score_value = (
            RISK_WEIGHTS["accident_frequency"] * cell["accident_frequency_norm"]
            + RISK_WEIGHTS["severity"] * cell["severity_norm"]
            + RISK_WEIGHTS["crime"] * cell["crime_norm"]
            + RISK_WEIGHTS["time"] * cell["time_norm"]
            + RISK_WEIGHTS["season"] * cell["season_norm"]
        )
        if cell["event_multiplier"] > 1.0:
            risk_score_value *= min(cell["event_multiplier"], 1.35)
        cell["risk_score"] = round_value(min(risk_score_value, 100.0), 1)
        cell["risk_level"] = risk_level(cell["risk_score"])
        cell["components"] = {
            "accident_frequency": cell["accident_frequency_norm"],
            "severity": cell["severity_norm"],
            "crime": cell["crime_norm"],
            "time": cell["time_norm"],
            "season": cell["season_norm"],
        }
        cell["categories"] = dict(sorted(cell["categories"].items(), key=lambda item: item[1], reverse=True))

    grid_cells.sort(
        key=lambda item: (
            -item["risk_score"],
            -item["accident_frequency_raw"],
            -item["crime_raw"],
            item["grid_id"],
        )
    )
    priority_zones = cluster_priority_grids(grid_cells)

    return {
        "grid_cells": grid_cells,
        "priority_zones": priority_zones,
        "summary": {
            "cells_analyzed": len(grid_cells),
            "high_risk_cells": sum(1 for cell in grid_cells if cell["risk_level"] == "HIGH"),
            "medium_risk_cells": sum(1 for cell in grid_cells if cell["risk_level"] == "MEDIUM"),
            "low_risk_cells": sum(1 for cell in grid_cells if cell["risk_level"] == "LOW"),
        },
    }


def cluster_priority_grids(grid_cells, minimum_level="MEDIUM"):
    minimum_score = DEFAULT_GRID_THRESHOLDS.get(normalize_text(minimum_level), DEFAULT_GRID_THRESHOLDS["MEDIUM"])
    eligible = {
        (cell["grid_x"], cell["grid_y"]): cell
        for cell in grid_cells
        if cell["risk_score"] >= minimum_score
    }
    visited = set()
    clusters = []

    for key in eligible:
        if key in visited:
            continue
        queue = deque([key])
        visited.add(key)
        members = []
        while queue:
            current_x, current_y = queue.popleft()
            current_cell = eligible[(current_x, current_y)]
            members.append(current_cell)
            for neighbor in (
                (current_x - 1, current_y),
                (current_x + 1, current_y),
                (current_x, current_y - 1),
                (current_x, current_y + 1),
                (current_x - 1, current_y - 1),
                (current_x - 1, current_y + 1),
                (current_x + 1, current_y - 1),
                (current_x + 1, current_y + 1),
            ):
                if neighbor in eligible and neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)

        total_priority = sum(member["risk_score"] * max(member["incident_weight"], 1.0) for member in members)
        total_risk = sum(member["risk_score"] for member in members)
        total_weight = sum(max(member["incident_weight"], 1.0) for member in members)
        center_lat = sum(member["center_lat"] * member["risk_score"] for member in members) / max(total_risk, 1.0)
        center_lng = sum(member["center_lng"] * member["risk_score"] for member in members) / max(total_risk, 1.0)
        categories = defaultdict(float)
        for member in members:
            for category, value in member["categories"].items():
                categories[category] += value
        dominant_category = max(categories, key=categories.get) if categories else "ACCIDENT"
        cluster_score = round_value(total_priority / max(total_weight, 1.0), 1)
        clusters.append(
            {
                "cluster_id": f"C{len(clusters) + 1}",
                "center_lat": round_value(center_lat, 6),
                "center_lng": round_value(center_lng, 6),
                "risk_score": cluster_score,
                "risk_level": risk_level(cluster_score),
                "priority_score": round_value(total_priority, 1),
                "grid_count": len(members),
                "incident_weight": round_value(total_weight, 1),
                "accident_count": round_value(sum(member["accident_count"] for member in members), 1),
                "crime_count": round_value(sum(member["crime_count"] for member in members), 1),
                "dominant_category": dominant_category.title(),
                "grid_ids": [member["grid_id"] for member in members],
                "grids": [
                    {
                        "grid_id": member["grid_id"],
                        "risk_score": member["risk_score"],
                        "center_lat": member["center_lat"],
                        "center_lng": member["center_lng"],
                    }
                    for member in sorted(members, key=lambda item: item["risk_score"], reverse=True)
                ],
            }
        )

    clusters.sort(
        key=lambda item: (
            -item["priority_score"],
            -item["risk_score"],
            -item["grid_count"],
            item["cluster_id"],
        )
    )
    for index, cluster in enumerate(clusters, start=1):
        cluster["priority_rank"] = index
    return clusters


def weighted_centroid(clusters):
    if not clusters:
        return None
    total_weight = sum(max(cluster["priority_score"], 1.0) for cluster in clusters)
    return {
        "lat": sum(cluster["center_lat"] * max(cluster["priority_score"], 1.0) for cluster in clusters) / total_weight,
        "lng": sum(cluster["center_lng"] * max(cluster["priority_score"], 1.0) for cluster in clusters) / total_weight,
    }


def select_diverse_stations(stations, target_count, demand_center=None):
    if target_count <= 0:
        return []
    if len(stations) <= target_count:
        return stations[:]

    ranked = stations[:]
    if demand_center:
        ranked.sort(
            key=lambda item: (
                haversine_km(item["lat"], item["lng"], demand_center["lat"], demand_center["lng"]),
                -item["coverage_priority"],
            )
        )
    else:
        ranked.sort(key=lambda item: (-item["coverage_priority"], item["station_name"]))

    selected = [ranked.pop(0)]
    while ranked and len(selected) < target_count:
        next_station = max(
            ranked,
            key=lambda item: (
                min(
                    haversine_km(item["lat"], item["lng"], picked["lat"], picked["lng"])
                    for picked in selected
                ),
                item["coverage_priority"],
            ),
        )
        selected.append(next_station)
        ranked.remove(next_station)
    return selected


def resolve_patrol_units(district, unit_count, requested_units=None, priority_zones=None):
    stations = load_station_rows(district)
    if not stations and not requested_units:
        raise ValueError(f"No patrol stations were found for district '{district}'.")

    priority_zones = priority_zones or []
    demand_center = weighted_centroid(priority_zones)
    station_lookup = {row["station_id"]: row for row in stations}
    resolved = []

    for index, item in enumerate(requested_units or [], start=1):
        station = station_lookup.get(item.get("station_id"))
        lat = item.get("lat")
        lng = item.get("lng")
        if station and (lat is None or lng is None):
            lat = station["lat"]
            lng = station["lng"]
        if lat is None or lng is None:
            fallback = select_diverse_stations(stations, 1, demand_center=demand_center)
            if not fallback:
                continue
            station = fallback[0]
            lat = station["lat"]
            lng = station["lng"]
        resolved.append(
            {
                "unit_id": item.get("unit_id") or f"P{index}",
                "station_id": station["station_id"] if station else item.get("station_id"),
                "station_name": station["station_name"] if station else item.get("label") or f"Patrol Unit {index}",
                "lat": float(lat),
                "lng": float(lng),
                "district": district,
            }
        )

    remaining_count = max(0, unit_count - len(resolved))
    if remaining_count > 0:
        if not stations:
            raise ValueError(f"No patrol stations were found for district '{district}'.")
        seed_count = min(max(1, len(stations)), remaining_count)
        chosen = select_diverse_stations(stations, seed_count, demand_center=demand_center)
        while len(resolved) < unit_count:
            station = chosen[(len(resolved) - len(requested_units or [])) % len(chosen)]
            resolved.append(
                {
                    "unit_id": f"P{len(resolved) + 1}",
                    "station_id": station["station_id"],
                    "station_name": station["station_name"],
                    "lat": float(station["lat"]),
                    "lng": float(station["lng"]),
                    "district": district,
                }
            )

    return resolved[:unit_count]


def build_priority_candidates(priority_zones, unit_count, max_per_unit):
    if not priority_zones:
        return []
    limit = max(unit_count * max_per_unit, unit_count)
    return priority_zones[:limit]


def greedy_assign_priority_zones(units, priority_zones, max_targets_per_unit=DEFAULT_PRIORITY_ZONE_LIMIT_PER_UNIT):
    state = {
        unit["unit_id"]: {
            "unit": unit,
            "assigned": [],
            "risk_load": 0.0,
            "distance_load_km": 0.0,
            "last_lat": unit["lat"],
            "last_lng": unit["lng"],
        }
        for unit in units
    }

    for zone in priority_zones:
        candidates = []
        for unit_id, unit_state in state.items():
            if len(unit_state["assigned"]) >= max_targets_per_unit:
                continue
            deadhead_km = haversine_km(
                unit_state["last_lat"],
                unit_state["last_lng"],
                zone["center_lat"],
                zone["center_lng"],
            )
            assignment_cost = (
                deadhead_km
                + unit_state["distance_load_km"] * 0.45
                + unit_state["risk_load"] / 28.0
            )
            candidates.append((assignment_cost, deadhead_km, unit_id))

        if not candidates:
            continue

        _, deadhead_km, winner = min(candidates, key=lambda item: (item[0], item[1], item[2]))
        unit_state = state[winner]
        unit_state["assigned"].append(zone)
        unit_state["distance_load_km"] += deadhead_km
        unit_state["risk_load"] += zone["priority_score"]
        unit_state["last_lat"] = zone["center_lat"]
        unit_state["last_lng"] = zone["center_lng"]

    return state


def order_zones_nearest_neighbor(unit, zones):
    remaining = zones[:]
    ordered = []
    current_lat = unit["lat"]
    current_lng = unit["lng"]

    while remaining:
        next_zone = min(
            remaining,
            key=lambda zone: (
                haversine_km(current_lat, current_lng, zone["center_lat"], zone["center_lng"])
                * (1.0 - min(zone["risk_score"], 95.0) / 180.0),
                -zone["priority_score"],
            ),
        )
        ordered.append(next_zone)
        current_lat = next_zone["center_lat"]
        current_lng = next_zone["center_lng"]
        remaining.remove(next_zone)
    return ordered


def build_osrm_url(base_url, points):
    coordinates = ";".join(f"{point['lng']},{point['lat']}" for point in points)
    params = {
        "overview": "full",
        "geometries": "geojson",
        "steps": "false",
        "continue_straight": "true",
        "annotations": "false",
    }
    return f"{base_url.rstrip('/')}/{coordinates}?{urlencode(params)}"


def build_osrm_nearest_url(base_url, point):
    return f"{base_url.rstrip('/')}/{point['lng']},{point['lat']}?number=1"


def request_osrm_nearest(point):
    request_url = build_osrm_nearest_url(DEFAULT_OSRM_NEAREST_URL, point)
    request = Request(
        request_url,
        headers={"User-Agent": "CrimeRadar/1.0"},
    )
    try:
        with urlopen(request, timeout=DEFAULT_OSRM_TIMEOUT_SECONDS) as response:
            payload = json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError):
        return None

    waypoint = (payload.get("waypoints") or [None])[0]
    if payload.get("code") != "Ok" or not waypoint:
        return None

    snapped_lng, snapped_lat = waypoint.get("location") or [None, None]
    if snapped_lat is None or snapped_lng is None:
        return None

    return {
        "lat": float(snapped_lat),
        "lng": float(snapped_lng),
        "distance_m": round_value(waypoint.get("distance") or 0.0, 2),
        "name": waypoint.get("name"),
        "request_url": request_url,
    }


def snap_stops_to_roads(stops):
    snapped_stops = []
    for stop in stops:
        snapped = request_osrm_nearest({"lat": stop["lat"], "lng": stop["lng"]})
        if not snapped:
            raise ValueError(
                f"OSRM nearest could not snap patrol stop '{stop.get('name') or stop.get('stop_id')}' to the road network."
            )
        snapped_stops.append(
            {
                **stop,
                "input_lat": stop["lat"],
                "input_lng": stop["lng"],
                "lat": snapped["lat"],
                "lng": snapped["lng"],
                "snap_distance_m": snapped["distance_m"],
                "snap_road_name": snapped["name"],
                "nearest_request_url": snapped["request_url"],
            }
        )
    return snapped_stops


def request_osrm_route(points):
    if len(points) < 2:
        return None
    request_url = build_osrm_url(DEFAULT_OSRM_ROUTE_URL, points)
    request = Request(
        request_url,
        headers={"User-Agent": "CrimeRadar/1.0"},
    )
    try:
        with urlopen(request, timeout=DEFAULT_OSRM_TIMEOUT_SECONDS) as response:
            payload = json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError):
        return None

    routes = payload.get("routes") or []
    if payload.get("code") != "Ok" or not routes:
        return None

    route = routes[0]
    geometry = route.get("geometry") or {}
    coordinates = geometry.get("coordinates") or []
    if not coordinates:
        return None

    return {
        "geometry": {
            "type": "LineString",
            "coordinates": coordinates,
        },
        "route": coordinates,
        "distance_km": round_value((route.get("distance") or 0) / 1000, 2),
        "duration_min": round_value((route.get("duration") or 0) / 60, 1),
        "request_url": request_url,
        "source": "osrm",
    }


def fallback_loop_route(points):
    coordinates = [[round_value(point["lng"], 6), round_value(point["lat"], 6)] for point in points]
    distance_km = 0.0
    for index in range(len(points) - 1):
        distance_km += haversine_km(
            points[index]["lat"],
            points[index]["lng"],
            points[index + 1]["lat"],
            points[index + 1]["lng"],
        )
    return {
        "geometry": {"type": "LineString", "coordinates": coordinates},
        "route": coordinates,
        "distance_km": round_value(distance_km, 2),
        "duration_min": round_value(distance_km * 2.4, 1),
        "request_url": None,
        "source": "fallback",
    }


def build_loop_waypoints(unit, ordered_zones, max_waypoints=DEFAULT_MAX_WAYPOINTS_PER_UNIT):
    truncated_zones = ordered_zones[:max_waypoints]
    points = [{"lat": unit["lat"], "lng": unit["lng"]}]
    for zone in truncated_zones:
        points.append({"lat": zone["center_lat"], "lng": zone["center_lng"]})
    points.append({"lat": unit["lat"], "lng": unit["lng"]})
    return points, truncated_zones


def build_unit_patrol(unit, zones, reroute_interval_min):
    ordered_zones = order_zones_nearest_neighbor(unit, zones)
    waypoints, route_zones = build_loop_waypoints(unit, ordered_zones)
    route = request_osrm_route(waypoints) or fallback_loop_route(waypoints)
    route_risk_score = max((zone["risk_score"] for zone in route_zones), default=0.0)

    return {
        "unit_id": unit["unit_id"],
        "station_id": unit["station_id"],
        "station_name": unit["station_name"],
        "risk_level": risk_level(route_risk_score),
        "risk_score": round_value(route_risk_score, 1),
        "zones_covered": sum(zone["grid_count"] for zone in route_zones),
        "priority_zones": len(route_zones),
        "estimated_distance_km": route["distance_km"],
        "estimated_duration_min": route["duration_min"],
        "route_geometry": route["geometry"],
        "route": route["route"],
        "routing_source": route["source"],
        "reroute_after_min": reroute_interval_min,
        "stops": [
            {
                "stop_type": "station",
                "name": unit["station_name"],
                "lat": unit["lat"],
                "lng": unit["lng"],
            }
        ]
        + [
            {
                "stop_type": "priority_zone",
                "cluster_id": zone["cluster_id"],
                "name": f"{zone['dominant_category']} focus zone {zone['priority_rank']}",
                "lat": zone["center_lat"],
                "lng": zone["center_lng"],
                "risk_score": zone["risk_score"],
                "risk_level": zone["risk_level"],
                "grid_count": zone["grid_count"],
                "priority_score": zone["priority_score"],
            }
            for zone in route_zones
        ]
        + [
            {
                "stop_type": "station",
                "name": unit["station_name"],
                "lat": unit["lat"],
                "lng": unit["lng"],
            }
        ],
        "request_url": route["request_url"],
    }


def build_osrm_table_url(base_url, points):
    coordinates = ";".join(f"{point['lng']},{point['lat']}" for point in points)
    table_base = base_url.rstrip("/").replace("/route/v1/", "/table/v1/")
    return f"{table_base}/{coordinates}?annotations=duration,distance"


def request_osrm_matrix(points):
    if len(points) < 2:
        return None
    request_url = build_osrm_table_url(DEFAULT_OSRM_ROUTE_URL, points)
    request = Request(
        request_url,
        headers={"User-Agent": "CrimeRadar/1.0"},
    )
    try:
        with urlopen(request, timeout=DEFAULT_OSRM_TIMEOUT_SECONDS) as response:
            payload = json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError):
        return None

    if payload.get("code") != "Ok":
        return None
    distances = payload.get("distances") or []
    durations = payload.get("durations") or []
    if not distances:
        return None
    return {
        "distances": distances,
        "durations": durations,
    }


def fallback_distance_matrix(points):
    matrix = []
    for source in points:
        row = []
        for destination in points:
            row.append(
                round(
                    haversine_km(source["lat"], source["lng"], destination["lat"], destination["lng"]) * 1000
                )
            )
        matrix.append(row)
    return matrix


def solve_vrp_assignments(units, priority_zones, max_targets_per_unit):
    if pywrapcp is None or routing_enums_pb2 is None:
        return None
    if not units or not priority_zones:
        return None

    depot_points = [{"lat": unit["lat"], "lng": unit["lng"]} for unit in units]
    zone_points = [{"lat": zone["center_lat"], "lng": zone["center_lng"]} for zone in priority_zones]
    points = depot_points + zone_points
    matrix_payload = request_osrm_matrix(points)
    distance_matrix = matrix_payload["distances"] if matrix_payload else fallback_distance_matrix(points)
    demands = [0] * len(units) + [max(1, zone["grid_count"]) for zone in priority_zones]
    capacities = [max_targets_per_unit * 3 for _ in units]

    manager = pywrapcp.RoutingIndexManager(len(points), len(units), list(range(len(units))), list(range(len(units))))
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return int(distance_matrix[from_node][to_node] or 0)

    transit_callback_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    def demand_callback(index):
        node = manager.IndexToNode(index)
        return demands[node]

    demand_callback_index = routing.RegisterUnaryTransitCallback(demand_callback)
    routing.AddDimensionWithVehicleCapacity(
        demand_callback_index,
        0,
        capacities,
        True,
        "Capacity",
    )

    for zone_index, zone in enumerate(priority_zones, start=len(units)):
        routing.AddDisjunction([manager.NodeToIndex(zone_index)], int(zone["priority_score"] * 10))

    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    search_parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    search_parameters.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    search_parameters.time_limit.FromSeconds(2)
    solution = routing.SolveWithParameters(search_parameters)
    if solution is None:
        return None

    assignments = {unit["unit_id"]: [] for unit in units}
    for vehicle_id, unit in enumerate(units):
        index = routing.Start(vehicle_id)
        while not routing.IsEnd(index):
            node_index = manager.IndexToNode(index)
            if node_index >= len(units):
                assignments[unit["unit_id"]].append(priority_zones[node_index - len(units)])
            index = solution.Value(routing.NextVar(index))
    return assignments


def assign_priority_zones(units, priority_zones, strategy="auto", max_targets_per_unit=DEFAULT_PRIORITY_ZONE_LIMIT_PER_UNIT):
    strategy = normalize_text(strategy)
    assignments = None
    strategy_used = "GREEDY"

    if strategy in {"AUTO", "VRP"}:
        assignments = solve_vrp_assignments(units, priority_zones, max_targets_per_unit)
        if assignments:
            strategy_used = "VRP"

    if assignments is None:
        greedy_state = greedy_assign_priority_zones(units, priority_zones, max_targets_per_unit=max_targets_per_unit)
        assignments = {unit_id: value["assigned"] for unit_id, value in greedy_state.items()}
        strategy_used = "GREEDY"

    return assignments, strategy_used


def grid_priority_weight(grid):
    return max(float(grid.get("risk_score") or 0.0), 0.0) * max(float(grid.get("incident_weight") or 1.0), 1.0)


def select_high_risk_grids(grid_cells, minimum_level="HIGH", fallback_limit=8):
    minimum_level = normalize_text(minimum_level)
    selected = [
        cell
        for cell in grid_cells
        if cell["risk_score"] >= DEFAULT_GRID_THRESHOLDS.get(minimum_level, DEFAULT_GRID_THRESHOLDS["HIGH"])
    ]
    if not selected:
        selected = [cell for cell in grid_cells if cell["risk_level"] == "MEDIUM"][:fallback_limit]
    if not selected:
        selected = grid_cells[:fallback_limit]
    return sorted(
        selected,
        key=lambda item: (
            -item["risk_score"],
            -grid_priority_weight(item),
            item["grid_id"],
        ),
    )


def calculate_required_unit_count(high_risk_grid_count, requested_unit_count=None, min_zones_per_unit=5, max_zones_per_unit=10):
    if high_risk_grid_count <= 0:
        return {
            "minimum_required_units": 0,
            "recommended_unit_count": 0,
            "maximum_useful_units": 0,
            "actual_unit_count": 0,
            "target_zones_per_unit": 0,
        }

    target_zones_per_unit = max(min_zones_per_unit, round((min_zones_per_unit + max_zones_per_unit) / 2))
    minimum_required_units = max(1, math.ceil(high_risk_grid_count / max_zones_per_unit))
    recommended_unit_count = max(1, math.ceil(high_risk_grid_count / target_zones_per_unit))
    maximum_useful_units = max(1, math.ceil(high_risk_grid_count / min_zones_per_unit))
    requested = int(requested_unit_count or 0)
    actual_unit_count = requested if requested > 0 else recommended_unit_count
    actual_unit_count = max(actual_unit_count, minimum_required_units)
    actual_unit_count = min(actual_unit_count, high_risk_grid_count)

    return {
        "minimum_required_units": minimum_required_units,
        "recommended_unit_count": recommended_unit_count,
        "maximum_useful_units": maximum_useful_units,
        "actual_unit_count": actual_unit_count,
        "target_zones_per_unit": target_zones_per_unit,
    }


def balanced_cluster_capacities(total_items, cluster_count):
    if cluster_count <= 0:
        return []
    base_capacity = total_items // cluster_count
    remainder = total_items % cluster_count
    return [base_capacity + (1 if index < remainder else 0) for index in range(cluster_count)]


def cluster_summary_from_grids(grids, cluster_id):
    if not grids:
        return {
            "cluster_id": cluster_id,
            "risk_score": 0.0,
            "risk_level": "LOW",
            "priority_score": 0.0,
            "grid_count": 0,
            "grid_ids": [],
            "grids": [],
            "center_lat": None,
            "center_lng": None,
            "dominant_category": "Unknown",
        }

    total_weight = sum(grid_priority_weight(grid) for grid in grids)
    total_risk = sum(grid["risk_score"] for grid in grids)
    center_lat = sum(grid["center_lat"] * max(grid_priority_weight(grid), 1.0) for grid in grids) / max(total_weight, 1.0)
    center_lng = sum(grid["center_lng"] * max(grid_priority_weight(grid), 1.0) for grid in grids) / max(total_weight, 1.0)
    categories = defaultdict(float)
    for grid in grids:
        for category, value in (grid.get("categories") or {}).items():
            categories[category] += value
    dominant_category = max(categories, key=categories.get) if categories else "ACCIDENT"
    risk_score_value = total_risk / max(len(grids), 1)

    ordered_grids = sorted(
        grids,
        key=lambda item: (
            -item["risk_score"],
            -grid_priority_weight(item),
            item["grid_id"],
        ),
    )

    return {
        "cluster_id": cluster_id,
        "risk_score": round_value(risk_score_value, 1),
        "risk_level": risk_level(risk_score_value),
        "priority_score": round_value(total_weight, 1),
        "grid_count": len(grids),
        "grid_ids": [grid["grid_id"] for grid in ordered_grids],
        "center_lat": round_value(center_lat, 6),
        "center_lng": round_value(center_lng, 6),
        "dominant_category": str(dominant_category).title(),
        "accident_count": round_value(sum(grid.get("accident_count", 0.0) for grid in grids), 1),
        "crime_count": round_value(sum(grid.get("crime_count", 0.0) for grid in grids), 1),
        "grids": [
            {
                "grid_id": grid["grid_id"],
                "center_lat": grid["center_lat"],
                "center_lng": grid["center_lng"],
                "risk_score": grid["risk_score"],
                "risk_level": grid["risk_level"],
                "dominant_category": grid["dominant_category"],
                "incident_weight": round_value(grid["incident_weight"], 1),
                "accident_count": round_value(grid["accident_count"], 1),
                "crime_count": round_value(grid["crime_count"], 1),
            }
            for grid in ordered_grids
        ],
    }


def cluster_high_risk_grids_kmeans(high_risk_grids, unit_count):
    if not high_risk_grids:
        return []

    unit_count = min(max(1, int(unit_count)), len(high_risk_grids))
    if unit_count == 1:
        return [cluster_summary_from_grids(high_risk_grids, "K1")]

    ref_lat = sum(grid["center_lat"] for grid in high_risk_grids) / len(high_risk_grids)
    coords = np.array(
        [to_km_projection(grid["center_lat"], grid["center_lng"], ref_lat) for grid in high_risk_grids],
        dtype=float,
    )
    weights = np.array([max(grid_priority_weight(grid), 1.0) for grid in high_risk_grids], dtype=float)
    model = KMeans(n_clusters=unit_count, random_state=42, n_init=10)
    try:
        model.fit(coords, sample_weight=weights)
    except TypeError:  # pragma: no cover - older sklearn fallback
        model.fit(coords)
    centers = model.cluster_centers_

    capacities = balanced_cluster_capacities(len(high_risk_grids), unit_count)
    assignments = [[] for _ in range(unit_count)]
    cluster_loads = [0.0 for _ in range(unit_count)]
    unassigned = set(range(len(high_risk_grids)))

    for center_index in range(unit_count):
        nearest_index = min(
            unassigned,
            key=lambda grid_index: float(np.linalg.norm(coords[grid_index] - centers[center_index])),
        )
        assignments[center_index].append(high_risk_grids[nearest_index])
        cluster_loads[center_index] += weights[nearest_index]
        capacities[center_index] -= 1
        unassigned.remove(nearest_index)

    remaining_indexes = sorted(
        unassigned,
        key=lambda grid_index: (
            -high_risk_grids[grid_index]["risk_score"],
            -grid_priority_weight(high_risk_grids[grid_index]),
            high_risk_grids[grid_index]["grid_id"],
        ),
    )

    for grid_index in remaining_indexes:
        available_clusters = [index for index, capacity in enumerate(capacities) if capacity > 0]
        chosen_cluster = min(
            available_clusters,
            key=lambda cluster_index: (
                float(np.linalg.norm(coords[grid_index] - centers[cluster_index]))
                * (1 + len(assignments[cluster_index]) * 0.12),
                cluster_loads[cluster_index],
                len(assignments[cluster_index]),
                cluster_index,
            ),
        )
        assignments[chosen_cluster].append(high_risk_grids[grid_index])
        cluster_loads[chosen_cluster] += weights[grid_index]
        capacities[chosen_cluster] -= 1

    clusters = [
        cluster_summary_from_grids(members, f"K{index + 1}")
        for index, members in enumerate(assignments)
        if members
    ]
    clusters.sort(key=lambda item: item["cluster_id"])
    return clusters


def match_units_to_clusters(units, clusters):
    remaining_units = units[:]
    remaining_clusters = clusters[:]
    matches = []

    while remaining_units and remaining_clusters:
        candidate_pairs = []
        for unit_index, unit in enumerate(remaining_units):
            for cluster_index, cluster in enumerate(remaining_clusters):
                candidate_pairs.append(
                    (
                        haversine_km(unit["lat"], unit["lng"], cluster["center_lat"], cluster["center_lng"]),
                        unit_index,
                        cluster_index,
                    )
                )
        _, unit_index, cluster_index = min(candidate_pairs, key=lambda item: (item[0], item[1], item[2]))
        matches.append((remaining_units.pop(unit_index), remaining_clusters.pop(cluster_index)))

    return matches


def build_osrm_trip_url(base_url, points):
    coordinates = ";".join(f"{point['lng']},{point['lat']}" for point in points)
    trip_base = base_url.rstrip("/")
    params = {
        "roundtrip": "true",
        "source": "first",
        "destination": "last",
        "overview": "full",
        "geometries": "geojson",
        "steps": "false",
        "annotations": "false",
    }
    return f"{trip_base}/{coordinates}?{urlencode(params)}"


def request_osrm_trip(stops):
    if len(stops) < 2:
        return None

    request_url = build_osrm_trip_url(
        DEFAULT_OSRM_TRIP_URL,
        [{"lat": stop["lat"], "lng": stop["lng"]} for stop in stops],
    )
    request = Request(
        request_url,
        headers={"User-Agent": "CrimeRadar/1.0"},
    )
    try:
        with urlopen(request, timeout=DEFAULT_OSRM_TIMEOUT_SECONDS) as response:
            payload = json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError):
        return None

    waypoints = payload.get("waypoints") or []
    trips = payload.get("trips") or []
    if payload.get("code") != "Ok" or not waypoints or not trips:
        return None

    trip = trips[0]
    geometry = (trip.get("geometry") or {}).get("coordinates") or []
    if len(geometry) < 2:
        return None

    ordered_stops = [
        {
            **stops[input_index],
            "lat": float((waypoint.get("location") or [None, None])[1]),
            "lng": float((waypoint.get("location") or [None, None])[0]),
            "trip_order": waypoint.get("waypoint_index", input_index),
        }
        for input_index, waypoint in enumerate(waypoints)
        if waypoint.get("location")
    ]
    ordered_stops.sort(key=lambda item: item["trip_order"])

    return {
        "ordered_stops": ordered_stops,
        "geometry": {"type": "LineString", "coordinates": geometry},
        "route": geometry,
        "distance_km": round_value((trip.get("distance") or 0) / 1000, 2),
        "duration_min": round_value((trip.get("duration") or 0) / 60, 1),
        "request_url": request_url,
        "source": "osrm-trip",
    }


def order_grid_stops_nearest_neighbor(origin_stop, grid_stops):
    remaining = grid_stops[:]
    ordered = []
    current_lat = origin_stop["lat"]
    current_lng = origin_stop["lng"]
    while remaining:
        next_stop = min(
            remaining,
            key=lambda stop: (
                haversine_km(current_lat, current_lng, stop["lat"], stop["lng"])
                * (1.0 - min(stop.get("risk_score", 0.0), 95.0) / 180.0),
                -stop.get("risk_score", 0.0),
                stop["stop_id"],
            ),
        )
        ordered.append(next_stop)
        current_lat = next_stop["lat"]
        current_lng = next_stop["lng"]
        remaining.remove(next_stop)
    return ordered


def build_loop_stops_for_cluster(unit, cluster):
    start_stop = {
        "stop_id": f"{unit['unit_id']}-START",
        "stop_type": "station",
        "name": unit["station_name"],
        "lat": unit["lat"],
        "lng": unit["lng"],
    }
    grid_stops = [
        {
            "stop_id": grid["grid_id"],
            "stop_type": "grid",
            "name": f"High-risk grid {grid['grid_id']}",
            "grid_id": grid["grid_id"],
            "lat": grid["center_lat"],
            "lng": grid["center_lng"],
            "risk_score": grid["risk_score"],
            "risk_level": grid["risk_level"],
            "dominant_category": grid["dominant_category"],
        }
        for grid in cluster["grids"]
    ]
    end_stop = {
        "stop_id": f"{unit['unit_id']}-END",
        "stop_type": "station",
        "name": unit["station_name"],
        "lat": unit["lat"],
        "lng": unit["lng"],
    }
    return [start_stop] + grid_stops + [end_stop]


def build_unit_route_geojson(unit_plan):
    return {
        "type": "Feature",
        "geometry": unit_plan["route_geometry"],
        "properties": {
            "unit_id": unit_plan["unit_id"],
            "distance_km": unit_plan["distance_km"],
            "duration_min": unit_plan["duration_min"],
            "zones_covered": unit_plan["zones_covered"],
            "risk_level": unit_plan["risk_level"],
        },
    }


def build_patrol_geojson(unit_plans):
    return {
        "type": "FeatureCollection",
        "features": [build_unit_route_geojson(plan) for plan in unit_plans if plan.get("route_geometry")],
    }


def build_unit_patrol_from_cluster(unit, cluster, reroute_interval_min):
    stops = build_loop_stops_for_cluster(unit, cluster)
    snapped_stops = snap_stops_to_roads(stops)
    trip = request_osrm_trip(snapped_stops)
    if not trip:
        raise ValueError(
            f"OSRM trip routing was unavailable for patrol unit {unit['unit_id']}. Strict road-following routes could not be generated."
        )

    patrol_plan = {
        "unit_id": unit["unit_id"],
        "station_id": unit["station_id"],
        "station_name": unit["station_name"],
        "cluster_id": cluster["cluster_id"],
        "risk_level": cluster["risk_level"],
        "risk_score": cluster["risk_score"],
        "zones_covered": cluster["grid_count"],
        "distance_km": trip["distance_km"],
        "duration_min": trip["duration_min"],
        "route_geometry": trip["geometry"],
        "route": trip["route"],
        "routing_source": trip["source"],
        "optimization_source": "OSRM_TRIP",
        "reroute_after_min": reroute_interval_min,
        "stops": trip["ordered_stops"],
        "request_url": trip["request_url"],
        "trip_request_url": trip["request_url"],
        "high_risk_grid_ids": cluster["grid_ids"],
    }
    patrol_plan["geojson"] = build_unit_route_geojson(patrol_plan)
    return patrol_plan


def iso_timestamp(now=None):
    now = now or datetime.now(UTC)
    return now.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def generate_patrol_plan(
    district,
    target_year=None,
    target_month=None,
    grid_size_km=DEFAULT_GRID_SIZE_KM,
    unit_count=3,
    time_band="PEAK",
    weather="CLEAR",
    include_crime=True,
    is_festival=False,
    event_zones=None,
    lookback_months=DEFAULT_LOOKBACK_MONTHS,
    strategy="auto",
    reroute_interval_min=DEFAULT_REROUTE_INTERVAL_MIN,
    max_targets_per_unit=DEFAULT_PRIORITY_ZONE_LIMIT_PER_UNIT,
    patrol_units=None,
):
    today = date.today()
    target_year = target_year or today.year
    target_month = target_month or today.month
    district = normalize_text(district)
    if not district:
        raise ValueError("District is required.")
    if target_month < 1 or target_month > 12:
        raise ValueError("Month must be between 1 and 12.")

    incident_rows = load_incident_rows(
        district=district,
        target_year=target_year,
        target_month=target_month,
        lookback_months=lookback_months,
    )
    if not incident_rows:
        raise ValueError(f"No incident history was found for district '{district}'.")

    risk_map = build_grid_risk_map(
        incident_rows=incident_rows,
        target_year=target_year,
        target_month=target_month,
        cell_size_km=grid_size_km,
        time_band=time_band,
        weather=weather,
        include_crime=include_crime,
        is_festival=is_festival,
        event_zones=event_zones,
    )

    high_risk_grids = select_high_risk_grids(risk_map["grid_cells"], minimum_level="HIGH")
    unit_plan = calculate_required_unit_count(
        len(high_risk_grids),
        requested_unit_count=unit_count,
        min_zones_per_unit=5,
        max_zones_per_unit=10,
    )
    actual_unit_count = unit_plan["actual_unit_count"]
    if actual_unit_count < 1:
        raise ValueError("No patrol units could be derived from the high-risk grid set.")

    patrol_clusters = cluster_high_risk_grids_kmeans(high_risk_grids, actual_unit_count)
    while (
        patrol_clusters
        and max(cluster["grid_count"] for cluster in patrol_clusters) > 10
        and actual_unit_count < len(high_risk_grids)
    ):
        actual_unit_count += 1
        patrol_clusters = cluster_high_risk_grids_kmeans(high_risk_grids, actual_unit_count)
        unit_plan["actual_unit_count"] = actual_unit_count

    units = resolve_patrol_units(
        district=district,
        unit_count=actual_unit_count,
        requested_units=patrol_units,
        priority_zones=patrol_clusters,
    )
    if len(units) != len(patrol_clusters):
        actual_unit_count = min(len(units), len(patrol_clusters))
        patrol_clusters = cluster_high_risk_grids_kmeans(high_risk_grids, actual_unit_count)
        units = resolve_patrol_units(
            district=district,
            unit_count=actual_unit_count,
            requested_units=patrol_units,
            priority_zones=patrol_clusters,
        )
        unit_plan["actual_unit_count"] = actual_unit_count

    matches = match_units_to_clusters(units, patrol_clusters)
    patrol_plans = [
        build_unit_patrol_from_cluster(unit, cluster, reroute_interval_min=reroute_interval_min)
        for unit, cluster in matches
    ]

    covered_grid_ids = {
        grid_id
        for plan in patrol_plans
        for grid_id in plan.get("high_risk_grid_ids", [])
    }
    uncovered_high_risk = [
        grid for grid in high_risk_grids if grid["grid_id"] not in covered_grid_ids
    ]
    reroute_time = datetime.now(UTC) + timedelta(minutes=reroute_interval_min)
    high_risk_cells = [cell for cell in risk_map["grid_cells"] if cell["risk_level"] == "HIGH"]
    medium_risk_cells = [cell for cell in risk_map["grid_cells"] if cell["risk_level"] == "MEDIUM"]

    return {
        "status": "ok",
        "district": district,
        "target_year": target_year,
        "target_month": target_month,
        "generated_at": iso_timestamp(),
        "time_band": normalize_time_band(time_band),
        "seasonal_context": {
            "weather": normalize_weather(weather),
            "is_festival": bool(is_festival),
            "event_zones": normalize_event_zones(event_zones),
        },
        "strategy_requested": normalize_text(strategy),
        "strategy_used": "KMEANS + OSRM_TRIP",
        "risk_model": {
            "formula": "0.35*accident + 0.20*severity + 0.15*crime + 0.15*time + 0.15*season",
            "weights": RISK_WEIGHTS,
            "normalization": "percentile-clipped min-max to 0..100 by grid",
            "risk_bands": {
                "HIGH": ">= 70",
                "MEDIUM": ">= 40 and < 70",
                "LOW": "< 40",
            },
        },
        "grid_meta": {
            "grid_size_km": round_value(grid_size_km, 2),
            "cells_analyzed": risk_map["summary"]["cells_analyzed"],
            "high_risk_cells": len(high_risk_cells),
            "medium_risk_cells": len(medium_risk_cells),
            "selected_high_risk_grids": len(high_risk_grids),
            "patrol_clusters": len(patrol_clusters),
        },
        "unit_requirements": unit_plan,
        "priority_zones": patrol_clusters,
        "patrol_units": patrol_plans,
        "coverage": {
            "high_risk_grids_total": len(high_risk_grids),
            "high_risk_grids_covered": len(covered_grid_ids),
            "high_risk_grids_uncovered": len(uncovered_high_risk),
            "uncovered_grid_ids": [grid["grid_id"] for grid in uncovered_high_risk],
            "routes_generated": len(patrol_plans),
        },
        "reroute": {
            "recommended_interval_min": reroute_interval_min,
            "recommended_next_run_at": iso_timestamp(reroute_time),
            "triggers": [
                "new accident or crime incident in a monitored district",
                "weather state change such as rain or fog",
                "festival crowding or event-zone update",
                "road closure or traffic-speed degradation feed update",
            ],
        },
        "geojson": build_patrol_geojson(patrol_plans),
        "grid_cells": risk_map["grid_cells"][:80],
        "notes": [
            "All patrol routes are closed loops that start and end at the assigned patrol base.",
            "Every patrol stop is snapped to the road network with OSRM Nearest before trip generation.",
            "Multi-stop patrol routes use a single OSRM Trip geometry as the continuous road-following patrol line.",
            "If OSRM cannot return a road path, the planner fails closed instead of drawing unrealistic straight lines.",
        ],
    }
