from fastapi import APIRouter, Query
from database import get_connection
from typing import Optional

router = APIRouter()

@router.get("/all")
def get_all_hotspots(
    risk_level: Optional[str] = Query(None)
):
    conn = get_connection()
    cursor = conn.cursor()

    query = "SELECT * FROM hotspot_zones WHERE 1=1"
    params = []

    if risk_level:
        query += " AND risk_level = ?"
        params.append(risk_level)

    query += " ORDER BY risk_score DESC"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return {"hotspots": [dict(r) for r in rows], "count": len(rows)}


@router.get("/top")
def get_top_hotspots(limit: int = Query(5)):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM hotspot_zones
        ORDER BY risk_score DESC
        LIMIT ?
    """, [limit])
    rows = cursor.fetchall()
    conn.close()
    return {"hotspots": [dict(r) for r in rows]}


@router.get("/by-risk")
def get_by_risk(risk_level: str = Query(...)):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM hotspot_zones
        WHERE risk_level = ?
        ORDER BY risk_score DESC
    """, [risk_level])
    rows = cursor.fetchall()
    conn.close()
    return {"hotspots": [dict(r) for r in rows]}