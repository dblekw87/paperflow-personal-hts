# React 프론트엔드와 UI 시스템

## 1. 프레임워크 결정

Electron renderer는 **React + Vite + TypeScript**로 개발한다.

Next.js는 기본 선택으로 사용하지 않는다. 이 제품은 로컬 Electron 앱이고 SSR, 서버 라우팅, SEO, 서버 컴포넌트가 필요하지 않다. React + Vite가 renderer 패키징, 보안 경계, 빠른 HMR, fixture 기반 개발에 더 단순하다.

향후 별도 웹 제품을 만들 때만 Next.js를 독립 앱으로 검토한다. Electron renderer와 Next.js 서버를 섞지 않는다.

## 2. 프론트엔드 책임

renderer가 담당하는 것:

- 시장 대시보드, 순위표, 종목 작업공간, 차트, 호가, 주문 티켓
- 포트폴리오, 주문·체결, 뉴스·시황, 설정·진단 화면
- 사용자 레이아웃·필터·선택 상태
- canonical contract를 화면 모델로 변환
- live/delayed/stale/offline freshness와 unsupported/restricted/partial support 상태 표현

renderer가 담당하지 않는 것:

- KIS 인증·REST·WebSocket 연결
- App Key/Secret/token 보관
- SQLite 접근
- 주문 검증·체결·손익 계산
- 뉴스 원문 수집

모든 privileged 동작은 preload의 의미 단위 typed API를 통해서만 요청한다.

## 3. 권장 프론트엔드 구조

```text
apps/desktop/src/renderer/
  app/
    App.tsx
    routes.tsx
    providers.tsx
  shell/
    AppShell.tsx
    GlobalHeader.tsx
    NavigationRail.tsx
    ConnectionStrip.tsx
  features/
    market-dashboard/
    rankings/
    instrument-workspace/
    orderbook/
    trades/
    chart/
    order-ticket/
    watchlists/
    portfolio/
    orders/
    news/
    disclosures/
    explanation/
    settings/
    diagnostics/
  components/
    atoms/
      Button.tsx
      Icon.tsx
      PriceText.tsx
      StatusBadge.tsx
    molecules/
      PriceChange.tsx
      FreshnessStamp.tsx
      OrderPriceInput.tsx
      IndicatorToggle.tsx
    organisms/
      OrderBookPanel.tsx
      ChartToolbar.tsx
      PaperOrderTicket.tsx
      InstrumentHeader.tsx
    templates/
      InstrumentWorkspaceTemplate.tsx
      MarketDashboardTemplate.tsx
  design-system/
    tokens.css
    theme.css
    typography.css
    components/
  state/
    workspace-store.ts
    preferences-store.ts
  api/
    desktop-client.ts
    query-keys.ts
    stream-client.ts
  test/
    fixtures/
    render-with-providers.tsx
```

feature는 `components`, `model`, `queries`, `stream`, `view`를 내부에 가질 수 있지만 다른 feature의 내부 경로를 직접 import하지 않는다. 공유 계약은 `packages/contracts`를 사용한다.

### Atomic component 경계

- atom: 상태나 도메인 조회 없이 token과 props만으로 렌더링한다.
- molecule: 2개 이상의 atom을 의미 단위로 묶으며 네트워크·DB를 모른다.
- organism: 호가창, 차트 툴바, 주문 티켓처럼 독립 fixture로 검증할 수 있는 패널이다.
- template: 패널의 배치와 responsive 규칙만 소유한다.
- feature/page: query, stream projection, 사용자 동작을 조합하고 template에 view model을 전달한다.

atom/molecule이 KIS raw field, MessagePort, SQLite, 주문 엔진을 직접 참조하지 못하게 lint import boundary를 둔다. organism도 canonical view model과 callback만 받는다. 이를 통해 dark/light, live/stale, 국내 10호가/미국 1호가, 부분체결 상태를 Storybook에서 실제 연결 없이 조합한다.

## 4. 상태관리

### TanStack Query

- 종목 검색, quote snapshot, candle backfill, 순위, 뉴스, 포트폴리오 조회
- cache key에 시장·종목·interval·필터·source를 포함
- stale provider 데이터를 Query의 일반 stale 상태와 혼동하지 않고 domain freshness로 별도 보존

### Zustand

- 선택 시장·종목
- 열린 작업공간과 패널 크기
- 순위 필터와 정렬
- 차트 표시 설정
- 사용자 theme와 밀도

