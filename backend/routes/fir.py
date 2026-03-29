from fastapi import APIRouter, Query
from database import get_connection
from typing import Optional

router = APIRouter()

@router.get("/all")
def get_all_firs(
    year: Optional[int] = Query(None),
    category: Optional[str] = Query(None),
    district: Optional[str] = Query(None)
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

    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return {"data": [dict(r) for r in rows], "count": len(rows)}


@router.get("/districts")
def get_districts():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT DISTINCT district FROM fir_records ORDER BY district"
    )
    rows = cursor.fetchall()
    conn.close()
    return {"districts": [r["district"] for r in rows]}


@router.get("/categories")
def get_categories():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT DISTINCT category FROM crime_categories ORDER BY category"
    )
    rows = cursor.fetchall()
    conn.close()
    return {"categories": [r["category"] for r in rows]}

@router.get("/years")
def get_years():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT DISTINCT year FROM fir_records ORDER BY year"
    )
    rows = cursor.fetchall()
    conn.close()
    return {"years": [r["year"] for r in rows]}