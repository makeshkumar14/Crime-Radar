"""
/api/heatmap  —  GeoJSON endpoints for the Mapbox / MapLibre heatmap view.

Returns crime-density data as GeoJSON FeatureCollections so the frontend
can render smooth heatmap, boundary, label, and warning-marker layers.
"""

import math
from typing import Optional

from fastapi import APIRouter, Query

from database import get_connection
from ops_queries import risk_score, risk_level

router = APIRouter()


def _circle_polygon(lat: float, lng: float, radius_km: float, n: int = 48):
    """Return a GeoJSON Polygon approximating a circle."""
    coords = []
    for i in range(n + 1):
        angle = 2 * math.pi * i / n
        dlat = (radius_km / 111.32) * math.cos(angle)
        dlng = (radius_km / (111.32 * math.cos(math.radians(lat)))) * math.sin(angle)
        coords.append([round(lng + dlng, 6), round(lat + dlat, 6)])
    return {"type": "Polygon", "coordinates": [coords]}


@router.get("/geojson")
def get_heatmap_geojson(
    year: Optional[int] = Query(None),
    category: Optional[str] = Query(None),
    district: Optional[str] = Query(None),
):
    """
    Main endpoint — returns three GeoJSON FeatureCollections in one payload:
      • points   – individual crime-density points (for heatmap-layer)
      • regions  – district boundary polygons (for fill / line layers)
      • warnings – top-N extreme hotspot markers (for symbol layer)
    """
    conn = get_connection()
    cursor = conn.cursor()

    # ── Build WHERE clause ──────────────────────────────────────────
    clauses, params = [], []
    if year:
        clauses.append("f.year = ?")
        params.append(year)
    if category:
        clauses.append("f.category = ?")
        params.append(category)
    if district:
        clauses.append("f.district = ?")
        params.append(district)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""

    # ── 1.  Heatmap points: per-taluk aggregated totals ─────────────
    cursor.execute(
        f"""
        SELECT f.taluk_id,
               f.district,
               f.taluk,
               f.lat,
               f.lng,
               f.category,
               SUM(f.count) AS total
        FROM fir_records f
        {where}
        GROUP BY f.taluk_id, f.district, f.taluk, f.lat, f.lng, f.category
        """,
        params,
    )
    raw_points = [dict(r) for r in cursor.fetchall()]

    # Aggregate by location for total intensity
    location_totals = {}
    for row in raw_points:
        key = (row["lat"], row["lng"])
        if key not in location_totals:
            location_totals[key] = {
                "lat": row["lat"],
                "lng": row["lng"],
                "district": row["district"],
                "taluk": row["taluk"],
                "taluk_id": row["taluk_id"],
                "total": 0,
                "categories": {},
            }
        location_totals[key]["total"] += row["total"]
        cat = row["category"]
        location_totals[key]["categories"][cat] = (
            location_totals[key]["categories"].get(cat, 0) + row["total"]
        )

    max_total = max((v["total"] for v in location_totals.values()), default=1)

    point_features = []
    for loc in location_totals.values():
        intensity = round(loc["total"] / max_total, 4)
        dominant = max(loc["categories"], key=loc["categories"].get) if loc["categories"] else "Unknown"
        point_features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [loc["lng"], loc["lat"]],
                },
                "properties": {
                    "intensity": intensity,
                    "total": loc["total"],
                    "district": loc["district"],
                    "taluk": loc["taluk"],
                    "taluk_id": loc["taluk_id"],
                    "dominant_category": dominant,
                },
            }
        )

    # ── 2.  District boundaries (approximated circles) ──────────────
    dist_clause = " WHERE district = ?" if district else ""
    dist_params = [district] if district else []

    cursor.execute(f"SELECT * FROM districts{dist_clause}", dist_params)
    district_rows = [dict(r) for r in cursor.fetchall()]

    # Aggregate crime totals per district (with active filters)
    cursor.execute(
        f"""
        SELECT district, SUM(count) AS total
        FROM fir_records
        {where}
        GROUP BY district
        """,
        params,
    )
    dist_totals = {r["district"]: r["total"] for r in cursor.fetchall()}
    max_dist_total = max(dist_totals.values(), default=1)
    conn.close()

    region_features = []
    for d in district_rows:
        total = dist_totals.get(d["district"], 0)
        score = risk_score(total, max_dist_total)
        level = risk_level(score)
        radius = 18 + (total / max_dist_total) * 22  # 18-40 km visual radius
        region_features.append(
            {
                "type": "Feature",
                "geometry": _circle_polygon(d["lat"], d["lng"], radius),
                "properties": {
                    "district": d["district"],
                    "total": total,
                    "risk_score": score,
                    "risk_level": level,
                    "label": f"{d['district']}\n{total:,}",
                    "center_lat": d["lat"],
                    "center_lng": d["lng"],
                },
            }
        )

    # ── 3.  Warning markers (top 6 highest-intensity taluks) ────────
    sorted_locs = sorted(location_totals.values(), key=lambda v: v["total"], reverse=True)
    warning_features = []
    for loc in sorted_locs[:6]:
        if loc["total"] <= 0:
            continue
        warning_features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [loc["lng"], loc["lat"]],
                },
                "properties": {
                    "total": loc["total"],
                    "district": loc["district"],
                    "taluk": loc["taluk"],
                    "intensity": round(loc["total"] / max_total, 4),
                },
            }
        )

    # ── 4.  Label points (district centroids) ───────────────────────
    label_features = []
    for d in district_rows:
        total = dist_totals.get(d["district"], 0)
        label_features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [d["lng"], d["lat"]],
                },
                "properties": {
                    "district": d["district"],
                    "total": total,
                    "label": f"{total:,}",
                },
            }
        )

    return {
        "points": {"type": "FeatureCollection", "features": point_features},
        "regions": {"type": "FeatureCollection", "features": region_features},
        "warnings": {"type": "FeatureCollection", "features": warning_features},
        "labels": {"type": "FeatureCollection", "features": label_features},
        "meta": {
            "total_points": len(point_features),
            "total_districts": len(district_rows),
            "max_intensity": max_total,
        },
    }
