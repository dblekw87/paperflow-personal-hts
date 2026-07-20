# 개발 로드맵

일정 추정보다 검증 가능한 vertical slice와 exit criteria로 관리한다. 각 단계는 이전 단계의 계약·테스트를 통과해야 완료다.

## Phase 0. 기술 스파이크와 계약 고정

### 결과물

- 설계 기준 `885dd4e2f5c37e4f7e23dd63c15555a9967bc7bc` 이후 공식 샘플 변경 diff 기록
- 국내 현재가 REST
- 국내 단일 종목 KRX 호가/체결 WebSocket
- 미국 NASDAQ 종목의 실시간 또는 지연 데이터/호가 깊이 확인
- KOSPI200 주간·KRX 야간·NQ/MNQ·CL/MCL capability/entitlement 매트릭스
- 국내·미국 분봉과 순위·뉴스 응답 fixture
- 호출 제한과 재연결 관찰 보고서
- KRX/NXT/통합 표시 결정

### Exit

- 비밀 제거 fixture와 canonical schema가 review됨
- 미국 실시간/지연·호가 제공 범위를 UI 문구로 확정
- 모르는 호출 제한을 하드코딩하지 않는 limiter 설정 방식 확정
- 파생상품별 실시간/제한/미지원 상태와 장중 fixture 확보 계획 확정

## Phase 1. 앱 기반과 보안 경계

### 결과물

- Electron main/preload/renderer/utility process
- typed IPC와 Result/error 계약
- safeStorage credential vault
- SQLite migration, WAL, backup skeleton
- health/diagnostic 화면
- demo fixture mode

### Exit

- renderer에서 Node, DB, KIS secret에 접근할 수 없음
- IPC schema validation과 sender 검증 테스트 통과
- 앱 강제 종료 뒤 DB integrity 통과

## Phase 2. 국내 시장 관찰

### 결과물

- 국내 종목 마스터·검색
- 현재가, 호가, 실시간 체결
- 분봉/일봉 backfill과 실시간 봉
- 등락률·거래량·거래대금·체결강도 순위
- OHLCV·거래대금 패널, 사용자 SMA/EMA, 로컬 fill marker 차트 계약
- 거래대금 가속도·점유율·breadth·집중도 기반 주도주·주도 테마
- 관심종목과 구독 manager
- 연결/stale 상태

### Exit

- 단절→재연결→재구독→snapshot 보정 E2E 통과
- 현재가와 진행 candle이 같은 tick으로 일치
- 순위마다 source, 기준, as-of가 표시
- 같은 종목의 차트·호가창이 최소 지원 viewport에서 항상 동시에 보임
- 주도 테마 결과가 point-in-time·중복방지·stale fixture를 통과

## Phase 3. 로컬 모의투자

### 결과물

- KRW 가상 계좌·현금 원장
- 시장가/지정가, 매수/매도, 취소, 부분체결
- `BOOK_DEPTH_V1`
- `INITIAL_CONSERVATIVE_V1` 실제 체결가 도달 지정가와 선택적 `ADVANCED_QUEUE_V1`
- 포지션, 평균단가, 실현/미실현 손익
- 주문·체결 화면과 감사 이벤트

### Exit

- 주문/fill/cash/position/outbox 원자성 테스트
- replay 결정성·원장 불변식 테스트
- KIS 주문 endpoint 호출 0회 검증
- 재시작 뒤 동일 계좌 상태
- 주문·fill 원장에서 복원한 매수·매도·부분체결 차트 마커가 replay와 일치

## Phase 4. 미국 시장과 다중 통화

### 결과물

- NASDAQ·NYSE·AMEX 마스터와 검색
- 현재가, 지원 범위 호가/체결, 차트, 순위
- USD 현금 원장과 가상 환전
- DST/휴장/반일장
- FX 기반 KRW 환산 valuation

### Exit

- venue time과 KST 표시가 DST 경계 테스트 통과
- USD 원장과 KRW 환산 projection이 분리됨
- 제한된 호가/지연 데이터가 UI에 정확히 표시됨

## Phase 4A. 실시간 지수·선물 시장 컨텍스트

### 결과물

- KOSPI·KOSDAQ·KOSPI200 현물지수와 KOSPI200 주간 선물
- KRX 야간 KOSPI200 선물
- Nasdaq 현물지수 REST와 NQ/MNQ 해외선물 WebSocket 분리
- WTI CL/MCL 및 권한이 확인된 원유 선물
- 무료 기본 QQQ·IWM·USO `PROXY_LIVE` 시장 컨텍스트
- 실제 월물 resolver, 만기·롤오버, 거래소 세션·DST
- entitlement-aware health와 시장 상단 스트립

