from __future__ import annotations

import json
import math
import random
import re
from collections import defaultdict
from pathlib import Path

from database import get_connection

BASE_DIR = Path(__file__).resolve().parent
RAW_DIR = BASE_DIR / "data" / "raw"
DATA_SEED_VERSION = "ops_seed_v1"
YEARS = [2024, 2025, 2026]

DISTRICT_ALIASES = {
    "KALLAKURICHCHI": "KALLAKURICHI",
    "KALLAKURICHI": "KALLAKURICHI",
    "KANCHIPURAM": "KANCHEEPURAM",
    "KANCHEEPURAM": "KANCHEEPURAM",
    "KANNIYAKUMARI": "KANYAKUMARI",
    "KANYAKUMARI": "KANYAKUMARI",
    "SIVAGANGA": "SIVAGANGAI",
    "SIVAGANGAI": "SIVAGANGAI",
    "THE NILGIRIS": "NILGIRIS",
    "NILGIRIS": "NILGIRIS",
    "TIRUCHIRAPPALLI": "THIRUCHIRAPPALLI",
    "THIRUCHIRAPPALLI": "THIRUCHIRAPPALLI",
    "TIRUPPATTUR": "THIRUPATHUR",
    "THIRUPATHUR": "THIRUPATHUR",
    "THIRUVALLUR": "TIRUVALLUR",
    "TIRUVALLUR": "TIRUVALLUR",
    "VILUPPURAM": "VILLUPPURAM",
    "VILLUPPURAM": "VILLUPPURAM",
}

TALUK_FIXES = {
    "MADURAMDAGAM": "MADURANTHAGAM",
    "TINDIVANAMM": "TINDIVANAM",
}

URBAN_DISTRICTS = {
    "CHENNAI",
    "CHENGALPATTU",
    "COIMBATORE",
    "MADURAI",
    "TIRUPPUR",
    "THIRUCHIRAPPALLI",
    "SALEM",
    "VELLORE",
}

COASTAL_DISTRICTS = {
    "CUDDALORE",
    "NAGAPATTINAM",
    "MAYILADUTHURAI",
    "THIRUVARUR",
    "RAMANATHAPURAM",
    "THOOTHUKKUDI",
    "KANYAKUMARI",
    "CHENGALPATTU",
}

HIGHWAY_DISTRICTS = {
    "KRISHNAGIRI",
    "DHARMAPURI",
    "SALEM",
    "NAMAKKAL",
    "ERODE",
    "COIMBATORE",
    "TIRUPPUR",
    "RANIPET",
    "VELLORE",
    "THIRUCHIRAPPALLI",
}

INDUSTRIAL_DISTRICTS = {
    "COIMBATORE",
    "TIRUPPUR",
    "ERODE",
    "SALEM",
    "RANIPET",
    "VELLORE",
    "KANCHEEPURAM",
    "CHENGALPATTU",
}

HILL_TOURISM_DISTRICTS = {
    "NILGIRIS",
    "DINDIGUL",
    "KANYAKUMARI",
    "TENKASI",
    "THENI",
}

