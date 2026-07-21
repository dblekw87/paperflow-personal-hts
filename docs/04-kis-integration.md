# KIS 데이터 연동

## 1. 역할

KIS는 읽기 전용 시장 데이터 공급자다. 제품이 사용하는 기능은 인증, 현재가, 호가, 체결, 차트, 종목정보, 지수·시장상태, 순위, 수급, 뉴스다. 주문 관련 KIS 엔드포인트는 어댑터 registry와 네트워크 allowlist에 등록하지 않는다.

참조 기준은 `C:\Users\Pangwoo\open-trading-api`의 `examples_user`, `examples_llm`, `stocks_info`, `MCP/Kis Trading MCP/configs`다. 이 설계의 기준 commit은 `885dd4e2f5c37e4f7e23dd63c15555a9967bc7bc`, 확인일은 2026-07-20이다. 공식 샘플은 변경될 수 있으므로 구현 커밋에도 참조 SHA와 확인일을 기록한다.

## 2. 인증 환경

공식 샘플은 REST access token과 WebSocket approval key를 별도로 준비하며 실전/모의 데이터 URL을 구분한다.

```ts
type DataEnvironment = "KIS_PROD_DATA" | "KIS_PAPER_DATA";
type ExecutionMode = "LOCAL_SIMULATION";
```

`ExecutionMode`에는 실전 또는 KIS 모의계좌 주문 옵션을 두지 않는다. 데이터 환경 선택이 주문 환경으로 전파되지 않게 타입을 분리한다.

`KisAuthManager` 책임:

- 환경별 base URL과 key pair 선택
- 동시 token refresh 단일화
- 만료 전 선제 갱신과 인증 실패 1회 재시도
- token 발급 전용 limiter
- 메모리 token 보관과 로그 redaction
- 재시도 불가능한 자격증명 오류와 일시 장애 구분

공식 README는 토큰 재발급을 1분당 1회로 안내하며 모의투자 REST 제한이 더 낮을 수 있다고 경고한다. 정확한 호출 제한을 추측해 하드코딩하지 않고 최신 포털 기준 설정으로 둔다.

## 3. REST 기능 매핑

### 국내

| 제품 기능                   | 공식 샘플 함수                 | API 경로                                                          |
| --------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| 현재가                      | `inquire_price`                | `/uapi/domestic-stock/v1/quotations/inquire-price`                |
| 호가 초기값                 | `inquire_asking_price_exp_ccn` | `/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn` |
| 당일 분봉                   | `inquire_time_itemchartprice`  | `/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice`  |
| 일/주/월/년                 | `inquire_daily_itemchartprice` | `/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice` |
| 등락률 순위                 | `fluctuation`                  | `/uapi/domestic-stock/v1/ranking/fluctuation`                     |
| 거래량·증가율·거래금액 순위 | `volume_rank`                  | `/uapi/domestic-stock/v1/quotations/volume-rank`                  |
| 체결강도 순위               | `volume_power`                 | `/uapi/domestic-stock/v1/ranking/volume-power`                    |
| 시가총액 순위               | `market_cap`                   | `/uapi/domestic-stock/v1/ranking/market-cap`                      |
| 현재가 투자자               | `inquire_investor`             | `/uapi/domestic-stock/v1/quotations/inquire-investor`             |
| 기관·외국인 집계            | `foreign_institution_total`    | `/uapi/domestic-stock/v1/quotations/foreign-institution-total`    |

2026-07-21 실전 읽기 전용 재검증에서 `fluctuation`의
`fid_rank_sort_cls_code`는 상승률 `0`, 하락률 `1`의 한 자리 값으로 확인했다.
네 자리 `0000`은 gateway가 `INVALID INPUT_FILED_SIZE`로 거절한다.
| 상품 정보                   | `search_info`                  | `/uapi/domestic-stock/v1/quotations/search-info`                  |
| 시황/공시 제목              | `news_title`                   | `/uapi/domestic-stock/v1/quotations/news-title`                   |

`volume_rank`의 `fid_blng_cls_code`는 공식 샘플 설명 기준으로 거래량, 거래증가율, 거래회전율, 거래금액, 거래금액회전율 정렬을 선택할 수 있다. 실제 응답 필드와 비교 기준은 Phase 0 fixture로 고정한다.

`tradprt_byamt`는 시장 전체 거래대금 순위가 아니라 한 종목의 체결금액별 매매비중이다. 거래대금 상위 API로 잘못 매핑하지 않는다.

### 미국

