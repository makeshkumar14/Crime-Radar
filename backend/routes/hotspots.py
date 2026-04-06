from typing import Optional

from fastapi import APIRouter, Query

from ops_queries import load_map_layers

router = APIRouter()


@router.get("/all")
def get_all_hotspots(
    risk_level: Optional[str] = Query(None),
    district: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    category: Optional[str] = Query(None),
):
    hotspots = load_map_layers(year=year, category=category, district=district)["hotspots"]
    if risk_level:
        hotspots = [row for row in hotspots if row["risk_level"] == risk_level]
    return {"hotspots": hotspots, "count": len(hotspots)}


@router.get("/top")
def get_top_hotspots(
    limit: int = Query(5),
    district: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
):
    hotspots = load_map_layers(year=year, district=district)["hotspots"]
    return {"hotspots": hotspots[:limit]}


@router.get("/by-risk")
def get_by_risk(
    risk_level: str = Query(...),
    district: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
):
    hotspots = load_map_layers(year=year, district=district)["hotspots"]
    hotspots = [row for row in hotspots if row["risk_level"] == risk_level]
    return {"hotspots": hotspots}