CATEGORY_CONFIG = {
    "Violent": {
        "ipc": ["302", "307", "324"],
        "severity": "HIGH",
        "base": 0.82,
        "month": [0.94, 0.92, 0.95, 1.0, 1.04, 1.08, 1.1, 1.06, 1.0, 1.03, 1.08, 1.12],
        "time_slots": [("NIGHT", 0.38), ("EVENING", 0.34), ("AFTERNOON", 0.18), ("MORNING", 0.1)],
    },
    "Property": {
        "ipc": ["379", "392"],
        "severity": "MEDIUM",
        "base": 1.26,
        "month": [0.86, 0.88, 0.9, 0.96, 1.0, 1.03, 1.02, 1.0, 1.08, 1.2, 1.24, 1.26],
        "time_slots": [("EVENING", 0.4), ("NIGHT", 0.28), ("AFTERNOON", 0.2), ("MORNING", 0.12)],
    },
    "Fraud": {
        "ipc": ["420", "465"],
        "severity": "MEDIUM",
        "base": 0.76,
        "month": [0.92, 0.94, 0.95, 0.98, 1.0, 1.02, 1.0, 1.01, 1.05, 1.1, 1.12, 1.08],
        "time_slots": [("AFTERNOON", 0.42), ("MORNING", 0.3), ("EVENING", 0.2), ("NIGHT", 0.08)],
    },
    "Women Safety": {
        "ipc": ["354", "376", "498-A"],
        "severity": "HIGH",
        "base": 0.88,
        "month": [0.9, 0.92, 0.95, 0.97, 1.0, 1.04, 1.05, 1.04, 1.02, 1.08, 1.12, 1.14],
        "time_slots": [("EVENING", 0.36), ("NIGHT", 0.32), ("AFTERNOON", 0.18), ("MORNING", 0.14)],
    },
    "Public Order": {
        "ipc": ["147", "153-A"],
        "severity": "MEDIUM",
        "base": 0.66,
        "month": [0.9, 0.9, 0.96, 1.04, 1.08, 1.06, 1.0, 0.96, 1.0, 1.08, 1.1, 1.02],
        "time_slots": [("EVENING", 0.38), ("AFTERNOON", 0.3), ("NIGHT", 0.18), ("MORNING", 0.14)],
    },
    "NDPS": {
        "ipc": ["20", "21"],
        "severity": "HIGH",
        "base": 0.38,
        "month": [0.95, 0.95, 0.96, 0.98, 1.0, 1.02, 1.04, 1.03, 1.02, 1.05, 1.08, 1.1],
        "time_slots": [("NIGHT", 0.46), ("EVENING", 0.3), ("AFTERNOON", 0.16), ("MORNING", 0.08)],
    },
    "Excise Act": {
        "ipc": ["60", "72"],
        "severity": "MEDIUM",
        "base": 0.42,
        "month": [0.92, 0.92, 0.95, 0.98, 1.0, 1.03, 1.04, 1.02, 1.01, 1.06, 1.08, 1.12],
        "time_slots": [("NIGHT", 0.34), ("EVENING", 0.3), ("AFTERNOON", 0.2), ("MORNING", 0.16)],
    },
    "Accident": {
        "ipc": ["IRAD-ACCIDENT"],
        "severity": "HIGH",
        "base": 0.84,
        "month": [0.94, 0.93, 0.95, 0.97, 1.0, 1.02, 1.02, 1.0, 1.08, 1.16, 1.18, 1.1],
        "time_slots": [("EVENING", 0.34), ("NIGHT", 0.28), ("AFTERNOON", 0.22), ("MORNING", 0.16)],
    },
}


def normalize_text(value: str) -> str:
    value = (value or "").strip().upper()
    value = re.sub(r"\s+", " ", value)
    return value


def normalize_district(value: str) -> str:
    return DISTRICT_ALIASES.get(normalize_text(value), normalize_text(value))


def normalize_taluk(value: str) -> str:
    value = TALUK_FIXES.get(normalize_text(value), normalize_text(value))
    return value


def slugify(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "-", normalize_text(value)).strip("-")


def load_taluk_rows():
    html = (RAW_DIR / "tn_taluk_source.html").read_text(
        encoding="utf-8", errors="ignore"
    )
    rows = re.findall(
        r'<tr><td>\d+</td><td>([^<]+)</td>\s*<td class="text-left">([^<]+)</td></tr>',
        html,
    )
    taluks = [
        {
            "district": normalize_district(district),
            "taluk": normalize_taluk(taluk),
        }
        for district, taluk in rows
    ]
    return taluks


def polygon_area(ring):
    area = 0.0
    for idx in range(len(ring)):
        x1, y1 = ring[idx]
        x2, y2 = ring[(idx + 1) % len(ring)]
        area += (x1 * y2) - (x2 * y1)
    return area / 2.0


