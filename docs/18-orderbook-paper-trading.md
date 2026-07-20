# 실제 호가 기반 로컬 모의주문

## 1. 목적과 안전 경계

이 기능은 KIS에서 수신해 canonical 계약으로 정규화한 실제 호가·체결을 보면서 실제와 유사한 주문 흐름을 연습하게 한다. 주문, 예약 현금, 보유수량, 모의 체결, 수수료, 세금, 손익은 로컬 SQLite에만 존재한다.

KIS는 읽기 전용 시장 데이터 공급자다. 이 영역은 증권사 주문 기능, 주문 식별자, 주문용 네트워크 경로, 실제 계좌 잔고를 알지 못하며 호출하지 않는다. renderer는 canonical `OrderBookSnapshot`·`TradeTick`과 허용된 로컬 모의주문 IPC만 사용한다. 화면의 모든 주문 affordance에는 `로컬 모의주문`을 지속 표시한다.

## 2. 한 종목 workspace UI 불변식

종목 상세는 하나의 `instrumentId` context를 공유하는 단일 페이지다. 다음 패널은 route 이동이나 symbol context 변경 없이 함께 동작한다.

- 실시간 호가창과 차트는 항상 동시에 보인다. 좁은 창에서도 하나를 숨기지 않고 split ratio, 행 높이, 글자 밀도만 조정한다.
- 주문 티켓, 현재가, 거래량·거래대금, 최근 체결, 로컬 보유·미체결, 뉴스·공시, 근거 기반 `왜 움직였나`도 동일 `instrumentId`를 사용한다.
- 중앙 호가 행 클릭은 주문 초안만 바꾸며 route, 선택 종목, 차트 viewport를 바꾸지 않는다.
- 중앙 10호가 배열의 왼쪽에는 매도, 오른쪽에는 매수 로컬 주문 영역을 둔다. 양쪽은 수량과 선택 지정가를 보여주며 버튼에는 `모의`와 `실제 주문 전송 없음`을 표시한다.
- 차트는 실제 시장 데이터의 candle/OHLCV, 거래량, 거래대금과 사용자가 설정한 이동평균선을 표시한다.
- 주문·체결 overlay는 시장 데이터와 별도 layer다. 매수는 위쪽 삼각형, 매도는 아래쪽 삼각형, 부분체결은 분할 marker와 `체결수량/주문수량`, 취소 잔량은 회색 테두리로 표시한다. marker tooltip은 로컬 주문 여부, 가격, 수량, 시각, fill model, market event ID를 제공한다.
- 주문 marker는 주문가를, 체결 marker는 실제 모의체결가를 뜻한다. 시장 candle의 원본 OHLCV를 수정하지 않는다. chart replay도 로컬 이벤트와 시장 이벤트를 각각의 event ID로 결합한다.

호가창의 ask 행을 누르면 해당 가격의 `BUY LIMIT`, bid 행을 누르면 `SELL LIMIT` 초안이 된다. 기본값은 확인 ticket이다. one-click은 사용자가 별도 조작으로 arm하고 유효시간이 남은 동안에만 가능하며 `ONE_CLICK_ARMED · 로컬`을 표시한다. 종목 변경, 세션 변경, stale 전환, 앱 잠금 때 arm을 즉시 해제한다.

## 3. 데이터 계약과 capability

체결 엔진 입력은 KIS raw payload가 아니라 `src/contracts/market.ts`의 canonical snapshot/tick을 감싼 `CanonicalOrderBookEvent`와 `CanonicalTradeEvent`뿐이다. 이벤트에는 `instrumentId`, venue, currency, source time, receive time, freshness, sequence, session key, trading phase, market event ID가 있어야 한다.

현재 검증된 호가 깊이 차이는 capability로 노출한다.

| 범위      | 읽기 전용 시세 계약 |  bid/ask 깊이 | 제품 의미                                      |
| --------- | ------------------- | ------------: | ---------------------------------------------- |
| 국내 KRX  | `H0STASP0`          |     각 10단계 | 보이는 10단계 안에서만 시장가 depth walk       |
| 국내 NXT  | `H0NXASP0`          |     각 10단계 | 현재 표시·진단 전용, 장상태 adapter 전 fill 금지 |
| 미국 주식 | `HDFSASP0`          | 현재 각 1단계 | 1단계 이후 잔량·VWAP을 추정하지 않고 잔량 처리 |

