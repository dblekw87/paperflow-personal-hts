# 국내·미국 시장 이벤트 캘린더

## 1. 목적

국내·미국 주식과 시장 전체에 영향을 줄 수 있는 일정형 사건을 하나의
캘린더 계약으로 정규화한다. 캘린더 페이지에서는 현재 선택 종목과 무관하게
국내·미국·글로벌 전체 기업·시장 이벤트를 함께 표시한다. 별도 종목 workspace
패널이 필요한 경우에만 선택 종목의 시장에 맞는 이벤트를 우선 표시한다.

이 기능은 매매 신호가 아니다. 일정, 발표값, 공시, 거래소 조치와 같은
관찰 가능한 사실을 시간순으로 보여주고, 가격 반응과 연결할 때에는 별도
evidence와 observation이 필요하다.

## 2. 이벤트 범위

기업 이벤트:

- 실적 발표, guidance, 컨퍼런스콜, investor day
- 배당 선언, 기준일, ex-dividend, 지급일
- 유상증자, 무상증자, 유무상증자, rights offering
- 액면분할, 액면병합, 감자, 주식소각
- 자사주 취득·처분, 공개매수
- M&A, 분할, 분할합병, 주식교환·이전, 영업양수도, 자산취득·매각
- IPO, 신규상장, 변경상장, 상장폐지, lock-up 해제
- 주주총회, 거래정지, 관리종목·불성실공시 등 거래소·규제 이벤트

거시·시장 구조 이벤트:

- FOMC, 한국은행 금통위, ECB/BOJ 등 주요 중앙은행 금리결정·의사록·연설
- CPI, PPI, PCE, GDP, 고용, 실업률, JOLTS, PMI, 소매판매, 산업생산,
  무역수지, EIA 재고, 국채 입찰
- 국내·미국 옵션만기, 선물만기
- MSCI, Russell, 주요 ETF·지수 리밸런싱
- 정부 정책, 세금, 관세, 수출통제, 산업 규제처럼 시장 영향이 큰 발표

## 3. Canonical Contract

구현 계약은 `src/contracts/market-calendar.ts`가 소유한다.

핵심 필드:

- `kind`: 실적, 배당, 권리락, FOMC, CPI, 옵션만기, 리밸런싱 등 사건 유형
- `marketScope`: 사건의 주 시장 `KR | US | GLOBAL`
- `affectedMarkets`: 캘린더와 종목 workspace 필터에 사용할 영향 시장 목록
- `instrumentIds`: 직접 관련 종목. 전체 시장 이벤트면 빈 배열 가능
- `scheduledAt`, `localDate`, `timezone`: UTC instant와 현지 날짜·시간대
- `status`: 예정, 확정, 발표, 업데이트, 취소, 잠정
- `importance`: 월간 셀 dot과 agenda 정렬에 사용할 중요도
- `provider`, `sourceEventId`, `evidenceIds`: 공급자 중복 제거와 근거 연결
- `dataQuality`: 공식, 거래소·규제, issuer 1차, licensed, aggregated,
  headline-only, delayed, stale, unsupported
- `metrics`: actual, consensus, prior, EPS, revenue, 배당금, 비율, 금액 등을
  exact decimal string으로 저장

원본 이벤트는 불변으로 저장하고, 정정·변경은 새 version 또는
`supersedesEventId`로 연결한다. 발표값이 업데이트되어도 기존 scheduled
event를 조용히 덮어쓰지 않는다.

## 4. 국내 데이터 소스

| 범위 | 기본 소스 | 취급 |
| --- | --- | --- |
| 공시, 증자, 자사주, M&A, 분할, 감자 | OpenDART | 1차 공시. 구조화 API가 있으면 우선 사용하고 목록 keyword만으로 확정하지 않는다. |
| 배당·권리·ex-date·기준일·지급일 | 금융위/예탁원 주식권리일정정보, OpenDART | 공공데이터포털 키로 무료 사용 가능하다. 일 1회 갱신, 공공누리 2유형이므로 비상업 조건을 `DELAYED`/비상업 권리로 표시한다. |
| IPO, 신규상장, 변경상장, 주식발행·소각 | KRX/KIND, OpenDART | KIND 신규상장기업현황의 공식 Excel/HTML endpoint를 우선 사용한다. KRX Data Marketplace에 동일 범위 OPEN API가 확인되면 인증키 기반 adapter로 보강한다. |
| 거래정지·불성실공시·관리종목 | KRX KIND, 거래소 공시 | 거래소·규제 이벤트로 분류하고 원문 링크를 보존한다. |
| 국내 시세 반응 | KIS read-only market data | 가격 반응 observation일 뿐 사건 source로 승격하지 않는다. |
| 한국 경제지표·금리 | BOK ECOS, KOSIS, 기재부, 관세청 | 발표 일정·actual·revision policy를 source별로 보존한다. |

