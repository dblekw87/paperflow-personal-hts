# 시스템 아키텍처

## 1. 권장 구조

```text
Renderer (React UI)
  │ typed allowlist IPC / MessagePort
Preload (contextBridge)
  │
Electron Main
  │ private MessagePort
Trading Service (utilityProcess)
  ├─ KIS auth / REST / WebSocket
  ├─ 정규화 이벤트 버스 / 구독 관리자
  ├─ 캔들 집계 / 순위 / 뉴스 / 설명
  ├─ 로컬 주문·체결·평가 엔진
  └─ SQLite single writer
```

renderer는 표현만 담당한다. KIS 자격증명, 토큰, 원본 네트워크 응답, 파일시스템, DB 연결은 renderer에 존재하지 않는다. main은 창과 프로세스 수명주기·IPC 라우팅·자격증명 저장을 담당하고, 장시간 데이터 처리와 DB 쓰기는 `utilityProcess`의 trading service가 담당한다.

## 2. 기술 기준선

- Electron + React + Vite + TypeScript strict
- Phase 0는 npm 단일 패키지, Electron monorepo 전환 시 npm workspaces
- 런타임 계약 검증: Zod
- SQLite: `better-sqlite3`, Drizzle ORM, WAL
- 정확한 금융 계산: `decimal.js`, DB scaled integer/decimal text
- 서버 상태 캐시: TanStack Query
- UI 작업공간 상태: Zustand
- 대용량 표: TanStack Table + virtualizer
- 차트: TradingView Lightweight Charts
- 로그: Pino JSON + 회전 파일
- 테스트: Vitest + Playwright Electron E2E
- 시간: IANA timezone을 지원하는 Temporal 계열 API

정확한 패키지 버전은 구현 시작 시 현재 Electron 호환성 검증 후 lockfile로 고정한다.

## 3. 모듈 구조

```text
apps/desktop/
  src/main/          창, IPC router, credential vault, service supervisor
  src/preload/       의미 단위의 안전한 desktop API
  src/renderer/      market, chart, rankings, orders, portfolio, news, settings
  src/service/       utility process entry

packages/
  contracts/         IPC, command, event, error schema
  domain/            money, instrument, order, portfolio, market clock
  kis-adapter/       auth, REST, WS, decoder, endpoint registry, limiter
  market-data/       subscriptions, projections, candle, ranking
  simulation/        order state, fill model, fee, ledger, valuation
  storage/           schema, migration, repository, backup
  market-calendar/   session, holiday, timezone
  news/              provider adapters, dedupe, linking
  disclosures/       SEC/OpenDART watcher, classifier, translation queue
  explanations/      evidence and optional summarizer
  observability/     logging, metrics, health
  testkit/           fake clock, fake KIS, fixtures, replay

tests/
  fixtures/kis/
  contract/
  integration/
  replay/
  e2e/
```

KIS 경로, TR ID, 원본 필드명은 `kis-adapter/endpoint-registry`와 decoder에만 존재한다. renderer와 도메인 코드는 KIS 명칭을 모른다.

## 4. 실시간 이벤트 파이프라인

```text
KIS raw frame
→ TR별 decoder
→ canonical normalizer
→ schema/invariant validation
→ timezone/session enrichment
→ dedupe/gap/stale monitor
→ typed event bus
   ├─ 최신 quote/orderbook projection
   ├─ candle aggregator
   ├─ local matching engine
   ├─ DB batch writer
   └─ renderer stream gateway
```

- quote/orderbook UI는 50~100ms 동안 중간 상태를 합쳐 최신 상태만 보낼 수 있다.
- 진행 중 캔들은 100~250ms 단위로 보낼 수 있다.
- 주문·체결·현금 이벤트는 순서를 보장하고 버리지 않는다.
- provider sequence가 항상 있다고 가정하지 않는다. provider timestamp와 로컬 단조 sequence를 분리한다.
- UI가 느리면 시세 중간값은 버릴 수 있지만 주문 이벤트 backlog는 health 경고를 발생시킨다.

## 5. 공통 이벤트 계약

```ts
interface EventEnvelope<T extends string, D> {
  schemaVersion: 1;
  eventId: string;
  type: T;
  source:
    | "KIS_REST"
    | "KIS_WS"
    | "LOCAL_SIM"
    | "NEWS_PROVIDER"
    | "SEC_EDGAR"
    | "OPEN_DART";
  aggregateKey: string;
  sequence: string;
  occurredAt: string; // UTC ISO-8601
  receivedAt: string; // UTC ISO-8601
  traceId: string;
  data: D;
}
```

가격·금액·수량은 IPC에서 문자열로 전달한다.

```ts
interface TradeTick {
  instrumentId: string; // KRX:005930, NASDAQ:AAPL
  venue: string;
  session: "PRE" | "REGULAR" | "AFTER" | "CLOSED";
  price: string;
  quantity: string;
  aggressor: "BUY" | "SELL" | "UNKNOWN";
  cumulativeVolume?: string;
  cumulativeTurnover?: string;
  providerTradeId?: string;
}

interface OrderBookSnapshot {
  instrumentId: string;
  venue: string;
  bids: Array<{ price: string; quantity: string; orders?: number }>;
  asks: Array<{ price: string; quantity: string; orders?: number }>;
  providerTimestamp?: string;
}
```

핵심 이벤트:

