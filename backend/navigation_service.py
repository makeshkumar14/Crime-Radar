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


def round_value(value, digits=2):
    return round(float(value), digits)


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


def build_accident_zone_snapshot(target_year, target_month):
    snapshot = _prediction_snapshot(target_year, target_month)
    zones = []
    for row in snapshot:
        if row["predicted_accident"] <= 0:
            continue
        zones.append(
            {
                "taluk_id": row["taluk_id"],
                "district": row["district"],
                "taluk": row["taluk"],
                "lat": row["lat"],
                "lng": row["lng"],
                "radius_km": round_value(max(4.0, row["radius_km"] * 0.9), 2),
                "risk_score": row["risk_score"],
                "risk_level": row["risk_level"],
                "predicted_total": row["predicted_total"],
                "predicted_accident": row["predicted_accident"],
                "predicted_top_category": row["predicted_top_category"],
                "location_query": f"{row['taluk']}, {row['district']}, Tamil Nadu, India",
            }
        )
    return zones


def select_relevant_accident_zones(zones, origin, destination, limit=36):
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


def dedupe_candidates(candidates):
    deduped = []
    seen = set()
    for candidate in candidates:
        signature = candidate["signature"]
        if signature in seen:
            continue
        seen.add(signature)
        deduped.append(candidate)
    return deduped


def score_route_against_accident_zones(candidate, accident_zones):
    coordinates = candidate["route"]
    hits = []
    accident_exposure = 0.0
    highest_zone_severity = 0.0

    for zone in accident_zones:
        threshold_km = max(2.4, (zone.get("radius_km") or 0) * 0.78)
        min_distance_km = minimum_polyline_distance_km(
            {"lat": zone["lat"], "lng": zone["lng"]},
            coordinates,
        )

        if min_distance_km > threshold_km:
            continue

        severity = (
            (zone.get("predicted_accident") or 0) * 5.5
            + (zone.get("risk_score") or 0) * 0.28
            + (zone.get("predicted_total") or 0) * 0.08
        )
        proximity_factor = max(0.2, 1 - (min_distance_km / threshold_km))
        weighted_severity = severity * proximity_factor
        accident_exposure += weighted_severity
        highest_zone_severity = max(highest_zone_severity, severity)
        hits.append(
            {
                **zone,
                "min_distance_km": round_value(min_distance_km, 2),
                "weighted_severity": round_value(weighted_severity, 2),
            }
        )

    hits.sort(
        key=lambda item: (
            -(item.get("predicted_accident") or 0),
            item.get("min_distance_km") or 0,
            -(item.get("risk_score") or 0),
        )
    )

    safety_penalty = min(
        95.0,
        accident_exposure * 1.55 + len(hits) * 4.5 + highest_zone_severity * 0.06,
    )
    safety_score = round_value(max(5.0, 100.0 - safety_penalty), 1)

    candidate.update(
        {
            "accidentExposure": round_value(accident_exposure, 1),
            "accidentZoneHits": len(hits),
            "accidentHits": hits,
            "safety_score": safety_score,
        }
    )
    return candidate


def safer_candidate(current_candidate, comparison_candidates):
    if not comparison_candidates:
        return current_candidate

    best = min(
        comparison_candidates,
        key=lambda candidate: (
            candidate["accidentExposure"],
            candidate["accidentZoneHits"],
            candidate["durationMin"] if candidate["durationMin"] is not None else float("inf"),
            candidate["distanceKm"],
        ),
    )

    improvement = current_candidate["accidentExposure"] - best["accidentExposure"]
    duration_delta = (
        (best["durationMin"] or 0) - (current_candidate["durationMin"] or 0)
        if best["durationMin"] is not None and current_candidate["durationMin"] is not None
        else 0
    )
    if best["signature"] == current_candidate["signature"]:
        return current_candidate
    if best["accidentZoneHits"] < current_candidate["accidentZoneHits"]:
        return best
    if improvement >= 4.0:
        return best
    if improvement >= 2.0 and duration_delta <= 8:
        return best
    if best["safety_score"] >= current_candidate["safety_score"] + 6:
        return best
    return current_candidate


