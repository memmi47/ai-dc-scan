#!/usr/bin/env python3
"""Build the browser dataset from the user-provided source CSV.

The source columns are never overwritten. The normalized CSV only prepends
stable identifiers, and the browser bundle selects source fields verbatim.
"""

from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "us-datacenter-semianalysis-clean-v1.csv"
NORMALIZED = ROOT / "data" / "us-datacenter-normalized.csv"
BROWSER_DATA = ROOT / "data" / "datacenters-data.js"
LEGACY_GRID_MAPPING = ROOT / "data" / "legacy-market-grid-regions.json"

DERIVED_FIELDS = [
    "Source_Row_ID",
    "Facility_ID",
    "Campus_ID",
    "Facility_Sequence",
    "Grid_Region_Display",
    "Grid_Region_Method",
]

with LEGACY_GRID_MAPPING.open("r", encoding="utf-8") as mapping_file:
    legacy_market_grids = json.load(mapping_file)["markets"]

AUTHORITY_GRIDS = {
    "PJM INTERCONNECTION": "PJM",
    "MIDCONTINENT INDEPENDENT": "MISO",
    "SOUTHWEST POWER POOL": "SPP",
    "ELECTRIC RELIABILITY COUNCIL OF TEXAS": "ERCOT",
    "CALIFORNIA INDEPENDENT SYSTEM OPERATOR": "CAISO",
    "NEW YORK INDEPENDENT SYSTEM OPERATOR": "NYISO",
    "ISO NEW ENGLAND": "ISONE",
    "TENNESSEE VALLEY AUTHORITY": "TVA",
}

# 기존 저장소의 시장 매핑이 중복되는 지명만 주·전력기관으로 해소한다.
AMBIGUOUS_MARKETS = {
    ("Charleston", "South Carolina"): "SERC_SE",
    ("Charleston", "West Virginia"): "PJM",
    ("Columbia", "South Carolina"): "SERC_SE",
    ("Columbia", "Indiana"): "MISO",
}

# 기존 시장 매핑과 원본 Controlling_Authority로도 결정되지 않는 행의 지리 보조 규칙이다.
STATE_GRID_FALLBACK = {
    "Alaska": "Alaska",
    "Hawaii": "Hawaii",
    "Washington": "WECC_NW",
    "Oregon": "WECC_NW",
    "Idaho": "WECC_NW",
    "Utah": "WECC_NW",
    "Colorado": "WECC_RMP",
    "Wyoming": "WECC_RMP",
    "Montana": "WECC_RMP",
    "Arizona": "WECC_SW",
    "Nevada": "WECC_SW",
    "New Mexico": "WECC_SW",
    "California": "CAISO",
    "Georgia": "SERC_SE",
    "North Carolina": "SERC_SE",
    "South Carolina": "SERC_SE",
    "Alabama": "SERC_SE",
    "Mississippi": "SERC_SE",
    "Florida": "SERC_FL",
    "Tennessee": "SERC_Central",
    "Arkansas": "MISO",
    "Louisiana": "MISO",
    "Kentucky": "MISO",
    "Missouri": "MISO",
    "Iowa": "MISO",
    "Minnesota": "MISO",
    "Wisconsin": "MISO",
    "Michigan": "MISO",
    "North Dakota": "MISO",
    "Indiana": "MISO",
    "Illinois": "MISO",
    "Kansas": "SPP",
    "Nebraska": "SPP",
    "Oklahoma": "SPP",
    "South Dakota": "SPP",
    "Texas": "ERCOT",
    "Virginia": "PJM",
    "West Virginia": "PJM",
    "Maryland": "PJM",
    "District of Columbia": "PJM",
    "Delaware": "PJM",
    "New Jersey": "PJM",
    "Pennsylvania": "PJM",
    "Ohio": "PJM",
    "New York": "NYISO",
    "Connecticut": "ISONE",
    "Massachusetts": "ISONE",
    "Maine": "ISONE",
    "New Hampshire": "ISONE",
    "Rhode Island": "ISONE",
    "Vermont": "ISONE",
}


def base_market(value: str) -> str:
    return re.sub(r",\s*[A-Z]{2}$", "", value.strip())


