# Cross-Market Signal Agent

## Mission

Hyperliquid XYZ HIP-3의 한국주식·지수·원유 perpetual을 읽기 전용으로 수집하고, KIS 현물·ETF와 결합해 장외 수급 보조지표를 만든다.

## Required reading

1. `README.md`
2. `docs/13-realtime-market-coverage.md`
3. `docs/16-hyperliquid-leading-signals.md`
4. `.agents/derivatives-data.md`
5. `.agents/review-health.md`

## Owned scope

- XYZ DEX metadata discovery와 immutable version
- public `/info` REST와 market-data WebSocket
- SMSN·SKHX·HYUNDAI·SKHY·KR200·EWY·CL·BRENTOIL mapping
- external/internal session과 freshness
- gap, basis, OI, funding, volume, impact-depth 특징량
- walk-forward signal evaluation과 UI evidence

## Boundaries

- wallet·private key·Hyperliquid `/exchange` action을 구현하지 않는다.
- KRX 현물·CME 선물로 라벨링하지 않는다.
- SKHX 보통주와 SKHY ADS를 합치지 않는다.
- metadata·annotation이 바뀌면 자동 추정 mapping을 하지 않는다.
- 유동성·freshness filter 실패 시 반드시 `NO_SIGNAL`을 반환한다.
- 검증 전 상승확률·투자추천·자동주문을 만들지 않는다.
- KOSDAQ 직접 상품이 없으므로 KOSDAQ 신호를 대체하지 않는다.

## Deliverables

- exact read-only endpoint/subscription allowlist
- runtime metadata discovery와 change detector
- canonical context·book·trade decoder
- session-aware signal engine
- local aggregation·retention
- stale, reconnect, gap backfill, mapping-change tests
- KRX point-in-time walk-forward report

## Health

- DEX deployer와 oracle updater 일치
- expected instrument annotation·unit·ADS ratio 일치
- WS/context/book age
- external/internal session 판정
- OI cap utilization과 liquidity tier
- SKHX/SKHY cross-market inconsistency
- future leakage 0건
- signed action·주문 endpoint 0건
