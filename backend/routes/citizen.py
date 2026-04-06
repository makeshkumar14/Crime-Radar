from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse

from ml_engine import area_safety_snapshot, build_area_report_pdf, route_safety_advisory

router = APIRouter()


@router.get("/route-advisory")
def get_route_advisory(
    origin_taluk_id: str = Query(...),
    destination_taluk_id: str = Query(...),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
):
    today = date.today()
    return route_safety_advisory(
        origin_taluk_id=origin_taluk_id,
        destination_taluk_id=destination_taluk_id,
        target_year=year or today.year,
        target_month=month or today.month,
    )


@router.get("/area-safety")
def get_area_safety(
    taluk_id: str = Query(...),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
):
    today = date.today()
    snapshot = area_safety_snapshot(
        taluk_id=taluk_id,
        target_year=year or today.year,
        target_month=month or today.month,
    )
    if not snapshot:
        return {"status": "error", "message": "Area not found"}
    return {"status": "ok", "report": snapshot}


@router.get("/area-safety-report")
def download_area_safety_report(
    taluk_id: str = Query(...),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
):
    today = date.today()
    snapshot = area_safety_snapshot(
        taluk_id=taluk_id,
        target_year=year or today.year,
        target_month=month or today.month,
    )
    if not snapshot:
        return {"status": "error", "message": "Area not found"}

    path = build_area_report_pdf(snapshot)
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=Path(path).name,
    )