### 실시간 stream

- MessagePort로 받은 quote/orderbook/candle event를 feature별 projection에 반영
- quote·호가는 50~100ms coalescing
- 주문·체결 이벤트는 버리지 않고 순서대로 반영
- 화면이 보이지 않는 feature는 렌더링 업데이트를 중단하되 service 구독 의도는 정책에 따라 유지

### MessagePort 수명주기

1. renderer가 preload의 `market.openStream(request)`를 호출한다.
2. main은 `MessageChannelMain`을 만들고 service 쪽 port와 renderer 쪽 port를 분리한다.
3. renderer port는 `webContents.postMessage(channel, metadata, [port])`로만 전달한다. `invoke` 반환값이나 범용 IPC로 port를 전달하지 않는다.
4. preload는 channel, sender, metadata schema를 검증하고 제한된 `MarketStreamHandle`을 만든다.
5. handle은 `close`, `pause`, `resume`, `onEvent`, `onStatus`만 노출하며 원본 `MessagePort`나 `ipcRenderer`를 노출하지 않는다.
6. route 변경, renderer reload/destroy, generation 교체 시 반드시 close하고 service ref-count를 감소시킨다.
7. quote/호가는 coalescing queue, 주문/체결은 lossless queue를 분리한다. lossless backlog가 budget을 넘으면 health 경고를 발생시킨다.

### Snapshot과 stream의 단일 소유권

- canonical 최신 시장 상태의 단일 owner는 `market projection store`다.
- TanStack Query의 REST snapshot도 직접 화면에 따로 보관하지 않고 projection store의 동일 instrument/channel에 seed한다.
- 각 업데이트는 `subscriptionGeneration`, `occurredAt`, `receivedAt`, `localSequence`를 비교한다.
- 늦게 끝난 REST snapshot은 더 최신 WS event를 덮어쓰지 못한다.
- 초기 순서: generation 생성 → stream 준비 → REST snapshot seed → buffered WS event replay → live 전환.
- reconnect 시 `resyncing`으로 바꾸고 REST snapshot 뒤 같은 generation의 WS만 적용한다.
- generation이 다른 event, close 이후 event, 중복 event ID는 폐기하고 진단 counter를 증가시킨다.
- Query invalidation은 서버 조회 trigger일 뿐 화면 최신가의 별도 source가 아니다.

## 5. 화면 구성

### 전역 Shell

- 상단: 시장 선택, 종목 검색, 장 상태, KIS 연결, 데이터 지연, 총자산
- 왼쪽: 대시보드, 순위, 관심, 포트폴리오, 주문, 뉴스·공시, 설정·진단
- 중앙: 작업공간
- 하단: WebSocket, REST limiter, 마지막 수신 시각

종목 작업공간은 검색·순위·관심종목에서 새 workspace tab으로 연다. 독립 좌측 route는 만들지 않는다. 관심종목은 독립 route이며 순위 내부의 관심 filter도 동일 데이터를 투영한다. 설정과 진단은 하나의 route 안에서 탭으로 구분한다.

전역 총자산은 기준 통화, FX 기준 시각, `complete/partial/stale` valuation quality를 함께 표시한다. stale FX나 quote가 있으면 단일 정확값처럼 표현하지 않는다.

종목 작업공간의 `OrderBookPanel`과 `InstrumentChartPanel`은 동일 `instrumentId`와 subscription generation을 공유하며 항상 동시에 mount·표시한다. resize는 허용하지만 hide/collapse/tab 이동은 허용하지 않는다. responsive template은 좁은 화면에서 주문·정보 패널을 아래로 이동해 두 핵심 패널의 동시 가시성을 보존한다.

### 종목 작업공간 기본 그리드

```text
┌──────────────── 종목 헤더 ────────────────┐
├──── 호가/체결 ────┬────── 차트 ──────┬── 주문 ──┤
│                   │                  │ 보유/손익 │
├───────────────────┴──────────────────┼──────────┤
│ 종목정보 · 뉴스 · 움직임 설명                  │
└───────────────────────────────────────────────┘
```

MVP는 저장 가능한 무한 자유배치보다 안정적인 기본 그리드를 우선한다. 패널 resize와 collapse는 지원하되 arbitrary floating window는 후속 단계다.

