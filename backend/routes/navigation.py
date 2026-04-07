from datetime import date
from typing import Optional

from fastapi import APIRouter, Query

from navigation_service import (
    build_navigation_from_coordinates,
    build_navigation_from_taluks,
)

router = APIRouter()


def normalize_mode(mode):
    normalized = (mode or "compare").lower()
    return normalized if normalized in {"fast", "safe", "compare"} else "compare"


@router.get("/route")
def get_route(
    source: str = Query(..., description="Longitude,latitude"),
    destination: str = Query(..., description="Longitude,latitude"),
    mode: str = Query("compare"),
    year: Optional[int] = Query(None, ge=1),
    month: Optional[int] = Query(None, ge=1, le=12),
    accident_buffer_m: Optional[float] = Query(None, ge=150, le=2000),
    warning_buffer_m: Optional[float] = Query(None, ge=150, le=5000),
    max_distance_increase_pct: Optional[float] = Query(None, ge=5, le=80),
    max_eta_increase_pct: Optional[float] = Query(None, ge=5, le=80),
    alternatives: Optional[int] = Query(None, ge=0, le=6),
):
    today = date.today()
    try:
        return build_navigation_from_coordinates(
            source=source,
            destination=destination,
            mode=normalize_mode(mode),
            target_year=year or today.year,
            target_month=month or today.month,
            accident_buffer_m=accident_buffer_m,
            warning_buffer_m=warning_buffer_m,
            max_distance_increase_pct=max_distance_increase_pct,
            max_eta_increase_pct=max_eta_increase_pct,
            alternatives=alternatives,
        )
    except ValueError as exc:
        return {"status": "error", "message": str(exc)}


@router.get("/taluks/route")
def get_taluk_route(
    origin_taluk_id: str = Query(...),
    destination_taluk_id: str = Query(...),
    mode: str = Query("compare"),
    year: Optional[int] = Query(None, ge=1),
    month: Optional[int] = Query(None, ge=1, le=12),
    accident_buffer_m: Optional[float] = Query(None, ge=150, le=2000),
    warning_buffer_m: Optional[float] = Query(None, ge=150, le=5000),
    max_distance_increase_pct: Optional[float] = Query(None, ge=5, le=80),
    max_eta_increase_pct: Optional[float] = Query(None, ge=5, le=80),
    alternatives: Optional[int] = Query(None, ge=0, le=6),
):
    today = date.today()
    try:
        return build_navigation_from_taluks(
            origin_taluk_id=origin_taluk_id,
            destination_taluk_id=destination_taluk_id,
            mode=normalize_mode(mode),
            target_year=year or today.year,
            target_month=month or today.month,
            accident_buffer_m=accident_buffer_m,
            warning_buffer_m=warning_buffer_m,
            max_distance_increase_pct=max_distance_increase_pct,
            max_eta_increase_pct=max_eta_increase_pct,
            alternatives=alternatives,
        )
    except ValueError as exc:
        return {"status": "error", "message": str(exc)}
