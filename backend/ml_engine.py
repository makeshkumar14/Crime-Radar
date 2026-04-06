import heapq
import json
import math
from collections import defaultdict
from itertools import combinations
from datetime import date
from pathlib import Path

import numpy as np
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from database import get_connection

REPORT_DIR = Path(__file__).resolve().parent / "generated_reports"
MONTH_NAMES = {
    1: "Jan",
    2: "Feb",
    3: "Mar",
    4: "Apr",
    5: "May",
    6: "Jun",
    7: "Jul",
    8: "Aug",
    9: "Sep",
    10: "Oct",
    11: "Nov",
    12: "Dec",
}

CATEGORY_ALERT_WEIGHT = {
    "Women Safety": 1.35,
    "Violent": 1.28,
    "Kidnapping": 1.22,
    "Accident": 1.18,
    "Property": 1.1,
    "Public Order": 1.0,
    "Fraud": 0.92,
    "NDPS": 1.04,
    "Arms Act": 1.08,
}


def _month_index(year, month):
    return year * 12 + month


def _time_features(year, month):
    t = _month_index(year, month)
    angle = 2 * math.pi * month / 12
    return np.array(
        [
            1.0,
            t,
            math.sin(angle),
            math.cos(angle),
            math.sin(2 * angle),
            math.cos(2 * angle),
        ]
    )


def _fit_temporal_regression(rows):
    x = np.vstack([_time_features(row["year"], row["month"]) for row in rows])
    y = np.array([row["cases"] for row in rows], dtype=float)
    coeffs, *_ = np.linalg.lstsq(x, y, rcond=None)
    return coeffs


def _predict_from_coeffs(coeffs, year, month):
    value = float(_time_features(year, month) @ coeffs)
    return max(0.0, value)


def _load_zone_history(district=None, category=None):
    conn = get_connection()
    cursor = conn.cursor()

    query = """
        SELECT f.taluk_id, f.taluk, f.district, f.category, f.year, f.month,
               SUM(f.count) AS cases,
               t.lat, t.lng, t.radius_km, t.primary_station_id
        FROM fir_records f
        JOIN taluks t ON t.taluk_id = f.taluk_id
        WHERE 1=1
    """
    params = []
    if district:
        query += " AND f.district = ?"
        params.append(district)
    if category:
        query += " AND f.category = ?"
        params.append(category)

    query += """
        GROUP BY f.taluk_id, f.taluk, f.district, f.category, f.year, f.month,
                 t.lat, t.lng, t.radius_km, t.primary_station_id
        ORDER BY f.taluk_id, f.category, f.year, f.month
    """
    cursor.execute(query, params)
    rows = [dict(row) for row in cursor.fetchall()]

    cursor.execute(
        """
        SELECT station_id, station_name, district, taluk, lat, lng
        FROM police_stations
        """
    )
    stations = {row["station_id"]: dict(row) for row in cursor.fetchall()}
    conn.close()
    return rows, stations


def _prediction_snapshot(target_year, target_month, district=None):
    rows, stations = _load_zone_history(district=district)
    grouped = defaultdict(list)
    zone_meta = {}

    for row in rows:
        key = (row["taluk_id"], row["category"])
        grouped[key].append(row)
        zone_meta[row["taluk_id"]] = {
            "taluk_id": row["taluk_id"],
            "taluk": row["taluk"],
            "district": row["district"],
            "lat": row["lat"],
            "lng": row["lng"],
            "radius_km": row["radius_km"],
            "primary_station_id": row["primary_station_id"],
        }

    zone_predictions = defaultdict(lambda: {"categories": {}, "total": 0.0})

    for (taluk_id, category_name), history in grouped.items():
        coeffs = _fit_temporal_regression(history)
        predicted = _predict_from_coeffs(coeffs, target_year, target_month)
        zone_predictions[taluk_id]["categories"][category_name] = predicted
        zone_predictions[taluk_id]["total"] += predicted

    max_total = max((item["total"] for item in zone_predictions.values()), default=1.0)
    snapshot = []
    for taluk_id, prediction in zone_predictions.items():
        meta = zone_meta[taluk_id]
        top_category = max(prediction["categories"], key=prediction["categories"].get)
        total = prediction["total"]
        risk_score = round(18 + (total / max_total) * 77, 1)
        women = prediction["categories"].get("Women Safety", 0.0)
        violent = prediction["categories"].get("Violent", 0.0)
        accident = prediction["categories"].get("Accident", 0.0)
        snapshot.append(
            {
                **meta,
                "predicted_total": round(total, 2),
                "predicted_women_safety": round(women, 2),
                "predicted_violent": round(violent, 2),
                "predicted_accident": round(accident, 2),
                "predicted_top_category": top_category,
                "risk_score": risk_score,
                "risk_level": "HIGH" if risk_score >= 70 else "MEDIUM" if risk_score >= 42 else "LOW",
                "primary_station": stations.get(meta["primary_station_id"]),
                "categories": {
                    key: round(value, 2)
                    for key, value in sorted(
                        prediction["categories"].items(),
                        key=lambda item: item[1],
                        reverse=True,
                    )
                },
            }
        )

    return sorted(snapshot, key=lambda item: item["predicted_total"], reverse=True)


