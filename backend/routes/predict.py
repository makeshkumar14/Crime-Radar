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
               SUM(count) as total_crimes
        FROM fir_records
        WHERE district = ?
        GROUP BY district, category
        ORDER BY total_crimes DESC
    """, [district])

    rows = cursor.fetchall()

    # Get max crimes across all districts for normalization
    cursor.execute("""
        SELECT district, SUM(count) as total
        FROM fir_records
        GROUP BY district
        ORDER BY total DESC
    """)
    all_districts = cursor.fetchall()
    conn.close()

    if not rows:
        return {"district": district, "risk_score": 0, "risk_level": "LOW", "total_crimes": 0, "breakdown": []}

    total = sum(r["total_crimes"] for r in rows)
    max_total = all_districts[0]["total"] if all_districts else total
    min_total = all_districts[-1]["total"] if all_districts else 0

    # Normalize score between 10 and 95
    if max_total == min_total:
        risk_score = 50
    else:
        risk_score = int(10 + ((total - min_total) / (max_total - min_total)) * 85)
    risk_score = max(10, min(95, risk_score))

    # Risk level based on normalized score
    if risk_score >= 65:
        risk_level = "HIGH"
    elif risk_score >= 35:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    # Count unique categories
    unique_categories = len(set(r["category"] for r in rows))

    return {
        "district":   district,
        "risk_score": risk_score,
        "risk_level": risk_level,
        "total_crimes": total,
        "categories": unique_categories,
        "breakdown":  [dict(r) for r in rows]
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