def ring_centroid(ring):
    area = polygon_area(ring)
    if abs(area) < 1e-9:
        xs = [point[0] for point in ring]
        ys = [point[1] for point in ring]
        return sum(xs) / len(xs), sum(ys) / len(ys), 0.0

    factor = 0.0
    cx = 0.0
    cy = 0.0
    for idx in range(len(ring)):
        x1, y1 = ring[idx]
        x2, y2 = ring[(idx + 1) % len(ring)]
        step = (x1 * y2) - (x2 * y1)
        factor += step
        cx += (x1 + x2) * step
        cy += (y1 + y2) * step

    factor *= 0.5
    cx /= 6.0 * factor
    cy /= 6.0 * factor
    return cx, cy, abs(factor)


def point_in_ring(lng, lat, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        intersects = ((yi > lat) != (yj > lat)) and (
            lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def point_in_feature(lng, lat, rings):
    inside = False
    for ring in rings:
        if point_in_ring(lng, lat, ring):
            inside = not inside
    return inside


def load_district_geometries():
    raw = json.loads((RAW_DIR / "tn_districts_bharatmaps.json").read_text(encoding="utf-8-sig"))
    districts = {}
    for feature in raw["features"]:
        district = normalize_district(feature["attributes"]["dtname"])
        rings = feature["geometry"]["rings"]
        min_lng = min(point[0] for ring in rings for point in ring)
        max_lng = max(point[0] for ring in rings for point in ring)
        min_lat = min(point[1] for ring in rings for point in ring)
        max_lat = max(point[1] for ring in rings for point in ring)

        weighted = [ring_centroid(ring) for ring in rings if len(ring) >= 3]
        total_area = sum(item[2] for item in weighted) or 1.0
        centroid_lng = sum(item[0] * item[2] for item in weighted) / total_area
        centroid_lat = sum(item[1] * item[2] for item in weighted) / total_area

        districts[district] = {
            "district": district,
            "rings": rings,
            "bbox": (min_lng, min_lat, max_lng, max_lat),
            "centroid": (centroid_lat, centroid_lng),
        }
    return districts


def halton(index, base):
    result = 0.0
    factor = 1.0 / base
    current = index
    while current > 0:
        result += factor * (current % base)
        current //= base
        factor /= base
    return result


def generate_points_in_district(geometry, count, seed_offset):
    min_lng, min_lat, max_lng, max_lat = geometry["bbox"]
    rings = geometry["rings"]
    centroid_lat, centroid_lng = geometry["centroid"]
    points = []
    attempt = 1

    while len(points) < count and attempt <= count * 500:
        lng = min_lng + (max_lng - min_lng) * halton(attempt + seed_offset, 2)
        lat = min_lat + (max_lat - min_lat) * halton(attempt + seed_offset, 3)
        if point_in_feature(lng, lat, rings):
            points.append((lat, lng))
        attempt += 1

    while len(points) < count:
        idx = len(points) + 1
        angle = (idx / max(count, 1)) * math.pi * 2.0
        radius = 0.02 + (idx % 5) * 0.01
        lat = centroid_lat + math.sin(angle) * radius
        lng = centroid_lng + math.cos(angle) * radius
        if point_in_feature(lng, lat, rings):
            points.append((lat, lng))
        else:
            points.append((centroid_lat, centroid_lng))

    return points


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


def jitter_point(lat, lng, seed_value, radius_km):
    rng = random.Random(seed_value)
    angle = rng.random() * math.pi * 2.0
    distance_km = radius_km * (0.12 + rng.random() * 0.28)
    dlat = distance_km / 111.0
    dlng = distance_km / max(20.0, 111.0 * math.cos(math.radians(lat)))
    return lat + math.sin(angle) * dlat, lng + math.cos(angle) * dlng


def infer_profile(district):
    tags = []
    if district in URBAN_DISTRICTS:
        tags.append("urban")
    if district in COASTAL_DISTRICTS:
        tags.append("coastal")
    if district in HIGHWAY_DISTRICTS:
        tags.append("highway")
    if district in INDUSTRIAL_DISTRICTS:
        tags.append("industrial")
    if district in HILL_TOURISM_DISTRICTS:
        tags.append("tourism")
    return ",".join(tags) or "mixed"


def district_category_multiplier(district, category):
    multiplier = 1.0

    if district in URBAN_DISTRICTS and category in {"Property", "Fraud", "Women Safety"}:
        multiplier *= 1.28
    if district in HIGHWAY_DISTRICTS and category in {"Accident", "Property", "Public Order"}:
        multiplier *= 1.24
    if district in COASTAL_DISTRICTS and category in {"NDPS", "Excise Act", "Accident"}:
        multiplier *= 1.22
    if district in INDUSTRIAL_DISTRICTS and category in {"Fraud", "Property", "Accident"}:
        multiplier *= 1.16
    if district in HILL_TOURISM_DISTRICTS and category in {"Accident", "Property", "Women Safety"}:
        multiplier *= 1.12

    return multiplier


def taluk_keyword_multiplier(taluk_name, category):
    multiplier = 1.0
    keywords = normalize_text(taluk_name)

    if any(term in keywords for term in ("NORTH", "SOUTH", "EAST", "WEST", "CITY")):
        if category in {"Property", "Fraud", "Women Safety"}:
            multiplier *= 1.12
    if any(term in keywords for term in ("HILLS", "KODAIKANAL", "VALPARAI", "YERCAUD")):
        if category in {"Accident", "Property"}:
            multiplier *= 1.16
    if any(term in keywords for term in ("PORT", "NAGAPATTINAM", "RAMESHWARAM")):
        if category in {"Excise Act", "NDPS", "Accident"}:
            multiplier *= 1.14

    return multiplier


def pick_weighted(items, rng):
    roll = rng.random()
    cumulative = 0.0
    for value, weight in items:
        cumulative += weight
        if roll <= cumulative:
            return value
    return items[-1][0]


def load_osm_station_candidates(district_geometries):
    candidates = defaultdict(list)
    raw = json.loads((RAW_DIR / "tn_police_osm_simple.json").read_text(encoding="utf-8-sig"))
    unnamed_count = defaultdict(int)

    for item in raw:
        lat = item.get("lat")
        lng = item.get("lng")
        if lat is None or lng is None:
            continue

        district = None
        for district_name, geometry in district_geometries.items():
            min_lng, min_lat, max_lng, max_lat = geometry["bbox"]
            if lng < min_lng or lng > max_lng or lat < min_lat or lat > max_lat:
                continue
            if point_in_feature(lng, lat, geometry["rings"]):
                district = district_name
                break

        if not district:
            continue

        name = normalize_text(item.get("name") or "")
        if not name or name == "POLICE STATION":
            unnamed_count[district] += 1
            name = f"{district} PATROL UNIT {unnamed_count[district]}"

        candidates[district].append(
            {
                "name": name,
                "district": district,
                "lat": float(lat),
                "lng": float(lng),
            }
        )

    deduped = {}
    for district, stations in candidates.items():
        seen = set()
        clean = []
        for station in stations:
            key = (station["name"], round(station["lat"], 4), round(station["lng"], 4))
            if key in seen:
                continue
            seen.add(key)
            clean.append(station)
        deduped[district] = clean
    return deduped


def build_operational_layers():
    taluk_rows = load_taluk_rows()
    district_geometries = load_district_geometries()
    station_candidates = load_osm_station_candidates(district_geometries)

    grouped_taluks = defaultdict(list)
    for row in taluk_rows:
        grouped_taluks[row["district"]].append(row["taluk"])

    districts = []
    taluks = []
    stations = []

    for district in sorted(grouped_taluks):
        geometry = district_geometries[district]
        taluk_names = sorted(set(grouped_taluks[district]))
        points = generate_points_in_district(
            geometry=geometry,
            count=len(taluk_names),
            seed_offset=abs(hash(district)) % 1000,
        )
        available_stations = list(station_candidates.get(district, []))
        centroid_lat, centroid_lng = geometry["centroid"]
        profile = infer_profile(district)

        districts.append(
            {
                "district": district,
                "lat": centroid_lat,
                "lng": centroid_lng,
                "taluk_count": len(taluk_names),
                "profile": profile,
            }
        )

        for idx, taluk_name in enumerate(taluk_names, start=1):
            lat, lng = points[idx - 1]
            taluk_id = f"TLK-{slugify(district)}-{idx:03d}"
            radius_km = 7 + (idx % 5) * 1.4
            if district in URBAN_DISTRICTS:
                radius_km *= 0.78
            elif district in COASTAL_DISTRICTS or district in HILL_TOURISM_DISTRICTS:
                radius_km *= 1.08

            selected_station = None
            if available_stations:
                selected_station = min(
                    available_stations,
                    key=lambda item: haversine_km(lat, lng, item["lat"], item["lng"]),
                )
                available_stations.remove(selected_station)

            if selected_station:
                station_name = selected_station["name"]
                station_lat = selected_station["lat"]
                station_lng = selected_station["lng"]
                source_type = "osm"
                coverage_priority = 2
            else:
                station_name = f"{taluk_name} SERVICE UNIT"
                station_lat, station_lng = jitter_point(
                    lat, lng, f"{taluk_id}|fallback-station", 2.5
                )
                source_type = "generated"
                coverage_priority = 1

            station_id = f"PS-{slugify(district)}-{idx:03d}"

            taluks.append(
                {
                    "taluk_id": taluk_id,
                    "district": district,
                    "taluk": taluk_name,
                    "lat": lat,
                    "lng": lng,
                    "radius_km": round(radius_km, 2),
                    "primary_station_id": station_id,
                    "source_type": "generated",
                    "profile": profile,
                }
            )
            stations.append(
                {
                    "station_id": station_id,
                    "station_name": station_name,
                    "district": district,
                    "taluk": taluk_name,
                    "lat": station_lat,
                    "lng": station_lng,
                    "source_type": source_type,
                    "coverage_priority": coverage_priority,
                }
            )

    station_count_map = defaultdict(int)
    for station in stations:
        station_count_map[station["district"]] += 1
    for district in districts:
        district["station_count"] = station_count_map[district["district"]]

    return districts, taluks, stations


def base_zone_intensity(taluk_record):
    district = taluk_record["district"]
    taluk_name = taluk_record["taluk"]
    base = 8.0

    if district in URBAN_DISTRICTS:
        base += 5.0
    if district in HIGHWAY_DISTRICTS:
        base += 2.8
    if district in COASTAL_DISTRICTS:
        base += 2.1
    if district in INDUSTRIAL_DISTRICTS:
        base += 2.4
    if district in HILL_TOURISM_DISTRICTS:
        base += 1.4

    keywords = normalize_text(taluk_name)
    if any(term in keywords for term in ("NORTH", "SOUTH", "EAST", "WEST", "CHENNAI", "MADURAI", "COIMBATORE")):
        base += 2.2
    if any(term in keywords for term in ("PORT", "HILLS", "KODAIKANAL", "VALPARAI", "YERCAUD")):
        base += 1.4

    return base


def build_incidents(taluks, station_by_id):
    incidents = []

    for taluk in taluks:
        station = station_by_id[taluk["primary_station_id"]]
        base_intensity = base_zone_intensity(taluk)

        for year in YEARS:
            year_growth = {2024: 0.94, 2025: 1.0, 2026: 1.08}[year]
            for month in range(1, 13):
                for category, config in CATEGORY_CONFIG.items():
                    rng = random.Random(
                        f"{taluk['taluk_id']}|{category}|{year}|{month}"
                    )
                    count = int(
                        round(
                            base_intensity
                            * config["base"]
                            * district_category_multiplier(taluk["district"], category)
                            * taluk_keyword_multiplier(taluk["taluk"], category)
                            * config["month"][month - 1]
                            * year_growth
                            * (0.84 + rng.random() * 0.42)
                        )
                    )

                    if count <= 0:
                        continue

                    time_slot = pick_weighted(config["time_slots"], rng)
                    if category in {"Public Order", "Accident"}:
                        day_of_week = rng.choices(range(1, 8), weights=[0.11, 0.11, 0.12, 0.13, 0.15, 0.2, 0.18], k=1)[0]
                    elif category in {"Fraud"}:
                        day_of_week = rng.choices(range(1, 8), weights=[0.17, 0.17, 0.17, 0.17, 0.17, 0.08, 0.07], k=1)[0]
                    else:
                        day_of_week = rng.randint(1, 7)

                    incident_date = f"{year}-{month:02d}-{rng.randint(1, 28):02d}"
                    lat, lng = jitter_point(
                        taluk["lat"],
                        taluk["lng"],
                        f"{taluk['taluk_id']}|{category}|{incident_date}",
                        max(2.5, taluk["radius_km"] / 2.2),
                    )

                    incidents.append(
                        {
                            "district": taluk["district"],
                            "taluk_id": taluk["taluk_id"],
                            "taluk": taluk["taluk"],
                            "station_id": station["station_id"],
                            "station_name": station["station_name"],
                            "lat": round(lat, 6),
                            "lng": round(lng, 6),
                            "ipc_section": rng.choice(config["ipc"]),
                            "category": category,
                            "severity": config["severity"],
                            "year": year,
                            "month": month,
                            "day_of_week": day_of_week,
                            "time_slot": time_slot,
                            "incident_date": incident_date,
                            "source_type": "synthetic",
                            "count": count,
                        }
                    )

    return incidents


def score_from_total(total, maximum):
    if maximum <= 0:
        return 20
    return round(20 + (total / maximum) * 75, 1)


def level_from_score(score):
    if score >= 70:
        return "HIGH"
    if score >= 42:
        return "MEDIUM"
    return "LOW"


def build_hotspots_and_routes(taluks, incidents):
    totals = defaultdict(lambda: {"count": 0, "categories": defaultdict(int)})
    taluk_lookup = {row["taluk_id"]: row for row in taluks}

    for record in incidents:
        zone = totals[record["taluk_id"]]
        zone["count"] += record["count"]
        zone["categories"][record["category"]] += record["count"]

    max_total = max((value["count"] for value in totals.values()), default=1)
    hotspots = []
    district_buckets = defaultdict(list)

    for taluk_id, aggregate in totals.items():
        taluk = taluk_lookup[taluk_id]
        top_crime = max(aggregate["categories"], key=aggregate["categories"].get)
        score = score_from_total(aggregate["count"], max_total)
        risk_level = level_from_score(score)
        hotspots.append(
            {
                "taluk_id": taluk_id,
                "district": taluk["district"],
                "zone_name": taluk["taluk"],
                "center_lat": taluk["lat"],
                "center_lng": taluk["lng"],
                "radius_km": round(max(5.0, taluk["radius_km"] * 0.95), 2),
                "risk_level": risk_level,
                "risk_score": score,
                "crime_count": aggregate["count"],
                "top_crime": top_crime,
            }
        )
        district_buckets[taluk["district"]].append(
            {
                "lat": taluk["lat"],
                "lng": taluk["lng"],
                "score": score,
                "name": taluk["taluk"],
            }
        )

    patrol_routes = []
    for district, points in district_buckets.items():
        selected = sorted(points, key=lambda item: item["score"], reverse=True)[:4]
        selected = sorted(selected, key=lambda item: (item["lng"], item["lat"]))
        if len(selected) < 2:
            continue
        path = [{"lat": round(item["lat"], 6), "lng": round(item["lng"], 6), "name": item["name"]} for item in selected]
        avg_score = sum(item["score"] for item in selected) / len(selected)
        patrol_routes.append(
            {
                "route_id": f"PATROL-{slugify(district)}",
                "district": district,
                "route_name": f"{district} HOTSPOT PATROL",
                "risk_level": level_from_score(avg_score),
                "path_json": json.dumps(path),
                "source_type": "generated",
            }
        )

    return hotspots, patrol_routes


def seed_operational_data(force=False):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT value FROM app_meta WHERE key = 'data_seed_version'"
    )
    row = cursor.fetchone()
    if row and row["value"] == DATA_SEED_VERSION and not force:
        conn.close()
        print("Operational data already seeded")
        return

    districts, taluks, stations = build_operational_layers()
    station_by_id = {row["station_id"]: row for row in stations}
    incidents = build_incidents(taluks, station_by_id)
    hotspots, patrol_routes = build_hotspots_and_routes(taluks, incidents)

    cursor.execute("DELETE FROM districts")
    cursor.execute("DELETE FROM taluks")
    cursor.execute("DELETE FROM police_stations")
    cursor.execute("DELETE FROM fir_records")
    cursor.execute("DELETE FROM hotspot_zones")
    cursor.execute("DELETE FROM patrol_routes")

    cursor.executemany(
        """
        INSERT INTO districts
        (district, lat, lng, taluk_count, station_count, profile, source_type)
        VALUES (:district, :lat, :lng, :taluk_count, :station_count, :profile, 'official')
        """,
        districts,
    )

    cursor.executemany(
        """
        INSERT INTO taluks
        (taluk_id, district, taluk, lat, lng, radius_km, primary_station_id, source_type)
        VALUES (:taluk_id, :district, :taluk, :lat, :lng, :radius_km, :primary_station_id, :source_type)
        """,
        taluks,
    )

    cursor.executemany(
        """
        INSERT INTO police_stations
        (station_id, station_name, district, taluk, lat, lng, source_type, coverage_priority)
        VALUES (:station_id, :station_name, :district, :taluk, :lat, :lng, :source_type, :coverage_priority)
        """,
        stations,
    )

    cursor.executemany(
        """
        INSERT INTO fir_records
        (district, taluk_id, taluk, station_id, station_name, lat, lng, ipc_section,
         category, severity, year, month, day_of_week, time_slot, incident_date,
         source_type, count)
        VALUES (:district, :taluk_id, :taluk, :station_id, :station_name, :lat, :lng,
                :ipc_section, :category, :severity, :year, :month, :day_of_week,
                :time_slot, :incident_date, :source_type, :count)
        """,
        incidents,
    )

    cursor.executemany(
        """
        INSERT INTO hotspot_zones
        (taluk_id, district, zone_name, center_lat, center_lng, radius_km,
         risk_level, risk_score, crime_count, top_crime)
        VALUES (:taluk_id, :district, :zone_name, :center_lat, :center_lng, :radius_km,
                :risk_level, :risk_score, :crime_count, :top_crime)
        """,
        hotspots,
    )

    cursor.executemany(
        """
        INSERT INTO patrol_routes
        (route_id, district, route_name, risk_level, path_json, source_type)
        VALUES (:route_id, :district, :route_name, :risk_level, :path_json, :source_type)
        """,
        patrol_routes,
    )

    cursor.execute(
        """
        INSERT INTO app_meta(key, value)
        VALUES('data_seed_version', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (DATA_SEED_VERSION,),
    )

    conn.commit()
    conn.close()
    print(
        f"Operational seed complete | districts={len(districts)} "
        f"taluks={len(taluks)} stations={len(stations)} incidents={len(incidents)}"
    )


if __name__ == "__main__":
    seed_operational_data(force=True)
