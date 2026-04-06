from typing import Optional

from fastapi import APIRouter, Query

from database import get_connection

router = APIRouter()


@router.get("/summary")
def get_crime_summary(
    year: Optional[int] = Query(None),
    district: Optional[str] = Query(None),
):
    conn = get_connection()
    cursor = conn.cursor()

    query = """
        SELECT category, severity,
               COUNT(*) AS record_count,
               SUM(count) AS total_count
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
    return {"summary": [dict(row) for row in rows]}


@router.get("/trend")
def get_crime_trend(
    district: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
):
    conn = get_connection()
    cursor = conn.cursor()

    query = """
        SELECT year, SUM(count) AS cases
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

    query += " GROUP BY year ORDER BY year"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return {"trend": [dict(row) for row in rows]}


@router.get("/by-ipc")
def get_by_ipc(ipc_section: str = Query(...)):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT ipc_section, district, year, category, severity,
               SUM(count) AS total
        FROM fir_records
        WHERE ipc_section = ?
        GROUP BY ipc_section, district, year, category, severity
        ORDER BY total DESC
        """,
        [ipc_section],
    )
    rows = cursor.fetchall()
    conn.close()
    return {"data": [dict(row) for row in rows]}
