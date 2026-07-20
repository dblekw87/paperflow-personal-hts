# 거래대금 기반 오늘의 주도주·주도 테마

## 1. 목적과 제품 표현

KOSPI·KOSDAQ의 당일 누적 거래대금을 이용해 현재 장에서 자금이 집중되는 종목과 산업·테마를 보여 준다. 종목에는 `반도체 > 장비`, `반도체 > 소재`, `반도체 > 부품`, `전력 > 전력기기`, `전력 > 원전`, `전력 > ESS`처럼 검증 가능한 최하위 분류부터 상위 경로까지 표시한다.

`LEADING`, `EMERGING`, `ROTATING`, `WEAK`은 시장 내 상대 강도 상태다. 상승 지속 예측, 매수 추천 또는 상승 원인 판정이 아니다. 테마 이름 옆에는 기준시각, 데이터 freshness, constituent 수와 집중도를 함께 표시한다.

## 2. Canonical 입력

- 종목 순위의 출처 표지는 `KIS_CANONICAL_RANKING`이어야 한다.
- 개별 종목 누적 거래대금과 등락률은 `KIS_CANONICAL_MARKET_DATA`로 정규화된 값만 사용한다.
- 모든 금액·비율·점수는 exact decimal string이다. 구현은 `BigInt` 유리수로 계산하고 출력 시 소수점 여섯 자리에서 반올림한다.
- `sessionDate`, 개별 종목과 전체 시장 거래대금의 `observedAt`, 정규장 경과 분, 품질 상태가 없는 데이터는 받지 않는다.
- `asOf` 이후의 종목·시장 snapshot은 거부하고 `sessionDate`는 `Asia/Seoul`의 `asOf` 날짜와 일치해야 한다.
- 20일 중앙값은 오늘과 동일한 정규장 경과시간의 누적 거래대금이어야 한다. 오전 10시 누적값을 과거 종일값과 비교하지 않는다.
- KRX/NXT 데이터는 upstream canonical adapter가 중복 체결을 제거한 경우에만 통합한다.

ETF·우선주·SPAC은 주도주·주도 테마 계산에서 제외한다. REIT·기타 보통 지분성 상품은 명시적 security type과 taxonomy 근거가 있을 때만 포함한다.

## 3. 계층형 taxonomy와 mapping

taxonomy는 안정적인 node ID, 한국어 label, `INDUSTRY | THEME | SUBTHEME`, 부모 node를 갖는다. 종목은 가장 구체적으로 확인된 node에 다대다로 연결한다. 하위 node의 기여는 상위 node로 roll-up되지만 같은 종목이 부모와 자식에 모두 mapping돼도 상위에서는 한 번만 계산한다.

복수의 독립 leaf에 걸친 회사는 `allocationWeight`로 노출을 배분한다. 한 시점의 종목별 활성 leaf 배분 합계는 1 이하여야 한다. 같은 node에 복수 근거가 있으면 confidence가 높은 mapping을 사용하고, 동률이면 최신 `asOf`를 사용한다. 이 규칙은 거래대금의 이중 합산을 막기 위한 분석 배분이며 회계상 사업부 매출 비중을 뜻하지 않는다.

각 mapping은 다음을 보존한다.

- `source`와 source document ID, canonical URL
- 근거가 공개·확인된 `asOf`
- `confidence` 0~1
- `validFrom`, nullable `validTo`
- allocation weight

근거 우선순위는 상세 사업 내용과 point-in-time 검증 가능성을 기준으로 다음과 같이 적용한다.

1. OpenDART 사업보고서의 사업의 내용
2. OpenDART 기업개요와 정기보고서 구조화 항목
3. KRX 공식 업종
4. KIND 상장법인 공시·기업 정보
5. 회사 공식 IR

상위 근거가 상세하지 않으면 KRX 업종 같은 coarse node까지만 mapping한다. 기사·소문·커뮤니티·검색 키워드, 또는 함께 상승했다는 사실만으로 영구 편입하지 않는다. 뉴스는 taxonomy 검토 후보를 만들 수 있지만 DART·KRX·KIND·회사 공식 문서 확인 전에는 production mapping이 아니다.

합병, 분할, 주력사업 변경 때 과거 row를 덮어쓰지 않고 `validTo`를 닫고 새 row를 만든다. 분석 cutoff보다 미래인 `asOf` 또는 evidence는 사용할 수 없다.

## 4. 계산

종목 `i`와 테마 `t`의 유효 가중치를 `w(i,t)`라 한다. 하위 node를 상위로 올릴 때 같은 종목·상위 node에는 가장 큰 유효 가중치 하나만 적용한다.

