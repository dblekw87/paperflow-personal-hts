import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const rendererRoot = join(process.cwd(), "apps", "desktop", "src", "renderer");

describe("desktop HTS UI safety invariants", () => {
  it("guards instrument autocomplete against stale, jamo, and IME selection", () => {
    const app = readFileSync(join(rendererRoot, "app", "App.tsx"), "utf8");

    expect(app).toContain("isSearchableDomesticInstrumentQuery");
    expect(app).toContain(
      "desktop.instrumentSearch?.query === normalizedInstrumentQuery",
    );
    expect(app).toContain("event.nativeEvent.isComposing");
    expect(app).toContain("visibleInstrumentSearchItems");
  });

  it("keeps orderbook and chart mounted together in the instrument workspace", () => {
    const app = readFileSync(join(rendererRoot, "app", "App.tsx"), "utf8");
    const gridStart = app.indexOf('className="trading-grid"');
    const orderBook = app.indexOf("<OrderBookPanel", gridStart);
    const chart = app.indexOf("<MarketChart", gridStart);
    const ticket = app.indexOf("<OrderTicket", gridStart);

    expect(gridStart).toBeGreaterThan(-1);
    expect(orderBook).toBeGreaterThan(gridStart);
    expect(chart).toBeGreaterThan(orderBook);
    expect(ticket).toBe(-1);
    expect(app).toContain('isUsOneLevelBook');
    expect(app).toContain('"미국 실제 1호가 + 참고 가격대"');
    expect(app).toContain('"KRX 10호가"');
    expect(app).toContain('"잔량 미수신"');
  });

  it("labels fixture data and every order affordance as local simulation", () => {
    const app = readFileSync(join(rendererRoot, "app", "App.tsx"), "utf8");
    const preload = readFileSync(
      join(process.cwd(), "apps", "desktop", "src", "preload", "preload.ts"),
      "utf8",
    );

    expect(app).toContain("FIXTURE UI");
    expect(app).toContain(
      'dataMode={hasDesktopRuntime ? "REAL" : "FIXTURE"}',
    );
    expect(app).toContain("window.paperTradingDesktop === undefined");
    expect(app).toContain("isRegularPaperSession");
    expect(app).toContain("activeInstrumentId");
    expect(app).toContain("activeInstrumentName");
    expect(app).toContain("applyLiveTradeToCandles");
    expect(app).toContain("completeSessionHistory");
    expect(app).not.toContain(
      "volume: desktop.market.cumulativeVolume",
    );
    expect(app).not.toContain(
      "turnover: desktop.market.cumulativeTurnover",
    );
    expect(app).not.toContain('instrumentId="KRX:005930"');
    expect(app).toContain("실제 주문 기능 없음");
    expect(app).toContain('KIS WebSocket{" "}');
    expect(app).toContain('"장외/미연결"');
    expect(app).not.toContain("WS 정상");
    expect(app).not.toContain("SQLite WAL 정상");
    expect(app).not.toMatch(/<OrderTicket(?:\s|>)/);
    expect(app).toContain("BigInt(");
    expect(app).not.toContain('freshness="LIVE"');
    expect(app).not.toMatch(/Number\(draft\.(limitPrice|quantity)/);
    const orderBook = readFileSync(
      join(rendererRoot, "components", "organisms", "OrderBookPanel.tsx"),
      "utf8",
    );
    expect(orderBook).toContain("합성 호가 미리보기");
    expect(orderBook).toContain('onLevelOrder("SELL", level.price)');
    expect(orderBook).toContain('onLevelOrder("BUY", level.price)');
    expect(orderBook).toContain("pt-order-book__action-cell--sell");
    expect(orderBook).toContain("pt-order-book__action-cell--buy");
    expect(orderBook).not.toContain("onClick={() => {\n        if (canOrder)");
    expect(orderBook).toContain("호가 클릭 주문 수량");
    expect(orderBook).not.toContain("QuickOrderSide");
    expect(orderBook).not.toContain("지정가");
    expect(app).toContain("submitOrderBookLevel");
    expect(app).not.toContain("QUICK_ORDER_ARM_MS");
    expect(app).not.toContain("isConfirmed");
    expect(app).toContain("desktop.selectInstrument(rankingSelection)");
    expect(app).toContain('setWorkspacePage("DASHBOARD")');
    expect(preload).toContain("marketSelectInstrument");
    expect(preload).toContain("selectInstrument: async");
    expect(app).toContain("setSelectedInstrument({");
    expect(app).toContain("SQLite 모의 체결 내역");
    expect(app).toContain("WORKSPACE_PAGE_LABELS");
  });

  it("supports dark, light and system themes without privileged renderer APIs", () => {
    const app = readFileSync(join(rendererRoot, "app", "App.tsx"), "utf8");
    const styles = readFileSync(join(rendererRoot, "styles.css"), "utf8");
    const preload = readFileSync(
      join(process.cwd(), "apps", "desktop", "src", "preload", "preload.ts"),
      "utf8",
    );

    expect(app).toContain('type ThemePreference = "system" | "dark" | "light"');
    expect(styles).toContain(':root[data-theme="light"]');
    expect(styles).toContain("--color-text-tertiary: #7f8fa3");
    expect(styles).toContain("--color-text-tertiary: #657588");
    expect(preload).not.toMatch(/KIS_APP|APP_SECRET|better-sqlite3|node:fs/);
    expect(preload).not.toContain("ipcRenderer:");
  });

  it("uses hardened Electron renderer settings and denies external windows", () => {
    const main = readFileSync(
      join(process.cwd(), "apps", "desktop", "src", "main", "main.ts"),
      "utf8",
    );

    expect(main).toContain("contextIsolation: true");
    expect(main).toContain("sandbox: true");
    expect(main).toContain("nodeIntegration: false");
    expect(main).toContain('action: "deny"');
    expect(main).toContain("setPermissionRequestHandler");
    expect(main).toContain('"preload.cjs"');
  });

  it("bundles the sandboxed preload as standalone CommonJS", () => {
    const packageJson = readFileSync(
      join(process.cwd(), "package.json"),
      "utf8",
    );
    expect(packageJson).toContain("--format=cjs");
    expect(packageJson).toContain(
      "--outfile=apps/desktop/dist-electron/apps/desktop/src/preload/preload.cjs",
    );
  });

  it("keeps KIS, SQLite and paper execution behind typed desktop IPC", () => {
    const runtime = readFileSync(
      join(
        process.cwd(),
        "apps",
        "desktop",
        "src",
        "main",
        "desktop-runtime.ts",
      ),
      "utf8",
    );
    const hook = readFileSync(
      join(rendererRoot, "hooks", "useDesktopRuntime.ts"),
      "utf8",
    );
    const contracts = readFileSync(
      join(
        process.cwd(),
        "apps",
        "desktop",
        "src",
        "shared",
        "desktop-contracts.ts",
      ),
      "utf8",
    );

    expect(runtime).toContain("DomesticKisLiveStream");
    expect(runtime).toContain("KisDomesticChartClient");
    expect(runtime).toContain("getDomesticMinuteCandles");
    expect(runtime).toContain("getDomesticDailyCandles");
    expect(runtime).toContain("maxPages: 24");
    expect(runtime).not.toContain('interval === "1m" ? 2 : 14');
    expect(runtime).toContain("aggregateDomesticCandleHistory");
    expect(runtime).toContain("ADVANCED_QUEUE_V1");
    expect(runtime).toContain("planAdvancedQueueProgress");
    expect(runtime).toContain("saveAdvancedQueueState");
    expect(runtime).toContain("openUserDataDatabase");
    expect(runtime).toContain("planImmediateBookFills");
    expect(runtime).toContain("planPassiveObservedTradeFill");
    expect(runtime).toContain("sumPaperFillQuantityForMarketEvent");
    expect(runtime).toContain("commitPaperExecution");
    expect(hook).toContain("window.paperTradingDesktop");
    expect(hook).toContain("onAccountProjection");
    expect(hook).toContain("loadChartHistory");
    expect(hook).toContain("onProjection");
    expect(hook).not.toMatch(/KIS_APP|better-sqlite3|node:fs/);
    expect(contracts).toContain('actualOrderCapability: "FORBIDDEN"');
    expect(contracts).toContain("chartGetHistory");
    expect(contracts).toContain("DesktopChartProjection");
  });

  it("drops stale responses during rapid instrument selection", () => {
    const hook = readFileSync(
      join(rendererRoot, "hooks", "useDesktopRuntime.ts"),
      "utf8",
    );
    const runtime = readFileSync(
      join(
        process.cwd(),
        "apps",
        "desktop",
        "src",
        "main",
        "desktop-runtime.ts",
      ),
      "utf8",
    );

    expect(hook).toContain("instrumentSelectionSequence");
    expect(hook).toContain(
      "projection.instrumentId === activeInstrumentId.current",
    );
    expect(hook).toContain(
      "`${projection.instrumentId}:${projection.interval}:${projection.range}`",
    );
    expect(runtime).toContain("#marketConnectionGeneration");
    expect(runtime).toContain("isCurrentConnection()");
    expect(runtime).toContain("const selectionGeneration");
    expect(runtime).not.toContain("if (rawSymbol === this.#symbol)");
  });
});