위 일반 collapse 정책에서 차트와 호가창은 예외다. 두 패널은 collapse 대상이 아니며 E2E에서 동일 종목 ID, 동시 visibility, 최소 viewport를 검증한다.

## 6. 디자인 토큰

색을 컴포넌트에 직접 하드코딩하지 않는다.

```css
:root {
  --color-bg-canvas: #0b0f14;
  --color-bg-panel: #121820;
  --color-bg-elevated: #18212b;
  --color-border: #293442;
  --color-text-primary: #eef3f8;
  --color-text-secondary: #9eacba;
  --color-positive: #ff4d5e;
  --color-negative: #3b82f6;
  --color-warning: #f5a524;
  --color-success: #2fbf71;
  --color-stale: #f59e0b;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --radius-sm: 3px;
  --radius-md: 6px;
  --focus-ring: 0 0 0 2px #7dd3fc;
  --z-dropdown: 100;
  --z-dialog: 200;
  --motion-fast: 120ms;
}
```

국내 HTS 관습상 상승은 빨강, 하락은 파랑을 기본값으로 하되 색상 반전 옵션을 지원할 수 있다. 색만으로 등락·상태를 전달하지 않고 부호, 화살표, 텍스트를 함께 사용한다.

간격·크기:

- 4px 기반 spacing scale
- dense table row 28~32px
- 일반 control 32~36px
- 가격은 tabular number font
- 중요한 숫자는 최소 두 단계의 시각 계층만 사용

실제 구현 전 token에는 typography, spacing, radius, elevation, focus, disabled, error, live/offline, chart series, z-index, motion, high-contrast를 완성한다. **dark와 light theme를 모두 정식 지원**하고 `system/dark/light` 선택을 제공한다. 선택값은 `LOCAL_USER_PREFERENCE`로 저장해 재시작 뒤 복원한다. token contrast는 두 theme 모두 자동 테스트하며 일반 텍스트는 WCAG AA 기준을 만족한다.

호가 잔량 bar, 상승·하락 캔들, 이동평균선, 거래량·거래대금, 매수·매도·부분체결 마커는 dark/light별 semantic token을 사용한다. 배경색만 바꾸고 동일한 고정 RGB를 재사용하지 않는다. theme 변경은 WebSocket 구독이나 차트·호가 projection을 재생성하지 않고 표현 계층만 교체한다.

## 7. 핵심 컴포넌트 계약

### MarketDataCell

- `value`, `formattedValue`, `direction`, `freshness`, `support`, `asOf`
- 숫자 0과 미제공 `null`을 구분
- stale이면 셀 전체가 아니라 데이터 품질 badge를 함께 표시

### VirtualizedMarketTable

- column definition과 row key 안정성
- 1,000행에서 DOM row virtualization
- 정렬 source가 KIS 원본인지 local인지 표시
- keyboard navigation, column resize, pinned symbol column

### OrderBook

- depth는 provider가 실제 제공한 개수만 렌더링
- price level key는 가격+side
- 잔량 bar는 visible depth 내 상대값
- 미국 1호가를 10단계처럼 채우지 않음

### InstrumentChart

- OHLC candle과 거래량·거래대금 series를 별도 scale/panel로 렌더링
- 가격·거래량·거래대금 SMA/EMA 설정, interval별 사용자 preference
- `KIS_CANONICAL_MARKET_DATA` series와 `LOCAL_PAPER_FILL` marker 분리
- 매수/매도, 부분/전량 fill을 색 외의 모양·텍스트로도 구분
- 여러 부분체결 marker의 clustering과 원본 fill tooltip
- theme 변경 시 series state·viewport·WebSocket generation 유지

### OrderTicket

- 항상 `모의 주문` 라벨
- market data freshness와 사용 quote 시각
- 제출 중 중복 클릭 방지와 `clientOrderId`
- 서버/도메인 오류 code별 인라인 설명
- 주문 성공 toast만 믿지 않고 order aggregate를 다시 표시

### ExplanationPanel

- factor, confidence, evidence, counter-evidence
- evidence 없는 문장 렌더링 금지
- 뉴스·차트 window deep link
- “가능 요인”과 투자 조언 아님 고지

## 8. 성능 기준

