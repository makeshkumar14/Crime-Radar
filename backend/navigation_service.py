import json
import math
import os
from datetime import date
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from database import get_connection
from ml_engine import _prediction_snapshot


DEFAULT_FAST_ROUTE_URL = os.getenv(
    "OSRM_FAST_URL",
    "https://router.project-osrm.org/route/v1/driving",
).rstrip("/")
DEFAULT_SAFE_ROUTE_URL = os.getenv("OSRM_SAFE_URL", "").rstrip("/")
DEFAULT_TIMEOUT_SECONDS = float(os.getenv("OSRM_TIMEOUT_SECONDS", "8"))
DEFAULT_ALTERNATIVES = max(0, min(6, int(os.getenv("OSRM_ALTERNATIVES", "3"))))
DEFAULT_SAFE_ALTERNATIVES = max(1, min(4, int(os.getenv("OSRM_SAFE_ALTERNATIVES", "2"))))
DEFAULT_ACCIDENT_BUFFER_M = max(150.0, min(1000.0, float(os.getenv("NAV_ACCIDENT_BUFFER_M", "350"))))
DEFAULT_WARNING_BUFFER_M = max(
    DEFAULT_ACCIDENT_BUFFER_M,
    min(3000.0, float(os.getenv("NAV_WARNING_BUFFER_M", "900"))),
)
DEFAULT_MAX_DISTANCE_INCREASE_PCT = max(
    5.0,
    min(80.0, float(os.getenv("NAV_MAX_DISTANCE_INCREASE_PCT", "30"))),
)
DEFAULT_MAX_ETA_INCREASE_PCT = max(
    5.0,
    min(80.0, float(os.getenv("NAV_MAX_ETA_INCREASE_PCT", "20"))),
)
DEFAULT_ACCIDENT_ZONE_LIMIT = max(12, min(80, int(os.getenv("NAV_ACCIDENT_ZONE_LIMIT", "48"))))
DEFAULT_ROUTE_DEDUPE_OVERLAP = max(
    0.85,
    min(0.995, float(os.getenv("NAV_ROUTE_DEDUPE_OVERLAP", "0.97"))),
)


def round_value(value, digits=2):
    return round(float(value), digits)


def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def build_routing_policy(
    accident_buffer_m=None,
    warning_buffer_m=None,
    max_distance_increase_pct=None,
    max_eta_increase_pct=None,
    alternatives=None,
):
    strict_buffer_m = clamp(
        accident_buffer_m if accident_buffer_m is not None else DEFAULT_ACCIDENT_BUFFER_M,
        150.0,
        2000.0,
    )
    warning_buffer_m = clamp(
        warning_buffer_m if warning_buffer_m is not None else DEFAULT_WARNING_BUFFER_M,
        strict_buffer_m,
        5000.0,
    )
    max_distance_increase_pct = clamp(
        max_distance_increase_pct
        if max_distance_increase_pct is not None
        else DEFAULT_MAX_DISTANCE_INCREASE_PCT,
        5.0,
        80.0,
    )
    max_eta_increase_pct = clamp(
        max_eta_increase_pct
        if max_eta_increase_pct is not None
        else DEFAULT_MAX_ETA_INCREASE_PCT,
        5.0,
        80.0,
    )
    alternatives = max(0, min(6, int(alternatives if alternatives is not None else DEFAULT_ALTERNATIVES)))
    return {
        "strict_buffer_m": round_value(strict_buffer_m, 1),
        "strict_buffer_km": strict_buffer_m / 1000.0,
        "warning_buffer_m": round_value(warning_buffer_m, 1),
        "warning_buffer_km": warning_buffer_m / 1000.0,
        "max_distance_increase_pct": round_value(max_distance_increase_pct, 1),
        "max_distance_increase_ratio": max_distance_increase_pct / 100.0,
        "max_eta_increase_pct": round_value(max_eta_increase_pct, 1),
        "max_eta_increase_ratio": max_eta_increase_pct / 100.0,
        "alternatives": alternatives,
    }