| 제품 기능      | 공식 샘플 함수                | API 경로                                                         |
| -------------- | ----------------------------- | ---------------------------------------------------------------- |
| 현재 체결가    | `price`                       | `/uapi/overseas-price/v1/quotations/price`                       |
| 현재가 상세    | `price_detail`                | `/uapi/overseas-price/v1/quotations/price-detail`                |
| 현재 1호가     | `inquire_asking_price`        | `/uapi/overseas-price/v1/quotations/inquire-asking-price`        |
| 분봉           | `inquire_time_itemchartprice` | `/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice` |
| 일/주/월/년    | `inquire_daily_chartprice`    | `/uapi/overseas-price/v1/quotations/inquire-daily-chartprice`    |
| 상승/하락률    | `updown_rate`                 | `/uapi/overseas-stock/v1/ranking/updown-rate`                    |
| 가격 급등락    | `price_fluct`                 | `/uapi/overseas-stock/v1/ranking/price-fluct`                    |
| 거래량 순위    | `trade_vol`                   | `/uapi/overseas-stock/v1/ranking/trade-vol`                      |
| 거래증가율     | `trade_growth`                | `/uapi/overseas-stock/v1/ranking/trade-growth`                   |
| 거래대금 순위  | `trade_pbmn`                  | `/uapi/overseas-stock/v1/ranking/trade-pbmn`                     |
| 거래량 급증    | `volume_surge`                | `/uapi/overseas-stock/v1/ranking/volume-surge`                   |
| 상품 정보      | `search_info`                 | `/uapi/overseas-price/v1/quotations/search-info`                 |
| 해외 속보 제목 | `brknews_title`               | `/uapi/overseas-price/v1/quotations/brknews-title`               |
| 해외 뉴스 제목 | `news_title`                  | `/uapi/overseas-price/v1/quotations/news-title`                  |

제품 runtime은 미국 순위 화면에서 `NAS`·`NYS`·`AMS`를 각각 조회한 뒤 canonical
`NASDAQ`·`NYSE`·`AMEX` 종목으로 합친다. 거래대금·거래량·거래증가율·상승률·하락률은
각 전용 REST 결과만 사용하며 미국 화면에 국내 KRX 순위를 섞지 않는다.

경로와 함수가 공식 샘플과 MCP registry 사이에서 시차를 보일 수 있다. 실제 등록 전 샌드박스 호출, 응답 fixture, 포털 문서를 함께 확인한다.

## 4. WebSocket

국내 공식 샘플에는 KRX 기준 다음 채널이 확인된다.

- 실시간 호가: `asking_price_krx`, TR ID `H0STASP0`
- 실시간 체결: `ccnl_krx`, TR ID `H0STCNT0`
- 통합시장 호가/체결: `H0UNASP0` / `H0UNCNT0`
- 예상체결과 시장 상태: `H0STANC0` / `H0STMKO0`
- KRX/NXT/통합 시장별 함수가 구분되어 있음

해외 공식 샘플의 미국 호가는 `HDFSASP0`, 체결은 `HDFSCNT0`이다. 샘플 설명상 미국 호가는 무료 1호가이며 체결 지연·당일 시가 정정 같은 데이터 특성이 있을 수 있다. 미국 실시간 가능 여부, 지연 표시, 호가 깊이는 계정 권한·거래소에 따라 구현 스파이크에서 다시 검증한다.

2026-07-21 제품 runtime은 `NAS/NYS/AMS + symbol`을 KIS 구독키로 사용하고 이를 각각 `NASDAQ/NYSE/AMEX` canonical venue로 정규화한다. 1호가 이후 깊이는 만들지 않으며 positive ACK를 받은 호가·체결 채널이 모두 fresh할 때만 로컬 모의체결을 허용한다. 실전 읽기 전용 data profile만 사용하고 KIS 주문 endpoint는 연결하지 않는다.

국내·해외 선물 공식 샘플에서 다음 읽기 전용 채널이 확인된다.

| 상품               | 체결 TR    | 호가 TR    | 조건                                 |
| ------------------ | ---------- | ---------- | ------------------------------------ |
| 국내 지수선물 주간 | `H0IFCNT0` | `H0IFASP0` | 공식 샘플상 실전 환경 전용           |
| KRX 야간선물       | `H0MFCNT0` | `H0MFASP0` | 실제 월물·장중 권한 검증             |
| 해외선물옵션       | `HDFFF020` | `HDFFF010` | CME·SGX는 유료 실시간 시세 신청 필수 |