def grid_region(row: dict[str, str]) -> tuple[str, str]:
    source_grid = row["Power_Grid_ISO"].strip()
    if source_grid:
        return source_grid, "source:Power_Grid_ISO"

    market = base_market(row["Market"])
    state = row["State"].strip()
    if market in legacy_market_grids:
        return legacy_market_grids[market], "derived:legacy_market"
    if (market, state) in AMBIGUOUS_MARKETS:
        return AMBIGUOUS_MARKETS[(market, state)], "derived:legacy_market+state"

    authority = row["Controlling_Authority"].upper()
    for token, grid in AUTHORITY_GRIDS.items():
        if token in authority:
            return grid, "derived:Controlling_Authority"

    # 원본 시장의 철자·표기 차이로 기존 매핑에 없는 소수 행만 명시적으로 보정한다.
    if market == "Southaven":
        return "MISO", "derived:market_geography"
    if market == "Center" and state == "North Dakota":
        return "MISO", "derived:state_geography"
    if market == "Wichita Falls":
        return "ERCOT", "derived:market_geography"
    if row["Country"].strip() == "Canada":
        return "Canada", "derived:country_geography"

    fallback = STATE_GRID_FALLBACK.get(state)
    if fallback:
        return fallback, "derived:state_geography"
    raise RuntimeError(f"Grid region unresolved: {row['Country']} / {state} / {row['Market']}")


def number(value: str) -> float | None:
    value = value.strip()
    if not value:
        return None
    return float(value)


def text(value: str) -> str | None:
    value = value.strip()
    return value or None


# 원본은 2017~2023년을 연말(Cap_YE) 컬럼으로, 2024~2032년을 4분기(Q4) 컬럼으로 나눠 담는다.
SERIES_YEARS = list(range(2017, 2033))


def series_column(year: int) -> str:
    return f"Cap_{year}_YE_MW" if year <= 2023 else f"Q4_{year}_MW"


def capacity_series(row: dict[str, str]) -> list[float]:
    """연도별 누적 가동 용량(MW)을 2017~2032년 16개 값으로 만든다.

    원본의 빈 칸은 '아직 가동 전이라 변화 없음'을 뜻하며 Start_of_Operations와 일치한다.
    따라서 직전 값을 그대로 이어받고(전방 채움), 첫 값이 비면 0으로 둔다.
    """
    result: list[float] = []
    carried = 0.0
    for year in SERIES_YEARS:
        raw = row[series_column(year)].strip()
        if raw:
            carried = float(raw)
        result.append(round(carried, 2))
    return result


with SOURCE.open("r", encoding="utf-8-sig", newline="") as source_file:
    reader = csv.DictReader(source_file)
    if reader.fieldnames is None:
        raise RuntimeError("CSV header is missing")
    source_fields = list(reader.fieldnames)
    rows = list(reader)

required = {
    "Cluster_ID",
    "Company",
    "Facility_Type",
    "City",
    "State",
    "Country",
    "Market",
    "Latitude",
    "Longitude",
    "Total_UnderConstruction_MW",
    "Total_Planned_MW",
    "Q4_2026_MW",
    "Q4_2030_MW",
    *(series_column(year) for year in SERIES_YEARS),
}
missing = sorted(required - set(source_fields))
if missing:
    raise RuntimeError(f"Required source columns are missing: {', '.join(missing)}")

campus_ids: dict[tuple[str, str, str], str] = {}
campus_sequences: defaultdict[tuple[str, str, str], int] = defaultdict(int)
normalized_rows: list[dict[str, str]] = []
facilities: list[dict[str, object]] = []

for index, row in enumerate(rows, start=1):
    campus_key = (
        row["Country"].strip(),
        row["Market"].strip(),
        row["Cluster_ID"].strip(),
    )
    if campus_key not in campus_ids:
        campus_ids[campus_key] = f"CAM-{len(campus_ids) + 1:04d}"
    campus_sequences[campus_key] += 1

    source_row_id = f"SA-{index:06d}"
    facility_id = f"FAC-{index:06d}"
    campus_id = campus_ids[campus_key]
    facility_sequence = campus_sequences[campus_key]
    display_grid, grid_method = grid_region(row)
    capacity_years = capacity_series(row)
    year_capacity = dict(zip(SERIES_YEARS, capacity_years))

    normalized_rows.append(
        {
            "Source_Row_ID": source_row_id,
            "Facility_ID": facility_id,
            "Campus_ID": campus_id,
            "Facility_Sequence": str(facility_sequence),
            "Grid_Region_Display": display_grid,
            "Grid_Region_Method": grid_method,
            **row,
        }
    )

    facilities.append(
        {
            "sourceRowId": source_row_id,
            "facilityId": facility_id,
            "campusId": campus_id,
            "facilitySequence": facility_sequence,
            "clusterId": row["Cluster_ID"],
            "company": row["Company"],
            "facilityType": row["Facility_Type"],
            "city": row["City"],
            "state": row["State"],
            "country": row["Country"],
            "market": row["Market"],
            "zipCode": text(row["ZIP_Code"]),
            "latitude": number(row["Latitude"]),
            "longitude": number(row["Longitude"]),
            "powerGridIso": text(row["Power_Grid_ISO"]),
            "gridRegionDisplay": display_grid,
            "gridRegionMethod": grid_method,
            "onsiteGasGeneration": text(row["Onsite_Gas_Generation"]),
            "estimatedEndUser": text(row["Estimated_End_User"]),
            "gpuCloud": text(row["GPU_Cloud"]),
            "estimatedTenant": text(row["Estimated_Tenant"]),
            "utility": text(row["Utility"]),
            "holdingCompanyUtility": text(row["Holding_Co_Utility"]),
            "controllingAuthority": text(row["Controlling_Authority"]),
            "underConstructionMw": number(row["Total_UnderConstruction_MW"]),
            "plannedMw": number(row["Total_Planned_MW"]),
            "facilitySqft": number(row["Facility_Sqft"]),
            "startOfConstruction": text(row["Start_of_Construction"]),
            "timeToBuildMonths": number(row["Time_to_Build_Months"]),
            "startOfOperations": text(row["Start_of_Operations"]),
            "fullCapacityDate": text(row["Full_Capacity_Date"]),
            "quartersToComplete": number(row["Quarters_to_Complete"]),
            # 스냅샷 두 개는 전방 채움된 시계열에서 뽑아 빈 칸이 0으로 새지 않게 한다.
            "capacity2026Mw": year_capacity[2026],
            "capacity2030Mw": year_capacity[2030],
            "capacityByYear": capacity_years,
        }
    )

