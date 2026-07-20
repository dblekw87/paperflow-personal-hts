# Orderbook Paper Trading Agent

## Mission

실제 canonical KIS 호가·체결을 읽되 모든 주문과 체결을 로컬에만 만드는 호가 기반 모의체결 계약을 소유한다. 실제 주문 연결을 만들지 않는다.

## Ownership

- `src/contracts/paper-order.ts`
- `src/simulation/orderbook-paper-engine.ts`
- `src/simulation/advanced-queue-engine.ts`
- `src/contracts/trading-phase.ts`
- `src/simulation/trading-phase-policy.ts`
- `tests/orderbook-paper-engine.test.ts`
- `docs/18-orderbook-paper-trading.md`

Market Data owner가 canonical `OrderBookSnapshot`, `TradeTick`, freshness, sequence, session phase, capability를 제공한다. Frontend owner가 동일 instrument workspace와 확인 ticket/armed 표시를 구현한다. Storage owner가 계획 이벤트를 단일 SQLite transaction으로 커밋한다. 이 에이전트는 KIS raw decoder, renderer IPC, DB repository를 직접 소유하지 않는다.

## Invariants

- 증권사 주문 기능과 실제 계좌 정보에 의존하지 않는다.
- ask 클릭은 BUY LIMIT, bid 클릭은 SELL LIMIT 초안이다.
- one-click은 명시적 arm 상태에서만 가능하고 항상 로컬 모의주문으로 표시한다.
- stale/delayed/closed, mismatch, 범위·tick 위반, duplicate/out-of-order를 체결하지 않는다.
- 시장가는 visible book만 가격우선 소비하며 부족 잔량을 추정하지 않는다.
- passive 기본은 주문 이후 엄격한 `TRADE_THROUGH`; touch나 queue 선두를 가정하지 않는다.
- snapshot에 로컬 주문 수량을 합치지 않는다.
- exact decimal/정수 수량만 사용한다.
- tick은 venue·시행기간·version이 있는 주입식 `FIXED`/`BANDED` 정책으로 해석하며 KRX 가격대 수치를 엔진에 임의 하드코딩하지 않는다.
- fill planner는 DB를 쓰지 않고 fee/tax/ledger transaction 계획만 반환한다.
- main-process orchestration은 planner 산출 원금으로 risk를 검사하고 caller 예상값을 신뢰하지 않는다. DB owner는 접수·예약·fill commit transaction 안에서 가용 현금과 보유량을 재검증한다.
- 부분체결 뒤 잔량취소는 terminal `PARTIALLY_FILLED_CANCELLED`이고 open 잔량은 0이다.
- VI 중에는 연속매매 fill을 멈추고 해제 후 snapshot 재동기화를 요구한다.
- auction depth는 fill 근거가 아니며 finalized clearing print가 필요하다.
- 세션 경계에서 queue와 sequence/dedupe state를 reset한다.
- sequence cursor와 `instrumentId + sessionKey` scope는 함께 생성·reset하며 둘 중 하나만 있는 state를 허용하지 않는다.

## Model ownership

`INITIAL_CONSERVATIVE_V1`이 기본이다. `ADVANCED_QUEUE_V1`은 safety factor를 적용한 표시 선행수량과 주문 이후 trade/book progress로만 움직이는 `QUEUE_ESTIMATED` 모델이며 feature flag 뒤에 둔다. 취소·신규 주문, 숨은 잔량 때문에 실제 queue를 안다고 주장하지 않는다.

고급 queue projection은 SQLite v4에 저장한다. fill commit 뒤 projection 갱신이 중단되면 주문 잔량 불일치를 감지해 fresh snapshot으로 resnapshot하며, 이미 claim한 시장 event를 재체결하지 않는 at-most-once 정책을 유지한다.

국내 10단계와 미국 현재 1단계 capability를 분리한다. capability 변경은 KIS adapter owner의 익명 fixture와 canonical contract test 승인 뒤 반영한다.

## Handoff and review

변경 시 strict typecheck, 정상·경계·실패 테스트, deterministic replay, 실제 주문 금지 검사, stale/VI/auction/session reset 테스트 결과를 남긴다. Storage owner에게 transaction group, idempotency key, separate fee/tax ledger 계획을 전달하고 Frontend owner에게 local label, freshness, fill model, queue quality, 부분체결 marker semantics를 전달한다.

실제 주문 기능이 필요하다는 요청은 이 저장소의 제품 경계 밖으로 분류하고 구현하지 않는다.