def seasonal_ml_prediction(district=None, category=None, horizon=6):
    conn = get_connection()
    cursor = conn.cursor()
    query = """
        SELECT year, month, category, SUM(count) AS cases
        FROM fir_records
        WHERE 1=1
    """
    params = []
    if district:
        query += " AND district = ?"
        params.append(district)
    if category:
        query += " AND category = ?"
        params.append(category)
    query += " GROUP BY year, month, category ORDER BY year, month"
    cursor.execute(query, params)
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()

    by_category = defaultdict(list)
    for row in rows:
        by_category[row["category"]].append(row)

    today = date.today()
    predictions = []
    for category_name, history in by_category.items():
        coeffs = _fit_temporal_regression(history)
        for step in range(1, horizon + 1):
            month_offset = today.month - 1 + step
            year = today.year + month_offset // 12
            month = month_offset % 12 + 1
            predictions.append(
                {
                    "year": year,
                    "month": month,
                    "month_name": MONTH_NAMES[month],
                    "category": category_name,
                    "predicted_cases": round(_predict_from_coeffs(coeffs, year, month), 2),
                }
            )

    return sorted(predictions, key=lambda item: (item["year"], item["month"], item["category"]))


def patrol_ml_prediction(district, target_year=None, target_month=None):
    today = date.today()
    target_year = target_year or today.year
    target_month = target_month or today.month
    snapshot = _prediction_snapshot(target_year, target_month, district=district)
    selected = snapshot[:6]
    if len(selected) < 2:
        return {"district": district, "route_points": [], "summary": {}}

    stations = [row["primary_station"] for row in selected if row["primary_station"]]
    points = []
    for zone in selected:
        station = zone["primary_station"]
        points.append(
            {
                "taluk_id": zone["taluk_id"],
                "taluk": zone["taluk"],
                "lat": station["lat"] if station else zone["lat"],
                "lng": station["lng"] if station else zone["lng"],
                "risk_score": zone["risk_score"],
                "predicted_total": zone["predicted_total"],
                "predicted_top_category": zone["predicted_top_category"],
            }
        )

    ordered = [points.pop(0)]
    while points:
        last = ordered[-1]
        next_idx = min(
            range(len(points)),
            key=lambda idx: haversine_km(
                last["lat"], last["lng"], points[idx]["lat"], points[idx]["lng"]
            ) * (1 - points[idx]["risk_score"] / 200),
        )
        ordered.append(points.pop(next_idx))

    avg_score = sum(point["risk_score"] for point in ordered) / len(ordered)
    return {
        "district": district,
        "target_year": target_year,
        "target_month": target_month,
        "risk_level": "HIGH" if avg_score >= 70 else "MEDIUM" if avg_score >= 42 else "LOW",
        "route_points": ordered,
        "summary": {
            "focus_zones": len(ordered),
            "predicted_cases": round(sum(point["predicted_total"] for point in ordered), 2),
            "top_predicted_category": max(
                ordered,
                key=lambda item: item["predicted_total"],
            )["predicted_top_category"],
        },
    }


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


def _load_district_centroids():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT district, lat, lng FROM districts")
    rows = {row["district"]: dict(row) for row in cursor.fetchall()}
    conn.close()
    return rows


def _project_to_km(lat, lng, ref_lat):
    radius = 6371.0
    x = math.radians(lng) * radius * math.cos(math.radians(ref_lat))
    y = math.radians(lat) * radius
    return x, y