미국 1단계를 국내 10단계처럼 보간하지 않는다. capability가 바뀌면 익명 raw fixture와 canonical contract test를 먼저 갱신한다. snapshot의 표시 잔량에 로컬 주문 수량을 삽입하지 않는다.

`LIVE`이고 허용 age 이내인 이벤트만 체결에 쓴다. stale, delayed, occurredAt 누락, out-of-order/duplicate sequence, instrument·venue·currency mismatch를 거부한다. sequence cursor는 `instrumentId + sessionKey` scope와 항상 함께 존재해야 하며 scope 없는 cursor나 cursor 없는 scope는 계약 오류다. 세션 key나 종목 변경 시 order book, queue estimate, dedupe cursor를 reset한다.

가격·금액은 exact decimal 문자열, 수량은 정수 문자열이다. venue별 tick 정책은 `FIXED` 또는 가격대별 `BANDED` 표로 주입하며 venue, 시행 시작·종료 시각, 정책 version을 가진다. 가격대 표는 정렬되고 빈 구간 없이 이어지며 마지막 구간은 open-ended여야 한다. 따라서 KRX 제도 변경값을 엔진에 하드코딩하지 않고 검증된 시점별 표로 교체할 수 있고, 미국·기타 시장은 고정 tick을 유지할 수 있다. 당일 상·하한/허용 가격 범위도 canonical policy로 주입하며 범위 밖 가격, 정책 유효기간·venue 불일치, tick 불일치는 접수·체결하지 않는다.

## 4. 주문 상태와 로컬 처리

```text
DRAFT
  -> REJECTED
  -> ACCEPTED
       -> RESTING
       -> PARTIALLY_FILLED -> FILLED
       -> PARTIALLY_FILLED_CANCELLED
       -> CANCELLED
```

`clientOrderId`는 계좌 범위 unique다. 같은 ID의 재시도는 새로운 fill이나 원장을 만들지 않는다. 취소는 open 잔량에 대한 로컬 명령이며 외부 전송이 없다.

접수 전에 main-process의 검증형 orchestration이 fill planner가 직접 계산한 visible-depth 원금(지정가는 전체 주문수량 × limit 예약액)과 fee/tax reserve를 사용해 가용 현금·보유량을 검사한다. renderer나 caller가 전달한 예상 원금을 신뢰하지 않는다. 이어 DB transaction owner가 같은 transaction 안에서 최신 가용 현금·예약 현금, 가용 보유량·예약 수량을 다시 검증하고 예약한 뒤에만 접수와 fill을 커밋한다. 매수는 필요액을 초과하면, 매도는 가용 보유수량을 초과하면 side effect 없이 거부한다. 공매도는 별도 기능이 완성되기 전 금지다. 실제 장 운영시간과 휴장 calendar가 생성한 trading phase가 체결 가능 상태가 아니면 주문을 체결하지 않는다.

fill planner는 불변 원장을 직접 쓰지 않는다. `FILL_AND_LEDGER_COMMIT_REQUESTED` 계획 이벤트를 만들고 fee와 tax를 별도 ledger event로 계획한다. Storage owner가 주문·fill·현금 원장·position lot·projection·domain/outbox event를 하나의 SQLite transaction으로 커밋한다. 중간 실패 시 전부 rollback한다.

## 5. `INITIAL_CONSERVATIVE_V1`

초기 기본 프로필이다.

- 시장가 매수는 ask를 낮은 가격부터, 시장가 매도는 bid를 높은 가격부터 소비한다. 보이는 depth까지만 가격우선 부분체결한다.
- 시장가의 depth 부족 잔량은 `INSUFFICIENT_VISIBLE_DEPTH`로 즉시 로컬 취소한다. 일부 체결됐다면 terminal `PARTIALLY_FILLED_CANCELLED`이며 open 잔량은 0이고, 체결수량과 취소수량을 따로 보존한다. 마지막 체결가 fallback은 없다.
- 제출 시 이미 marketable인 지정가는 허용 가격 안의 반대편 visible depth만 소비하고 잔량은 `DAY` passive order로 둔다.
- 처음부터 passive인 지정가와 marketable 지정가 잔량의 초기 기본값은 `AT_OR_THROUGH`다. 주문 수락 이후 실제 체결가가 매수 limit 이하 또는 매도 limit 이상에 도달하면 해당 관측 체결량 범위에서 부분체결한다.
- 호가 snapshot의 단순 잔량 감소만으로 체결하지 않는다. 더 보수적인 연습을 원하는 사용자는 `TRADE_THROUGH`를 선택해 limit를 엄격히 통과한 실제 체결에서만 채울 수 있다.

