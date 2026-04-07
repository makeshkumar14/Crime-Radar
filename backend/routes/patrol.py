from datetime import date
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from patrol_service import generate_patrol_plan

router = APIRouter()


class EventZoneRequest(BaseModel):
    event_id: Optional[str] = None
    name: Optional[str] = None
    lat: float
    lng: float
    radius_km: float = 2.0
    priority_boost: float = 1.15


class PatrolUnitRequest(BaseModel):
    unit_id: Optional[str] = None
    station_id: Optional[str] = None
    label: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


class PatrolPlanRequest(BaseModel):
    district: str
    target_year: Optional[int] = None
    target_month: Optional[int] = None
    grid_size_km: float = 1.0
    unit_count: Optional[int] = None
    time_band: str = "peak"
    weather: str = "clear"
    include_crime: bool = True
    is_festival: bool = False
    lookback_months: int = 12
    strategy: str = "auto"
    reroute_interval_min: int = 45
    max_targets_per_unit: int = 4
    event_zones: List[EventZoneRequest] = Field(default_factory=list)
    patrol_units: List[PatrolUnitRequest] = Field(default_factory=list)


def model_to_dict(item):
    if hasattr(item, "model_dump"):
        return item.model_dump()
    return item.dict()


@router.post("/routes/generate")
def generate_patrol_routes(payload: PatrolPlanRequest):
    today = date.today()
    try:
        return generate_patrol_plan(
            district=payload.district,
            target_year=payload.target_year or today.year,
            target_month=payload.target_month or today.month,
            grid_size_km=payload.grid_size_km,
            unit_count=payload.unit_count,
            time_band=payload.time_band,
            weather=payload.weather,
            include_crime=payload.include_crime,
            is_festival=payload.is_festival,
            event_zones=[model_to_dict(item) for item in payload.event_zones],
            lookback_months=payload.lookback_months,
            strategy=payload.strategy,
            reroute_interval_min=payload.reroute_interval_min,
            max_targets_per_unit=payload.max_targets_per_unit,
            patrol_units=[model_to_dict(item) for item in payload.patrol_units],
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