Nasdaq 현물지수 REST, Nasdaq 상장 주식·ETF WebSocket, CME NQ/MNQ 선물 WebSocket은 서로 다른 capability다. NQ·WTI 같은 root symbol은 실제 월물 코드로 resolve한 뒤 구독하고, entitlement·만기·롤오버·세션 상태는 `docs/13-realtime-market-coverage.md`를 따른다.

`KisWebSocketManager` 요구사항:

- 최소 연결 수, heartbeat/PINGPONG
- `(environment, venue, instrumentId, stream)` ref-count 구독
- 화면 이동 debounce와 구독 우선순위
- 자동 재구독, 지수 backoff + jitter
- 원본 frame decoder와 schema 검증
- 중복 제거와 gap/stale 감지
- 재연결 후 REST snapshot 보정
- 구독 수·마지막 수신·재연결 횟수 진단

공식 샘플의 구독 구조는 동시 open 항목 수가 40을 넘는 경우를 차단한다. 이를 공식 계정 한도로 단정하지 말고 Phase 0에서 확인하되, 앱은 처음부터 구독 예산과 우선순위를 가져야 한다.

### 구독 우선순위

1. 현재 열린 종목과 미체결 주문 종목
2. 보유 종목
3. 화면에 보이는 관심종목
4. 나머지 관심종목

전 종목을 WebSocket으로 구독해 순위를 직접 만들지 않는다. 순위는 KIS REST를 polling하고, 사용자가 행을 열 때 해당 종목을 실시간 구독한다.

## 5. REST polling과 캐시

- 현재 열린 패널만 polling한다.
- 동일한 정규화 요청은 dedupe한다.
- 순위 기본 주기는 5~30초 범위의 설정값으로 시작하고 실제 제한 측정 후 조정한다.
- 종목 마스터와 정적 정보는 장기 캐시한다.
- 현재가·호가 snapshot은 짧은 TTL, 일봉은 세션 단위 TTL을 사용한다.
- `EGW00201` 등 제한 오류에는 queue, exponential backoff, jitter를 적용한다.
- 제한 또는 장애 시 마지막 snapshot을 유지하되 `asOf`, `staleAt`, 오류를 함께 보낸다.

### 국내 차트 구현 기준선

2026-07-20에 공식 `open-trading-api` commit `885dd4e2f5c37e4f7e23dd63c15555a9967bc7bc`의 `inquire_time_itemchartprice`와 `inquire_daily_itemchartprice` 예제를 대조했다.

- 당일 분봉은 `FHKST03010200`과 `inquire-time-itemchartprice`를 사용한다. 호출당 최대 30건이고 이전 영업일 분봉은 제공하지 않는다. `FID_INPUT_HOUR_1`을 이전 분으로 이동하며 중복 시각을 제거하는 bounded backward pagination을 사용한다.
- 일봉은 `FHKST03010100`과 `inquire-daily-itemchartprice`를 사용한다. 호출당 최대 100건이고 가장 오래된 영업일 전날로 종료일을 이동하는 bounded backward pagination을 사용한다.
- 시장 분류는 현재 기본 workspace에서 `J`(KRX)로 고정한다. NXT/통합 데이터를 암시적으로 섞지 않는다.
- 공급자 날짜·시간은 `Asia/Seoul` 거래소 시각으로 해석하고 UTC instant를 함께 만든다. 1분봉은 KST 분 경계, 일봉은 KRX 09:00~15:30 세션 경계를 사용한다.
- 분봉 `cntg_vol`은 공급자 보고 거래량이다. 공식 주의사항에 따라 최신 배열 첫 항목은 해당 분의 첫 체결 전까지 이전 분 거래량일 수 있으므로 caveat를 유지한다.
- 분봉 `acml_tr_pbmn`은 개별 봉 거래대금이 아니라 누적 거래대금이다. 이를 봉 거래대금으로 표시하거나 단순 차감하지 않고 `UNAVAILABLE`로 보낸다.
- 일봉 `acml_vol`과 `acml_tr_pbmn`은 해당 영업일의 공급자 보고 거래량·거래대금으로 보존한다. `FID_ORG_ADJ_PRC=0`은 수정주가, `1`은 원주가로 명시한다.
- limiter group은 `KIS_DOMESTIC_QUOTATIONS_CHART`, 제안 cache TTL은 분봉 15초·완료 일봉 6시간이다. 실제 계정 제한을 측정하기 전 호출 한도를 추측하지 않으며 각 page 요청 전에 caller limiter hook을 통과시킨다.

