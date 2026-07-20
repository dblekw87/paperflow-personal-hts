# 에이전트 개발 인계서

## 1. 읽는 순서

1. 루트 `README.md`
2. `docs/01-product-requirements.md`
3. 담당 영역 문서
4. `docs/adr/001-direct-kis-runtime.md`
5. `docs/07-security-testing-operations.md`

요구사항과 구현이 충돌하면 임의로 넓히지 말고 ADR 또는 문서 변경 제안을 먼저 남긴다.

## 2. 절대 불변식

- KIS 실제 주문 API를 호출하지 않는다.
- 가상 계좌의 단일 진실 공급원은 로컬 SQLite다.
- renderer에 KIS 비밀키, token, DB, Node API를 노출하지 않는다.
- 금융 금액을 영속 `number`/float로 저장하지 않는다.
- 시장·통화·원천·기준 시각 없는 시세를 도메인에 넣지 않는다.
- stale 데이터를 live처럼 표시하거나 체결에 사용하지 않는다.
- “왜 움직였나”에서 evidence 없는 원인을 만들지 않는다.
- 뉴스 본문을 권한 없이 수집·재배포하지 않는다.

## 3. 작업 경계

### Desktop shell

main/preload 경계, 창, IPC/MessagePort 전달, credential vault, process supervision을 소유한다. renderer feature UI는 Frontend UI owner가 소유한다.

### Frontend UI

React renderer, route/workspace, design system, 접근성, virtualization, fixture gallery를 소유한다. canonical contract와 preload allowlist만 사용하며 KIS raw field·DB·Node API를 사용하지 않는다. preload 계약 변경은 Desktop shell owner와 함께 승인한다.

공유 UI는 atom → molecule → organism → template → feature/page 순서로 조합한다. atom/molecule에는 query·stream·DB·주문 상태를 넣지 않으며 organism은 canonical view model과 callback만 입력받는다. dark/light/system 테마는 semantic token으로 제공하고 두 테마의 Storybook·접근성·시각 회귀를 함께 통과해야 한다.

### KIS adapter

공식 샘플과 포털을 근거로 auth, REST, WS, decoder, pagination, limiter를 소유한다. KIS 원본 명칭이 이 패키지 밖으로 새지 않게 한다.

### Derivatives market data

국내 주간·KRX 야간 선물과 해외 지수·원유 선물의 종목 마스터, 실제 월물, entitlement, 세션, decoder를 소유한다. 현물지수·ETF·선물·연속선물을 혼합하지 않으며 파생상품 모의체결 엔진이 완성되기 전 주문을 활성화하지 않는다.

### Market data

canonical event, subscription, latest projection, candle, ranking, stale/gap을 소유한다. 주문 상태를 직접 변경하지 않는다.

NXT 작업자는 `H0NXASP0`·`H0NXCNT0`·`H0NXMKO0`을 venue-specific 세트로 다룬다. 통합 `H0UNASP0/H0UNCNT0`을 SOR나 queue 체결 근거로 사용하지 않는다. 2026-07-20 paper 관측 NXT 호가는 공식 65필드가 아니라 62필드였으므로 두 exact layout을 분리하고, 장상태/VI·per-venue projection·security-level position migration 전까지 `paperFillEligible=false`를 유지한다. `npm run probe:nxt`의 ACK·record·parseErrors를 handoff evidence로 첨부한다.

Frontend 작업자는 중앙 10호가 배열의 왼쪽을 로컬 모의매도, 오른쪽을 로컬 모의매수 영역으로 유지한다. 실제 Electron 모드에는 fixture 가격을 fallback하지 않는다. 왼쪽 navigation의 시장·순위·포트폴리오·주문/체결·뉴스/공시·노트·보안·설정은 실제 page state를 가져야 하며, provider 미연결 페이지는 합성 수치 대신 명시적인 빈 상태를 표시한다.

2026-07-20 UI 기준선은 기본 1800×1040, 최소 1366×800, 본문·표·입력 14px 중심이다. 1350px 이하에서는 3열을 강제하지 않고 호가·차트 2열 뒤 주문 티켓을 전체 폭 다음 행으로 이동한다.

종목 순위 페이지의 `TURNOVER`, `AVERAGE_VOLUME`, `VOLUME_INCREASE`는 KIS `volume-rank`(`FHPST01710000`)의 실제 읽기 전용 응답만 표시한다. KIS paper에서 실제 응답을 확인했다. 실전 데이터 키로 `fluctuation`(`FHPST01700000`), 국내 뉴스(`FHKST01011800`), 해외 뉴스(`HHPSTH60100C1`) 응답을 검증하고 익명 fixture와 읽기 전용 adapter를 추가했다. 뉴스는 로컬 SQLite v5 정보 피드와 Electron 뉴스·공시 페이지에 연결됐고, 등락률 adapter의 순위 UI 연결은 후속 범위다.

### Simulation

주문 검증, state machine, fill model, ledger, P&L을 소유한다. KIS client에 의존하지 않고 canonical market snapshot만 입력받는다.

호가 기반 체결은 `docs/18-orderbook-paper-trading.md`를 따른다. 초기 지정가는 실제 체결가가 limit에 도달/통과한 관측 수량에서만 채우며, 고급 queue 추정은 `QUEUE_ESTIMATED`를 숨기지 않는다.

### Instrument chart

KIS canonical candle/OHLCV·거래량·거래대금 projection과 로컬 paper fill marker의 결합 view model을 소유한다. 동일 종목의 차트·호가 동시 표시, 사용자 SMA/EMA, session 배경, marker replay는 `docs/20-instrument-chart-and-workspace.md`를 따른다. 당일 1·5·15·30·60분/4시간과 6개월·1년·5년 일·주봉 조합, `interval:range` 응답 경쟁 차단, 5년 일봉 성능 evidence도 이 에이전트의 책임이다. 시장 candle을 로컬 fill로 수정하지 않는다.