KIS 실제 주문 API는 어떤 캘린더 처리에도 사용하지 않는다. KIS 뉴스 제목은
조기 탐지 신호일 수 있으나 본문 권리가 없으면 `HEADLINE_ONLY`로만 저장한다.

## 5. 미국 데이터 소스

| 범위 | 기본 소스 | 취급 |
| --- | --- | --- |
| SEC 공시, M&A, 8-K, S-4, 13D, 6-K | SEC EDGAR | 공식 1차 소스. CIK와 accession으로 dedupe한다. |
| 상장·상폐·심볼변경·배당·분할·next-day ex-date | Nasdaq Daily List | 공식성이 높지만 계약/유료 성격이므로 권리 상태를 표시한다. |
| NYSE corporate actions | NYSE Corporate Actions | NYSE 그룹 상장 종목 corporate action. |
| 실적·배당·분할·IPO 캘린더 MVP | Alpha Vantage, Financial Modeling Prep, Finnhub | 빠른 MVP용 aggregated source. 공식 공시와 충돌하면 공식 source가 우선이다. |
| 고정밀 corporate events, lock-up, 컨퍼런스콜 | Licensed corporate events provider | Intrinio/Wall Street Horizon/EDI 계열처럼 라이선스 식별자가 있는 경우만 사용한다. |
| 미국 시세 반응 | KIS read-only market data | NASDAQ·NYSE·AMEX 종목과 ETF proxy 반응 observation으로만 사용한다. |

유료 또는 aggregated provider의 예상 실적일·consensus는 공식 1차 사실이
아니다. 화면에는 provider와 권리·지연 상태를 같이 표시한다.

## 6. 글로벌·파생·리밸런싱 소스

| 범위 | 기본 소스 | 취급 |
| --- | --- | --- |
| FOMC, 미국 금리결정, 의사록 | Federal Reserve | 공식 일정과 발표 문서를 version으로 보존한다. |
| CPI, PPI, 고용 등 | BLS | release calendar와 actual을 구분한다. |
| PCE, GDP, personal income | BEA | release schedule과 발표값을 구분한다. |
| EIA 재고 | EIA | 원유·에너지 민감 이벤트로 분류한다. |
| 미국 옵션만기 | Cboe, OCC/NYSE calendar | 상품별 만기 범위와 시간대를 명시한다. |
| CME 선물만기 | CME expiration calendar | 상품 코드, last trade date, delivery date를 구분한다. |
| 국내 옵션·선물만기 | KRX 파생상품 명세 | 상품별 규칙으로 생성하되 휴장일 조정은 KRX 캘린더와 함께 검증한다. |
| MSCI 리밸런싱 | MSCI Index Review | 발표일과 effective date를 분리한다. |
| Russell 리밸런싱 | FTSE Russell/LSEG | preliminary list, lock-down, final, effective를 별도 이벤트로 둔다. |
| ETF 리밸런싱 | ETF issuer 공식 자료 또는 licensed source | ETF별 규칙이 다르므로 추정 생성하지 않는다. |

## 7. 화면 표시 규칙

### 전체 캘린더 페이지

- 월간 grid는 국내·미국·글로벌 이벤트를 모두 표시한다.
- 현재 삼성전자, Apple 등 어떤 종목을 열어둔 상태여도 캘린더 page scope는
  모든 기업·시장 일정이다.
- 날짜 셀에는 긴 제목 대신 중요도 dot, event kind icon, 개수만 표시한다.
- 오른쪽 agenda는 선택 날짜의 이벤트를 현지 발표시각 기준으로 정렬한다.
- `국내`, `미국`, `글로벌`, `기업`, `거시`, `파생`, `리밸런싱`, `중요도`,
  `공식/집계/지연` 필터를 제공한다.
- 날짜를 누르면 그날의 모든 이벤트를 시간순으로 보여주고, 발표 전·발표 후
  상태를 분리한다.
- actual/consensus/prior가 있는 이벤트는 발표 전에는 consensus/prior만,
  발표 후에는 actual과 surprise를 표시한다. consensus 권리가 없으면
  surprise를 만들지 않는다.

### 별도 종목 workspace

- 캘린더 page가 아닌 별도 종목 패널에서는 `KRX:*` 또는 `NXT:*` 종목은 국내
  이벤트와 `GLOBAL` 이벤트만 표시한다.
- `NASDAQ:*`, `NYSE:*`, `AMEX:*`, `NYSEARCA:*` 종목은 미국 이벤트와
  `GLOBAL` 이벤트만 표시한다.
- `instrumentIds`에 선택 종목이 직접 포함된 이벤트는 항상 우선 표시한다.
- 시장 전체 이벤트는 `affectedMarkets`가 선택 종목 시장과 일치할 때만
  표시한다.
