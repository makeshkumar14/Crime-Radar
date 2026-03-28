from fastapi import APIRouter, Query
from database import get_connection
from typing import Optional

router = APIRouter()

@router.get("/summary")
def get_crime_summary(
    year: Optional[int] = Query(None),
    district: Optional[str] = Query(None)
):
    conn = get_connection()
    cursor = conn.cursor()

    query = """
        SELECT category, severity,
               COUNT(*) as total_cases,
               SUM(count) as total_count
        FROM fir_records
        WHERE 1=1
    """
    params = []
    if year:
        query += " AND year = ?"
        params.append(year)
    if district:
        query += " AND district = ?"
        params.append(district)

    query += " GROUP BY category, severity ORDER BY total_count DESC"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return {"summary": [dict(r) for r in rows]}


@router.get("/trend")
def get_crime_trend(
    district: Optional[str] = Query(None),
    category: Optional[str] = Query(None)
):
    conn = get_connection()
    cursor = conn.cursor()

    query = """
        SELECT year, COUNT(*) as cases
        FROM fir_records WHERE 1=1
    """
    params = []
    if district:
        query += " AND district = ?"
        params.append(district)
    if category:
        query += " AND category = ?"
        params.append(category)

    query += " GROUP BY year ORDER BY year"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return {"trend": [dict(r) for r in rows]}


@router.get("/by-ipc")
def get_by_ipc(ipc_section: str = Query(...)):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT f.district, f.year, SUM(f.count) as total,
               c.category, c.severity, c.description
        FROM fir_records f
        JOIN crime_categories c ON f.ipc_section = c.ipc_section
        WHERE f.ipc_section = ?
        GROUP BY f.district, f.year
        ORDER BY total DESC
    """, [ipc_section])
    rows = cursor.fetchall()
    conn.close()
    return {"data": [dict(r) for r in rows]}