def percent_increase(current_value, baseline_value):
    if baseline_value in (None, 0) or current_value is None:
        return None
    return round_value(((current_value - baseline_value) / baseline_value) * 100, 1)


def duration_sort_value(value):
    return value if value is not None else float("inf")


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
    earth_radius_km = 6371.0
    x = (lng * math.pi * earth_radius_km * math.cos((ref_lat * math.pi) / 180)) / 180
    y = (lat * math.pi * earth_radius_km) / 180
    return x, y


def point_to_segment_distance_km(point, start, end):
    ref_lat = (point["lat"] + start["lat"] + end["lat"]) / 3.0
    px, py = to_km_projection(point["lat"], point["lng"], ref_lat)
    ax, ay = to_km_projection(start["lat"], start["lng"], ref_lat)
    bx, by = to_km_projection(end["lat"], end["lng"], ref_lat)
    abx = bx - ax
    aby = by - ay
    apx = px - ax
    apy = py - ay
    length_sq = (abx * abx) + (aby * aby)
    if length_sq <= 1e-9:
        return math.sqrt((px - ax) ** 2 + (py - ay) ** 2)

    t = max(0.0, min(1.0, ((apx * abx) + (apy * aby)) / length_sq))
    closest_x = ax + abx * t
    closest_y = ay + aby * t
    return math.sqrt((px - closest_x) ** 2 + (py - closest_y) ** 2)


def minimum_polyline_distance_km(point, coordinates):
    if not coordinates:
        return float("inf")
    if len(coordinates) == 1:
        return point_to_segment_distance_km(point, coordinates[0], coordinates[0])

    best = float("inf")
    for index in range(len(coordinates) - 1):
        best = min(
            best,
            point_to_segment_distance_km(
                point,
                coordinates[index],
                coordinates[index + 1],
            ),
        )
    return best


