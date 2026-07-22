# US 데이터센터 전력 지도

사용자 제공 원본 CSV를 기준으로 미국 전력망, 시장, 캠퍼스, 개별 시설을 탐색하는 정적 HTML 애플리케이션입니다.

## 데이터 원칙

- `data/us-datacenter-semianalysis-clean-v1.csv`이 최우선 원본입니다.
- 원본 3,496개 행과 모든 원본 필드는 수정하지 않습니다.
- 탐색용 식별자와 `Grid_Region_Display`, `Grid_Region_Method` 파생 필드만 추가합니다.
- 캠퍼스는 원본의 `Country + Market + Cluster_ID` 조합으로 그룹화합니다.
- 시설 상세는 원본 `Latitude`와 `Longitude`를 그대로 표시합니다. 완전한 좌표가 있는 3,489개 행과 좌표가 비어 있는 7개 행을 구분합니다.
- 외부 웹 데이터나 자체 추정값은 추가하지 않았습니다. `Estimated` 표시는 원본 CSV에서 이미 추정 필드로 제공된 값입니다.
- 화면 용량은 가독성을 위해 `Q4_2026_MW`, `Q4_2030_MW`, `Total_UnderConstruction_MW`, `Total_Planned_MW`만 사용합니다.
- `Total_Planned_MW`는 현재 발표 파이프라인 필드이며 2030 용량에 더하지 않습니다. Planned가 있는 1,311행 중 1,217행은 이미 `Q4_2030_MW`에도 값이 있습니다.

원본에는 Canada 행 155개도 포함되어 있습니다. 이 행들은 정규화 파일과 브라우저 데이터에 보존되지만, 현재 지도와 대시보드는 USA 행 3,341개만 표시합니다.

## 화면 구성

- **지도**: `Power_Grid_ISO` 전력망 → 시장 → 캠퍼스 순서의 드릴다운
- **전력망**: PJM·ERCOT·MISO·CAISO·SPP·NYISO·ISONE·TVA와 WECC NW/RMP/SW, SERC SE/Central/FL을 비교합니다.
- **권역 보완**: `Power_Grid_ISO` 공란은 기존 저장소의 시장 매핑을 우선 적용하고, 남은 행만 원본 `Controlling_Authority`와 주·시장 지리로 보완합니다. 모든 파생 행에 배정 방법을 기록합니다.
- **캠퍼스**: 개별 시설을 운영 중 / 예정·건설 중으로 나누고, 선택한 시설의 일정·전력·테넌트·정확 좌표를 같은 패널에서 표시합니다.
- **업체**: 운영사를 Hyperscaler/Colocation으로 필터링하고, 원본 `Estimated_Tenant` 기준 추정 테넌트의 시장별 풋프린트도 제공합니다.
- **대시보드**: 2026/2030 용량, 성장, 공사 중·계획 용량, 시장·시설유형·전력망 분포

## 파일 구조

```text
index.html                         HTML 셸과 미국 지도 topology
styles.css                        반응형 UI 스타일
app.js                            지도·업체·대시보드 상호작용
data/
├── us-datacenter-semianalysis-clean-v1.csv  authoritative source
├── us-datacenter-normalized.csv             식별자 추가 정규화본
├── legacy-market-grid-regions.json          기존 저장소 시장→권역 매핑
└── datacenters-data.js                       브라우저용 생성 데이터
scripts/
├── build_data.py                 정규화 CSV와 브라우저 데이터 생성
├── verify_data.py                원본 보존·좌표·행 순서 검증
└── rewrite_index.py              기존 topology를 보존해 HTML 셸 재작성
```

## 실행

브라우저 보안 정책 때문에 파일을 직접 여는 대신 저장소 루트에서 로컬 서버를 실행합니다.

```bash
python3 -m http.server 8765
```

그다음 `http://127.0.0.1:8765/`을 엽니다. D3와 TopoJSON은 HTML에서 CDN으로 로드합니다.

## 데이터 재생성 및 검증

원본 CSV가 교체되면 다음 순서로 생성 파일을 갱신하고 검증합니다.

```bash
python3 scripts/build_data.py
python3 scripts/verify_data.py
```

`rewrite_index.py`는 UI 셸을 다시 생성할 필요가 있을 때만 실행합니다. 현재 `index.html`에 포함된 미국 topology를 보존해서 새 셸에 삽입합니다.