```text
market.trade.v1
market.orderbook.v1
market.quote.v1
market.candle.updated.v1
market.candle.finalized.v1
market.session.changed.v1
market.connection.changed.v1
ranking.snapshot.updated.v1
news.item.upserted.v1
order.accepted.v1
order.rejected.v1
order.partially-filled.v1
order.filled.v1
order.cancelled.v1
portfolio.cash.changed.v1
portfolio.position.changed.v1
```

## 6. IPC 계약

저빈도 명령·조회는 `ipcMain.handle`, 고빈도 시세는 `MessageChannelMain`을 사용한다. preload는 renderer에 임의 채널 송신 함수를 노출하지 않는다.

```ts
interface DesktopTradingApi {
  system: {
    getHealth(): Promise<Result<SystemHealth>>;
  };
  market: {
    search(query: InstrumentSearch): Promise<Result<Instrument[]>>;
    getQuote(id: string): Promise<Result<Quote>>;
    getCandles(query: CandleQuery): Promise<Result<Candle[]>>;
    getRankings(query: RankingRequest): Promise<Result<RankingSnapshot>>;
    openStream(query: MarketStreamRequest): Promise<MarketStreamHandle>;
  };
  orders: {
    place(command: PlaceOrderCommand): Promise<Result<Order>>;
    cancel(command: CancelOrderCommand): Promise<Result<Order>>;
    list(query: OrderQuery): Promise<Result<Order[]>>;
  };
  portfolio: {
    getSnapshot(accountId: string): Promise<Result<PortfolioSnapshot>>;
  };
  news: {
    list(query: NewsQuery): Promise<Result<NewsItem[]>>;
    explain(query: ExplanationQuery): Promise<Result<InstrumentExplanation>>;
  };
}

type Result<T> =
  | { ok: true; requestId: string; data: T }
  | {
      ok: false;
      requestId: string;
      error: { code: string; message: string; retryable: boolean };
    };
```

대표 오류 코드는 `VALIDATION_FAILED`, `AUTH_EXPIRED`, `KIS_RATE_LIMITED`, `KIS_UNAVAILABLE`, `STREAM_DISCONNECTED`, `STALE_MARKET_DATA`, `MARKET_CLOSED`, `INSUFFICIENT_CASH`, `INSUFFICIENT_POSITION`, `ORDER_NOT_CANCELLABLE`, `DB_BUSY`다.

### MessagePort 전달과 수명주기

- main은 `webContents.postMessage(channel, payload, [port])`로 renderer 쪽 port를 transfer한다.
- preload는 sender, channel, payload schema를 검증하고 `close/pause/resume/onEvent/onStatus`만 가진 handle로 감싼다.
- service는 구독 generation과 ref-count를 소유하고 마지막 consumer가 닫히면 upstream 구독을 해제한다.
- route 전환, renderer reload/destroy, utility process 재시작 때 port와 listener를 정리한다.
- 시세·호가는 제한된 latest-state coalescing을 허용하지만 주문·체결·현금 이벤트는 lossless queue와 backlog health를 사용한다.
- close 뒤 event, 이전 generation event, 중복 event ID는 projection에 적용하지 않는다.

### REST와 WebSocket 병합 소유권

- 최신 quote/orderbook/candle의 단일 owner는 market projection store다.
- REST snapshot과 WebSocket event를 별도 화면 상태로 경쟁시키지 않는다.
- projection version은 `generation`, `occurredAt`, `receivedAt`, `localSequence`를 가지며 늦게 도착한 REST가 더 최신 WS 상태를 덮지 못한다.
- 초기 연결과 재연결은 `stream 준비 → REST seed → buffered WS replay → live` 순서로 수행한다.
- gap 또는 reconnect 후에는 새 generation에서 REST resync를 거친 뒤 해당 generation의 event만 적용한다.

## 7. 시간·통화

- 저장 시각은 UTC instant, 종목에는 venue IANA timezone을 저장한다.
- 한국은 `Asia/Seoul`, 미국은 `America/New_York`를 사용한다.
- 미국 DST를 고정 UTC offset 또는 서울 시각 상수로 처리하지 않는다.
- 장 영업일, 반일장, 휴장일은 캘린더 테이블로 관리한다.
- USD 자산은 USD 원장에 남는다. KRW 환산은 별도 FX snapshot과 기준 시각을 가진 projection이다.
- 평가용 환율과 실제 가상 환전 원장 거래를 구분한다.

## 8. 캔들 정책

- 1분봉을 기본 저장하고 5분봉은 파생/캐시한다.
- 일봉은 거래소 세션 날짜를 사용한다.
- REST backfill과 WebSocket 진행 봉은 `(instrument, interval, session, openedAt)`로 병합한다.
- 지연 체결은 제한된 최근 bucket만 revision하고 watermark 뒤 finalized 처리한다.
- 체결이 없는 구간에 가짜 거래량 0 봉을 DB에 만들지 않는다.
- 가격 조정 여부와 corporate action 기준을 series metadata에 기록한다.

## 9. 프로세스 복구

- trading service 종료 시 main이 제한 횟수로 재시작하고 UI에 상태를 알린다.
- 재시작 뒤 DB projection, 미체결 주문, 구독 의도를 복구한다.
- WebSocket 재연결 뒤 REST snapshot을 다시 받아 gap을 보정한다.
- outbox에 남은 도메인 이벤트를 재전송하되 event ID로 중복 적용을 막는다.