def _distance_point_to_segment_km(point, start, end):
    ref_lat = (point["lat"] + start["lat"] + end["lat"]) / 3.0
    px, py = _project_to_km(point["lat"], point["lng"], ref_lat)
    ax, ay = _project_to_km(start["lat"], start["lng"], ref_lat)
    bx, by = _project_to_km(end["lat"], end["lng"], ref_lat)
    abx = bx - ax
    aby = by - ay
    apx = px - ax
    apy = py - ay
    ab_len_sq = (abx * abx) + (aby * aby)
    if ab_len_sq <= 1e-9:
        return math.sqrt((px - ax) ** 2 + (py - ay) ** 2)
    t = max(0.0, min(1.0, ((apx * abx) + (apy * aby)) / ab_len_sq))
    closest_x = ax + abx * t
    closest_y = ay + aby * t
    return math.sqrt((px - closest_x) ** 2 + (py - closest_y) ** 2)


def _route_scope_districts(origin_district, destination_district, limit=8):
    district_centroids = _load_district_centroids()
    start = district_centroids.get(origin_district)
    end = district_centroids.get(destination_district)

    if not start or not end:
        return sorted({origin_district, destination_district})

    if origin_district == destination_district:
        return [origin_district]

    ranked = []
    for district, centroid in district_centroids.items():
        corridor_distance = _distance_point_to_segment_km(centroid, start, end)
        endpoint_distance = min(
            haversine_km(centroid["lat"], centroid["lng"], start["lat"], start["lng"]),
            haversine_km(centroid["lat"], centroid["lng"], end["lat"], end["lng"]),
        )
        ranked.append(
            (
                corridor_distance,
                endpoint_distance,
                district,
            )
        )

    ranked.sort()
    selected = []
    required = {origin_district, destination_district}
    for corridor_distance, endpoint_distance, district in ranked:
        if district in required:
            selected.append(district)
            continue
        if corridor_distance <= 110 or endpoint_distance <= 135 or len(selected) < 6:
            selected.append(district)
        if len(selected) >= limit:
            break

    for district in sorted(required):
        if district not in selected:
            selected.insert(0, district)

    return selected[:limit]


def _build_route_safety_zones(snapshot, scope_districts):
    scope_lookup = set(scope_districts)
    zones = []
    for node in snapshot:
        if node["district"] not in scope_lookup:
            continue
        zones.append(
            {
                "taluk_id": node["taluk_id"],
                "taluk": node["taluk"],
                "district": node["district"],
                "risk_score": node["risk_score"],
                "risk_level": node["risk_level"],
                "radius_km": node["radius_km"],
                "predicted_total": node["predicted_total"],
                "predicted_accident": node["predicted_accident"],
                "predicted_top_category": node["predicted_top_category"],
                "location_query": f"{node['taluk']}, {node['district']}, Tamil Nadu, India",
            }
        )

    zones.sort(
        key=lambda item: (
            item["district"],
            -item["predicted_accident"],
            -item["risk_score"],
            item["taluk"],
        )
    )
    return zones


def _build_graph(snapshot):
    graph = defaultdict(list)
    for node in snapshot:
        candidates = []
        for other in snapshot:
            if node["taluk_id"] == other["taluk_id"]:
                continue
            distance = haversine_km(node["lat"], node["lng"], other["lat"], other["lng"])
            if distance <= 220:
                candidates.append((distance, other))
        for _, other in sorted(candidates, key=lambda item: item[0])[:10]:
            graph[node["taluk_id"]].append(other["taluk_id"])
    return graph


def _dijkstra(start_id, end_id, nodes, graph, risk_factor):
    queue = [(0.0, start_id, [start_id])]
    best = {start_id: 0.0}

    while queue:
        cost, node_id, path = heapq.heappop(queue)
        if node_id == end_id:
            return cost, path
        if cost > best.get(node_id, float("inf")):
            continue
        for next_id in graph[node_id]:
            current = nodes[node_id]
            nxt = nodes[next_id]
            distance = haversine_km(current["lat"], current["lng"], nxt["lat"], nxt["lng"])
            edge_cost = distance * (1 + (nxt["risk_score"] / 100.0) * risk_factor)
            next_cost = cost + edge_cost
            if next_cost < best.get(next_id, float("inf")):
                best[next_id] = next_cost
                heapq.heappush(queue, (next_cost, next_id, path + [next_id]))
    return None, []


