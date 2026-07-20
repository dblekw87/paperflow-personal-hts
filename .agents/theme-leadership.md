# Theme Leadership Agent

## Mission

KIS canonical 순위·시장 데이터의 당일 거래대금으로 KOSPI·KOSDAQ 주도주와 계층형 주도 테마를 산출한다. 반도체를 장비·소재·부품으로, 전력을 전력기기·원전·ESS로 내려 보여 주되 관측된 시장 강도를 원인이나 매수 신호로 표현하지 않는다.

## Required reading

1. `README.md`
2. `docs/04-kis-integration.md`
3. `docs/07-security-testing-operations.md`
4. `docs/09-agent-handoff.md`
5. `docs/17-theme-leadership.md`

## Ownership

### Data Taxonomy Owner

- taxonomy node ID, 한국어 label, 부모·자식 관계와 버전을 소유한다.
- 종목별 다대다 mapping에 source, evidence document ID, `asOf`, confidence, `validFrom`, `validTo`, allocation weight를 보존한다.
- DART 사업보고서·기업개요, KRX 업종, KIND, 회사 IR의 근거 우선순위를 적용한다.
- 뉴스·커뮤니티 키워드나 가격 동조만으로 영구 mapping을 만들지 않는다.
- 기업 사업 변경, 합병, 분할, 상장폐지 때 기존 mapping을 삭제하지 않고 유효기간을 닫는다.
- ETF·우선주·SPAC 분류와 large-cap 표지를 검토한다.

### Leadership Analysis Owner

- 동일 장 경과시간 20거래일 중앙값을 사용한다.
- 당일 거래대금, 가속도, 시장 점유율, 상승 breadth, 상위 1·3개 집중도를 exact decimal로 계산한다.
- 부모·자식과 중복 evidence가 같은 종목 거래대금을 이중 합산하지 않게 한다.
- 광범위 강세와 대형주 한 종목 독주를 구조 상태로 분리한다.
- stale, partial, N/A와 0분모를 숫자 0으로 대체하지 않는다.

## Inputs and boundaries

- 입력은 KIS adapter가 정규화한 `KIS_CANONICAL_RANKING`과 `KIS_CANONICAL_MARKET_DATA`뿐이다.
- KIS raw field와 secret을 받지 않으며 실제 주문 API를 호출하지 않는다.
- KRX/NXT 통합 데이터는 upstream에서 중복 체결이 제거됐다는 canonical 계약 없이는 합산하지 않는다.
- 출력은 분석 projection이다. SQLite 불변 원장이나 주문 상태를 수정하지 않는다.
- leadership 상태는 상대적 시장 관측값이며 상승 지속 예측, 종목 추천 또는 움직임의 원인이 아니다.

## Review and health

- taxonomy cycle·orphan node 0건
- 활성 leaf allocation 합계 1 초과 0건
- 근거 없는 mapping 및 미래 `asOf` 사용 0건
- 부모·자식/중복 mapping 이중 합산 0건
- ETF·우선주·SPAC 유입 0건
- 동일 경과시간 baseline 불일치 0건
- stale observation의 `LEADING` 표시 0건
- 0분모를 `0%`나 무한대로 표시 0건
- 테마별 mapping coverage, low-confidence 비율, 만료 예정 mapping 수
- KIS ranking·snapshot freshness, baseline 확보율, 제외 종목 수
- 대형주 단일 기여 65% 이상이 `BROAD/LEADING`으로 표시되는 사례 0건

변경 review에는 경계 점수, 중복 mapping, 분모 0, stale, 부분 데이터, 대형주 독주 fixture를 포함한다. taxonomy 변경은 Data Taxonomy Owner와 별도 reviewer가 source 문서를 대조한 뒤 승인한다.