계약은 `src/contracts/market-history.ts`, 어댑터는 `src/kis/domestic-chart.ts`, 익명 fixture와 source contract test는 `tests/fixtures/kis` 및 `tests/domestic-chart.test.ts`에 있다. 이 단계는 1분봉과 일봉만 공급하며 5·15·30·60분봉과 주봉은 검증된 1분/일 데이터에서 별도 집계한다.

## 6. 정규화와 원본 보존

모든 공급자 응답은 KIS 필드 문자열을 그대로 UI에 전달하지 않고 canonical model로 변환한다.

- 빈 문자열, 부호 필드, 암시적 소수점, 시장별 단위를 decoder에서 처리
- 종목 식별자: `KRX:005930`, `NASDAQ:AAPL` 형식
- 거래소 시각과 앱 수신 시각 분리
- 통화와 price scale 명시
- 알 수 없는 값은 0이 아니라 nullable
- 원본 fixture는 비밀정보를 제거해 계약 테스트에 보존

## 7. 종목 마스터

공식 `stocks_info`와 KIS Trading MCP master loader를 참조해 KOSPI, KOSDAQ, KONEX 및 해외 거래소 마스터를 가져올 수 있다. MVP import 대상은 KOSPI, KOSDAQ, NASDAQ, NYSE, AMEX다.

2026-07-21 미국 검색은 공식 `nasmst.cod`, `nysmst.cod`, `amsmst.cod` ZIP을 내려받아 CP949 탭 구분 계약으로 검증한다. 한글명·영문명·ticker를 통합 검색하며 24시간 로컬 cache와 마지막 검증본 fallback을 사용한다. 결과의 `NAS/NYS/AMS`는 각각 `NASDAQ/NYSE/AMEX` canonical venue와 실제 WebSocket 구독키로 함께 전달한다.

마스터 업데이트는 앱 시작을 막지 않는 background job이며 version, source SHA/날짜, row count, checksum을 기록한다. 실패하면 마지막 성공 버전을 유지한다.

## 8. 참조 코드 사용 주의

공식 저장소는 좋은 계약·예제 자료지만 제품 코드로 그대로 복사하지 않는다.

- token cache를 prod/vps와 자격증명별로 분리하고 single-flight refresh를 구현한다.
- YAML과 token 파일 평문 저장 방식을 사용하지 않는다.
- DEBUG/WS 로그의 authorization, secret, approval key, 계좌정보를 제거한다.
- unsubscribe await, reconnect 성공 후 retry reset, 전역 구독 map 같은 수명주기 문제를 새 adapter에서 다시 설계한다.
- 종목 master는 전체 삭제 후 갱신하지 않고 staging table 검증 뒤 transaction swap한다.
- 코드 복사 전 저장소와 하위 디렉터리의 라이선스 적용 범위를 확인한다.
- MCP config는 최신 기능을 모두 포함하지 않는다. `examples_llm`과 공식 포털을 source of truth로 하고 자체 capability registry를 둔다.

## 9. 구현 전 필수 스파이크

1. 국내 현재가 REST와 `H0STASP0`/`H0STCNT0` 단일 종목 연결
2. 미국 NASDAQ 종목의 실시간/지연 체결과 호가 깊이 확인
3. 국내·미국 분봉/일봉 field mapping과 pagination 확인
4. 각 순위 응답에 거래대금·증가율 필드가 실제 포함되는지 fixture 확보
5. 국내/미국 뉴스의 URL, 제공사, 본문 접근 범위 확인
6. 운영 계정 기준 REST/WS 제한 측정과 안전한 기본 주기 결정
7. KRX/NXT/통합 데이터를 MVP에서 어떤 기준으로 표시할지 결정
8. KOSPI200 주간·KRX 야간 선물의 실전 읽기 전용 profile과 장중 frame fixture 확보
9. CME NQ/MNQ·CL/MCL 유료 entitlement 확인 및 positive/negative ACK fixture 확보
10. Nasdaq 현물지수의 전용 WebSocket 부재 여부를 최신 포털에서 재확인하고 REST 지연 정책 결정

검증 전에는 미국 전체 호가 깊이, 뉴스 본문, 정확한 호출 한도, KRX/NXT 통합값, 미신청 해외선물 실시간 수신을 완료 기능으로 약속하지 않는다.

## 10. 공식 자료

- [KIS Developers](https://apiportal.koreainvestment.com/)
- [공식 open-trading-api](https://github.com/koreainvestment/open-trading-api)
- [공식 MCP 소개](https://github.com/koreainvestment/open-trading-api/tree/main/MCP)

시세정보는 개인의 자기 자산 투자 목적 범위에서 사용하고 제3자 제공하지 않는다는 KIS 안내를 전제로 로컬 개인용으로만 설계한다.
