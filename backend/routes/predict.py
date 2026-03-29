from fastapi import APIRouter, Query
from database import get_connection
from typing import Optional

router = APIRouter()

@router.get("/risk-score")
def get_risk_score(
    district: str = Query(...),
    category: Optional[str] = Query(None)
):
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT district, category,
               SUM(count) as total_crimes,
               COUNT(DISTINCT year) as years_active
        FROM fir_records
        WHERE district = ?
        GROUP BY district, category
        ORDER BY total_crimes DESC
    """, [district])

    rows = cursor.fetchall()
    conn.close()

    if not rows:
        return {"district": district, "risk_score": 0, "risk_level": "LOW"}

    total = sum(r["total_crimes"] for r in rows)

    if total > 1000:
        risk_level = "HIGH"
        risk_score = min(95, 70 + (total // 100))
    elif total > 500:
        risk_level = "MEDIUM"
        risk_score = min(69, 40 + (total // 50))
    else:
        risk_level = "LOW"
        risk_score = min(39, total // 20)

    return {
        "district": district,
        "risk_score": risk_score,
        "risk_level": risk_level,
        "total_crimes": total,
        "breakdown": [dict(r) for r in rows]
    }


@router.get("/high-risk-districts")
def get_high_risk_districts():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT district,
               SUM(count) as total_crimes,
               COUNT(DISTINCT category) as crime_types
        FROM fir_records
        GROUP BY district
        ORDER BY total_crimes DESC
        LIMIT 10
    """)

    rows = cursor.fetchall()
    conn.close()
    return {"high_risk": [dict(r) for r in rows]}


@router.get("/seasonal")
def get_seasonal_prediction(
    district: Optional[str] = Query(None)
):
    conn = get_connection()
    cursor = conn.cursor()

    query = """
        SELECT month,
               COUNT(*) as cases,
               category
        FROM fir_records
        WHERE 1=1
    """
    params = []
    if district:
        query += " AND district = ?"
        params.append(district)

    query += " GROUP BY month, category ORDER BY month"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return {"seasonal": [dict(r) for r in rows]}