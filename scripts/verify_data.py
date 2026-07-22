#!/usr/bin/env python3
"""Verify that generated data preserves the source CSV row-for-row."""

from __future__ import annotations

import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "us-datacenter-semianalysis-clean-v1.csv"
NORMALIZED = ROOT / "data" / "us-datacenter-normalized.csv"
BROWSER_DATA = ROOT / "data" / "datacenters-data.js"
DERIVED_FIELDS = [
    "Source_Row_ID",
    "Facility_ID",
    "Campus_ID",
    "Facility_Sequence",
    "Grid_Region_Display",
    "Grid_Region_Method",
]


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open("r", encoding="utf-8-sig", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        if reader.fieldnames is None:
            raise RuntimeError(f"CSV header is missing: {path}")
        return list(reader.fieldnames), list(reader)


source_fields, source_rows = read_csv(SOURCE)
normalized_fields, normalized_rows = read_csv(NORMALIZED)

if normalized_fields != [*DERIVED_FIELDS, *source_fields]:
    raise RuntimeError("Normalized CSV columns do not match derived + source columns")
if len(source_rows) != len(normalized_rows):
    raise RuntimeError("Source and normalized CSV row counts differ")

campus_key_to_id: dict[tuple[str, str, str], str] = {}
facility_sequence: dict[tuple[str, str, str], int] = {}

for index, (source, normalized) in enumerate(
    zip(source_rows, normalized_rows), start=1
):
    if any(source[field] != normalized[field] for field in source_fields):
        raise RuntimeError(f"Source field changed in normalized row {index}")

    expected_source_id = f"SA-{index:06d}"
    expected_facility_id = f"FAC-{index:06d}"
    if normalized["Source_Row_ID"] != expected_source_id:
        raise RuntimeError(f"Unexpected Source_Row_ID in row {index}")
    if normalized["Facility_ID"] != expected_facility_id:
        raise RuntimeError(f"Unexpected Facility_ID in row {index}")

    campus_key = (source["Country"], source["Market"], source["Cluster_ID"])
    campus_key_to_id.setdefault(campus_key, normalized["Campus_ID"])
    if campus_key_to_id[campus_key] != normalized["Campus_ID"]:
        raise RuntimeError(f"Campus_ID is inconsistent in row {index}")

    facility_sequence[campus_key] = facility_sequence.get(campus_key, 0) + 1
    if normalized["Facility_Sequence"] != str(facility_sequence[campus_key]):
        raise RuntimeError(f"Facility_Sequence is inconsistent in row {index}")
    if not normalized["Grid_Region_Display"] or not normalized["Grid_Region_Method"]:
        raise RuntimeError(f"Grid region derivation is missing in row {index}")
    if source["Power_Grid_ISO"] and normalized["Grid_Region_Display"] != source["Power_Grid_ISO"]:
        raise RuntimeError(f"Source Power_Grid_ISO was not prioritized in row {index}")

bundle_text = BROWSER_DATA.read_text(encoding="utf-8")
prefix = "window.DC_DATA="
if not bundle_text.startswith(prefix) or not bundle_text.rstrip().endswith(";"):
    raise RuntimeError("Browser data bundle wrapper is invalid")
bundle = json.loads(bundle_text[len(prefix) :].rstrip()[:-1])

if bundle["meta"]["sourceRows"] != len(source_rows):
    raise RuntimeError("Browser metadata row count differs from source")
if len(bundle["facilities"]) != len(source_rows):
    raise RuntimeError("Browser facility count differs from source")
if bundle["meta"]["provenance"]["external"] != "No external web data added":
    raise RuntimeError("Browser provenance does not state the external-data policy")

coordinates_verified = 0
for index, (source, facility) in enumerate(
    zip(source_rows, bundle["facilities"]), start=1
):
    if facility["sourceRowId"] != f"SA-{index:06d}":
        raise RuntimeError(f"Browser source row order differs at row {index}")
    source_latitude = float(source["Latitude"]) if source["Latitude"] else None
    source_longitude = float(source["Longitude"]) if source["Longitude"] else None
    if facility["latitude"] != source_latitude:
        raise RuntimeError(f"Browser latitude differs at row {index}")
    if facility["longitude"] != source_longitude:
        raise RuntimeError(f"Browser longitude differs at row {index}")
    if facility["gridRegionDisplay"] != normalized_rows[index - 1]["Grid_Region_Display"]:
        raise RuntimeError(f"Browser grid region differs at row {index}")
    if source_latitude is not None and source_longitude is not None:
        coordinates_verified += 1

print(
    json.dumps(
        {
            "status": "ok",
            "sourceRowsPreserved": len(source_rows),
            "sourceFieldsPreserved": len(source_fields),
            "derivedFieldsAdded": DERIVED_FIELDS,
            "campusGroups": len(campus_key_to_id),
            "exactCoordinatesVerified": coordinates_verified,
            "rowsWithoutCompleteCoordinates": len(source_rows) - coordinates_verified,
            "externalWebData": False,
        },
        ensure_ascii=False,
        indent=2,
    )
)