def _prune_graph(graph, banned_ids):
    return {
        node_id: [next_id for next_id in neighbours if next_id not in banned_ids]
        for node_id, neighbours in graph.items()
        if node_id not in banned_ids
    }


def _serialize_path(path, nodes):
    return [nodes[node_id] for node_id in path if node_id in nodes]


def _route_metrics(items):
    if not items:
        return 0.0, 0.0, 0.0, 0

    distance = 0.0
    for index in range(len(items) - 1):
        distance += haversine_km(
            items[index]["lat"],
            items[index]["lng"],
            items[index + 1]["lat"],
            items[index + 1]["lng"],
        )

    avg_risk = sum(node["risk_score"] for node in items) / len(items)
    max_risk = max(node["risk_score"] for node in items)
    high_risk_stops = sum(1 for node in items[1:-1] if node["risk_score"] >= 65)
    return round(distance, 2), round(avg_risk, 1), round(max_risk, 1), high_risk_stops


def _path_overlap_ratio(primary_path, candidate_path):
    primary_nodes = set(primary_path[1:-1])
    candidate_nodes = set(candidate_path[1:-1])
    if not primary_nodes and not candidate_nodes:
        return 1.0 if tuple(primary_path) == tuple(candidate_path) else 0.0
    shared = primary_nodes & candidate_nodes
    return len(shared) / max(len(primary_nodes), len(candidate_nodes), 1)


def _find_safer_path(start_id, end_id, nodes, graph, baseline_path):
    if len(baseline_path) < 2:
        return baseline_path

    baseline_items = _serialize_path(baseline_path, nodes)
    baseline_distance, baseline_risk, baseline_max_risk, baseline_high_risk = _route_metrics(
        baseline_items
    )
    risky_intermediates = sorted(
        baseline_path[1:-1],
        key=lambda node_id: nodes[node_id]["risk_score"],
        reverse=True,
    )[:6]

    seen = {tuple(baseline_path)}
    candidates = []

    def register(path):
        if not path or tuple(path) in seen:
            return
        seen.add(tuple(path))
        items = _serialize_path(path, nodes)
        distance, avg_risk, max_risk, high_risk_stops = _route_metrics(items)
        overlap = _path_overlap_ratio(baseline_path, path)
        safety_score = (
            avg_risk
            + max_risk * 0.12
            + high_risk_stops * 2.5
            + max(0.0, distance - baseline_distance) * 0.18
            + overlap * 2.2
        )
        candidates.append(
            {
                "path": path,
                "distance": distance,
                "avg_risk": avg_risk,
                "max_risk": max_risk,
                "high_risk_stops": high_risk_stops,
                "overlap": overlap,
                "safety_score": round(safety_score, 3),
            }
        )

    for risk_factor in (1.4, 2.1, 2.8):
        _, path = _dijkstra(start_id, end_id, nodes, graph, risk_factor=risk_factor)
        register(path)

    for ban_size in (1, 2):
        for banned in combinations(risky_intermediates, ban_size):
            pruned_graph = _prune_graph(graph, set(banned))
            _, path = _dijkstra(
                start_id,
                end_id,
                nodes,
                pruned_graph,
                risk_factor=2.2 + ban_size * 0.45,
            )
            register(path)

    if not candidates:
        return baseline_path

    accepted = [
        candidate
        for candidate in candidates
        if candidate["avg_risk"] <= baseline_risk - 0.8
        or (
            candidate["avg_risk"] <= baseline_risk - 0.3
            and (
                candidate["high_risk_stops"] < baseline_high_risk
                or candidate["max_risk"] <= baseline_max_risk - 2.0
            )
        )
    ]

    if not accepted:
        return baseline_path

    best_candidate = min(
        accepted,
        key=lambda candidate: (
            candidate["safety_score"],
            candidate["distance"],
            candidate["overlap"],
        ),
    )
    return best_candidate["path"]


