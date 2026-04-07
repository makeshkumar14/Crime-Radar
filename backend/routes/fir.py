from datetime import date
from typing import Optional

from fastapi import APIRouter, Body, Query
from pydantic import BaseModel

from crime_catalog import catalog_by_category
from database import get_connection
from insights_service import build_fir_impact_summary
from ops_queries import load_map_layers

router = APIRouter()


CATEGORY_CODES = catalog_by_category()


class DemoEntry(BaseModel):
    district: Optional[str] = None
    taluk_id: Optional[str] = None
    category: str = "Property"
    count: int = 4
    time_slot: Optional[str] = None
    month: Optional[int] = None
    year: Optional[int] = None


@router.get("/all")
def get_all_firs(
    year: Optional[int] = Query(None),
    category: Optional[str] = Query(None),
    district: Optional[str] = Query(None),
):
    conn = get_connection()
    cursor = conn.cursor()

    query = "SELECT * FROM fir_records WHERE 1=1"
    params = []

    if year:
        query += " AND year = ?"
        params.append(year)
    if category:
        query += " AND category = ?"
        params.append(category)
    if district:
        query += " AND district = ?"
        params.append(district)

    query += " ORDER BY year DESC, month DESC, count DESC"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return {"data": [dict(row) for row in rows], "count": len(rows)}


@router.get("/map-layers")
def get_map_layers(
    year: Optional[int] = Query(None),
    category: Optional[str] = Query(None),
    district: Optional[str] = Query(None),
):
    return load_map_layers(year=year, category=category, district=district)


@router.get("/districts")
def get_districts():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT district FROM districts ORDER BY district")
    rows = cursor.fetchall()
    conn.close()
    return {"districts": [row["district"] for row in rows]}


@router.get("/taluks")
def get_taluks(district: Optional[str] = Query(None)):
    conn = get_connection()
    cursor = conn.cursor()
    if district:
        cursor.execute(
            "SELECT taluk_id, district, taluk FROM taluks WHERE district = ? ORDER BY taluk",
            [district],
        )
    else:
        cursor.execute("SELECT taluk_id, district, taluk FROM taluks ORDER BY district, taluk")
    rows = cursor.fetchall()
    conn.close()
    return {"taluks": [dict(row) for row in rows]}


@router.get("/stations")
def get_stations(district: Optional[str] = Query(None)):
    conn = get_connection()
    cursor = conn.cursor()
    if district:
        cursor.execute(
            """
            SELECT station_id, station_name, district, taluk, lat, lng, source_type
            FROM police_stations
            WHERE district = ?
            ORDER BY station_name
            """,
            [district],
        )
    else:
        cursor.execute(
            """
            SELECT station_id, station_name, district, taluk, lat, lng, source_type
            FROM police_stations
            ORDER BY district, station_name
            """
        )
    rows = cursor.fetchall()
    conn.close()
    return {"stations": [dict(row) for row in rows]}


@router.get("/categories")
def get_categories():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT DISTINCT category FROM crime_categories ORDER BY category"
    )
    rows = cursor.fetchall()
    conn.close()
    return {"categories": [row["category"] for row in rows]}


@router.get("/years")
def get_years():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT DISTINCT year FROM fir_records ORDER BY year")
    rows = cursor.fetchall()
    conn.close()
    return {"years": [row["year"] for row in rows]}


@router.post("/demo-entry")
def create_demo_entry(payload: DemoEntry = Body(...)):
    conn = get_connection()
    cursor = conn.cursor()

    if payload.taluk_id:
        cursor.execute(
            """
            SELECT t.taluk_id, t.district, t.taluk, t.lat, t.lng,
                   p.station_id, p.station_name
            FROM taluks t
            LEFT JOIN police_stations p ON p.station_id = t.primary_station_id
            WHERE t.taluk_id = ?
            """,
            [payload.taluk_id],
        )
    elif payload.district:
        cursor.execute(
            """
            SELECT t.taluk_id, t.district, t.taluk, t.lat, t.lng,
                   p.station_id, p.station_name,
                   COALESCE(SUM(f.count), 0) AS total
            FROM taluks t
            LEFT JOIN police_stations p ON p.station_id = t.primary_station_id
            LEFT JOIN fir_records f ON f.taluk_id = t.taluk_id
            WHERE t.district = ?
            GROUP BY t.taluk_id, t.district, t.taluk, t.lat, t.lng, p.station_id, p.station_name
            ORDER BY total DESC, t.taluk
            LIMIT 1
            """,
            [payload.district],
        )
    else:
        cursor.execute(
            """
            SELECT t.taluk_id, t.district, t.taluk, t.lat, t.lng,
                   p.station_id, p.station_name,
                   COALESCE(SUM(f.count), 0) AS total
            FROM taluks t
            LEFT JOIN police_stations p ON p.station_id = t.primary_station_id
            LEFT JOIN fir_records f ON f.taluk_id = t.taluk_id
            GROUP BY t.taluk_id, t.district, t.taluk, t.lat, t.lng, p.station_id, p.station_name
            ORDER BY total DESC, t.taluk
            LIMIT 1
            """
        )

    taluk_row = cursor.fetchone()
    if not taluk_row:
        conn.close()
        return {"status": "error", "message": "No target zone found"}

    category = payload.category if payload.category in CATEGORY_CODES else "Property"
    legal_entry = CATEGORY_CODES[category][0]
    today = date.today()
    incident_year = payload.year or today.year
    incident_month = payload.month or today.month
    time_slot = payload.time_slot or "EVENING"
    count = max(1, min(payload.count, 25))
    before_layers = load_map_layers(year=incident_year)

    cursor.execute(
        """
        INSERT INTO fir_records
        (district, taluk_id, taluk, station_id, station_name, lat, lng, law_name, ipc_section,
         category, severity, year, month, day_of_week, time_slot, incident_date,
         source_type, count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            taluk_row["district"],
            taluk_row["taluk_id"],
            taluk_row["taluk"],
            taluk_row["station_id"],
            taluk_row["station_name"],
            taluk_row["lat"],
            taluk_row["lng"],
            legal_entry["law_name"],
            legal_entry["ipc_section"],
            category,
            legal_entry["severity"],
            incident_year,
            incident_month,
            today.isoweekday(),
            time_slot,
            today.isoformat(),
            "demo-entry",
            count,
        ],
    )
    conn.commit()
    conn.close()

    layers = load_map_layers(
        year=incident_year,
        district=taluk_row["district"],
    )
    after_statewide_layers = load_map_layers(year=incident_year)
    impact_summary = build_fir_impact_summary(
        {
            "district": taluk_row["district"],
            "taluk_id": taluk_row["taluk_id"],
            "taluk": taluk_row["taluk"],
            "category": category,
            "count": count,
        },
        before_layers,
        after_statewide_layers,
    )

    return {
        "status": "ok",
        "message": "Demo FIR inserted",
        "entry": {
            "district": taluk_row["district"],
            "taluk_id": taluk_row["taluk_id"],
            "taluk": taluk_row["taluk"],
            "station_name": taluk_row["station_name"],
            "category": category,
            "count": count,
            "lat": taluk_row["lat"],
            "lng": taluk_row["lng"],
        },
        "impact_summary": impact_summary,
        "impact": layers,
    }
