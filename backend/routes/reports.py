from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from report_service import build_operations_report_pdf, build_scenario_report_pdf

router = APIRouter()


@router.get("/operations-pdf")
def download_operations_report(
    year: Optional[int] = Query(None),
    district: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
):
    path = build_operations_report_pdf(
        {
            "year": year,
            "district": district,
            "category": category,
        }
    )
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=Path(path).name,
    )


@router.get("/scenario-pdf")
def download_scenario_report(
    scenario: Literal["women_safety", "accident"] = Query(...),
    district: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    limit: int = Query(20, ge=1, le=60),
):
    try:
        path = build_scenario_report_pdf(
            {
                "scenario": scenario,
                "district": district,
                "year": year,
                "month": month,
                "limit": limit,
            }
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return FileResponse(
        path,
        media_type="application/pdf",
        filename=Path(path).name,
    )