def route_signature(points):
    if not points:
        return "empty"

    sample_step = max(1, len(points) // 10)
    sampled = [
        point
        for index, point in enumerate(points)
        if index % sample_step == 0 or index == len(points) - 1
    ]
    return "|".join(
        f"{point['lat']:.4f},{point['lng']:.4f}"
        for point in sampled
    )


def route_overlap_ratio(left_points, right_points):
    left_signature = set(route_signature(left_points).split("|"))
    right_signature = set(route_signature(right_points).split("|"))
    if left_signature == {"empty"} and right_signature == {"empty"}:
        return 1.0
    if not left_signature or not right_signature:
        return 0.0
    return len(left_signature & right_signature) / max(len(left_signature), len(right_signature), 1)


def parse_coordinate_pair(raw_value):
    parts = [part.strip() for part in raw_value.split(",")]
    if len(parts) != 2:
        raise ValueError("Coordinates must be supplied as 'longitude,latitude'.")

    lng = float(parts[0])
    lat = float(parts[1])
    if not (-180 <= lng <= 180 and -90 <= lat <= 90):
        raise ValueError("Coordinates are out of range.")

    return {"lat": lat, "lng": lng}


def get_taluk_location(taluk_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT taluk_id, district, taluk, lat, lng, radius_km
        FROM taluks
        WHERE taluk_id = ?
        """,
        [taluk_id],
    )
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def build_accident_zone_snapshot(target_year, target_month, policy=None):
    policy = policy or build_routing_policy()
    snapshot = _prediction_snapshot(target_year, target_month)
    zones = []
    for row in snapshot:
        if row["predicted_accident"] <= 0:
            continue
        zones.append(
            {
                "taluk_id": row["taluk_id"],
                "zone_id": row["taluk_id"],
                "district": row["district"],
                "taluk": row["taluk"],
                "lat": row["lat"],
                "lng": row["lng"],
                "radius_km": round_value(max(4.0, row["radius_km"] * 0.9), 2),
                "buffer_radius_m": policy["strict_buffer_m"],
                "buffer_radius_km": round_value(policy["strict_buffer_km"], 3),
                "warning_radius_m": policy["warning_buffer_m"],
                "warning_radius_km": round_value(policy["warning_buffer_km"], 3),
                "risk_score": row["risk_score"],
                "risk_level": row["risk_level"],
                "predicted_total": row["predicted_total"],
                "predicted_accident": row["predicted_accident"],
                "predicted_top_category": row["predicted_top_category"],
                "location_query": f"{row['taluk']}, {row['district']}, Tamil Nadu, India",
            }
        )
    return zones


def select_relevant_accident_zones(zones, origin, destination, limit=DEFAULT_ACCIDENT_ZONE_LIMIT):
    ranked = []
    for zone in zones:
        corridor_distance = point_to_segment_distance_km(zone, origin, destination)
        endpoint_distance = min(
            haversine_km(zone["lat"], zone["lng"], origin["lat"], origin["lng"]),
            haversine_km(zone["lat"], zone["lng"], destination["lat"], destination["lng"]),
        )
        ranked.append(
            (
                corridor_distance,
                endpoint_distance,
                -(zone["predicted_accident"] or 0),
                -(zone["risk_score"] or 0),
                zone,
            )
        )

    ranked.sort()
    return [item[-1] for item in ranked[:limit]]


def fallback_route(origin, destination, source_label="fallback"):
    coordinates = [origin, destination]
    distance_km = haversine_km(
        origin["lat"],
        origin["lng"],
        destination["lat"],
        destination["lng"],
    )
    return {
        "source": source_label,
        "route": coordinates,
        "geometry": {
            "type": "LineString",
            "coordinates": [[origin["lng"], origin["lat"]], [destination["lng"], destination["lat"]]],
        },
        "distanceKm": round_value(distance_km, 2),
        "distance_km": round_value(distance_km, 2),
        "durationMin": None,
        "duration_min": None,
        "weight": None,
        "signature": route_signature(coordinates),
        "request_coordinates": [origin, destination],
        "request_url": None,
    }


def build_osrm_url(base_url, origin, destination, alternatives):
    base_url = base_url.rstrip("/")
    coordinates = f"{origin['lng']},{origin['lat']};{destination['lng']},{destination['lat']}"
    params = {
        "alternatives": alternatives if alternatives > 0 else "false",
        "overview": "full",
        "geometries": "geojson",
        "steps": "false",
        "continue_straight": "true",
        "annotations": "false",
    }
    return f"{base_url}/{coordinates}?{urlencode(params)}"


def build_osrm_nearest_url(base_url, point):
    nearest_base = base_url.rstrip("/").replace("/route/v1/", "/nearest/v1/")
    return f"{nearest_base}/{point['lng']},{point['lat']}?number=1"


def request_osrm_nearest(base_url, point, source_label):
    request_url = build_osrm_nearest_url(base_url, point)
    request = Request(
        request_url,
        headers={"User-Agent": "CrimeRadar/1.0"},
    )

    try:
        with urlopen(request, timeout=DEFAULT_TIMEOUT_SECONDS) as response:
            payload = json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError):
        return {
            "status": "error",
            "source": source_label,
            "request_url": request_url,
            "input": {"lat": point["lat"], "lng": point["lng"]},
            "snapped": None,
            "snap_distance_m": None,
            "name": None,
        }

    waypoint = (payload.get("waypoints") or [None])[0]
    if payload.get("code") != "Ok" or not waypoint:
        return {
            "status": "error",
            "source": source_label,
            "request_url": request_url,
            "input": {"lat": point["lat"], "lng": point["lng"]},
            "snapped": None,
            "snap_distance_m": None,
            "name": None,
        }

    snapped_lng, snapped_lat = waypoint.get("location") or [None, None]
    return {
        "status": "ok",
        "source": source_label,
        "request_url": request_url,
        "input": {"lat": point["lat"], "lng": point["lng"]},
        "snapped": {"lat": snapped_lat, "lng": snapped_lng},
        "snap_distance_m": round_value(waypoint.get("distance") or 0, 2),
        "name": waypoint.get("name"),
    }


def request_osrm_candidates(base_url, origin, destination, alternatives, source_label):
    request_url = build_osrm_url(base_url, origin, destination, alternatives)
    request = Request(
        request_url,
        headers={"User-Agent": "CrimeRadar/1.0"},
    )

    try:
        with urlopen(request, timeout=DEFAULT_TIMEOUT_SECONDS) as response:
            payload = json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError):
        return []

    if payload.get("code") != "Ok":
        return []

    candidates = []
    for index, route in enumerate(payload.get("routes") or []):
        geometry = route.get("geometry") or {}
        coordinates = []
        for coordinate in geometry.get("coordinates") or []:
            if len(coordinate) < 2:
                continue
            lng, lat = coordinate[0], coordinate[1]
            coordinates.append({"lat": lat, "lng": lng})

        if len(coordinates) < 2:
            continue

        candidate_source = source_label if index == 0 else f"{source_label}-alt-{index}"
        candidates.append(
            {
                "source": candidate_source,
                "route": coordinates,
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[point["lng"], point["lat"]] for point in coordinates],
                },
                "distanceKm": round_value((route.get("distance") or 0) / 1000, 2),
                "distance_km": round_value((route.get("distance") or 0) / 1000, 2),
                "durationMin": round_value((route.get("duration") or 0) / 60, 1),
                "duration_min": round_value((route.get("duration") or 0) / 60, 1),
                "weight": route.get("weight"),
                "signature": route_signature(coordinates),
                "request_coordinates": [origin, destination],
                "request_url": request_url,
            }
        )

    return candidates


def dedupe_candidates(candidates, overlap_threshold=DEFAULT_ROUTE_DEDUPE_OVERLAP):
    deduped = []
    seen = set()
    for candidate in candidates:
        signature = candidate["signature"]
        if signature in seen:
            continue
        if any(
            route_overlap_ratio(candidate["route"], existing["route"]) >= overlap_threshold
            for existing in deduped
        ):
            continue
        seen.add(signature)
        deduped.append(candidate)
    return deduped


def score_route_against_accident_zones(candidate, accident_zones, policy=None):
    policy = policy or build_routing_policy()
    coordinates = candidate["route"]
    hits = []
    crossed_hits = []
    near_hits = []
    accident_exposure = 0.0
    nearest_zone_distance_km = float("inf")

    for zone in accident_zones:
        strict_buffer_km = max(policy["strict_buffer_km"], zone.get("buffer_radius_km") or 0)
        warning_buffer_km = max(strict_buffer_km, zone.get("warning_radius_km") or policy["warning_buffer_km"])
        min_distance_km = minimum_polyline_distance_km(
            {"lat": zone["lat"], "lng": zone["lng"]},
            coordinates,
        )
        nearest_zone_distance_km = min(nearest_zone_distance_km, min_distance_km)

        if min_distance_km > warning_buffer_km:
            continue

        severity = (
            1.0
            + (zone.get("predicted_accident") or 0) * 0.55
            + (zone.get("risk_score") or 0) / 90.0
            + (zone.get("predicted_total") or 0) / 140.0
        )

        intersects_buffer = min_distance_km <= strict_buffer_km
        if intersects_buffer:
            proximity_factor = 1.0
            weighted_severity = 35.0 + severity * 6.0
        else:
            distance_band_km = max(warning_buffer_km - strict_buffer_km, 0.001)
            proximity_factor = max(
                0.0,
                (warning_buffer_km - min_distance_km) / distance_band_km,
            )
            weighted_severity = severity * (1.5 + proximity_factor * 4.5)

        accident_exposure += weighted_severity
        hit = {
            **zone,
            "min_distance_km": round_value(min_distance_km, 3),
            "min_distance_m": round_value(min_distance_km * 1000, 1),
            "weighted_severity": round_value(weighted_severity, 2),
            "proximity_factor": round_value(proximity_factor, 3),
            "intersects_buffer": intersects_buffer,
            "strict_buffer_m": zone.get("buffer_radius_m") or policy["strict_buffer_m"],
            "warning_buffer_m": zone.get("warning_radius_m") or policy["warning_buffer_m"],
        }
        hits.append(hit)
        if intersects_buffer:
            crossed_hits.append(hit)
        else:
            near_hits.append(hit)

    hits.sort(
        key=lambda item: (
            not item.get("intersects_buffer"),
            item.get("min_distance_km") or 0,
            -(item.get("predicted_accident") or 0),
            -(item.get("risk_score") or 0),
        )
    )
    crossed_hits = [item for item in hits if item.get("intersects_buffer")]
    near_hits = [item for item in hits if not item.get("intersects_buffer")]

    risk_score_value = round_value(min(100.0, accident_exposure), 1)
    safety_score = round_value(max(0.0, 100.0 - risk_score_value), 1)
    if crossed_hits or risk_score_value >= 70:
        risk_label = "HIGH"
    elif len(near_hits) >= 2 or risk_score_value >= 30:
        risk_label = "MEDIUM"
    else:
        risk_label = "LOW"

    candidate.update(
        {
            "accidentExposure": round_value(accident_exposure, 1),
            "accidentZoneHits": len(crossed_hits),
            "nearZoneHits": len(near_hits),
            "affectedZoneHits": len(hits),
            "accidentHits": hits,
            "crossedAccidentZones": crossed_hits,
            "nearAccidentZones": near_hits,
            "safety_score": safety_score,
            "riskScoreValue": risk_score_value,
            "risk_label": risk_label,
            "minZoneClearanceKm": None
            if nearest_zone_distance_km == float("inf")
            else round_value(nearest_zone_distance_km, 3),
            "minZoneClearanceM": None
            if nearest_zone_distance_km == float("inf")
            else round_value(nearest_zone_distance_km * 1000, 1),
        }
    )
    return candidate


def choose_fastest_candidate(candidates):
    if not candidates:
        return None
    return min(
        candidates,
        key=lambda candidate: (
            duration_sort_value(candidate.get("durationMin")),
            candidate.get("distanceKm") or float("inf"),
            candidate.get("accidentExposure") or 0,
            candidate.get("accidentZoneHits") or 0,
        ),
    )


def annotate_candidate_balancing(candidates, baseline_candidate, policy):
    for candidate in candidates:
        distance_increase_pct = percent_increase(
            candidate.get("distanceKm"),
            baseline_candidate.get("distanceKm"),
        )
        eta_increase_pct = percent_increase(
            candidate.get("durationMin"),
            baseline_candidate.get("durationMin"),
        )
        candidate["distanceIncreasePct"] = distance_increase_pct
        candidate["etaIncreasePct"] = eta_increase_pct
        candidate["distance_delta_km"] = round_value(
            (candidate.get("distanceKm") or 0) - (baseline_candidate.get("distanceKm") or 0),
            2,
        )
        candidate["duration_delta_min"] = (
            None
            if candidate.get("durationMin") is None or baseline_candidate.get("durationMin") is None
            else round_value(candidate["durationMin"] - baseline_candidate["durationMin"], 1)
        )
        candidate["withinBalanceLimits"] = (
            (distance_increase_pct is None or distance_increase_pct <= policy["max_distance_increase_pct"])
            and (eta_increase_pct is None or eta_increase_pct <= policy["max_eta_increase_pct"])
        )
    return candidates


def safer_candidate_sort_key(candidate):
    return (
        candidate.get("accidentZoneHits") or 0,
        candidate.get("accidentExposure") or 0,
        candidate.get("nearZoneHits") or 0,
        duration_sort_value(candidate.get("durationMin")),
        candidate.get("distanceKm") or float("inf"),
    )


def safer_candidate(current_candidate, comparison_candidates, policy=None, mode="compare"):
    policy = policy or build_routing_policy()
    if not comparison_candidates:
        current_candidate["selection_profile"] = "fast_only"
        return current_candidate

    candidates = annotate_candidate_balancing(
        comparison_candidates,
        current_candidate,
        policy,
    )

    if mode == "fast":
        current_candidate["selection_profile"] = "fast_only"
        return current_candidate

    balanced_candidates = [candidate for candidate in candidates if candidate["withinBalanceLimits"]]
    strict_balanced_candidates = [
        candidate
        for candidate in balanced_candidates
        if candidate["accidentZoneHits"] == 0
    ]

    if strict_balanced_candidates:
        selected = min(strict_balanced_candidates, key=safer_candidate_sort_key)
        selected["selection_profile"] = "strict_safe_balanced"
        return selected

    if balanced_candidates:
        selected = min(balanced_candidates, key=safer_candidate_sort_key)
        selected["selection_profile"] = "least_risky_balanced_fallback"
        return selected

    selected = min(candidates, key=safer_candidate_sort_key)
    selected["selection_profile"] = "least_risky_unbalanced_fallback"
    return selected


def build_route_summary(candidate, zones_avoided=0):
    return {
        "distance_km": candidate.get("distanceKm"),
        "eta_min": candidate.get("durationMin"),
        "risk_score": candidate.get("risk_label"),
        "risk_score_value": candidate.get("riskScoreValue"),
        "accident_zones_crossed": candidate.get("accidentZoneHits"),
        "accident_zones_nearby": candidate.get("nearZoneHits"),
        "zones_avoided": zones_avoided,
        "distance_increase_pct": candidate.get("distanceIncreasePct"),
        "eta_increase_pct": candidate.get("etaIncreasePct"),
        "within_balance_limits": candidate.get("withinBalanceLimits", True),
        "selection_profile": candidate.get("selection_profile"),
    }


def build_zone_overlays(accident_zones, fastest_path, safer_path):
    fastest_hits = {hit["zone_id"]: hit for hit in fastest_path.get("accidentHits", [])}
    safer_hits = {hit["zone_id"]: hit for hit in safer_path.get("accidentHits", [])}
    fastest_crossed = {hit["zone_id"] for hit in fastest_path.get("crossedAccidentZones", [])}
    safer_crossed = {hit["zone_id"] for hit in safer_path.get("crossedAccidentZones", [])}
    avoided_zone_ids = fastest_crossed - safer_crossed

    annotated_zones = []
    for zone in accident_zones:
        fastest_hit = fastest_hits.get(zone["zone_id"])
        safer_hit = safer_hits.get(zone["zone_id"])
        annotated_zones.append(
            {
                **zone,
                "crossed_by_fastest": zone["zone_id"] in fastest_crossed,
                "crossed_by_safer": zone["zone_id"] in safer_crossed,
                "near_fastest": zone["zone_id"] in fastest_hits,
                "near_safer": zone["zone_id"] in safer_hits,
                "avoided_by_safer": zone["zone_id"] in avoided_zone_ids,
                "fastest_distance_km": fastest_hit.get("min_distance_km") if fastest_hit else None,
                "safer_distance_km": safer_hit.get("min_distance_km") if safer_hit else None,
            }
        )

    return annotated_zones, avoided_zone_ids


def build_recommendation(current_path, safe_path, policy, zones_avoided):
    if current_path["source"].startswith("fallback"):
        return "OSRM routing was unavailable, so this trip preview is approximate."
    if safe_path["selection_profile"] == "fast_only":
        return "Fast mode keeps the quickest road route without applying a safer detour."
    if current_path["signature"] == safe_path["signature"] and current_path["accidentZoneHits"] == 0:
        return "The fastest route already avoids the configured accident buffers, so it is also the safest valid option."
    if safe_path["selection_profile"] == "strict_safe_balanced":
        return (
            f"Safer route avoids {zones_avoided} accident-prone areas and stays within "
            f"{policy['max_distance_increase_pct']}% distance and {policy['max_eta_increase_pct']}% ETA limits."
        )
    if safe_path["selection_profile"] == "least_risky_balanced_fallback":
        return "No zero-crossing detour stayed within the balance limits, so the advisor chose the least risky realistic route."
    return "No balanced safe detour was available, so the advisor returned the least risky road route instead of blocking navigation."


def coordinate_label(point):
    return f"{point['lat']:.5f}, {point['lng']:.5f}"


def build_navigation_payload(
    origin,
    destination,
    mode="compare",
    target_year=None,
    target_month=None,
    accident_buffer_m=None,
    warning_buffer_m=None,
    max_distance_increase_pct=None,
    max_eta_increase_pct=None,
    alternatives=None,
):
    today = date.today()
    target_year = target_year or today.year
    target_month = target_month or today.month
    policy = build_routing_policy(
        accident_buffer_m=accident_buffer_m,
        warning_buffer_m=warning_buffer_m,
        max_distance_increase_pct=max_distance_increase_pct,
        max_eta_increase_pct=max_eta_increase_pct,
        alternatives=alternatives,
    )
    requested_alternatives = policy["alternatives"] if mode in {"compare", "safe"} else 0

    all_zones = build_accident_zone_snapshot(target_year, target_month, policy=policy)
    accident_zones = select_relevant_accident_zones(all_zones, origin, destination)
    fast_route_url = build_osrm_url(
        DEFAULT_FAST_ROUTE_URL,
        origin,
        destination,
        requested_alternatives,
    )
    fast_snap_debug = {
        "origin": request_osrm_nearest(DEFAULT_FAST_ROUTE_URL, origin, "osrm-fast"),
        "destination": request_osrm_nearest(DEFAULT_FAST_ROUTE_URL, destination, "osrm-fast"),
    }

    fast_candidates = request_osrm_candidates(
        DEFAULT_FAST_ROUTE_URL,
        origin,
        destination,
        requested_alternatives,
        "osrm-fast",
    )
    safe_route_url = None
    safe_snap_debug = None
    safe_candidates = []
    if mode in {"compare", "safe"} and DEFAULT_SAFE_ROUTE_URL and DEFAULT_SAFE_ROUTE_URL != DEFAULT_FAST_ROUTE_URL:
        safe_alternatives = min(
            DEFAULT_SAFE_ALTERNATIVES,
            max(1, requested_alternatives or 1),
        )
        safe_route_url = build_osrm_url(
            DEFAULT_SAFE_ROUTE_URL,
            origin,
            destination,
            safe_alternatives,
        )
        safe_snap_debug = {
            "origin": request_osrm_nearest(DEFAULT_SAFE_ROUTE_URL, origin, "osrm-safe"),
            "destination": request_osrm_nearest(DEFAULT_SAFE_ROUTE_URL, destination, "osrm-safe"),
        }
        safe_candidates = request_osrm_candidates(
            DEFAULT_SAFE_ROUTE_URL,
            origin,
            destination,
            safe_alternatives,
            "osrm-safe",
        )

    if not fast_candidates and safe_candidates:
        fast_candidates = safe_candidates[:]
    if not fast_candidates:
        fast_candidates = [fallback_route(origin, destination)]

    fast_candidates = dedupe_candidates(fast_candidates)
    comparison_candidates = dedupe_candidates(fast_candidates + safe_candidates)
    scored_candidates = [
        score_route_against_accident_zones(dict(candidate), accident_zones, policy=policy)
        for candidate in comparison_candidates
    ]
    fast_candidate_signatures = {candidate["signature"] for candidate in fast_candidates}
    fast_scored_candidates = [
        candidate
        for candidate in scored_candidates
        if candidate["signature"] in fast_candidate_signatures
    ]
    current_path = choose_fastest_candidate(fast_scored_candidates) or choose_fastest_candidate(scored_candidates)
    annotate_candidate_balancing([current_path], current_path, policy)
    safe_path = safer_candidate(
        current_path,
        scored_candidates,
        policy=policy,
        mode=mode,
    )

    accident_zones, avoided_zone_ids = build_zone_overlays(accident_zones, current_path, safe_path)
    zones_avoided = len(avoided_zone_ids)
    current_path["zonesAvoided"] = 0
    safe_path["zonesAvoided"] = zones_avoided

    route_diverges = current_path["signature"] != safe_path["signature"]
    overlap_ratio = round_value(route_overlap_ratio(current_path["route"], safe_path["route"]), 2)
    risk_reduction = round_value(
        max(0.0, current_path["accidentExposure"] - safe_path["accidentExposure"]),
        1,
    )
    distance_delta_km = round_value(
        safe_path["distanceKm"] - current_path["distanceKm"],
        2,
    )

    if current_path["durationMin"] is None or safe_path["durationMin"] is None:
        duration_delta_min = None
    else:
        duration_delta_min = round_value(safe_path["durationMin"] - current_path["durationMin"], 1)

    recommendation = build_recommendation(
        current_path,
        safe_path,
        policy,
        zones_avoided,
    )
    alerts = current_path["crossedAccidentZones"] or current_path["accidentHits"]

    current_path["recommendation"] = recommendation
    safe_path["recommendation"] = recommendation

    return {
        "status": "ok",
        "mode": mode,
        "target_year": target_year,
        "target_month": target_month,
        "origin": origin,
        "destination": destination,
        "origin_query": origin.get("label") or coordinate_label(origin),
        "destination_query": destination.get("label") or coordinate_label(destination),
        "request_debug": {
            "fast_route_url": fast_route_url,
            "safe_route_url": safe_route_url,
        },
        "snap_debug": {
            "fast": fast_snap_debug,
            "safe": safe_snap_debug,
        },
        "routing_policy": policy,
        "accident_zones": accident_zones,
        "route_diverges": route_diverges,
        "route_overlap_ratio": overlap_ratio,
        "risk_reduction": risk_reduction,
        "distance_delta_km": distance_delta_km,
        "duration_delta_min": duration_delta_min,
        "fastest_route": build_route_summary(current_path, zones_avoided=0),
        "safer_route": build_route_summary(safe_path, zones_avoided=zones_avoided),
        "comparison": {
            "distance_delta_km": distance_delta_km,
            "duration_delta_min": duration_delta_min,
            "distance_increase_pct": safe_path.get("distanceIncreasePct"),
            "eta_increase_pct": safe_path.get("etaIncreasePct"),
            "risk_reduction": risk_reduction,
            "route_diverges": route_diverges,
            "route_overlap_ratio": overlap_ratio,
            "zones_avoided": zones_avoided,
            "selected_route_balanced": safe_path.get("withinBalanceLimits", True),
            "selection_profile": safe_path.get("selection_profile"),
        },
        "current_path": current_path,
        "safer_path": safe_path,
        "alerts": alerts[:6],
        "recommendation": recommendation,
    }


def build_navigation_from_taluks(
    origin_taluk_id,
    destination_taluk_id,
    mode="compare",
    target_year=None,
    target_month=None,
    accident_buffer_m=None,
    warning_buffer_m=None,
    max_distance_increase_pct=None,
    max_eta_increase_pct=None,
    alternatives=None,
):
    origin = get_taluk_location(origin_taluk_id)
    destination = get_taluk_location(destination_taluk_id)
    if not origin or not destination:
        return {"status": "error", "message": "Origin or destination zone not found"}
    if origin_taluk_id == destination_taluk_id:
        return {"status": "error", "message": "Origin and destination must be different"}

    origin["label"] = f"{origin['taluk']}, {origin['district']}, Tamil Nadu, India"
    destination["label"] = f"{destination['taluk']}, {destination['district']}, Tamil Nadu, India"
    return build_navigation_payload(
        origin,
        destination,
        mode=mode,
        target_year=target_year,
        target_month=target_month,
        accident_buffer_m=accident_buffer_m,
        warning_buffer_m=warning_buffer_m,
        max_distance_increase_pct=max_distance_increase_pct,
        max_eta_increase_pct=max_eta_increase_pct,
        alternatives=alternatives,
    )


def build_navigation_from_coordinates(
    source,
    destination,
    mode="compare",
    target_year=None,
    target_month=None,
    accident_buffer_m=None,
    warning_buffer_m=None,
    max_distance_increase_pct=None,
    max_eta_increase_pct=None,
    alternatives=None,
):
    origin = parse_coordinate_pair(source)
    dest = parse_coordinate_pair(destination)
    return build_navigation_payload(
        origin,
        dest,
        mode=mode,
        target_year=target_year,
        target_month=target_month,
        accident_buffer_m=accident_buffer_m,
        warning_buffer_m=warning_buffer_m,
        max_distance_increase_pct=max_distance_increase_pct,
        max_eta_increase_pct=max_eta_increase_pct,
        alternatives=alternatives,
    )