다단계 fill마다 가격·수량·gross notional·market event ID를 보존한다. VWAP은 정해진 decimal scale과 rounding policy로 산출하고 원장에는 개별 fill을 기준으로 기록한다.

## 6. `ADVANCED_QUEUE_V1`

이 모델은 선택적 고급 프로필이며 실제 queue의 복원이 아니라 `QUEUE_ESTIMATED` 시뮬레이션이다.

1. 주문 수락 시 같은 가격의 같은 편 표시잔량을 snapshot한다.
2. venue/유동성 정책의 safety factor를 곱해 선행 대기수량을 만든다.
3. 주문 이후 sequence가 증가한 실제 체결량과 같은 가격 표시잔량 감소를 관측한다.
4. 같은 변화가 trade와 book에 함께 보이면 더 큰 값 하나만 사용해 이중 차감을 막는다.
5. 선행수량을 먼저 차감하고 남은 관측량만 내 주문에 가격우선 부분체결한다. 엄격한 trade-through는 선행수량이 소진된 것으로 보되 해당 tick의 관측 수량 이상은 채우지 않는다.

중복 market event ID와 역행 sequence는 무시한다. 신규·취소 주문, 숨은 수량, iceberg, venue 간 routing, feed aggregation 때문에 실제 queue position은 알 수 없다. 따라서 safety factor, 최초 표시잔량, 각 queue progress, `QUEUE_ESTIMATED` 품질을 감사 기록에 남기며 이를 `실제 예상 체결`로 표현하지 않는다.

이 프로필의 DoD는 queue decrement/부분체결 golden replay, trade-book 중복 제거, safety factor 정책 버전, KRX 10단계와 미국 1단계 capability fixture, VI와 session reset 테스트다. 조건을 충족하기 전 기본 프로필로 승격하지 않는다.

## 7. VI, 연속매매, 동시호가

trading phase는 `PREOPEN_AUCTION`, `REGULAR_CONTINUOUS`, `VI_PAUSED`, `CLOSING_AUCTION`, `AFTER_HOURS_AUCTION`, `CLOSED`로 분리한다.

- `REGULAR_CONTINUOUS`: 선택한 fill model을 적용한다.
- `VI_PAUSED`: 연속매매 fill과 queue progress를 중단한다. 해제 후 새 canonical snapshot으로 queue와 sequence를 재동기화하기 전 체결하지 않는다.
- 장전·장마감·시간외 단일가/동시호가: 호가 depth를 즉시 소진하지 않는다. 실제 확정 auction print와 clearing price가 수신된 뒤 조건을 만족한 주문에만 보수적으로 관측 수량을 allocation한다.
- `CLOSED`: 접수·체결을 금지하고 DAY 잔량의 expire 계획을 만든다.

세션 경계를 넘은 queue state를 재사용하지 않는다. auction과 continuous는 별도 session key, dedupe cursor, fill policy를 가진다.

## 8. 현실성 한계

KIS 시세는 실제 시장 관측값이지만 로컬 fill은 거래소 체결이 아니다. 네트워크 지연, 누락 tick, feed entitlement, 호가 통합 방식, 숨은 주문, 취소·정정, 내 주문의 시장 영향, 실제 queue priority를 재현하지 못한다. 특히 미국 1단계 호가는 깊은 시장가 주문의 실제 평균가를 알려주지 않는다.

UI는 `실제 시세 · 로컬 모의체결`, fill model, freshness, depth capability, queue quality를 함께 표시한다. stale 상태나 VI/auction 재동기화 중에는 주문 버튼을 disabled하고 이유를 보인다.

## 9. Health, replay, acceptance

Health는 feed freshness, clock skew, sequence gap/rewind, session calendar, instrument mapping, currency/venue, capability depth, tick/price band, VI state, auction finalization, SQLite writer/outbox를 각각 진단한다. 주문 기능은 market data health와 local ledger health가 모두 정상일 때만 활성화한다.

