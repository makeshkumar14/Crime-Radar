from typing import Optional

from fastapi import APIRouter, Query

from insights_service import (
    build_district_compare,
    build_district_profile,
    build_taluk_explanation,
    build_watchlist_snapshot,
    parse_natural_language_filters,
)

router = APIRouter()


@router.get("/district-profile")
def get_district_profile(
    district: str = Query(...),
    year: Optional[int] = Query(None),
    category: Optional[str] = Query(None),
    target_year: Optional[int] = Query(None),
    target_month: Optional[int] = Query(None),
):
    return build_district_profile(
        district,
        year=year,
        category=category,
        target_year=target_year,
        target_month=target_month,
    )


@router.get("/district-compare")
def get_district_compare(
    left_district: str = Query(...),
    right_district: str = Query(...),
    year: Optional[int] = Query(None),
    category: Optional[str] = Query(None),
    target_year: Optional[int] = Query(None),
    target_month: Optional[int] = Query(None),
):
    return build_district_compare(
        left_district,
        right_district,
        year=year,
        category=category,
        target_year=target_year,
        target_month=target_month,
    )


@router.get("/taluk-explanation")
def get_taluk_explanation(
    taluk_id: str = Query(...),
    district: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    category: Optional[str] = Query(None),
    target_year: Optional[int] = Query(None),
    target_month: Optional[int] = Query(None),
):
    return build_taluk_explanation(
        taluk_id,
        year=year,
        district=district,
        category=category,
        target_year=target_year,
        target_month=target_month,
    )


@router.get("/watchlist")
def get_watchlist_snapshot(
    taluk_ids: list[str] = Query(default=[]),
    target_year: Optional[int] = Query(None),
    target_month: Optional[int] = Query(None),
):
    return build_watchlist_snapshot(
        taluk_ids,
        target_year=target_year,
        target_month=target_month,
    )


@router.get("/parse-filters")
def get_parsed_filters(text: str = Query(..., min_length=2)):
    return parse_natural_language_filters(text)