### Theme leadership

계층형 산업·테마 taxonomy, 근거가 있는 종목 매핑, 거래대금 가속도·시장 점유율·breadth·집중도 분석을 소유한다. 부모·자식과 중복 매핑을 이중합산하지 않고 stale·N/A와 단일 대형주 독주를 명시한다.

### Storage

schema, migration, repository, transaction, outbox, backup을 소유한다. 한 transaction으로 보장할 aggregate 변경을 분리하지 않는다.

### News/explanation

provider, 권리 메타데이터, 중복, evidence, confidence를 소유한다. source 없는 자연어 생성은 금지한다.

### Disclosure

SEC EDGAR/OpenDART watcher, filing dedupe, event 분류, 한국어 번역 queue를 소유한다. 공시 원문 수신은 번역 완료에 종속되지 않으며 provider policy를 지킨다.

### Catalyst analysis

MoveEpisode와 정규화된 공시·거래소 조치만 입력받아 KOSPI·KOSDAQ 및 미국 소형주의 근거 기반 설명과 급등 위험 신호를 만든다. 원문 수집을 소유하지 않으며 point-in-time cutoff 이후 자료를 사용하지 않는다.

### Cross-market signal

Hyperliquid XYZ의 한국주식·원유 HIP-3 공개 시세를 읽기 전용으로 수집해 KIS 시장 데이터와 비교한다. 온체인 TradFi perp를 KRX/CME 공식 가격으로 표시하지 않고 유동성·세션·mapping guardrail을 통과한 보조 신호만 만든다.

### Global event analysis

KIS 해외뉴스 제목과 공식 기관·거래소·기업 자료에서 금리·물가·고용·성장·환율·유동성·재정·무역·원자재·신용·정책·지정학·재난·기업·기술 사건을 정규화하고 한국어 번역과 point-in-time 시장 반응을 연결한다. actual/consensus/prior/revision과 coverage 상태를 보존한다. Reuters 본문을 라이선스 없이 수집하지 않으며, 사건과 KOSPI·KOSDAQ·환율·proxy·업종 반응의 상관관계를 확정 인과로 승격하지 않는다.

## 4. 구현 작업의 Definition of Done

- 요구사항 ID 또는 문서 절을 이슈/PR에 연결
- TypeScript strict와 public contract schema
- 정상·경계·실패 단위 테스트
- KIS 변경이면 익명 fixture와 contract test
- DB 변경이면 forward migration, backup 영향, rebuild 검증
- IPC 변경이면 preload allowlist와 sender/schema 검증
- 오류 code, retryable 여부, stale 처리
- 로그 redaction 확인
- 관련 문서와 ADR 업데이트
- 실제 주문 endpoint 금지 테스트 통과

## 5. KIS 변경 절차

1. 최신 공식 샘플 commit과 포털을 확인한다.
2. endpoint path, TR ID, 필수 파라미터, pagination, 환경 차이를 기록한다.
3. 비밀 제거 raw fixture를 저장한다.
4. decoder와 canonical schema contract test를 먼저 만든다.
5. rate limiter group과 cache TTL을 지정한다.
6. 빈 응답, 오류, 필드 누락, 지연 상태를 구현한다.
7. 제품 문서의 API map과 검증일을 갱신한다.

MCP가 알려준 코드만으로 완료 처리하지 않고 공식 샘플/실제 fixture와 대조한다.

## 6. DB 변경 절차

1. 불변 원장인지 projection인지 먼저 결정한다.
2. unique/idempotency/foreign key를 정의한다.
3. 금액 scale과 rounding policy를 정의한다.
4. migration 전 backup과 실패 rollback을 고려한다.
5. ledger에서 projection rebuild가 가능한지 테스트한다.
6. crash 중간 지점을 주입해 transaction 원자성을 검증한다.

## 7. 병렬 작업 규칙

병렬화 가능한 경계:

- fixture 기반 KIS decoder와 renderer mock UI
- domain contract와 DB migration
- 국내 adapter와 미국 데이터 spike
- 뉴스 provider와 규칙 기반 evidence engine

같은 schema/contract 파일을 여러 작업이 동시에 바꾸지 않는다. contract owner가 먼저 interface를 확정하고 consumer는 fixture/mock으로 진행한다.

## 8. 초기 결정이 필요한 열린 항목

Phase 0에서 근거를 확보해 결정한다.

- KRX/NXT/통합 중 국내 기본 시세 기준
- 미국 실시간/지연 권한과 호가 깊이
- 운영 계정별 안전한 REST polling 기본값
- 미국 뉴스 URL·본문 제공 범위
- 국내 거래대금 증가율의 기준 데이터 확보 방식
- 정규장 밖 데이터를 차트에는 보이되 체결에는 제외할지
- KIS 실전 읽기 전용 시세 profile과 CME 유료 실시간 entitlement 확보
- MVP 결제를 즉시 처리할지 settlement projection만 분리할지
- 평가 환율 공급원과 갱신 주기

## 9. 금지된 지름길

- KIS raw payload를 renderer에서 직접 파싱
- 모든 IPC를 받는 범용 `invoke(channel, payload)`
- `.env` 또는 source에 App Secret 저장
- 전체 종목 WebSocket 구독으로 순위 생성
- 마지막 체결가를 아무 표시 없이 시장가 fill로 사용
- 잔고를 원장 없이 직접 수정
- 미국 시각을 고정 KST offset으로 계산
- 빈 값/오류를 숫자 0으로 대체
- 설명을 먼저 생성하고 나중에 근거를 끼워 맞추기