동일한 order, policy version, canonical event stream, initial state replay는 byte-equivalent fill 계획을 만들어야 한다. 다음 fixture를 고정한다.

- ask→BUY, bid→SELL 초안과 confirm/armed 표시
- 국내 10단계·미국 1단계 depth capability
- 다단계 시장가 VWAP, 부분체결, 시장가 취소 잔량, 지정가 resting 잔량
- 지정가 도달/통과 실제 체결과 선택적 엄격한 trade-through fill
- queue 선행량 차감, trade/book dedupe, 부분체결, safety factor
- stale/delayed/closed/휴장, mismatch, price band/tick, duplicate/out-of-order
- VI pause와 해제 후 snapshot reset, auction final print 전 no-fill
- `clientOrderId` 재시도의 zero side effect와 로컬 취소
- 수수료·세금 별도 ledger event 및 crash rollback/rebuild
- 제품 코드와 네트워크 로그에 실제 주문 기능이 없다는 금지 검사
- 좁은 viewport에서도 같은 instrument의 chart+orderbook 동시 표시
- 실제 OHLCV와 로컬 주문/부분체결 marker layer 분리

`INITIAL_CONSERVATIVE_V1`은 위 기본 replay, 안전·원장 검사와 UI 불변식을 통과하면 출시할 수 있다. `ADVANCED_QUEUE_V1`은 별도 feature flag이며 고급 DoD와 장중 장시간 replay 비교가 완료된 뒤에만 선택 가능하다.

## 10. 현재 runtime 상태 (2026-07-20)

Electron runtime은 기본 `INITIAL_CONSERVATIVE_V1`과 선택형 `ADVANCED_QUEUE_V1`의 정규 연속매매 경로를 구현한다. 실제 KIS 체결 tick의 수량을 같은 종목의 open `LIMIT` 주문들이 제출시각 순서로 공유한다. SQLite v4의 세션별 누적거래량 high-watermark와 immutable market-event receipt가 duplicate·역행 tick 및 앱 재시작 후 재처리를 막는다. event claim 뒤 process crash가 나면 과다체결보다 미체결을 택하는 fail-closed 정책이다.

고급 프로필은 주문 당시 같은 편·같은 가격 표시잔량에 주입된 safety factor를 적용해 선행 추정량을 만들고, 실제 체결량과 호가 감소량의 큰 값 하나만 차감한다. queue state는 `paper_advanced_queue_states`에 저장되며 재시작 sequence 불연속 시 새 fresh book으로 보수적 resnapshot한다. UI는 `QUEUE_ESTIMATED`와 factor를 표시하고 실제 queue라고 표현하지 않는다.

VI pause/resync, finalized auction print, 주입형 상·하한가/tick guard, DAY expiry 계획의 순수 정책은 구현됐다. 다만 KIS VI/auction event adapter와 expiry DB commit은 아직 runtime에 연결되지 않았으므로 정규 연속매매 외 주문·체결은 계속 차단한다.

호가 UI는 중앙 KRX 10호가 배열, 왼쪽 로컬 모의매도, 오른쪽 로컬 모의매수로 구현됐다. 양쪽 주문은 현재 입력 수량과 선택 지정가를 사용하고 KIS 정규장 `LIVE` 및 SQLite `READY`가 아니면 잠긴다. renderer는 주문을 KIS에 보내지 않고 typed IPC를 통해 로컬 sidecar에만 전달한다.

NXT 진단 경로는 `H0NXASP0`·`H0NXCNT0`·`H0NXMKO0`을 함께 구독한다. 2026-07-20 KIS paper에서 세 ACK, NXT 실제 호가 62필드와 체결 46필드를 확인했다. 공식 65필드와 관측 62필드는 별도 exact layout으로 파싱한다. NXT 장상태 11필드의 실제 frame과 코드 의미, per-venue projection, security-level 보유량 합산이 제품 runtime에 연결되기 전 NXT는 `DISPLAY_ONLY`이고 모의체결 대상이 아니다. 통합 `H0UNASP0/H0UNCNT0`은 실행 거래소 attribution이 없으므로 SOR·queue 체결 근거로 사용하지 않는다.