- 실시간 quote 수신으로 전체 React tree를 다시 렌더링하지 않는다.
- selector와 row-level memoization을 사용한다.
- 표는 virtualization, 차트 데이터는 incremental update를 사용한다.
- 호가·quote는 최신 상태 coalescing, 주문·체결은 lossless 처리한다.
- React Profiler fixture 시나리오를 성능 회귀 기준으로 저장한다.
- 종목 전환 중 이전 stream 이벤트가 새 종목 화면에 섞이지 않도록 subscription generation을 검사한다.

### 측정 가능한 budget

- fixture workload: quote 2,000 events/second 30초, orderbook 200 snapshots/second 30초, lossless order/fill 100 events burst
- quote/orderbook은 100ms 안에 coalesce하고 마지막 상태 유실 0
- lossless order/fill 유실·순서역전 0
- 사용자 입력→다음 paint p95 100ms 이하
- WS 수신→화면 표시 p95 300ms 이하
- React commit p95 16ms 이하, 최대 50ms 이하
- 순위 1,000행 scroll에서 장시간 50 FPS 이상
- 30초 burst 뒤 renderer heap 증가가 안정 시점 대비 20% 이내로 회복
- 이전 기준선 대비 p95 20% 초과 회귀 시 health/review 실패

성능 report에는 received, coalesced, rendered, dropped-by-policy, lossless backlog, CPU, heap을 기록한다.

## 9. 접근성과 키보드

- 목표 규격은 WCAG 2.2 AA다.
- 색 외에 텍스트·아이콘·부호 제공
- 모든 주문 입력에 label과 오류 연결
- focus ring 제거 금지
- 표 행과 탭 키보드 이동
- `Esc` 주문 확인 닫기, 명시적 단축키 설정
- 주문 제출 단축키는 기본 비활성화하며 활성화 시 확인 정책 제공
- screen reader용 현재가 폭주 알림은 throttle
- virtualized grid에 `role=grid`, `aria-rowcount`, `aria-rowindex`와 scroll 후 focus 복원을 구현
- dialog는 focus trap과 닫힌 뒤 trigger focus 복귀를 보장
- 200% zoom과 Windows high-DPI에서 주문·호가가 잘리지 않음
- `prefers-reduced-motion`을 존중
- 시장 시세는 polite/throttled live region, 주문 거부·체결은 별도 우선순위 알림 사용

## 10. UI 개발 방식

KIS 실시간 연결 없이도 fixture로 모든 상태를 개발한다.

필수 UI fixture:

- 정상 live, delayed, stale, offline, unsupported, restricted, partial, market-closed
- 국내 10단계 호가와 미국 1호가
- 빈 순위, 일부 필드 누락, rate limit 캐시
- 주문 접수/부분체결/체결/취소/거부
- KRW/USD 포트폴리오와 stale FX
- 뉴스 없음, 중복 뉴스, 낮은 confidence 설명
- fixed clock/timezone, 같은 seed와 canonical schema를 가진 replay
- 중복·역순 event, reconnect generation, unmount 후 event
- viewport, theme, DPI matrix
- dark/light/system 전환, 재시작 후 선택 복원, 각 theme의 차트·호가·주문 마커 대비

Storybook 또는 독립 fixture gallery를 Phase 1에 도입한다. 어떤 도구를 쓰든 production preload API 없이도 화면을 렌더링할 수 있어야 한다.

## 11. 테스트

- 컴포넌트: React Testing Library
- 상태·hook: Vitest
- 접근성: axe 기반 자동 검사 + WCAG 2.2 AA 키보드/가상화 grid 수동 검증
- 시각 회귀: 핵심 workspace screenshot
- E2E: Playwright Electron
- 성능: 순위 1,000행, 체결 burst, 종목 연속 전환

주요 E2E:

1. 종목 검색→작업공간 열기→REST snapshot→WS update
2. stale 상태→시장가 버튼 제한
3. 지정가 모의 주문→부분체결→포트폴리오 반영
4. 미국 1호가 표시와 USD 주문금액
5. 설명 evidence→뉴스/차트 이동
6. renderer에서 Node/KIS secret 접근 불가

## 12. UI Definition of Done

- 승인된 design token만 사용하고 새 token은 design-system owner review
- loading/empty/error와 live/delayed/stale/offline/unsupported/restricted/partial 상태 구현
- keyboard와 focus 검증
- canonical contract 외 KIS raw field 사용 없음
- 1,000행 virtualization과 정의된 실시간 burst 성능 budget 모두 검증
- fixture story와 component test
- screenshot 또는 시각 review
- 보안·헬스체크 에이전트 review 완료