def route_safety_advisory(origin_taluk_id, destination_taluk_id, target_year=None, target_month=None):
    today = date.today()
    target_year = target_year or today.year
    target_month = target_month or today.month
    snapshot = _prediction_snapshot(target_year, target_month)
    nodes = {row["taluk_id"]: row for row in snapshot}
    if origin_taluk_id not in nodes or destination_taluk_id not in nodes:
        return {"status": "error", "message": "Origin or destination zone not found"}

    origin_node = nodes[origin_taluk_id]
    destination_node = nodes[destination_taluk_id]
    scope_districts = _route_scope_districts(
        origin_node["district"],
        destination_node["district"],
    )
    safety_zones = _build_route_safety_zones(snapshot, scope_districts)

    graph = _build_graph(snapshot)
    _, fastest_path = _dijkstra(
        origin_taluk_id,
        destination_taluk_id,
        nodes,
        graph,
        risk_factor=0.05,
    )
    safe_path = _find_safer_path(
        origin_taluk_id,
        destination_taluk_id,
        nodes,
        graph,
        fastest_path,
    )

    fastest_nodes = _serialize_path(fastest_path, nodes)
    safe_nodes = _serialize_path(safe_path, nodes)
    if not fastest_nodes:
        fastest_nodes = [nodes[origin_taluk_id], nodes[destination_taluk_id]]
    if not safe_nodes:
        safe_nodes = [nodes[origin_taluk_id], nodes[destination_taluk_id]]

    alerts = []
    for node in fastest_nodes:
        score = node["risk_score"] * CATEGORY_ALERT_WEIGHT.get(node["predicted_top_category"], 1.0)
        if score >= 65:
            alerts.append(
                {
                    "taluk": node["taluk"],
                    "district": node["district"],
                    "predicted_top_category": node["predicted_top_category"],
                    "risk_score": node["risk_score"],
                }
            )

    fastest_distance, fastest_risk, fastest_max_risk, fastest_high_risk = _route_metrics(
        fastest_nodes
    )
    safe_distance, safe_risk, safe_max_risk, safe_high_risk = _route_metrics(safe_nodes)
    route_diverges = fastest_path != safe_path
    route_overlap_ratio = round(_path_overlap_ratio(fastest_path, safe_path), 2)
    risk_reduction = round(max(0.0, fastest_risk - safe_risk), 1)
    distance_delta_km = round(safe_distance - fastest_distance, 2)

    if not route_diverges:
        recommendation = "No clearly safer detour was found. Stay alert on the main route."
    elif safe_risk + 3 <= fastest_risk:
        recommendation = "Use the safer detour. It reduces exposure across the route."
    else:
        recommendation = "The safer corridor is only a mild improvement. Use either route with caution."

    return {
        "status": "ok",
        "target_year": target_year,
        "target_month": target_month,
        "origin": origin_node,
        "destination": destination_node,
        "origin_query": f"{origin_node['taluk']}, {origin_node['district']}, Tamil Nadu, India",
        "destination_query": f"{destination_node['taluk']}, {destination_node['district']}, Tamil Nadu, India",
        "scope_districts": scope_districts,
        "safety_zones": safety_zones,
        "accident_zones": [
            zone for zone in safety_zones if zone["predicted_accident"] > 0
        ],
        "route_diverges": route_diverges,
        "route_overlap_ratio": route_overlap_ratio,
        "risk_reduction": risk_reduction,
        "distance_delta_km": distance_delta_km,
        "current_path": {
            "distance_km": fastest_distance,
            "risk_score": fastest_risk,
            "max_risk_score": fastest_max_risk,
            "high_risk_stops": fastest_high_risk,
            "route": fastest_nodes,
        },
        "safer_path": {
            "distance_km": safe_distance,
            "risk_score": safe_risk,
            "max_risk_score": safe_max_risk,
            "high_risk_stops": safe_high_risk,
            "route": safe_nodes,
        },
        "alerts": alerts[:6],
        "recommendation": recommendation,
    }


