from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from database import get_connection
from ml_engine import patrol_ml_prediction, scenario_zone_prediction, seasonal_ml_prediction
from ops_queries import risk_level, risk_score

router = APIRouter()


@router.get("/risk-score")
def get_risk_score(
    district: str = Query(...),
    category: Optional[str] = Query(None),
):
    conn = get_connection()
    cursor = conn.cursor()

    params = [district]
    category_sql = ""
    if category:
        category_sql = " AND category = ?"
        params.append(category)

    cursor.execute(
        f"""
        SELECT district, category, SUM(count) AS total_crimes
        FROM fir_records
        WHERE district = ?{category_sql}
        GROUP BY district, category
        ORDER BY total_crimes DESC
        """,
        params,
    )
    rows = cursor.fetchall()

    cursor.execute(
        """
        SELECT district, SUM(count) AS total
        FROM fir_records
        GROUP BY district
        ORDER BY total DESC
        """
    )
    all_districts = cursor.fetchall()
    conn.close()

    if not rows:
        return {
            "district": district,
            "risk_score": 0,
            "risk_level": "LOW",
            "total_crimes": 0,
            "breakdown": [],
            "categories": 0,
        }

    total = sum(row["total_crimes"] for row in rows)
    maximum = all_districts[0]["total"] if all_districts else total
    score = risk_score(total, maximum)

    return {
        "district": district,
        "risk_score": int(round(score)),
        "risk_level": risk_level(score),
        "total_crimes": total,
        "categories": len(rows),
        "breakdown": [dict(row) for row in rows],
    }


@router.get("/high-risk-districts")
def get_high_risk_districts():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT district,
               SUM(count) AS total_crimes,
               COUNT(DISTINCT category) AS crime_types
        FROM fir_records
        GROUP BY district
        ORDER BY total_crimes DESC
        LIMIT 12
        """
    )
    rows = cursor.fetchall()
    conn.close()
    return {"high_risk": [dict(row) for row in rows]}


@router.get("/seasonal")
def get_seasonal_prediction(
    district: Optional[str] = Query(None),
):
    conn = get_connection()
    cursor = conn.cursor()

    query = """
        SELECT month, category, SUM(count) AS cases
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
    return {"seasonal": [dict(row) for row in rows]}


@router.get("/seasonal-ml")
def get_seasonal_prediction_ml(
    district: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    horizon: int = Query(6, ge=1, le=12),
):
    return {
        "predictions": seasonal_ml_prediction(
            district=district,
            category=category,
            horizon=horizon,
        )
    }


@router.get("/patrol-ml")
def get_patrol_prediction_ml(
    district: str = Query(...),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
):
    today = date.today()
    return patrol_ml_prediction(
        district=district,
        target_year=year or today.year,
        target_month=month or today.month,
    )


@router.get("/scenario-zones")
def get_scenario_zone_prediction(
    scenario: str = Query(...),
    district: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    limit: int = Query(20, ge=1, le=60),
):
    today = date.today()
    try:
        return scenario_zone_prediction(
            scenario=scenario,
            district=district,
            target_year=year or today.year,
            target_month=month or today.month,
            limit=limit,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
