#!/usr/bin/env python3
"""Replace the legacy single-file UI while preserving the bundled US topology."""

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
legacy = INDEX.read_text(encoding="utf-8")
topology_match = re.search(r"^const TOPO = .*;$", legacy, re.MULTILINE)
if not topology_match:
    raise RuntimeError("Could not locate the legacy TOPO constant")
topology = topology_match.group(0)

html = """<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="미국 데이터센터 전력망·시장·캠퍼스·시설 탐색 도구">
  <title>US 데이터센터 전력 지도</title>
  <link rel="stylesheet" href="styles.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/topojson/3.0.2/topojson.min.js"></script>
  <script src="data/datacenters-data.js"></script>
</head>
<body>
  <header class="app-header">
    <div class="brand">US 데이터센터 <span class="accent">전력 지도</span></div>
    <nav class="primary-nav" aria-label="주요 화면">
      <button type="button" class="active" data-view="map">지도</button>
      <button type="button" data-view="operator">업체</button>
      <button type="button" data-view="dashboard">대시보드</button>
    </nav>
    <div class="global-search">
      <input id="globalSearch" type="search" placeholder="시장·캠퍼스·업체 검색…" autocomplete="off" aria-label="전체 검색">
      <div id="searchResults" class="search-results" role="listbox"></div>
    </div>
  </header>

  <main id="mapView" class="view active">
    <div class="workspace">
      <section id="mapStage" class="map-stage" aria-label="데이터센터 지도">
        <div class="map-toolbar">
          <div id="yearSeg" class="segmented compact" aria-label="용량 시점">
            <button type="button" data-year="2026">2026 YE</button>
            <button type="button" class="active" data-year="2030">2030 YE</button>
          </div>
          <div id="typeSeg" class="segmented compact" aria-label="시설 유형">
            <button type="button" class="active" data-type="all">전체</button>
            <button type="button" data-type="hyperscaler">Hyperscaler</button>
            <button type="button" data-type="colocation">Colocation</button>
          </div>
          <div class="toolbar-spacer"></div>
          <div id="breadcrumb" class="breadcrumb" aria-label="지도 탐색 경로"></div>
        </div>
        <svg id="mapSvg" class="map-svg" role="img" aria-label="미국 데이터센터 시장 지도">
          <g id="mapRoot"></g>
        </svg>
        <div id="mapLegend" class="map-legend"></div>
      </section>
      <aside class="inspector" aria-label="선택 항목 상세정보">
        <div id="inspectorContent"></div>
      </aside>
    </div>
  </main>

  <main id="operatorView" class="view operator-view">
    <div class="operator-shell">
      <section class="entity-panel" aria-label="업체 목록">
        <div class="entity-controls">
          <div id="entityModeSeg" class="segmented" style="margin-bottom:10px">
            <button type="button" class="active" data-mode="operator">운영사</button>
            <button type="button" data-mode="tenant">추정 테넌트</button>
          </div>
          <div id="entityTypeSeg" class="segmented entity-type-seg" style="margin-bottom:10px" aria-label="운영사 시설 유형">
            <button type="button" class="active" data-entity-type="all">전체</button>
            <button type="button" data-entity-type="hyperscaler">Hyperscaler</button>
            <button type="button" data-entity-type="colocation">Colocation</button>
          </div>
          <input id="entitySearch" class="entity-search" type="search" placeholder="업체 검색…" aria-label="업체 검색">
        </div>
        <div id="entityList" class="entity-list"></div>
      </section>
      <section class="operator-map" aria-label="업체 풋프린트 지도">
        <div id="operatorMapTitle" class="operator-map-title"></div>
        <svg id="operatorSvg" class="operator-svg" role="img" aria-label="업체 캠퍼스 분포 지도">
          <g id="operatorMapRoot"></g>
        </svg>
      </section>
      <aside id="operatorDetail" class="inspector" aria-label="업체 상세정보"></aside>
    </div>
  </main>

  <main id="dashboardView" class="view dashboard-view">
    <div id="dashboardContent" class="dashboard"></div>
  </main>

  <div id="mapTooltip" class="map-tooltip"></div>
  <script>
TOPOLOGY_PLACEHOLDER
  </script>
  <script src="app.js"></script>
</body>
</html>
"""

INDEX.write_text(html.replace("TOPOLOGY_PLACEHOLDER", topology), encoding="utf-8")
print(f"rewrote {INDEX} ({INDEX.stat().st_size:,} bytes)")