```text
themeTurnover(t) = Σ todayTurnover(i) × w(i,t)
themeMedian20(t) = Σ sameElapsedMedian20(i) × w(i,t)
acceleration(t) = themeTurnover / themeMedian20
marketSharePct(t) = themeTurnover / marketTurnover × 100
breadthPct(t) = 상승 constituent 수 / fresh constituent 수 × 100
topNConcentrationPct(t) = 상위 N개 기여 거래대금 / themeTurnover × 100
```

20일 baseline이 없거나 0인 constituent가 하나라도 있으면 테마 baseline과 acceleration은 N/A다. 시장 거래대금이 0·누락·stale이면 market share와 점수는 N/A다. 현재 거래대금이 0이거나 constituent가 없을 때도 점수를 만들지 않는다.

점수는 0~100 범위다.

```text
market share: min(marketSharePct / 5, 1) × 35
acceleration: clamp((acceleration - 1) / 2, 0, 1) × 30
breadth: breadthPct / 100 × 20
diversity: (1 - top1ConcentrationPct / 100) × 15
```

기본 경계는 70 이상 `LEADING`, 50 이상 `EMERGING`, 35 이상 `ROTATING`, 그 미만 `WEAK`이다. 단 다음 guardrail을 먼저 적용한다.

- `LEADING`은 3개 이상 fresh constituent가 있고 top1 기여가 65% 미만인 `BROAD` 구조에만 허용한다.
- 3개 미만이면 `THIN`이다.
- top1 65% 이상이면 `CONCENTRATED`, 해당 종목이 large-cap이면 `LARGE_CAP_SINGLE_NAME`이다.
- `LARGE_CAP_SINGLE_NAME` 또는 다른 비광범위 구조의 높은 점수는 `ROTATING`으로 낮춰 “한 종목 독주”와 “테마 전반 강세”를 구분한다.
- `EMERGING`은 acceleration 1.5 이상이어야 하며 대형주 한 종목 독주에는 사용하지 않는다.

종목 순위도 당일 거래대금으로 정렬하고 시장 점유율 60점, 가속도 25점, 상승 여부 15점으로 동일한 상태를 만든다. 화면은 종목의 활성 taxonomy 경로를 함께 보여 준다.

## 5. Freshness와 실패 상태

- `AVAILABLE`: 모든 필수 분모와 fresh snapshot을 확보
- `PARTIAL`: 일부 constituent가 stale이거나 시장 데이터가 명시적으로 delayed
- `STALE`: mapping된 constituent가 있지만 fresh snapshot이 하나도 없음
- `N_A`: constituent·baseline·시장 거래대금 같은 필수 계산 입력이 없음

stale 종목은 계산에서 제외하고 제외 사실을 품질 상태로 남긴다. `STALE`과 `N_A`에는 점수와 leadership 상태를 붙이지 않는다. 빈 값, 0분모와 수집 오류를 숫자 0로 치환하지 않으며 무한대 가속도를 만들지 않는다.

## 6. UI projection

주도 테마 표에는 순위, 전체 경로, 상태, 점수, 거래대금, 시장 점유율, 가속도, 상승 breadth, top1/top3 집중도, constituent 수와 freshness를 표시한다. 상위 기여 3개 종목을 펼칠 수 있어야 한다.

예시:

```text
반도체 > 장비  LEADING  82.4
거래대금 1.2조 · 시장 6.1% · 20일 동시간 대비 2.7배
상승 breadth 72% · top1 28% · top3 61% · BROAD
```

대형주 독주는 별도 문구를 사용한다.

```text
전력 > 전력기기  ROTATING · LARGE_CAP_SINGLE_NAME
top1 기여 78% — 테마 전반 강세가 아닌 단일 종목 집중으로 분류
```

## 7. 운영·검증

health projection은 다음을 추적한다.

- KIS ranking 및 snapshot 최근 성공 시각과 stale 비율
- 동일 경과시간 20일 baseline 확보율
- taxonomy orphan·cycle, mapping coverage와 low-confidence 비율
- 미래 `asOf`, 만료 mapping, 근거 없는 mapping
- 종목별 활성 leaf allocation 합계 초과
- 부모·자식과 중복 evidence로 발생한 이중 합산
- ETF·우선주·SPAC 유입
- large-cap top1 65% 이상인데 `BROAD/LEADING`으로 표시된 사례
- 0분모에 점수·상태가 생성된 사례
- 종목별 또는 최신 eligible snapshot 합이 전체 시장 거래대금을 초과한 사례
- 미래 snapshot 또는 stale 전체 시장 거래대금이 점수에 사용된 사례

계약 및 순수 함수 테스트에는 정상적인 광범위 주도 테마, 부모·자식 중복, 복수 테마 allocation 초과, exact decimal 경계, baseline 경과시간 불일치, 시장·baseline 0, stale, ETF 제외, large-cap 단일 종목 독주를 포함한다.