### Exit

- 모든 WebSocket 채널의 positive ACK와 요청 월물 canonical frame을 확인해야 live로 표시
- CME 권한 미신청은 `RESTRICTED`, 현물지수 REST는 `DELAYED` 또는 polling 상태로 표시
- KRX 주간·야간과 해외선물 장중 익명 fixture replay 통과
- 파생상품은 별도 증거금·정산 엔진 전까지 분석 전용이며 주문 버튼 비활성

## Phase 5. 뉴스·시황·움직임 설명

### 결과물

- KIS 국내/해외 뉴스 제목 adapter
- SEC EDGAR·OpenDART 신규 공시 watcher
- 인수·합병·자산취득/매각 등 공시 event classifier
- KOSPI·KOSDAQ·미국 소형주 move episode와 catalyst/risk assessment
- 미국 공시 한국어 번역 queue와 원문/번역 전환
- 뉴스 중복·종목 연결·원문 링크
- 시장/업종/수급/뉴스 evidence bundle
- 지정학·금리·물가·고용·성장·환율·유동성·재정·무역·원자재·신용·정책·재난·기술 변화 글로벌 event timeline
- 미국·한국 시장의 point-in-time 반응과 한국어 번역
- 규칙 기반 possible factor와 confidence
- 근거에서 차트/뉴스로 이동

### Exit

- evidence 없는 주장을 생성하지 않음
- stale 데이터만으로 medium/high confidence가 나오지 않음
- 뉴스 권한 수준에 맞는 저장·표시
- 새 공시는 번역 지연과 관계없이 먼저 표시되고 provider filing ID로 중복 제거됨
- point-in-time replay에서 미래 공시 누출과 evidence 없는 원인 claim이 0건
- 글로벌 사건의 공식 사실·예상 대비 surprise·전달 경로·시장 동시 반응·counter-evidence가 분리되고 Reuters 비라이선스 수집이 0건

## Phase 5A. 장외 교차시장 보조지표

### 결과물

- Hyperliquid XYZ metadata discovery와 읽기 전용 REST/WebSocket
- 삼성전자·SK하이닉스·현대차·EWY·KR200 mapping
- WTI·Brent perp와 USO 교차 비교
- external/internal 세션, 유동성·stale·ADS 괴리 guardrail
- 시초가·5분·종가 별 walk-forward 평가

### Exit

- `/exchange`, wallet, private key와 signed action 0건
- instrument annotation·단위가 바뀌면 신호가 자동 중단됨
- 유동성·freshness 미달은 `NO_SIGNAL`
- 미래 데이터 누출 0건과 baseline 대비 out-of-sample 결과 공개
- 성능 미달이면 방향 badge 없이 원시 시장지표만 표시

## Phase 6. 안정화와 개인 배포

### 결과물

- soak/load/crash recovery 결과
- 로그 redaction 검증
- DB backup/restore UI
- Windows installer와 서명 전략
- 운영 runbook, known limitations

### Exit

- 6시간 WebSocket soak에서 자동 복구
- 복원 후 ledger/projection 일치
- secret scan과 금지 주문 endpoint scan 통과
- MVP 수용 기준 전체 통과

## 후속 후보

- 저장 가능한 멀티 패널 HTS 레이아웃
- 프리마켓·애프터마켓 모의체결
- 알림과 조건 검색
- 거래 녹화·재생과 상세 매매일지
- 전략 백테스트와 로컬 모의 자동매매
- 복수 가상 계좌
- 정식 뉴스 공급자와 선택적 LLM 요약
- 기업행사·배당·분할 반영

## 초기 이슈 백로그

1. `contracts`: Money/Price/Quantity/Instant schema
2. `storage`: 최초 migration과 ledger 불변식
3. `desktop`: secure BrowserWindow + preload API
4. `kis-auth`: token/approval key manager
5. `kis-rest`: 국내 현재가 adapter + fixture
6. `kis-ws`: `H0STASP0`/`H0STCNT0` decoder
7. `market-data`: ref-count subscription manager
8. `chart`: REST backfill + 1m aggregator
9. `rankings`: 국내 fluctuation/volume adapter
10. `simulation`: order state machine + `BOOK_DEPTH_V1`
11. `portfolio`: cash/position projection
12. `us-spike`: 미국 데이터 권한·지연·호가 깊이 보고서
13. `derivatives-spike`: KRX 주·야간, NQ/MNQ, CL/MCL entitlement와 장중 fixture

각 이슈는 schema, fixture, 테스트, 오류 상태, 문서 변경을 함께 포함한다.