def area_safety_snapshot(taluk_id, target_year=None, target_month=None):
    today = date.today()
    target_year = target_year or today.year
    target_month = target_month or today.month
    snapshot = _prediction_snapshot(target_year, target_month)
    target = next((row for row in snapshot if row["taluk_id"] == taluk_id), None)
    if not target:
        return None

    women = target["predicted_women_safety"]
    accident = target["predicted_accident"]
    violent = target["predicted_violent"]
    total = max(target["predicted_total"], 1.0)
    safety_index = round(max(0.0, 100 - target["risk_score"]), 1)

    grade = "SAFE"
    if safety_index < 40:
        grade = "HIGH CAUTION"
    elif safety_index < 60:
        grade = "MODERATE"

    nearby = [
        row
        for row in snapshot
        if row["district"] == target["district"] and row["taluk_id"] != taluk_id
    ]
    nearby = sorted(
        nearby,
        key=lambda row: haversine_km(target["lat"], target["lng"], row["lat"], row["lng"]),
    )[:5]

    return {
        "taluk_id": taluk_id,
        "district": target["district"],
        "taluk": target["taluk"],
        "target_year": target_year,
        "target_month": target_month,
        "predicted_total": round(total, 2),
        "predicted_top_category": target["predicted_top_category"],
        "risk_score": target["risk_score"],
        "risk_level": target["risk_level"],
        "women_safety_index": round(max(0.0, 100 - (women / total) * 100), 1),
        "accident_exposure_index": round(max(0.0, 100 - (accident / total) * 100), 1),
        "violent_share": round((violent / total) * 100, 1),
        "safety_index": safety_index,
        "grade": grade,
        "categories": target["categories"],
        "nearby_comparison": [
            {
                "taluk": row["taluk"],
                "risk_score": row["risk_score"],
                "predicted_total": row["predicted_total"],
            }
            for row in nearby
        ],
        "recommendation": (
            "Suitable for residential relocation with standard precautions"
            if grade == "SAFE"
            else "Suitable with caution; prioritize gated communities and good police access"
            if grade == "MODERATE"
            else "Not recommended for family relocation without strong safety mitigation"
        ),
    }


def build_area_report_pdf(snapshot):
    REPORT_DIR.mkdir(exist_ok=True)
    filename = f"safety_report_{snapshot['taluk_id'].lower()}_{snapshot['target_year']}_{snapshot['target_month']:02d}.pdf"
    path = REPORT_DIR / filename

    doc = SimpleDocTemplate(str(path), pagesize=A4, topMargin=36, bottomMargin=36)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("TitleBlue", parent=styles["Title"], textColor=colors.HexColor("#0F172A"))
    subtitle_style = ParagraphStyle("Subtle", parent=styles["Normal"], textColor=colors.HexColor("#475569"), leading=16)

    story = [
        Paragraph("CrimeRadar Area Safety Assessment", title_style),
        Spacer(1, 8),
        Paragraph(
            f"{snapshot['taluk']}, {snapshot['district']} | Forecast for {MONTH_NAMES[snapshot['target_month']]} {snapshot['target_year']}",
            subtitle_style,
        ),
        Spacer(1, 16),
    ]

    summary_table = Table(
        [
            ["Overall Grade", snapshot["grade"]],
            ["Safety Index", f"{snapshot['safety_index']} / 100"],
            ["Predicted Crime Load", str(snapshot["predicted_total"])],
            ["Dominant Predicted Crime", snapshot["predicted_top_category"]],
            ["Risk Level", snapshot["risk_level"]],
        ],
        colWidths=[180, 280],
    )
    summary_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E2E8F0")),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F8FAFC")),
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
            ]
        )
    )
    story.extend([summary_table, Spacer(1, 16)])

    metrics_table = Table(
        [
            ["Women Safety Index", snapshot["women_safety_index"]],
            ["Accident Exposure Index", snapshot["accident_exposure_index"]],
            ["Violent Crime Share", f"{snapshot['violent_share']}%"],
            ["Recommendation", snapshot["recommendation"]],
        ],
        colWidths=[180, 280],
    )
    metrics_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F8FAFC")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story.extend([metrics_table, Spacer(1, 16)])

    story.append(Paragraph("Predicted Crime Mix", styles["Heading3"]))
    cat_rows = [["Category", "Predicted Cases"]]
    for key, value in list(snapshot["categories"].items())[:8]:
        cat_rows.append([key, str(value)])
    cat_table = Table(cat_rows, colWidths=[220, 240])
    cat_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
            ]
        )
    )
    story.extend([cat_table, Spacer(1, 16)])

    if snapshot["nearby_comparison"]:
        story.append(Paragraph("Nearby Taluk Comparison", styles["Heading3"]))
        near_rows = [["Taluk", "Risk Score", "Predicted Cases"]]
        for item in snapshot["nearby_comparison"]:
            near_rows.append([item["taluk"], str(item["risk_score"]), str(item["predicted_total"])])
        near_table = Table(near_rows, colWidths=[220, 100, 140])
        near_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E293B")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
                ]
            )
        )
        story.extend([near_table, Spacer(1, 16)])

    story.append(
        Paragraph(
            "This report is generated from real Tamil Nadu geography with synthetic FIR event simulation and a seasonal count-based prediction engine.",
            subtitle_style,
        )
    )

    doc.build(story)
    return path