def build_recommendation(current_path, safe_path):
    if current_path["source"].startswith("fallback"):
        return "OSRM routing was unavailable, so this trip preview is approximate."
    if current_path["signature"] == safe_path["signature"]:
        return "No clearly safer detour was found. The fastest and safest option uses the same main route."
    if safe_path["accidentZoneHits"] == 0 and current_path["accidentZoneHits"] > 0:
        return "Use the safest route. It avoids the accident-prone stretch on the main drive."
    if safe_path["accidentExposure"] <= current_path["accidentExposure"] - 6:
        return "Use the safest route. It reduces accident-zone exposure across the drive."
    return "A modestly safer option is available. It lowers accident exposure with a small detour."


def coordinate_label(point):
    return f"{point['lat']:.5f}, {point['lng']:.5f}"


def build_navigation_payload(origin, destination, mode="compare", target_year=None, target_month=None):
    today = date.today()
    target_year = target_year or today.year
    target_month = target_month or today.month

    all_zones = build_accident_zone_snapshot(target_year, target_month)
    accident_zones = select_relevant_accident_zones(all_zones, origin, destination)
    fast_route_url = build_osrm_url(
        DEFAULT_FAST_ROUTE_URL,
        origin,
        destination,
        DEFAULT_ALTERNATIVES if mode in {"compare", "safe"} else 0,
    )
    fast_snap_debug = {
        "origin": request_osrm_nearest(DEFAULT_FAST_ROUTE_URL, origin, "osrm-fast"),
        "destination": request_osrm_nearest(DEFAULT_FAST_ROUTE_URL, destination, "osrm-fast"),
    }

    fast_candidates = request_osrm_candidates(
        DEFAULT_FAST_ROUTE_URL,
        origin,
        destination,
        DEFAULT_ALTERNATIVES if mode in {"compare", "safe"} else 0,
        "osrm-fast",
    )
    if not fast_candidates:
        fast_candidates = [fallback_route(origin, destination)]

    comparison_candidates = fast_candidates[1:]
    safe_route_url = None
    safe_snap_debug = None
    if mode in {"compare", "safe"} and DEFAULT_SAFE_ROUTE_URL and DEFAULT_SAFE_ROUTE_URL != DEFAULT_FAST_ROUTE_URL:
        safe_route_url = build_osrm_url(
            DEFAULT_SAFE_ROUTE_URL,
            origin,
            destination,
            1,
        )
        safe_snap_debug = {
            "origin": request_osrm_nearest(DEFAULT_SAFE_ROUTE_URL, origin, "osrm-safe"),
            "destination": request_osrm_nearest(DEFAULT_SAFE_ROUTE_URL, destination, "osrm-safe"),
        }
        comparison_candidates.extend(
            request_osrm_candidates(
                DEFAULT_SAFE_ROUTE_URL,
                origin,
                destination,
                1,
                "osrm-safe",
            )
        )

    fast_candidates = dedupe_candidates(fast_candidates)
    comparison_candidates = dedupe_candidates(comparison_candidates)

    current_path = score_route_against_accident_zones(fast_candidates[0], accident_zones)
    scored_comparisons = [
        score_route_against_accident_zones(candidate, accident_zones)
        for candidate in comparison_candidates
    ]

    if mode == "fast":
        safe_path = current_path
    elif mode == "safe":
        safe_path = safer_candidate(current_path, scored_comparisons)
    else:
        safe_path = safer_candidate(current_path, scored_comparisons)

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
        "accident_zones": accident_zones,
        "route_diverges": route_diverges,
        "route_overlap_ratio": overlap_ratio,
        "risk_reduction": risk_reduction,
        "distance_delta_km": distance_delta_km,
        "duration_delta_min": duration_delta_min,
        "current_path": current_path,
        "safer_path": safe_path,
        "alerts": current_path["accidentHits"][:6],
        "recommendation": build_recommendation(current_path, safe_path),
    }


def build_navigation_from_taluks(origin_taluk_id, destination_taluk_id, mode="compare", target_year=None, target_month=None):
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
    )


def build_navigation_from_coordinates(source, destination, mode="compare", target_year=None, target_month=None):
    origin = parse_coordinate_pair(source)
    dest = parse_coordinate_pair(destination)
    return build_navigation_payload(
        origin,
        dest,
        mode=mode,
        target_year=target_year,
        target_month=target_month,
    )