- 예: 삼성전자 화면에는 DART·KIND·권리일정·한국은행·국내 만기·MSCI 한국
  관련 이벤트와 글로벌 FOMC/CPI를 보여준다. Apple 화면에는 SEC·Nasdaq/NYSE
  corporate actions·미국 실적·FOMC/CPI·미국 옵션만기를 보여준다.
- 국내 종목 화면에 미국 개별 기업 실적을, 미국 종목 화면에 국내 개별 기업
  공시를 기본 노출하지 않는다. 사용자가 전체 캘린더 필터를 켰을 때만 보인다.

### 이벤트 상세

- 원문 링크, provider, sourceEventId, evidence ID, 공개·수신·감지 시각을 표시한다.
- dataQuality가 `DELAYED`, `STALE`, `HEADLINE_ONLY`, `UNSUPPORTED`이면 제목
  옆에 숨기지 않고 표시한다.
- 이벤트 marker는 차트에 표시할 수 있지만 매수·매도 신호로 표현하지 않는다.

## 8. 저장·동기화

- `market_calendar_events`는 provider identity와 event ID로 dedupe한다.
- `calendar_evidence`는 source document hash, rights, headline-only 여부를 보존한다.
- `calendar_event_versions` 또는 `supersedesEventId`로 일정 변경·정정·취소를 추적한다.
- 날짜별 projection은 재구축 가능해야 하며 원본 이벤트를 덮어쓰지 않는다.
- provider cursor와 polling checkpoint는 SQLite에 저장하되 renderer에 노출하지 않는다.

현재 연결된 provider adapter:

- `src/calendar/federal-reserve-fomc-client.ts`: Federal Reserve 공식 HTML에서
  FOMC 결정일을 `US_FEDERAL_RESERVE`/`OFFICIAL` 이벤트로 정규화한다.
- `src/calendar/bls-release-calendar-client.ts`: BLS 공식 `bls.ics` 온라인 캘린더에서
  CPI, PPI, 고용, JOLTS 등 주요 release를 `US_BLS`/`OFFICIAL` 이벤트로 정규화한다.
- `src/calendar/bea-release-schedule-client.ts`: BEA release schedule HTML에서 GDP,
  PCE, 무역수지 release를 `US_BEA`/`OFFICIAL` 이벤트로 정규화한다.
- `src/calendar/open-dart-calendar-adapter.ts`: 기존 OpenDART filing client 결과를
  국내 기업 이벤트로 변환한다. `DART_CRTFC_KEY`가 없으면 runtime은 미설정 상태로
  건너뛴다.
- `src/calendar/ksd-rights-schedule-client.ts`: 금융위원회_주식권리일정정보
  `getRighExerReasSche_V2`를 공공데이터포털 키로 호출해 예탁원 연계 권리일정을
  `KSD_RIGHTS_SCHEDULE`/`DELAYED` 이벤트로 정규화한다. `DATA_GO_KR_SERVICE_KEY`가
  없으면 runtime은 미설정 상태로 건너뛴다.
- `src/calendar/kind-listing-schedule-client.ts`: KIND 신규상장기업현황의 공식
  Excel/HTML POST endpoint를 호출해 신규상장·이전상장·재상장 일정을
  `KIND_KRX`/`REGULATOR_EXCHANGE` 이벤트로 정규화한다.

`LocalMarketCalendarRepository`가 SQLite에 `INSERT OR IGNORE`로 ingest한다.
Electron 런타임은 provider별 수신/실패/미설정 상태를 status message에 남기고,
저장된 provider 이벤트가 없으면 fixture projection으로 폴백한다.

## 9. Health와 테스트

- provider별 최근 성공·실패·지연·권리 상태
- 국내/미국 종목별 필터가 다른 시장 개별 기업 이벤트를 섞지 않는지
- `scheduledAt`, `localDate`, `timezone` 불일치
- evidence 없는 이벤트, 알 수 없는 metric evidence
- KIS 뉴스 제목을 공식 이벤트로 승격하는 오류
- 비상업 공공데이터 권리 상태 누락
- unsupported provider를 confirmed로 표시하는 오류
- calendar 변경 후 old version이 point-in-time replay에 남는지

## 10. MVP 순서

1. `src/contracts/market-calendar.ts` 계약과 fixture 기반 contract test
2. 전체 캘린더 페이지 mock projection과 국내/미국 workspace 필터
3. Federal Reserve FOMC 공식 일정 adapter
4. BLS, BEA 공식 일정 adapter
5. OpenDART 주요사항 calendar adapter
6. 금융위/예탁원 권리일정 adapter
7. BOK 공식 일정, KIND 상장 일정 adapter
8. 미국 실적·배당·IPO aggregated adapter
9. SEC/Nasdaq/NYSE 공식 corporate action 보강
10. 차트 marker와 움직임 설명 observation 연결
