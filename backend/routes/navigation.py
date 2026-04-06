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
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
):
    today = date.today()
    try:
        return build_navigation_from_coordinates(
            source=source,
            destination=destination,
            mode=normalize_mode(mode),
            target_year=year or today.year,
            target_month=month or today.month,
        )
    except ValueError as exc:
        return {"status": "error", "message": str(exc)}


@router.get("/taluks/route")
def get_taluk_route(
    origin_taluk_id: str = Query(...),
    destination_taluk_id: str = Query(...),
    mode: str = Query("compare"),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
):
    today = date.today()
    return build_navigation_from_taluks(
        origin_taluk_id=origin_taluk_id,
        destination_taluk_id=destination_taluk_id,
        mode=normalize_mode(mode),
        target_year=year or today.year,
        target_month=month or today.month,
    )