with NORMALIZED.open("w", encoding="utf-8-sig", newline="") as normalized_file:
    writer = csv.DictWriter(
        normalized_file,
        fieldnames=[
            *DERIVED_FIELDS,
            *source_fields,
        ],
    )
    writer.writeheader()
    writer.writerows(normalized_rows)

country_totals: dict[str, dict[str, object]] = {}
for country in sorted({str(item["country"]) for item in facilities}):
    subset = [item for item in facilities if item["country"] == country]
    country_totals[country] = {
        "capacity2026Mw": sum(float(item["capacity2026Mw"] or 0) for item in subset),
        "capacity2030Mw": sum(float(item["capacity2030Mw"] or 0) for item in subset),
        "underConstructionMw": sum(
            float(item["underConstructionMw"] or 0) for item in subset
        ),
        "plannedMw": sum(float(item["plannedMw"] or 0) for item in subset),
        "capacityByYear": [
            round(sum(item["capacityByYear"][position] for item in subset), 2)
            for position in range(len(SERIES_YEARS))
        ],
    }

# 지도 배경을 전력시장 구조로 칠하기 위한 주별 대표 권역.
# 시설이 있는 주는 실제 데이터의 최빈 권역을, 없는 주는 지리 폴백을 쓴다.
state_grid_counts: defaultdict[str, Counter[str]] = defaultdict(Counter)
for item in facilities:
    if item["country"] == "USA":
        state_grid_counts[str(item["state"])][str(item["gridRegionDisplay"])] += 1

state_grids: dict[str, str] = {}
for state, fallback in STATE_GRID_FALLBACK.items():
    counts = state_grid_counts.get(state)
    state_grids[state] = counts.most_common(1)[0][0] if counts else fallback
for state, counts in state_grid_counts.items():
    state_grids.setdefault(state, counts.most_common(1)[0][0])

browser_payload = {
    "meta": {
        "schemaVersion": 2,
        "source": "Source CSV",
        "sourceRows": len(rows),
        "stateGrids": dict(sorted(state_grids.items())),
        "campusGroups": len(campus_ids),
        "years": SERIES_YEARS,
        "countries": country_totals,
            "provenance": {
            "raw": "Source CSV",
            "derived": "Power grid display uses source Power_Grid_ISO first, then legacy repository market geography and source fields",
            "estimated": "Fields explicitly marked Estimated in the source CSV",
            "external": "No external web data added",
            "series": "capacityByYear is Cap_YYYY_YE_MW for 2017-2023 and Q4_YYYY_MW for 2024-2032; blank source cells carry the previous year forward",
            "stateGrids": "Most frequent Grid_Region_Display among that state's facilities; states with no facilities use the state geography fallback",
        },
    },
    "facilities": facilities,
}

BROWSER_DATA.write_text(
    "window.DC_DATA="
    + json.dumps(browser_payload, ensure_ascii=False, separators=(",", ":"))
    + ";\n",
    encoding="utf-8",
)

print(
    json.dumps(
        {
            "sourceRows": len(rows),
            "normalizedRows": len(normalized_rows),
            "facilityRows": len(facilities),
            "campusGroups": len(campus_ids),
            "countryTotals": country_totals,
            "normalizedCsv": str(NORMALIZED.relative_to(ROOT)),
            "browserData": str(BROWSER_DATA.relative_to(ROOT)),
        },
        ensure_ascii=False,
        indent=2,
    )
)
