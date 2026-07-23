(() => {
  "use strict";

  const SOURCE = window.DC_DATA;
  const allFacilities = SOURCE.facilities;
  const usaCanadaMismatchCount = allFacilities.filter((item) => item.country === "USA" && item.gridRegionDisplay === "Canada").length;
  const facilities = allFacilities.filter((item) => item.country === "USA" && item.gridRegionDisplay !== "Canada");
  const byId = new Map(facilities.map((item) => [item.facilityId, item]));
  const COLORS = {
    hyperscaler: "#e0a13e",
    colocation: "#4fb3a9",
    mixed: "#8f8299",
    marker: "#6fb4e3",
    rto: "#4a9ad4",
    ercot: "#7b6fd4",
    nonrto: "#d4943a",
    other: "#6d7380",
    selected: "#e9e7df",
  };

  // 주 배경을 전력시장 계열로 칠할 때 쓰는 색. 버블 색과 같은 계열의 저채도 버전이다.
  const REGION_FILL = {
    rto: "#1e3448",
    ercot: "#2c2750",
    nonrto: "#3d2f1a",
    other: "#1a1e24",
  };
  const stateGrids = SOURCE.meta.stateGrids || {};

  const GRID_META = {
    PJM: { label: "PJM", description: "Power_Grid_ISO · PJM", family: "rto" },
    ERCOT: { label: "ERCOT", description: "Power_Grid_ISO · ERCOT", family: "ercot" },
    MISO: { label: "MISO", description: "Power_Grid_ISO · MISO", family: "rto" },
    CAISO: { label: "CAISO", description: "Power_Grid_ISO · CAISO", family: "rto" },
    SPP: { label: "SPP", description: "Power_Grid_ISO · SPP", family: "rto" },
    NYISO: { label: "NYISO", description: "Power_Grid_ISO · NYISO", family: "rto" },
    ISONE: { label: "ISONE", description: "Power_Grid_ISO · ISONE", family: "rto" },
    TVA: { label: "TVA", description: "Power_Grid_ISO · TVA", family: "nonrto" },
    WECC_NW: { label: "WECC NW", description: "태평양 북서부 · Non-RTO", family: "nonrto" },
    WECC_RMP: { label: "WECC RMP", description: "Rocky Mountain · Non-RTO", family: "nonrto" },
    WECC_SW: { label: "WECC SW", description: "미국 남서부 · Non-RTO", family: "nonrto" },
    SERC_SE: { label: "SERC SE", description: "미국 동남부 · Non-RTO", family: "nonrto" },
    SERC_Central: { label: "SERC Central", description: "미국 중남부 · Non-RTO", family: "nonrto" },
    SERC_FL: { label: "SERC FL", description: "플로리다 · Non-RTO", family: "nonrto" },
    Alaska: { label: "Alaska", description: "알래스카 독립 전력권역 · Non-RTO", family: "nonrto" },
    Hawaii: { label: "Hawaii", description: "하와이 독립 전력권역 · Non-RTO", family: "nonrto" },
  };

  const GRID_METHOD_LABELS = {
    "source:Power_Grid_ISO": "원본 Power_Grid_ISO",
    "derived:legacy_market": "기존 저장소 시장 매핑",
    "derived:legacy_market+state": "기존 시장 매핑 + 주",
    "derived:Controlling_Authority": "원본 전력기관 필드",
    "derived:market_geography": "시장 지리 추론",
    "derived:state_geography": "주 지리 추론",
    "derived:country_geography": "국가 지리 추론",
  };

  const YEARS = SOURCE.meta.years || [2026, 2030];
  const FIRST_YEAR = YEARS[0];
  const LAST_YEAR = YEARS[YEARS.length - 1];
  // 성장 배수·덤벨 차트의 기준 시점. 원본이 "현재 가동"으로 다루는 해다.
  const BASE_YEAR = YEARS.includes(2026) ? 2026 : FIRST_YEAR;

  const state = {
    view: "map",
    year: 2030,
    facilityType: "all",
    layer: "grid",
    selectedGrid: null,
    selectedMarket: null,
    selectedCampus: null,
    selectedFacility: null,
    entityMode: "operator",
    entityFacilityType: "all",
    selectedEntity: null,
    dashboardFacilityType: "all",
  };

  const number = (value) => (Number.isFinite(value) ? value : 0);
  const yearSlot = (year) => {
    const slot = YEARS.indexOf(Number(year));
    return slot >= 0 ? slot : YEARS.length - 1;
  };
  // 시설·집계 모두 capacityByYear를 들고 있으므로 선택 연도를 그때그때 읽는다.
  const capacityAt = (item, year = state.year) => number(item.capacityByYear?.[yearSlot(year)]);
  const pipelineTotal = (item) => number(item.capacity2026Mw) + number(item.underConstructionMw) + number(item.plannedMw);
  const sum = (items, field) => items.reduce((total, item) => total + number(item[field]), 0);
  const sumSeries = (items) => YEARS.map((_, slot) =>
    items.reduce((total, item) => total + number(item.capacityByYear?.[slot]), 0));
  const unique = (items) => [...new Set(items.filter(Boolean))];
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const display = (value) => value === null || value === undefined || value === "" ? "—" : escapeHtml(value);
  const fmtInt = (value) => Math.round(number(value)).toLocaleString("en-US");
  const fmtMw = (value) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    if (Math.abs(value) >= 1000) {
      const decimals = Math.abs(value) >= 10000 ? 1 : 2;
      return `${(value / 1000).toFixed(decimals).replace(/\.0$/, "")} GW`;
    }
    return `${value < 100 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value)} MW`;
  };
  const fmtDate = (value) => value ? escapeHtml(value) : "—";
  const pct = (part, total) => total > 0 ? Math.round(part / total * 100) : 0;

  function groupBy(items, keyFn) {
    const groups = new Map();
    items.forEach((item) => {
      const key = keyFn(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return groups;
  }

  function gridKey(item) {
    return item.gridRegionDisplay;
  }

  function dominantGrid(items) {
    const counts = new Map();
    items.forEach((item) => counts.set(gridKey(item), (counts.get(gridKey(item)) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "PJM";
  }

  function gridAggregates(items = filterItems(facilities)) {
    return Object.keys(GRID_META).map((grid) => {
      const gridItems = items.filter((item) => gridKey(item) === grid);
      const result = aggregate(grid, GRID_META[grid].label, "grid", gridItems);
      result.marketCount = unique(gridItems.map((item) => item.market)).length;
      return result;
    }).filter((item) => item.items.length);
  }

  function statusLabel(item) {
    if (facilityLifecycle(item) === "operating") return "운영 중";
    if (number(item.underConstructionMw) > 0) return "건설 중";
    if (number(item.plannedMw) > 0 || number(item.capacity2030Mw) > 0) return "예정";
    return "상태 미기재";
  }

  function facilityLifecycle(item) {
    const value = item.startOfOperations;
    if (value && !value.startsWith("1900")) {
      const date = new Date(`${value}T00:00:00`);
      if (!Number.isNaN(date.getTime())) return date <= new Date() ? "operating" : "pipeline";
    }
    if (number(item.capacity2026Mw) > 0 && number(item.plannedMw) === 0) return "operating";
    if (number(item.underConstructionMw) > 0 || number(item.plannedMw) > 0 || number(item.capacity2030Mw) > 0) return "pipeline";
    return "unknown";
  }

  function breakdown(items, keyFn, limit = 5) {
    return [...groupBy(items, keyFn).entries()]
      .map(([name, rows]) => aggregate(name || "미기재", name || "미기재", "breakdown", rows))
      .sort((a, b) => capacityAt(b) - capacityAt(a))
      .slice(0, limit);
  }

  function aggregate(id, label, type, items) {
    const geocoded = items.filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
    const hyperscalerCount = items.filter((item) => item.facilityType === "hyperscaler").length;
    const colocationCount = items.filter((item) => item.facilityType === "colocation").length;
    return {
      id,
      label,
      type,
      items,
      latitude: geocoded.length ? d3.mean(geocoded, (item) => item.latitude) : null,
      longitude: geocoded.length ? d3.mean(geocoded, (item) => item.longitude) : null,
      capacity2026Mw: sum(items, "capacity2026Mw"),
      capacity2030Mw: sum(items, "capacity2030Mw"),
      capacityByYear: sumSeries(items),
      underConstructionMw: sum(items, "underConstructionMw"),
      plannedMw: sum(items, "plannedMw"),
      facilityCount: items.length,
      companies: unique(items.map((item) => item.company)),
      markets: unique(items.map((item) => item.market)),
      states: unique(items.map((item) => item.state)),
      campusIds: unique(items.map((item) => item.campusId)),
      dominantType: hyperscalerCount === colocationCount ? "mixed" : hyperscalerCount > colocationCount ? "hyperscaler" : "colocation",
    };
  }

  const markets = [...groupBy(facilities, (item) => item.market).entries()]
    .map(([name, items]) => aggregate(name, name, "market", items))
    .sort((a, b) => b.capacity2030Mw - a.capacity2030Mw);
  const marketByName = new Map(markets.map((market) => [market.id, market]));

  const campuses = [...groupBy(facilities, (item) => item.campusId).entries()]
    .map(([id, items]) => aggregate(id, items[0].clusterId, "campus", items))
    .sort((a, b) => b.capacity2030Mw - a.capacity2030Mw);
  const campusById = new Map(campuses.map((campus) => [campus.id, campus]));
  markets.forEach((market) => {
    market.campuses = campuses.filter((campus) => campus.items[0].market === market.id);
  });

  const operatorGroups = [...groupBy(facilities, (item) => item.company).entries()]
    .map(([name, items]) => aggregate(name, name, "operator", items))
    .sort((a, b) => b.capacity2030Mw - a.capacity2030Mw);
  const tenantGroups = [...groupBy(
    facilities.filter((item) => item.estimatedTenant),
    (item) => item.estimatedTenant,
  ).entries()]
    .map(([name, items]) => aggregate(name, name, "tenant", items))
    .sort((a, b) => b.capacity2030Mw - a.capacity2030Mw);

  const national = aggregate("USA", "United States", "country", facilities);

  // 원 크기 기준(반경당 GW)을 화면·필터·연도와 무관하게 고정한다.
  // 필터링된 부분집합으로 매번 다시 계산하면, 예를 들어 시설유형을 하이퍼스케일러로만
  // 좁혔을 때 같은 크기 원이 다른 GW를 의미하게 되어 화면 간 비교가 불가능해진다.
  const scalePeak = (item) => Math.max(...item.capacityByYear, pipelineTotal(item));
  const GRID_SCALE_MAX = d3.max(gridAggregates(facilities), scalePeak) || 1;
  const MARKET_SCALE_MAX = d3.max(markets, scalePeak) || 1;
  const CAMPUS_SCALE_MAX = d3.max(campuses, scalePeak) || 1;

  const stateFeatures = topojson.feature(TOPO, TOPO.objects.states);
  const nationFeature = topojson.feature(TOPO, TOPO.objects.nation);

  const mapSvg = d3.select("#mapSvg");
  const mapRoot = mapSvg.select("#mapRoot");
  const tooltip = document.getElementById("mapTooltip");
  const inspector = document.getElementById("inspectorContent");
  let mapProjection;
  let mapZoom;
  let currentMapTransform = d3.zoomIdentity;

  function filterItems(items) {
    if (state.facilityType === "all") return items;
    return items.filter((item) => item.facilityType === state.facilityType);
  }

  function filterAggregate(item) {
    if (state.facilityType === "all") return item;
    return aggregate(item.id, item.label, item.type, filterItems(item.items));
  }

  function showTooltip(event, html) {
    tooltip.innerHTML = html;
    tooltip.style.display = "block";
    const maxX = window.innerWidth - 300;
    tooltip.style.left = `${Math.min(event.clientX + 14, maxX)}px`;
    tooltip.style.top = `${Math.max(8, event.clientY - 12)}px`;
  }
  function moveTooltip(event) {
    const maxX = window.innerWidth - 300;
    tooltip.style.left = `${Math.min(event.clientX + 14, maxX)}px`;
    tooltip.style.top = `${Math.max(8, event.clientY - 12)}px`;
  }
  function hideTooltip() { tooltip.style.display = "none"; }

  function stateFamily(feature) {
    const grid = stateGrids[feature.properties.name];
    return grid && GRID_META[grid] ? GRID_META[grid].family : "other";
  }

  function setupMapBase(svg, root, width, height, { choropleth = true } = {}) {
    const projection = d3.geoAlbersUsa().fitExtent([[28, 74], [width - 28, height - 28]], nationFeature);
    const path = d3.geoPath(projection);
    root.selectAll("*").remove();
    root.append("g")
      .selectAll("path")
      .data(stateFeatures.features.filter((feature) => path(feature)))
      .join("path")
      .attr("class", "state-shape")
      .attr("fill", (feature) => choropleth ? REGION_FILL[stateFamily(feature)] : REGION_FILL.other)
      .attr("d", path);
    root.append("path").datum(nationFeature).attr("class", "nation-outline").attr("d", path);
    return projection;
  }

  // 캠퍼스까지 확대하면 주 경계만으로는 위치를 못 읽는다.
  // 외부 지도를 받지 않고, 데이터에 이미 있는 시설 좌표로 도시 앵커를 만든다.
  function renderCityAnchors(items) {
    const cities = [...groupBy(
      items.filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude)),
      (item) => `${item.city}, ${item.state}`,
    ).entries()]
      .map(([name, rows]) => ({
        name,
        city: rows[0].city,
        longitude: d3.mean(rows, (row) => row.longitude),
        latitude: d3.mean(rows, (row) => row.latitude),
        facilityCount: rows.length,
      }))
      .sort((a, b) => b.facilityCount - a.facilityCount)
      .slice(0, 40)
      .map((entry) => {
        const point = mapProjection([entry.longitude, entry.latitude]);
        return point ? { ...entry, x: point[0], y: point[1] } : null;
      })
      .filter(Boolean);
    if (!cities.length) return;
    const layer = mapRoot.append("g").attr("class", "city-anchors");
    const city = layer.selectAll("g.city-anchor").data(cities).join("g")
      .attr("class", "city-anchor")
      .attr("transform", (entry) => `translate(${entry.x},${entry.y})`);
    city.append("path").attr("class", "city-cross").attr("d", "M-3.5,0 H3.5 M0,-3.5 V3.5");
    city.append("text").attr("class", "city-name").attr("y", -6).text((entry) => entry.city);
    pruneCityLabels();
  }

  // 라벨은 줌과 반대로 축소되므로, 최종 화면 좌표가 정해진 뒤 겹치는 것만 숨긴다.
  function pruneCityLabels() {
    const labels = mapRoot.selectAll("g.city-anchor");
    if (labels.empty()) return;
    const transform = currentMapTransform;
    const placed = [];
    labels.each(function (entry) {
      const screenX = entry.x * transform.k + transform.x;
      const screenY = entry.y * transform.k + transform.y;
      const clear = placed.every((seen) =>
        Math.abs(seen.x - screenX) > 58 || Math.abs(seen.y - screenY) > 13);
      if (clear) placed.push({ x: screenX, y: screenY });
      this.classList.toggle("crowded", !clear);
    });
  }

  // 확대 배율이 바뀌면 거리 감각이 사라지므로 축척 막대를 같이 그린다.
  function renderScaleBar() {
    const container = document.getElementById("mapScale");
    if (!container || !mapProjection) return;
    const { width, height } = mapDimensions(mapSvg.node());
    const centre = [width / 2, height / 2];
    const scale = currentMapTransform.k || 1;
    const left = mapProjection.invert([(centre[0] - 60 - currentMapTransform.x) / scale, (centre[1] - currentMapTransform.y) / scale]);
    const right = mapProjection.invert([(centre[0] + 60 - currentMapTransform.x) / scale, (centre[1] - currentMapTransform.y) / scale]);
    if (!left || !right) { container.textContent = ""; return; }
    const km = d3.geoDistance(left, right) * 6371;
    if (!Number.isFinite(km) || km <= 0) { container.textContent = ""; return; }
    const label = km >= 100 ? `${Math.round(km / 10) * 10} km` : km >= 10 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
    container.innerHTML = `<span class="scale-bar"></span><span class="scale-label">${label}</span>`;
  }

  function mapDimensions(svgNode) {
    const rect = svgNode.getBoundingClientRect();
    return { width: Math.max(rect.width, 320), height: Math.max(rect.height, 360) };
  }

  function projectAggregate(item, projection) {
    if (!Number.isFinite(item.longitude) || !Number.isFinite(item.latitude)) return null;
    const point = projection([item.longitude, item.latitude]);
    return point ? { ...item, x: point[0], y: point[1] } : null;
  }

  function visibleNodes() {
    if (state.layer === "market") {
      const gridItems = filterItems(facilities).filter((item) => gridKey(item) === state.selectedGrid);
      return [...groupBy(gridItems, (item) => item.market).entries()]
        .map(([name, items]) => aggregate(name, name, "market", items))
        .filter((item) => item.items.length)
        .sort((a, b) => capacityAt(b) - capacityAt(a))
        .slice(0, 18);
    }
    if (state.layer === "campus" && state.selectedMarket) {
      const marketItems = filterItems(facilities).filter((item) => item.market === state.selectedMarket && gridKey(item) === state.selectedGrid);
      return [...groupBy(marketItems, (item) => item.campusId).entries()]
        .map(([id, items]) => aggregate(id, items[0].clusterId, "campus", items))
        .sort((a, b) => capacityAt(b) - capacityAt(a))
        .slice(0, 24);
    }
    return [];
  }

  function zoomToAggregates(items, scaleFloor = 1.5, scaleCeiling = 10) {
    const points = items
      .map((item) => Number.isFinite(item.x) && Number.isFinite(item.y) ? item : projectAggregate(item, mapProjection))
      .filter(Boolean);
    if (!points.length || !mapZoom) return;
    const { width, height } = mapDimensions(mapSvg.node());
    const xExtent = d3.extent(points, (item) => item.x);
    const yExtent = d3.extent(points, (item) => item.y);
    const dx = Math.max(40, xExtent[1] - xExtent[0]);
    const dy = Math.max(40, yExtent[1] - yExtent[0]);
    const scale = Math.max(scaleFloor, Math.min(scaleCeiling, .76 / Math.max(dx / width, dy / height)));
    const tx = width / 2 - scale * ((xExtent[0] + xExtent[1]) / 2);
    const ty = height / 2 - scale * ((yExtent[0] + yExtent[1]) / 2);
    mapSvg.call(mapZoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  function renderMap() {
    const node = mapSvg.node();
    const { width, height } = mapDimensions(node);
    mapProjection = setupMapBase(mapSvg, mapRoot, width, height);
    mapZoom = d3.zoom()
      .scaleExtent([1, 18])
      // 일반 휠/트랙패드 스크롤은 페이지 스크롤로 남겨두고, 핀치·Ctrl+휠만 지도 확대로 받는다.
      // 그렇지 않으면 좁은 화면에서 지도 위로 스크롤할 때 페이지가 아니라 지도만 움직인다.
      .filter((event) => event.type === "wheel" ? (event.ctrlKey || event.metaKey) : !event.button)
      .on("zoom", (event) => {
        currentMapTransform = event.transform;
        mapRoot.attr("transform", event.transform);
        mapRoot.selectAll(".map-node,.grid-node,.city-anchor")
          .attr("transform", (item) => `translate(${item.x},${item.y}) scale(${1 / event.transform.k})`);
        pruneCityLabels();
        renderScaleBar();
      });
    mapSvg.call(mapZoom).on("dblclick.zoom", null);
    mapSvg.call(mapZoom.transform, d3.zoomIdentity);

    if (state.layer === "grid") {
      renderGridNodes();
    } else {
      if (state.layer === "campus" && state.selectedMarket) {
        renderCityAnchors(filterItems(facilities).filter((item) =>
          item.market === state.selectedMarket && gridKey(item) === state.selectedGrid));
      }
      renderAggregateNodes();
    }
    updateBreadcrumb();
    updateLayerControls();
    renderInspector();
    renderLegend();
    renderScaleBar();
  }

  function renderGridNodes() {
    const nodes = gridAggregates()
      .map((item) => projectAggregate(item, mapProjection))
      .filter(Boolean);
    const bounds = mapDimensions(mapSvg.node());
    const compact = bounds.width < 600;
    const radius = d3.scaleSqrt().domain([0, GRID_SCALE_MAX]).range(compact ? [4, 34] : [5, 46]);
    const outerRadius = (item) => Math.max(radius(capacityAt(item, LAST_YEAR)), radius(pipelineTotal(item)));
    // 라벨이 원보다 넓은 작은 권역에서 글자끼리 겹치므로, 글자 폭도 밀어내기 반경에 반영한다.
    const labelHalfWidth = (item) => item.label.length * (compact ? 2.7 : 3.3) + 5;
    const spacing = (item) => Math.max(outerRadius(item) + (compact ? 11 : 18), labelHalfWidth(item));
    nodes.forEach((item) => { item.anchorX = item.x; item.anchorY = item.y; });
    const simulation = d3.forceSimulation(nodes)
      .force("x", d3.forceX((item) => item.anchorX).strength(.34))
      .force("y", d3.forceY((item) => item.anchorY).strength(.34))
      .force("collide", d3.forceCollide(spacing).iterations(3))
      .stop();
    for (let index = 0; index < 120; index += 1) simulation.tick();
    nodes.forEach((item) => {
      const boundary = outerRadius(item);
      item.x = Math.max(boundary + 28, Math.min(bounds.width - boundary - 28, item.x));
      item.y = Math.max(boundary + 86, Math.min(bounds.height - boundary - 52, item.y));
      if (!compact && item.id === "Alaska") {
        item.x = 260;
        item.y = bounds.height - 76;
      }
    });
    const group = mapRoot.append("g").attr("class", "grid-nodes");
    const grid = group.selectAll("g.grid-node")
      .data(nodes, (item) => item.id)
      .join("g")
      .attr("class", "grid-node")
      .attr("transform", (item) => `translate(${item.x},${item.y})`)
      .attr("role", "button")
      .attr("tabindex", 0)
      .attr("aria-label", (item) => `${item.label}, ${state.year} ${fmtMw(capacityAt(item))}, ${LAST_YEAR} ${fmtMw(capacityAt(item, LAST_YEAR))}`)
      .on("click", (_event, item) => selectGrid(item.id))
      .on("keydown", (event, item) => { if (event.key === "Enter" || event.key === " ") selectGrid(item.id); })
      .on("mouseenter", (event, item) => showTooltip(event, `<strong>${escapeHtml(item.label)}</strong><br>${state.year} YE ${fmtMw(capacityAt(item))} → ${LAST_YEAR} YE ${fmtMw(capacityAt(item, LAST_YEAR))}<br>+UC ${fmtMw(item.underConstructionMw)} · +Planned ${fmtMw(item.plannedMw)}<br>시장 ${item.marketCount} · 시설 ${item.facilityCount}`))
      .on("mousemove", moveTooltip)
      .on("mouseleave", hideTooltip);
    grid.filter((item) => number(item.plannedMw) > 0).append("circle")
      .attr("class", "grid-planned-ring")
      .attr("r", (item) => radius(pipelineTotal(item)))
      .attr("stroke", (item) => COLORS[GRID_META[item.id].family]);
    grid.append("circle")
      .attr("class", "grid-current-core")
      .attr("r", (item) => Math.max(3, radius(capacityAt(item))))
      .attr("fill", (item) => COLORS[GRID_META[item.id].family]);
    grid.append("text").attr("class", "grid-label").attr("y", -4).text((item) => item.label);
    grid.append("text").attr("class", "grid-value").attr("y", 12).text((item) => fmtMw(capacityAt(item)));
  }

  function renderAggregateNodes() {
    const nodes = visibleNodes().map((item) => projectAggregate(item, mapProjection)).filter(Boolean);
    const scaleMax = state.layer === "market" ? MARKET_SCALE_MAX : CAMPUS_SCALE_MAX;
    const radius = d3.scaleSqrt().domain([0, scaleMax]).range([3, state.layer === "market" ? 25 : 18]);
    nodes.forEach((item) => {
      item.anchorX = item.x;
      item.anchorY = item.y;
    });
    const simulation = d3.forceSimulation(nodes)
      .force("x", d3.forceX((item) => item.anchorX).strength(state.layer === "market" ? .38 : .72))
      .force("y", d3.forceY((item) => item.anchorY).strength(state.layer === "market" ? .38 : .72))
      .force("collide", d3.forceCollide((item) => Math.max(4, radius(capacityAt(item))) + (state.layer === "market" ? 3 : 2)).iterations(2))
      .stop();
    for (let index = 0; index < 90; index += 1) simulation.tick();
    const bounds = mapDimensions(mapSvg.node());
    nodes.forEach((item) => {
      const nodeRadius = Math.max(4, radius(capacityAt(item)));
      item.x = Math.max(nodeRadius + 22, Math.min(bounds.width - nodeRadius - 22, item.x));
      item.y = Math.max(nodeRadius + 86, Math.min(bounds.height - nodeRadius - 44, item.y));
    });
    const topLabels = new Set([...nodes].sort((a, b) => capacityAt(b) - capacityAt(a)).slice(0, state.layer === "market" ? 8 : 6).map((item) => item.id));
    const group = mapRoot.append("g").attr("class", "aggregate-nodes");
    group.selectAll("line.node-leader")
      .data(nodes.filter((item) => Math.hypot(item.x - item.anchorX, item.y - item.anchorY) > 10))
      .join("line")
      .attr("x1", (item) => item.anchorX)
      .attr("y1", (item) => item.anchorY)
      .attr("x2", (item) => item.x)
      .attr("y2", (item) => item.y)
      .attr("stroke", "#566170")
      .attr("stroke-width", .7)
      .attr("stroke-dasharray", "2 2")
      .attr("opacity", .32);
    const node = group.selectAll("g.map-node")
      .data(nodes, (item) => item.id)
      .join("g")
      .attr("class", (item) => `map-node${isNodeSelected(item) ? " selected" : ""}`)
      .attr("transform", (item) => `translate(${item.x},${item.y})`)
      .attr("role", "button")
      .attr("tabindex", 0)
      .attr("aria-label", (item) => `${item.label}, ${fmtMw(capacityAt(item))}`)
      .on("click", (_event, item) => selectAggregate(item))
      .on("keydown", (event, item) => { if (event.key === "Enter" || event.key === " ") selectAggregate(item); })
      .on("mouseenter", (event, item) => showTooltip(event,
        `<strong>${escapeHtml(item.label)}</strong><br>${state.year} YE · ${fmtMw(capacityAt(item))}<br>`
        + `시설 ${fmtInt(item.facilityCount)} · 캠퍼스 ${fmtInt(item.campusIds.length)}<br>`
        + `공사 중 ${fmtMw(item.underConstructionMw)} · Planned ${fmtMw(item.plannedMw)}`))
      .on("mousemove", moveTooltip)
      .on("mouseleave", hideTooltip);

    node.append("circle")
      .attr("class", "node-core")
      .attr("r", (item) => Math.max(capacityAt(item) > 0 ? 3 : 2, radius(capacityAt(item))))
      .attr("fill", COLORS.marker);
    node.filter((item) => topLabels.has(item.id) || isNodeSelected(item))
      .append("text")
      .attr("class", "node-label")
      .attr("y", (item) => -Math.max(6, radius(capacityAt(item)) + 7))
      .text((item) => shortLabel(item.label, 22));
    node.filter((item) => topLabels.has(item.id) || isNodeSelected(item))
      .append("text")
      .attr("class", "node-value")
      .attr("y", (item) => Math.max(11, radius(capacityAt(item)) + 12))
      .text((item) => fmtMw(capacityAt(item)));

    if (state.layer === "campus" && state.selectedMarket) {
      requestAnimationFrame(() => zoomToAggregates(nodes, 2.2));
    } else if (state.layer === "market" && state.selectedGrid) {
      requestAnimationFrame(() => zoomToAggregates(nodes, 1.6));
    }
  }

  function shortLabel(value, length) {
    return value.length > length ? `${value.slice(0, length - 1)}…` : value;
  }

  function isNodeSelected(item) {
    return state.layer === "market" ? state.selectedMarket === item.id : state.selectedCampus === item.id;
  }

  function selectGrid(grid) {
    if (!GRID_META[grid]) return;
    hideTooltip();
    state.selectedGrid = grid;
    state.selectedMarket = null;
    state.selectedCampus = null;
    state.selectedFacility = null;
    state.layer = "market";
    renderMap();
  }

  function openGrid(grid) {
    if (!GRID_META[grid]) return;
    switchView("map");
    selectGrid(grid);
  }

  function selectAggregate(item) {
    hideTooltip();
    if (item.type === "market") {
      state.selectedMarket = item.id;
      state.selectedCampus = null;
      state.selectedFacility = null;
      state.layer = "campus";
    } else {
      state.selectedCampus = item.id;
      state.selectedFacility = null;
    }
    renderMap();
  }

  function navigateToMarket(name) {
    if (!marketByName.has(name)) return;
    state.selectedGrid = dominantGrid(marketByName.get(name).items);
    state.selectedMarket = name;
    state.selectedCampus = null;
    state.selectedFacility = null;
    state.layer = "campus";
    switchView("map");
    renderMap();
  }

  function navigateToCampus(id) {
    const campus = campusById.get(id);
    if (!campus) return;
    state.selectedGrid = dominantGrid(campus.items);
    state.selectedMarket = campus.items[0].market;
    state.selectedCampus = id;
    state.selectedFacility = null;
    state.layer = "campus";
    switchView("map");
    renderMap();
  }

  let yearPlaybackTimer = null;

  function stopYearPlayback() {
    if (yearPlaybackTimer === null) return;
    clearInterval(yearPlaybackTimer);
    yearPlaybackTimer = null;
    const button = document.getElementById("yearPlay");
    if (button) {
      button.textContent = "▶";
      button.classList.remove("playing");
    }
  }

  function toggleYearPlayback() {
    if (yearPlaybackTimer !== null) {
      stopYearPlayback();
      return;
    }
    const button = document.getElementById("yearPlay");
    button.textContent = "❙❙";
    button.classList.add("playing");
    if (state.year >= LAST_YEAR) state.year = FIRST_YEAR;
    yearPlaybackTimer = setInterval(() => {
      if (state.year >= LAST_YEAR) {
        stopYearPlayback();
        return;
      }
      state.year += 1;
      renderMap();
    }, 700);
    renderMap();
  }

  // 연도별 용량 곡선을 인스펙터에 넣는 미니 스파크라인.
  function sparklineHtml(item, title) {
    const series = item.capacityByYear;
    if (!series || !series.length) return "";
    const max = Math.max(...series, 1);
    const width = 100;
    const height = 30;
    const points = series.map((value, slot) => {
      const x = series.length > 1 ? slot / (series.length - 1) * width : 0;
      const y = height - value / max * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    const slot = yearSlot(state.year);
    const markerX = series.length > 1 ? slot / (series.length - 1) * width : 0;
    const markerY = height - series[slot] / max * height;
    return `<div class="section">
      <div class="section-header"><span>${escapeHtml(title)}</span><span class="count">${FIRST_YEAR}–${LAST_YEAR}</span></div>
      <div class="sparkline">
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(title)} 연도별 곡선">
          <polygon class="spark-area" points="0,${height} ${points.join(" ")} ${width},${height}"></polygon>
          <polyline class="spark-line" points="${points.join(" ")}"></polyline>
          <line class="spark-marker" x1="${markerX.toFixed(2)}" y1="0" x2="${markerX.toFixed(2)}" y2="${height}"></line>
          <circle class="spark-dot" cx="${markerX.toFixed(2)}" cy="${markerY.toFixed(2)}" r="2.2"></circle>
        </svg>
        <div class="spark-scale"><span>${FIRST_YEAR} · ${fmtMw(series[0])}</span><strong>${state.year} · ${fmtMw(series[slot])}</strong><span>${LAST_YEAR} · ${fmtMw(series[series.length - 1])}</span></div>
      </div>
    </div>`;
  }

  function syncYearControls() {
    // 지도·업체 화면이 같은 연도를 쓰므로 두 슬라이더를 함께 맞춘다.
    [["yearSlider", "yearReadout"], ["entityYearSlider", "entityYearReadout"]].forEach(([sliderId, readoutId]) => {
      const slider = document.getElementById(sliderId);
      if (slider && Number(slider.value) !== state.year) slider.value = String(state.year);
      const readout = document.getElementById(readoutId);
      if (readout) readout.textContent = `${state.year} YE`;
    });
  }

  function updateLayerControls() {
    syncYearControls();
    document.querySelectorAll("#typeSeg button").forEach((button) => {
      const active = button.dataset.type === state.facilityType;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function updateBreadcrumb() {
    const container = document.getElementById("breadcrumb");
    if (state.layer === "grid") {
      container.innerHTML = '<span class="current">전체 전력망</span>';
      return;
    }
    const gridLabel = GRID_META[state.selectedGrid]?.label || "전체 전력망";
    if (state.layer === "market") {
      container.innerHTML = `<button type="button" data-back>← 전체 전력망</button><span class="current">${escapeHtml(gridLabel)}</span>`;
    } else if (state.selectedCampus) {
      container.innerHTML = `<button type="button" data-back>← ${escapeHtml(state.selectedMarket)} 캠퍼스</button><span class="current">${escapeHtml(campusById.get(state.selectedCampus)?.label || "캠퍼스")}</span>`;
    } else {
      container.innerHTML = `<button type="button" data-back>← ${escapeHtml(gridLabel)} 시장</button><span class="current">${escapeHtml(state.selectedMarket)}</span>`;
    }
    container.querySelector("[data-back]").addEventListener("click", navigateUp);
  }

  function navigateUp() {
    if (state.layer === "market") return resetMap();
    if (state.layer === "campus" && state.selectedCampus) {
      state.selectedCampus = null;
      state.selectedFacility = null;
    } else if (state.layer === "campus") {
      state.layer = "market";
      state.selectedMarket = null;
    }
    state.selectedFacility = null;
    renderMap();
  }

  function resetMap() {
    state.layer = "grid";
    state.selectedGrid = null;
    state.selectedMarket = null;
    state.selectedCampus = null;
    state.selectedFacility = null;
    renderMap();
  }

  function renderLegend() {
    const legend = document.getElementById("mapLegend");
    if (state.layer === "grid") {
      legend.innerHTML = `<div class="legend-title">전력망 용량 · ${state.year} YE</div>
        <div class="legend-row"><span class="legend-core"></span>채움 원 · ${state.year} YE 가동 (슬라이더)</div>
        <div class="legend-row"><span class="legend-planned"></span>점선 원 · ${BASE_YEAR} + UC + Planned</div>
        <div class="legend-row"><span class="legend-swatch" style="background:${COLORS.rto};outline:3px solid ${REGION_FILL.rto}"></span>RTO / ISO · 조직화된 도매시장</div>
        <div class="legend-row"><span class="legend-swatch" style="background:${COLORS.ercot};outline:3px solid ${REGION_FILL.ercot}"></span>ERCOT · 텍사스 (연방규제 밖)</div>
        <div class="legend-row"><span class="legend-swatch" style="background:${COLORS.nonrto};outline:3px solid ${REGION_FILL.nonrto}"></span>WECC / SERC / TVA · 수직통합</div>
        <div class="legend-note">면적 = MW · 색 = 전력시장 구조 · 주 배경색 = 해당 주의 대표 권역</div>`;
      return;
    }
    legend.innerHTML = `<div class="legend-title">${state.layer === "market" ? escapeHtml(GRID_META[state.selectedGrid]?.label || "전력망") : escapeHtml(state.selectedMarket || "시장")}</div>
      <div class="legend-row"><span class="legend-dot" style="background:${COLORS.marker}"></span>상위 ${state.layer === "market" ? "시장" : "캠퍼스"}</div>
      <div class="legend-note">원 크기 = ${state.year} YE 용량 · 지도에는 상위 항목만 표시</div>`;
  }

  function statsHtml(item) {
    return `<div class="stats-grid">
      ${statCard("2026 YE", item.capacity2026Mw, "")}
      ${statCard("2030 YE", item.capacity2030Mw, "future")}
      ${statCard("Under construction", item.underConstructionMw, "")}
      ${statCard("Planned · current", item.plannedMw, "planned")}
    </div>`;
  }
  function statCard(label, value, className) {
    return `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value ${className}">${fmtMw(value)}</div></div>`;
  }

  function compareHtml(item) {
    const max = Math.max(item.capacity2026Mw, item.capacity2030Mw, 1);
    return `<div class="capacity-compare">
      <div class="compare-label"><span>2026</span><span>${fmtMw(item.capacity2026Mw)}</span></div>
      <div class="compare-track"><div class="compare-bar current" style="width:${item.capacity2026Mw / max * 100}%"></div></div>
      <div class="compare-label"><span>2030</span><span>${fmtMw(item.capacity2030Mw)}</span></div>
      <div class="compare-track"><div class="compare-bar future" style="width:${item.capacity2030Mw / max * 100}%"></div></div>
    </div>`;
  }

  function renderInspector() {
    inspector.scrollTop = 0;
    if (state.layer === "grid") return renderNationalInspector();
    if (state.layer === "market") return renderGridInspector(state.selectedGrid);
    if (state.selectedCampus) return renderCampusInspector(campusById.get(state.selectedCampus));
    return renderMarketInspector(marketByName.get(state.selectedMarket));
  }

  function renderNationalInspector() {
    const filtered = filterAggregate(national);
    const grids = gridAggregates().sort((a, b) => capacityAt(b) - capacityAt(a));
    inspector.innerHTML = `<div class="inspector-inner">
      <div class="eyebrow">Power Grid ISO</div>
      <h2 class="detail-title">US 전력망 개요</h2>
      <div class="detail-subtitle">시설 행 ${fmtInt(filtered.facilityCount)}개 · 캠퍼스 ${fmtInt(filtered.campusIds.length)}개 · 시장 ${fmtInt(markets.length)}개</div>
      <div class="purpose-line">원본 Power_Grid_ISO와 기존 지리 매핑으로 복원한 Non-RTO 세부 권역별 규모·성장·현재 Planned 파이프라인을 비교합니다.</div>
      ${statsHtml(filtered)}
      ${sparklineHtml(filtered, "전국 증설 곡선")}
      ${compareHtml(filtered)}
      <div class="section"><div class="section-header"><span>전력망 선택</span><span class="count">클릭 → 해당 시장</span></div>
        <div class="detail-list">${grids.map((item) => detailButton(item.id, item.label, `${GRID_META[item.id].description} · 시장 ${item.marketCount} · Planned ${fmtMw(item.plannedMw)}`, fmtMw(capacityAt(item)), "grid")).join("")}</div>
      </div>
      <div class="callout"><strong>분류 기준</strong> · Power_Grid_ISO 원본값을 최우선으로 사용합니다. 공란은 기존 저장소의 시장별 권역을 우선 적용하고, 남은 행만 원본 Controlling_Authority와 주·시장 지리로 추론했습니다. 미분류 행은 없습니다. Country는 USA지만 주·시장·좌표가 캐나다인 ${usaCanadaMismatchCount}행은 US 지도에서 제외하고 데이터에는 보존했습니다.</div>
    </div>`;
    bindDetailButtons();
  }

  function renderGridInspector(grid) {
    const gridKeyValue = GRID_META[grid] ? grid : "PJM";
    const gridItems = filterItems(facilities).filter((item) => gridKey(item) === gridKeyValue);
    const item = aggregate(gridKeyValue, GRID_META[gridKeyValue].label, "grid", gridItems);
    const gridMarkets = [...groupBy(gridItems, (row) => row.market).entries()]
      .map(([name, items]) => aggregate(name, name, "market", items))
      .sort((a, b) => capacityAt(b) - capacityAt(a));
    const states = breakdown(gridItems, (row) => row.state || "주 미기재", 8);
    const methods = breakdown(gridItems, (row) => GRID_METHOD_LABELS[row.gridRegionMethod] || row.gridRegionMethod, 8);
    inspector.innerHTML = `<div class="inspector-inner">
      <div class="eyebrow">Power Grid ISO</div>
      <h2 class="detail-title">${escapeHtml(GRID_META[gridKeyValue].label)}</h2>
      <div class="detail-subtitle">${escapeHtml(GRID_META[gridKeyValue].description)} · 시장 ${gridMarkets.length}개 · 시설 행 ${item.facilityCount}개</div>
      <div class="purpose-line">이 전력망에 속한 행만 사용해 시장별 규모와 주요 주 구성을 비교합니다.</div>
      ${statsHtml(item)}${sparklineHtml(item, "권역 증설 곡선")}${compareHtml(item)}
      <div class="section"><div class="section-header"><span>시장 · ${state.year}</span><span class="count">상위 ${Math.min(gridMarkets.length, 24)}개</span></div>
        <div class="detail-list">${gridMarkets.slice(0, 24).map((market) => detailButton(market.id, market.label, `${market.states.join(" · ")} · 캠퍼스 ${market.campusIds.length} · 시설 ${market.facilityCount}`, fmtMw(capacityAt(market)), "market")).join("")}</div>
      </div>
      <div class="section"><div class="section-header"><span>주 구성</span><span class="count">해당 전력망 행만 집계</span></div>
        <div class="detail-list">${states.map((row) => detailRow(row.label, `시설 ${row.facilityCount}`, fmtMw(capacityAt(row)))).join("")}</div>
      </div>
      <div class="section"><div class="section-header"><span>권역 배정 근거</span><span class="count">원본 / 파생 구분</span></div>
        <div class="detail-list">${methods.map((row) => detailRow(row.label, `시설 ${row.facilityCount}`, fmtMw(capacityAt(row)))).join("")}</div>
      </div>
    </div>`;
    bindDetailButtons();
  }

  function renderMarketInspector(market) {
    const scopedItems = filterItems(market.items).filter((item) => gridKey(item) === state.selectedGrid);
    const filtered = aggregate(market.id, market.label, market.type, scopedItems);
    const allCampusRows = [...groupBy(scopedItems, (item) => item.campusId).entries()]
      .map(([id, items]) => aggregate(id, items[0].clusterId, "campus", items))
      .sort((a, b) => capacityAt(b) - capacityAt(a));
    const campusList = allCampusRows.slice(0, 30);
    const grids = breakdown(filtered.items, (item) => item.gridRegionDisplay, 5);
    const operators = breakdown(filtered.items, (item) => item.company, 5);
    inspector.innerHTML = `<div class="inspector-inner">
      <div class="eyebrow">Market</div>
      <h2 class="detail-title">${escapeHtml(market.label)}</h2>
      <div class="detail-subtitle">${escapeHtml(GRID_META[state.selectedGrid]?.label || "전력망")} · ${escapeHtml(filtered.states.join(" · "))} · 캠퍼스 ${filtered.campusIds.length}개 · 시설 행 ${filtered.facilityCount}개</div>
      <div class="purpose-line">선택한 전력망에 속한 시설만 사용해 시장 규모, 개발 주체와 캠퍼스 집중도를 비교합니다.</div>
      ${statsHtml(filtered)}${sparklineHtml(filtered, "시장 증설 곡선")}${compareHtml(filtered)}
      <div class="section"><div class="section-header"><span>시장 구성</span><span class="count">${state.year} YE</span></div>
        <div class="detail-list">
          ${grids.map((item) => detailRow(`Grid · ${item.label}`, `시설 ${item.facilityCount}`, fmtMw(capacityAt(item)))).join("")}
          ${operators.map((item) => detailRow(`Operator · ${item.label}`, `캠퍼스 ${item.campusIds.length}`, fmtMw(capacityAt(item)))).join("")}
        </div>
      </div>
      <div class="section"><div class="section-header"><span>캠퍼스</span><span class="count">상위 ${campusList.length} / ${filtered.campusIds.length}</span></div>
        <div class="detail-list">${campusList.map((item) => detailButton(item.id, item.label, `${item.companies.slice(0, 3).join(" · ")} · 시설 ${item.facilityCount}`, fmtMw(capacityAt(item)), "campus")).join("")}</div>
      </div>
    </div>`;
    bindDetailButtons();
  }

  function renderCampusInspector(campus) {
    inspector.scrollTop = 0;
    const campusItems = filterItems(campus.items).filter((item) => gridKey(item) === state.selectedGrid);
    const filtered = aggregate(campus.id, campus.label, campus.type, campusItems);
    const cities = unique(filtered.items.map((item) => `${item.city}, ${item.state}`));
    const facilityRows = [...filtered.items].sort((a, b) => a.facilitySequence - b.facilitySequence);
    const operatingRows = facilityRows.filter((item) => facilityLifecycle(item) === "operating");
    const pipelineRows = facilityRows.filter((item) => facilityLifecycle(item) === "pipeline");
    const unknownRows = facilityRows.filter((item) => facilityLifecycle(item) === "unknown");
    const selected = facilityRows.find((item) => item.facilityId === state.selectedFacility);
    const geocodedCount = facilityRows.filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude)).length;
    const operators = breakdown(facilityRows, (item) => item.company, 6);
    const grids = unique(facilityRows.map((item) => item.gridRegionDisplay));
    const gridMethods = unique(facilityRows.map((item) => GRID_METHOD_LABELS[item.gridRegionMethod] || item.gridRegionMethod));
    const utilities = unique(facilityRows.map((item) => item.utility)).slice(0, 4);
    const operationDates = facilityRows.map((item) => item.startOfOperations).filter((value) => value && !value.startsWith("1900")).sort();
    const capacityDates = facilityRows.map((item) => item.fullCapacityDate).filter((value) => value && !value.startsWith("1900")).sort();
    inspector.innerHTML = `<div class="inspector-inner">
      <div class="eyebrow">Campus · ${escapeHtml(campus.id)}</div>
      <h2 class="detail-title">${escapeHtml(campus.label)}</h2>
      <div class="detail-subtitle">${escapeHtml(cities.join(" · "))}<br>${escapeHtml(campus.items[0].market)} · 시설 행 ${filtered.facilityCount}개</div>
      <div class="purpose-line">캠퍼스의 개발 주체, 전력 연결, 가동 일정과 개별 시설 단계 구성을 확인합니다.</div>
      ${statsHtml(filtered)}${sparklineHtml(filtered, "캠퍼스 증설 곡선")}${compareHtml(filtered)}
      <div class="section"><div class="section-header"><span>캠퍼스 프로필</span><span class="count">원본 필드 요약</span></div>
        ${fieldTable([
          ["Operators", operators.map((item) => item.label).join(" · ")],
          ["Display grid region", grids.join(" · ")],
          ["Region assignment", gridMethods.join(" · ")],
          ["Utilities", utilities.join(" · ")],
          ["First operations", operationDates[0]],
          ["Latest full capacity", capacityDates.at(-1)],
          ["Hyperscaler / Colo", `${facilityRows.filter((item) => item.facilityType === "hyperscaler").length} / ${facilityRows.filter((item) => item.facilityType === "colocation").length}`],
        ])}
      </div>
      ${selected ? `<div class="selected-facility"><div class="selected-facility-head"><span>선택 시설 상세</span><button type="button" data-close-facility>닫기</button></div>${facilityDetailHtml(selected)}</div>` : ""}
      ${facilityGroupHtml("운영 중", operatingRows, "Start_of_Operations 기준 현재 가동")}
      ${facilityGroupHtml("예정 · 건설 중", pipelineRows, "향후 가동 또는 파이프라인")}
      ${unknownRows.length ? facilityGroupHtml("상태 미기재", unknownRows, "판단 가능한 일정·용량 값 없음") : ""}
      <div class="callout"><strong>시설 상태 기준</strong> · Start_of_Operations를 우선하며, 날짜가 없을 때만 2026 YE·Under Construction·Planned 값을 보조 기준으로 사용합니다. 정확 좌표는 시설을 선택하면 상세에 표시됩니다. 좌표 제공 ${geocodedCount}/${facilityRows.length}행.</div>
    </div>`;
    bindDetailButtons();
    inspector.querySelector("[data-close-facility]")?.addEventListener("click", () => {
      state.selectedFacility = null;
      renderCampusInspector(campus);
    });
  }

  function facilityGroupHtml(title, rows, subtitle) {
    if (!rows.length) return `<div class="section"><div class="section-header"><span>${escapeHtml(title)}</span><span class="count">0개</span></div><div class="empty-state compact">해당 시설이 없습니다.</div></div>`;
    return `<div class="section"><div class="section-header"><span>${escapeHtml(title)}</span><span class="count">${rows.length}개 · ${escapeHtml(subtitle)}</span></div>
      <div class="detail-list">${rows.slice(0, 80).map((item) => {
        const hasCoordinates = Number.isFinite(item.latitude) && Number.isFinite(item.longitude);
        const lifecycle = facilityLifecycle(item);
        const operation = item.startOfOperations && !item.startOfOperations.startsWith("1900")
          ? `${lifecycle === "operating" ? "가동" : "가동 예정"} ${item.startOfOperations}`
          : statusLabel(item);
        const rowSubtitle = `${operation} · ${item.sourceRowId}${hasCoordinates ? "" : " · 좌표 미기재"}`;
        return detailButton(item.facilityId, `시설 ${String(item.facilitySequence).padStart(2, "0")} · ${item.company}`, rowSubtitle, fmtMw(capacityAt(item)), "facility-inline");
      }).join("")}</div>
      ${rows.length > 80 ? '<div class="callout">이 그룹은 앞 80개 시설까지 표시합니다.</div>' : ""}
    </div>`;
  }

  function facilityDetailHtml(item) {
    return `<div class="section">
      <div class="section-header"><span>시설 ${String(item.facilitySequence).padStart(2, "0")}</span><span class="count">${escapeHtml(item.facilityId)}</span></div>
      ${item.estimatedTenant || item.estimatedEndUser ? '<div class="badge-row"><span class="badge estimated">원본 Estimated 필드</span></div>' : ""}
      ${statsHtml(item)}
      ${fieldTable([
        ["UI status (derived)", statusLabel(item)],
        ["Source row", item.sourceRowId],
        ["Cluster_ID", item.clusterId],
        ["Company", item.company],
        ["Facility type", item.facilityType],
        ["Estimated tenant", item.estimatedTenant],
        ["Estimated end user", item.estimatedEndUser],
        ["GPU cloud", item.gpuCloud],
        ["Facility sqft", item.facilitySqft ? fmtInt(item.facilitySqft) : null],
        ["Start construction", item.startOfConstruction],
        ["Build months", item.timeToBuildMonths],
        ["Start operations", item.startOfOperations],
        ["Full capacity", item.fullCapacityDate],
        ["Quarters to complete", item.quartersToComplete],
        ["Current planned MW", item.plannedMw ? fmtMw(item.plannedMw) : null],
        ["Display grid region", item.gridRegionDisplay],
        ["Region assignment", GRID_METHOD_LABELS[item.gridRegionMethod] || item.gridRegionMethod],
        ["Source Power Grid ISO", item.powerGridIso],
        ["Utility", item.utility],
        ["Holding company", item.holdingCompanyUtility],
        ["Controlling authority", item.controllingAuthority],
        ["Onsite generation", item.onsiteGasGeneration],
        ["ZIP", item.zipCode],
        ["Coordinates", `${item.latitude ?? "—"}, ${item.longitude ?? "—"}`],
      ])}
      ${item.plannedMw ? '<div class="callout"><strong>Planned</strong> · 현재 발표 파이프라인 원본값입니다. 2030 YE 용량에 추가로 합산하지 않습니다.</div>' : ""}
    </div>`;
  }

  function fieldTable(fields) {
    return `<div class="field-table">${fields.map(([name, value]) => `<div class="field-row"><div class="field-name">${escapeHtml(name)}</div><div class="field-value">${display(value)}</div></div>`).join("")}</div>`;
  }

  function detailButton(id, title, subtitle, value, kind) {
    return `<button type="button" class="detail-button" data-kind="${kind}" data-id="${escapeHtml(id)}"><span><span class="row-title"><strong>${escapeHtml(title)}</strong></span><span class="row-sub">${escapeHtml(subtitle)}</span></span><span class="row-value">${value}</span></button>`;
  }

  function detailRow(title, subtitle, value) {
    return `<div class="detail-row"><span><span class="row-title"><strong>${escapeHtml(title)}</strong></span><span class="row-sub">${escapeHtml(subtitle)}</span></span><span class="row-value">${value}</span></div>`;
  }

  function bindDetailButtons() {
    inspector.querySelectorAll(".detail-button").forEach((button) => {
      button.addEventListener("click", () => {
        const { kind, id } = button.dataset;
        if (kind === "grid") return selectGrid(id);
        if (kind === "market") return navigateToMarket(id);
        if (kind === "campus") return navigateToCampus(id);
        if (kind === "facility-inline") {
          const item = byId.get(id);
          if (!item || item.campusId !== state.selectedCampus) return;
          state.selectedFacility = id;
          return renderCampusInspector(campusById.get(state.selectedCampus));
        }
      });
    });
  }

  function renderEntityView() {
    const operatorItems = state.entityFacilityType === "all"
      ? facilities
      : facilities.filter((item) => item.facilityType === state.entityFacilityType);
    const groups = state.entityMode === "operator"
      ? [...groupBy(operatorItems, (item) => item.company).entries()]
        .map(([name, items]) => aggregate(name, name, "operator", items))
        .sort((a, b) => capacityAt(b) - capacityAt(a))
      : [...tenantGroups].sort((a, b) => capacityAt(b) - capacityAt(a));
    const query = document.getElementById("entitySearch").value.trim().toLowerCase();
    const filteredGroups = groups.filter((item) => item.label.toLowerCase().includes(query));
    if (!state.selectedEntity || !groups.some((item) => item.id === state.selectedEntity)) state.selectedEntity = groups[0]?.id || null;
    const visibleGroups = query ? filteredGroups : groups;
    const major = visibleGroups.slice(0, 10);
    const majorIds = new Set(major.map((item) => item.id));
    const remaining = visibleGroups.filter((item) => !majorIds.has(item.id));
    const entityOption = (item) => `<option value="${escapeHtml(item.id)}" ${item.id === state.selectedEntity ? "selected" : ""}>${escapeHtml(item.label)} · ${fmtMw(capacityAt(item))}</option>`;
    const picker = state.entityMode === "tenant"
      ? `<select class="entity-select" data-entity-select><option value="">추정 테넌트 선택…</option>${remaining.map(entityOption).join("")}</select>`
      : `<select class="entity-select" data-entity-select><option value="">+ Hyperscaler 기타</option>${remaining.filter((item) => item.dominantType === "hyperscaler").map(entityOption).join("")}</select>
         <select class="entity-select" data-entity-select><option value="">+ Colocation 기타</option>${remaining.filter((item) => item.dominantType !== "hyperscaler").map(entityOption).join("")}</select>`;
    document.getElementById("entityList").innerHTML = visibleGroups.length
      ? `<div class="entity-picker-row">${major.map((item) => `
      <button type="button" class="entity-chip ${item.dominantType} ${item.id === state.selectedEntity ? "active" : ""}" data-entity="${escapeHtml(item.id)}"><span class="entity-dot"></span>${escapeHtml(item.label)}<span class="entity-chip-value">${fmtMw(capacityAt(item))}</span></button>`).join("")}${picker}</div>
      <div class="entity-summary"><span>${groups.length}개 업체 · ${state.year} YE 기준</span><strong>${fmtMw(groups.reduce((total, row) => total + capacityAt(row), 0))}</strong></div>`
      : `<div class="empty-state compact">"${escapeHtml(query)}"에 대한 검색 결과가 없습니다.</div>`;
    document.querySelectorAll("#entityModeSeg button").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.entityMode));
    document.getElementById("entityTypeSeg").classList.toggle("hidden", state.entityMode !== "operator");
    document.querySelectorAll("#entityTypeSeg button").forEach((button) => button.classList.toggle("active", button.dataset.entityType === state.entityFacilityType));
    document.querySelectorAll(".entity-chip").forEach((button) => button.addEventListener("click", () => {
      state.selectedEntity = button.dataset.entity;
      renderEntityView();
    }));
    document.querySelectorAll("[data-entity-select]").forEach((select) => select.addEventListener("change", () => {
      if (!select.value) return;
      state.selectedEntity = select.value;
      renderEntityView();
    }));
    const selected = groups.find((item) => item.id === state.selectedEntity);
    renderOperatorMap(selected);
    renderEntityDetail(selected);
  }

  function renderOperatorMap(entity) {
    const svg = d3.select("#operatorSvg");
    const root = svg.select("#operatorMapRoot");
    const { width, height } = mapDimensions(svg.node());
    // 업체 화면은 한 업체의 분포를 보는 곳이라 권역 색을 끄고 버블 색만 남긴다.
    const projection = setupMapBase(svg, root, width, height, { choropleth: false });
    document.getElementById("operatorMapTitle").textContent = entity
      ? `${state.entityMode === "tenant" ? "Estimated tenant" : "Operator"} · ${entity.label} · ${state.year} YE`
      : "업체를 선택하세요";
    const entityColor = !entity || state.entityMode === "tenant" || entity.dominantType === "hyperscaler" ? COLORS.hyperscaler : COLORS.colocation;
    const legend = document.getElementById("operatorLegend");
    legend.innerHTML = `<div class="legend-title">${state.year} YE 가동</div>
      <div class="legend-row"><span class="legend-core operator" style="background:${entityColor}"></span>채움 원 · ${state.year} YE</div>
      <div class="legend-row"><span class="legend-planned" style="border-color:${entityColor}"></span>점선 원 · ${BASE_YEAR} + UC + Planned</div>
      <div class="legend-note">Planned는 발표 파이프라인이라 전망에 다시 더하지 않습니다.</div>`;
    if (!entity) return;
    const groups = [...groupBy(entity.items, (item) => item.market).entries()]
      .map(([id, items]) => aggregate(id, id, "entity-market", items))
      .sort((a, b) => capacityAt(b) - capacityAt(a))
      .filter((item) => capacityAt(item) > 0 || pipelineTotal(item) > 0)
      .slice(0, 24)
      .map((item) => projectAggregate(item, projection))
      .filter(Boolean);
    // 지도의 시장 레이어와 동일한 기준(MARKET_SCALE_MAX)을 써야 지도·업체 화면을 넘나들며
    // 원 크기를 비교할 수 있다.
    const radius = d3.scaleSqrt().domain([0, MARKET_SCALE_MAX]).range([3, 25]);
    const color = entityColor;
    // 시장이 몰린 동부에서 라벨이 겹치므로 원+글자 폭만큼만 살짝 밀어낸다.
    const top = new Set(groups.slice(0, 10).map((item) => item.id));
    groups.forEach((item) => { item.anchorX = item.x; item.anchorY = item.y; });
    d3.forceSimulation(groups)
      .force("x", d3.forceX((item) => item.anchorX).strength(.62))
      .force("y", d3.forceY((item) => item.anchorY).strength(.62))
      .force("collide", d3.forceCollide((item) => {
        const circle = Math.max(radius(capacityAt(item)), radius(pipelineTotal(item))) + 3;
        return top.has(item.id) ? Math.max(circle, shortLabel(item.label, 20).length * 2.9 + 5) : circle;
      }).iterations(3))
      .stop()
      .tick(80);
    const nodes = root.append("g").selectAll("g.map-node")
      .data(groups)
      .join("g")
      .attr("class", "map-node")
      .attr("transform", (item) => `translate(${item.x},${item.y})`)
      .attr("role", "button")
      .attr("tabindex", 0)
      .on("click", (_event, item) => navigateToMarket(item.id))
      .on("mouseenter", (event, item) => showTooltip(event, `<strong>${escapeHtml(item.label)}</strong><br>${state.year} YE ${fmtMw(capacityAt(item))}<br>+UC ${fmtMw(item.underConstructionMw)} · +Planned ${fmtMw(item.plannedMw)}<br>캠퍼스 ${item.campusIds.length} · 시설 ${item.facilityCount}`))
      .on("mousemove", moveTooltip)
      .on("mouseleave", hideTooltip);
    nodes.filter((item) => number(item.plannedMw) > 0).append("circle").attr("class", "operator-planned-ring").attr("r", (item) => radius(pipelineTotal(item))).attr("stroke", color);
    nodes.append("circle").attr("class", "node-core").attr("r", (item) => Math.max(3, radius(capacityAt(item)))).attr("fill", color);
    // 밀어내기로도 남는 겹침은 큰 시장을 우선해 라벨을 생략한다.
    const placedLabels = [];
    const labelled = groups.filter((item) => {
      if (!top.has(item.id)) return false;
      const halfWidth = shortLabel(item.label, 20).length * 3.1;
      const labelY = -Math.max(radius(Math.max(capacityAt(item), pipelineTotal(item))), 5) - 7 + item.y;
      const clear = placedLabels.every((seen) =>
        Math.abs(seen.x - item.x) > seen.halfWidth + halfWidth || Math.abs(seen.y - labelY) > 11);
      if (clear) placedLabels.push({ x: item.x, y: labelY, halfWidth });
      return clear;
    });
    const labelledIds = new Set(labelled.map((item) => item.id));
    nodes.filter((item) => labelledIds.has(item.id)).append("text").attr("class", "node-label").attr("y", (item) => -Math.max(radius(Math.max(capacityAt(item), pipelineTotal(item))), 5) - 7).text((item) => shortLabel(item.label, 20));
  }

  function renderEntityDetail(entity) {
    const yearLabel = `${state.year} YE`;
    const target = document.getElementById("operatorDetail");
    target.scrollTop = 0;
    if (!entity) {
      target.innerHTML = '<div class="inspector-inner"><div class="empty-state">업체를 선택하세요.</div></div>';
      return;
    }
    const marketRows = [...groupBy(entity.items, (item) => item.market).entries()]
      .map(([name, items]) => aggregate(name, name, "market", items))
      .sort((a, b) => capacityAt(b) - capacityAt(a))
      .filter((item) => capacityAt(item) > 0);
    const gridRows = [...groupBy(entity.items, gridKey).entries()]
      .map(([name, items]) => aggregate(name, GRID_META[name]?.label || name, "grid", items))
      .sort((a, b) => capacityAt(b) - capacityAt(a))
      .filter((item) => capacityAt(item) > 0);
    const growthMultiple = capacityAt(entity) > 0 ? capacityAt(entity, LAST_YEAR) / capacityAt(entity) : null;
    const ucMomentum = capacityAt(entity, BASE_YEAR) > 0 ? entity.underConstructionMw / capacityAt(entity, BASE_YEAR) * 100 : null;
    target.innerHTML = `<div class="inspector-inner">
      <div class="eyebrow">${state.entityMode === "tenant" ? "Estimated tenant" : "Operator footprint"}</div>
      <h2 class="detail-title">${escapeHtml(entity.label)}</h2>
      <div class="detail-subtitle">시장 ${entity.markets.length}개 · 캠퍼스 ${entity.campusIds.length}개 · 시설 행 ${entity.facilityCount}개</div>
      ${state.entityMode === "operator" ? `<div class="badge-row"><span class="badge hyperscaler">Hyperscaler ${entity.items.filter((row) => row.facilityType === "hyperscaler").length}</span><span class="badge colocation">Colocation ${entity.items.filter((row) => row.facilityType === "colocation").length}</span></div>` : ""}
      ${state.entityMode === "tenant" ? '<div class="badge-row"><span class="badge estimated">원본 Estimated_Tenant</span></div>' : ""}
      <div class="operator-kpis"><div><span>${state.year} → ${LAST_YEAR}</span><strong>${growthMultiple ? `×${growthMultiple.toFixed(1)}` : "—"}</strong></div><div><span>UC / ${BASE_YEAR}</span><strong>${ucMomentum !== null ? `${Math.round(ucMomentum)}%` : "—"}</strong></div></div>
      ${pipelineLadderHtml(entity)}
      <div class="section"><div class="section-header"><span>전력 권역 · ${yearLabel}</span><span class="count">클릭 → 지도</span></div><div class="detail-list">
        ${gridRows.slice(0, 10).map((item) => detailButton(item.id, item.label, `${GRID_META[item.id]?.description || "전력 권역"} · 시장 ${item.markets.length}`, fmtMw(capacityAt(item)), "operator-grid")).join("")}
      </div></div>
      <div class="section"><div class="section-header"><span>상위 시장 · ${yearLabel}</span><span class="count">클릭 → 지도</span></div><div class="detail-list">
        ${marketRows.slice(0, 15).map((item) => detailButton(item.id, item.label, `캠퍼스 ${item.campusIds.length} · 시설 ${item.facilityCount}`, fmtMw(capacityAt(item)), "operator-market")).join("")}
      </div></div>
      <div class="callout"><strong>해석 기준</strong> · 건설 중은 ${BASE_YEAR} 기준에서 확실도가 높은 증분, Planned는 발표된 추가 파이프라인입니다. 연도별 전망치는 별도 시계열이므로 Planned와 합산하지 않습니다.</div>
      ${state.entityMode === "tenant" ? '<div class="callout"><strong>Estimated</strong> · 원본 CSV의 Estimated_Tenant가 입력된 시설만 포함합니다. 비어 있는 행을 자가운영으로 추정하지 않습니다.</div>' : ""}
    </div>`;
    target.querySelectorAll('[data-kind="operator-market"]').forEach((button) => button.addEventListener("click", () => navigateToMarket(button.dataset.id)));
    target.querySelectorAll('[data-kind="operator-grid"]').forEach((button) => button.addEventListener("click", () => openGrid(button.dataset.id)));
  }

  function pipelineLadderHtml(entity) {
    const withUc = capacityAt(entity, BASE_YEAR) + number(entity.underConstructionMw);
    const withPlanned = withUc + number(entity.plannedMw);
    const max = Math.max(withPlanned, capacityAt(entity, LAST_YEAR), 1);
    const row = (label, value, className, note) => `<div class="pipeline-row"><div class="pipeline-label"><span>${label}</span><strong>${fmtMw(value)}</strong></div><div class="pipeline-track"><span class="${className}" style="width:${value / max * 100}%"></span></div><div class="pipeline-note">${note}</div></div>`;
    return `<div class="pipeline-ladder"><div class="section-header"><span>성장 가시성 · ${BASE_YEAR} 기준</span><span class="count">누적 용량</span></div>
      ${row(`${BASE_YEAR} 가동`, capacityAt(entity, BASE_YEAR), "base", "현재 기준")}
      ${row("+ 건설 중", withUc, "uc", `증분 ${fmtMw(entity.underConstructionMw)}`)}
      ${row("+ Planned", withPlanned, "planned", `발표 증분 ${fmtMw(entity.plannedMw)}`)}
      ${row(`${state.year} YE 전망`, capacityAt(entity), "forecast", "별도 전망 · 합산 금지")}
    </div>`;
  }

  function renderDashboard() {
    const dashboard = document.getElementById("dashboardContent");
    const yearLabel = `${state.year} YE`;
    const isEndYear = state.year >= LAST_YEAR;
    const horizon = (item) => capacityAt(item, LAST_YEAR);
    const scopeItems = facilities.filter((item) => state.dashboardFacilityType === "all" || item.facilityType === state.dashboardFacilityType);
    const scope = aggregate("dashboard", "Dashboard scope", "dashboard", scopeItems);
    const topOperators = [...groupBy(scopeItems, (item) => item.company).entries()]
      .map(([name, items]) => aggregate(name, name, "operator", items))
      .sort((a, b) => capacityAt(b) - capacityAt(a))
      .slice(0, 10);
    const gridGroups = [...groupBy(scopeItems, gridKey).entries()]
      .map(([name, items]) => aggregate(name, GRID_META[name]?.label || name, "grid", items))
      .sort((a, b) => capacityAt(b) - capacityAt(a));
    const maxOperator = d3.max(topOperators, (item) => Math.max(capacityAt(item), horizon(item))) || 1;
    const maxGrid = d3.max(gridGroups, (item) => Math.max(capacityAt(item), horizon(item))) || 1;
    const hyper = aggregate("hyperscaler", "Hyperscaler", "segment", scopeItems.filter((item) => item.facilityType === "hyperscaler"));
    const colo = aggregate("colocation", "Colocation", "segment", scopeItems.filter((item) => item.facilityType === "colocation"));
    const familyTotals = { rto: 0, ercot: 0, nonrto: 0 };
    scopeItems.forEach((item) => { familyTotals[GRID_META[gridKey(item)]?.family || "nonrto"] += capacityAt(item); });
    const familyTotal = familyTotals.rto + familyTotals.ercot + familyTotals.nonrto;
    const isoShare = pct(familyTotals.rto, familyTotal);
    const growthMultiple = capacityAt(scope) > 0 ? horizon(scope) / capacityAt(scope) : 0;
    const ucMomentum = capacityAt(scope) > 0 ? scope.underConstructionMw / capacityAt(scope) * 100 : 0;
    const scopeLabel = state.dashboardFacilityType === "all" ? "전체 시설" : state.dashboardFacilityType === "hyperscaler" ? "Hyperscaler" : "Colocation";
    const segmentCard = (item, className) => dashboardDynamicStat(item.label, capacityAt(item), isEndYear ? `UC ${fmtMw(item.underConstructionMw)} · Planned ${fmtMw(item.plannedMw)}` : `${LAST_YEAR} ${fmtMw(horizon(item))} · ×${(horizon(item) / Math.max(capacityAt(item), 1)).toFixed(1)}`, className);
    const firstCards = state.dashboardFacilityType === "all"
      ? `${segmentCard(hyper, "hyper")}${segmentCard(colo, "colo")}`
      : `${dashboardDynamicStat(scopeLabel, capacityAt(scope), `${LAST_YEAR} ${fmtMw(horizon(scope))}`, state.dashboardFacilityType === "hyperscaler" ? "hyper" : "colo")}${dashboardDynamicStat(`${state.year} → ${LAST_YEAR}`, growthMultiple, `증가 ${fmtMw(horizon(scope) - capacityAt(scope))}`, "growth", true)}`;
    dashboard.innerHTML = `<div class="dashboard-header"><div><div class="eyebrow">POWER · MARKET · OPERATOR</div><h2 class="dashboard-title">US 데이터센터 전력·시장 대시보드</h2><div class="dashboard-sub">${escapeHtml(scopeLabel)} · 시설 ${fmtInt(scope.facilityCount)} · 캠퍼스 ${fmtInt(scope.campusIds.length)} · 시장 ${scope.markets.length}</div></div></div>
      <div class="dashboard-controls">
        <div class="dashboard-control"><span>시점</span><div class="year-scrub dashboard-scrub"><input id="dashboardYearSlider" type="range" min="${FIRST_YEAR}" max="${LAST_YEAR}" step="1" value="${state.year}" aria-label="대시보드 용량 시점"><output>${state.year} YE</output></div></div>
        <div class="dashboard-control"><span>시설 유형</span><div class="segmented compact"><button type="button" data-dashboard-type="all" class="${state.dashboardFacilityType === "all" ? "active" : ""}">전체</button><button type="button" data-dashboard-type="hyperscaler" class="${state.dashboardFacilityType === "hyperscaler" ? "active" : ""}">Hyperscaler</button><button type="button" data-dashboard-type="colocation" class="${state.dashboardFacilityType === "colocation" ? "active" : ""}">Colocation</button></div></div>
      </div>
      <div class="dashboard-stats dynamic">
        ${firstCards}
        ${dashboardDynamicStat(`시장 구조 · ${yearLabel}`, `${isoShare}%`, `ISO/RTO ${fmtMw(familyTotals.rto)} · ERCOT ${fmtMw(familyTotals.ercot)} · Non-RTO ${fmtMw(familyTotals.nonrto)}`, "market")}
        ${isEndYear
          ? dashboardDynamicStat("발표 파이프라인", scope.underConstructionMw, `UC 모멘텀 ${Math.round(ucMomentum)}% · Planned ${fmtMw(scope.plannedMw)}`, "pipeline")
          : dashboardDynamicStat(`${state.year} → ${LAST_YEAR} 성장`, growthMultiple, `${fmtMw(capacityAt(scope))} → ${fmtMw(horizon(scope))}`, "growth", true)}
      </div>
      <div class="dashboard-grid">
        <div class="dashboard-card dashboard-grid-card"><h3>전력 권역 · ${state.year} → ${LAST_YEAR} <span>클릭 → 지도</span></h3>${gridGroups.map((item) => dashboardDumbbellRow(item, maxGrid)).join("")}<div class="chart-key"><span class="key-current"></span>${state.year} <span class="key-future"></span>${LAST_YEAR} · 점 간격이 성장폭입니다.</div></div>
        <div class="dashboard-card"><h3>주요 운영사 · ${yearLabel} <span>클릭 → 업체 분석</span></h3>${topOperators.map((item) => dashboardRankingRow(item, maxOperator, "operator")).join("")}<div class="callout"><strong>파이프라인</strong> · 건설 중과 Planned는 2026 기준 성장 가시성을 설명합니다. 2030 전망에 다시 더하지 않습니다.</div></div>
      </div>
      <div class="methodology"><strong>집계 기준</strong> · 연도별 용량은 원본 CSV의 Cap_YE(2017~2023)와 Q4(2024~2032) 값이며, 빈 칸은 직전 연도를 이어받습니다. Planned는 현재 발표 파이프라인 필드이므로 2030에 추가하지 않습니다. Power_Grid_ISO 공란은 기존 저장소의 시장 권역 → 원본 Controlling_Authority → 주·시장 지리 순으로 보완했으며 각 시설 상세에 배정 근거를 표시합니다. 외부 웹 데이터는 사용하지 않았습니다.</div>`;
    const dashboardSlider = dashboard.querySelector("#dashboardYearSlider");
    if (dashboardSlider) dashboardSlider.addEventListener("input", () => { state.year = Number(dashboardSlider.value); renderDashboard(); syncYearControls(); });
    dashboard.querySelectorAll("[data-dashboard-type]").forEach((button) => button.addEventListener("click", () => { state.dashboardFacilityType = button.dataset.dashboardType; renderDashboard(); }));
    dashboard.querySelectorAll("[data-dashboard-kind]").forEach((button) => button.addEventListener("click", () => {
      const { dashboardKind: kind, dashboardId: id } = button.dataset;
      if (kind === "market") return navigateToMarket(id);
      if (kind === "grid") return openGrid(id);
      state.entityMode = "operator";
      state.entityFacilityType = "all";
      state.selectedEntity = id;
      document.getElementById("entitySearch").value = "";
      switchView("operator");
    }));
  }

  function dashboardDynamicStat(label, value, note, className, isMultiple = false) {
    const formatted = typeof value === "string" ? value : isMultiple ? `×${value.toFixed(1)}` : fmtMw(value);
    return `<div class="dashboard-stat ${className}"><div class="stat-label">${label}</div><div class="stat-value">${formatted}</div><div class="stat-note">${note}</div></div>`;
  }
  function dashboardRankingRow(item, max, kind) {
    return `<button type="button" class="ranking-row dashboard-link" data-dashboard-kind="${kind}" data-dashboard-id="${escapeHtml(item.id)}"><span class="ranking-name">${escapeHtml(item.label)}</span><span class="ranking-track"><span class="ranking-future" style="width:${capacityAt(item, LAST_YEAR) / max * 100}%"></span><span class="ranking-current" style="width:${capacityAt(item) / max * 100}%"></span></span><span class="ranking-value">${fmtMw(capacityAt(item))}</span></button>`;
  }
  function dashboardDumbbellRow(item, max) {
    const current = capacityAt(item) / max * 100;
    const future = capacityAt(item, LAST_YEAR) / max * 100;
    const start = Math.min(current, future);
    const width = Math.max(1, Math.abs(future - current));
    const color = COLORS[GRID_META[item.id]?.family || "nonrto"];
    return `<button type="button" class="dumbbell-row dashboard-link" data-dashboard-kind="grid" data-dashboard-id="${escapeHtml(item.id)}"><span class="ranking-name">${escapeHtml(item.label)}</span><span class="dumbbell-track"><span class="dumbbell-line" style="left:${start}%;width:${width}%"></span><span class="dumbbell-dot current" style="left:${current}%"></span><span class="dumbbell-dot future active" style="left:${future}%;background:${color}"></span></span><span class="ranking-value">${fmtMw(capacityAt(item))}</span></button>`;
  }

  function switchView(view) {
    state.view = view;
    document.querySelectorAll(".view").forEach((element) => element.classList.toggle("active", element.id === `${view}View`));
    document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    if (view === "map") requestAnimationFrame(renderMap);
    if (view === "operator") requestAnimationFrame(renderEntityView);
    if (view === "dashboard") renderDashboard();
  }

  let searchActiveIndex = -1;

  function activateSearchResult(button) {
    if (!button) return;
    const results = document.getElementById("searchResults");
    results.classList.remove("open");
    document.getElementById("globalSearch").value = "";
    searchActiveIndex = -1;
    if (button.dataset.kind === "market") navigateToMarket(button.dataset.id);
    if (button.dataset.kind === "campus") navigateToCampus(button.dataset.id);
    if (button.dataset.kind === "operator" || button.dataset.kind === "tenant") {
      state.entityMode = button.dataset.kind === "tenant" ? "tenant" : "operator";
      state.entityFacilityType = "all";
      state.selectedEntity = button.dataset.id;
      switchView("operator");
    }
    if (button.dataset.kind === "grid") openGrid(button.dataset.id);
  }

  function renderSearch(query) {
    const results = document.getElementById("searchResults");
    const normalized = query.trim().toLowerCase();
    searchActiveIndex = -1;
    if (normalized.length < 2) {
      results.classList.remove("open");
      results.innerHTML = "";
      return;
    }
    const matches = [
      ...Object.entries(GRID_META).filter(([id, meta]) => `${id} ${meta.label}`.toLowerCase().includes(normalized)).slice(0, 3).map(([id, meta]) => ({ kind: "grid", id, name: meta.label, meta: meta.description })),
      ...markets.filter((item) => `${item.label} ${item.states.join(" ")}`.toLowerCase().includes(normalized)).slice(0, 5).map((item) => ({ kind: "market", id: item.id, name: item.label, meta: fmtMw(item.capacity2030Mw) })),
      ...campuses.filter((item) => `${item.label} ${item.items[0].city} ${item.items[0].state} ${item.items[0].market}`.toLowerCase().includes(normalized)).slice(0, 7).map((item) => ({ kind: "campus", id: item.id, name: item.label, meta: item.items[0].market })),
      ...operatorGroups.filter((item) => item.label.toLowerCase().includes(normalized)).slice(0, 5).map((item) => ({ kind: "operator", id: item.id, name: item.label, meta: fmtMw(item.capacity2030Mw) })),
      ...tenantGroups.filter((item) => item.label.toLowerCase().includes(normalized)).slice(0, 4).map((item) => ({ kind: "tenant", id: item.id, name: item.label, meta: fmtMw(item.capacity2030Mw) })),
    ].slice(0, 16);
    results.innerHTML = matches.length ? matches.map((item) => `<button type="button" class="search-result" data-kind="${item.kind}" data-id="${escapeHtml(item.id)}"><span class="type">${item.kind}</span><span class="name">${escapeHtml(item.name)}</span><span class="meta">${escapeHtml(item.meta)}</span></button>`).join("") : '<div class="empty-state" style="padding:14px">검색 결과가 없습니다.</div>';
    results.classList.add("open");
    results.querySelectorAll(".search-result").forEach((button) => button.addEventListener("click", () => activateSearchResult(button)));
  }

  function moveSearchSelection(delta) {
    const results = document.getElementById("searchResults");
    const items = [...results.querySelectorAll(".search-result")];
    if (!items.length) return;
    items[searchActiveIndex]?.classList.remove("active");
    searchActiveIndex = (searchActiveIndex + delta + items.length) % items.length;
    const active = items[searchActiveIndex];
    active.classList.add("active");
    active.scrollIntoView({ block: "nearest" });
  }

  function bindControls() {
    document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
    const slider = document.getElementById("yearSlider");
    slider.min = String(FIRST_YEAR);
    slider.max = String(LAST_YEAR);
    slider.value = String(state.year);
    slider.addEventListener("input", () => {
      state.year = Number(slider.value);
      stopYearPlayback();
      renderMap();
    });
    document.getElementById("yearPlay").addEventListener("click", toggleYearPlayback);
    document.querySelectorAll("#typeSeg button").forEach((button) => button.addEventListener("click", () => {
      state.facilityType = button.dataset.type;
      state.selectedFacility = null;
      renderMap();
    }));
    document.querySelectorAll("#entityModeSeg button").forEach((button) => button.addEventListener("click", () => {
      state.entityMode = button.dataset.mode;
      state.selectedEntity = null;
      document.getElementById("entitySearch").value = "";
      renderEntityView();
    }));
    document.querySelectorAll("#entityTypeSeg button").forEach((button) => button.addEventListener("click", () => {
      state.entityFacilityType = button.dataset.entityType;
      state.selectedEntity = null;
      renderEntityView();
    }));
    const entitySlider = document.getElementById("entityYearSlider");
    entitySlider.min = String(FIRST_YEAR);
    entitySlider.max = String(LAST_YEAR);
    entitySlider.value = String(state.year);
    entitySlider.addEventListener("input", () => {
      state.year = Number(entitySlider.value);
      syncYearControls();
      renderEntityView();
    });
    document.getElementById("entitySearch").addEventListener("input", renderEntityView);
    const globalSearch = document.getElementById("globalSearch");
    globalSearch.addEventListener("input", (event) => renderSearch(event.target.value));
    globalSearch.addEventListener("keydown", (event) => {
      const results = document.getElementById("searchResults");
      if (!results.classList.contains("open")) return;
      if (event.key === "ArrowDown") { event.preventDefault(); moveSearchSelection(1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); moveSearchSelection(-1); }
      else if (event.key === "Enter") {
        event.preventDefault();
        const items = [...results.querySelectorAll(".search-result")];
        activateSearchResult(items[searchActiveIndex] || items[0]);
      } else if (event.key === "Escape") {
        results.classList.remove("open");
        globalSearch.blur();
      }
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".global-search")) document.getElementById("searchResults").classList.remove("open");
    });
    new ResizeObserver(() => {
      if (state.view === "map") renderMap();
      if (state.view === "operator") renderEntityView();
    }).observe(document.querySelector(".app-header"));
  }

  bindControls();
  renderDashboard();
  state.selectedEntity = operatorGroups[0]?.id || null;
  requestAnimationFrame(renderMap);
})();
