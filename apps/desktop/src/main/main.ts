import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

import {
  DESKTOP_CHANNELS,
  isAllowedExternalInformationUrl,
  isSearchableDomesticInstrumentQuery,
  isSearchableUsInstrumentQuery,
  type DesktopChartInterval,
  type DesktopChartRange,
  type DesktopRankingSort,
} from "../shared/desktop-contracts.js";
import { DesktopRuntimeClient } from "./desktop-runtime-client.js";

const APP_METADATA_CHANNEL = DESKTOP_CHANNELS.appMetadata;
const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const PORTFOLIO_CAPTURE_MODE = process.argv.includes("--portfolio-capture");

if (PORTFOLIO_CAPTURE_MODE) {
  const captureProfilePath = resolve(
    process.cwd(),
    ".capture-live-electron-profile",
  );
  mkdirSync(captureProfilePath, { recursive: true });
  app.setPath("userData", captureProfilePath);
}

const currentDirectory = dirname(fileURLToPath(import.meta.url));
// Sandboxed Electron preload scripts run in a restricted CommonJS context.
// The TypeScript ESM output cannot execute there, so the build emits a
// standalone CommonJS bundle at this path.
const preloadPath = join(currentDirectory, "..", "preload", "preload.cjs");
const packagedRendererPath = join(
  currentDirectory,
  "..",
  "..",
  "..",
  "..",
  "..",
  "dist",
  "renderer",
  "index.html",
);

let mainWindow: BrowserWindow | null = null;
let trustedRendererUrl: URL | null = null;
let desktopRuntime: DesktopRuntimeClient | null = null;
let shutdownStarted = false;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveReady) => setTimeout(resolveReady, milliseconds));
}

async function waitForRendererCondition(
  window: BrowserWindow,
  expression: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = (await window.webContents
      .executeJavaScript(`Boolean(${expression})`)
      .catch(() => false)) as boolean;
    if (ready) return;
    await wait(500);
  }
  const diagnostics = await window.webContents
    .executeJavaScript(`({
      chartCandles: document.querySelectorAll(".market-chart__candle").length,
      chartText: [...document.querySelectorAll("body *")]
        .map((element) => element.textContent?.trim() ?? "")
        .find((value) => value.startsWith("차트 ·")) ?? null,
      hasPartialLookup: document.body.innerText.includes("부분 조회"),
      quote: document.querySelector(".pt-instrument-header__quote")?.innerText ?? null
    })`)
    .catch(() => null);
  throw new Error(
    `Portfolio capture data condition timed out: ${expression} · ${JSON.stringify(diagnostics)}`,
  );
}

async function capturePortfolioPage(
  window: BrowserWindow,
  outputPath: string,
): Promise<void> {
  await wait(350);
  const image = await window.webContents.capturePage();
  await writeFile(outputPath, image.toPNG());
}

async function capturePortfolioElement(
  window: BrowserWindow,
  selector: string,
  outputPath: string,
): Promise<void> {
  await wait(350);
  const rect = (await window.webContents.executeJavaScript(
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (element === null) return null;
      const bounds = element.getBoundingClientRect();
      const x = Math.max(0, Math.floor(bounds.left));
      const y = Math.max(0, Math.floor(bounds.top));
      return {
        x,
        y,
        width: Math.max(
          1,
          Math.min(Math.ceil(bounds.width), window.innerWidth - x)
        ),
        height: Math.max(
          1,
          Math.min(Math.ceil(bounds.height), window.innerHeight - y)
        )
      };
    })()`,
  )) as { x: number; y: number; width: number; height: number } | null;
  if (rect === null) {
    throw new Error(`Portfolio capture element not found: ${selector}`);
  }
  const image = await window.webContents.capturePage(rect);
  await writeFile(outputPath, image.toPNG());
}

async function capturePortfolio(window: BrowserWindow): Promise<void> {
  const imageDirectory = resolve(process.cwd(), "docs", "images");
  await mkdir(imageDirectory, { recursive: true });

  await window.webContents.executeJavaScript(
    `document.querySelector('button[aria-label="시장 대시보드"]')?.click();
     window.scrollTo(0, 0)`,
  );
  await waitForRendererCondition(
    window,
    `document.querySelector('button[aria-label="시장 대시보드"].active') !== null &&
      !document.body.innerText.includes("FIXTURE UI") &&
      !document.body.innerText.includes("SYNTHETIC_UI_FIXTURE") &&
      document.querySelectorAll(".pt-order-book__row").length >= 20 &&
      document.querySelectorAll(".market-chart__candle").length > 0 &&
      !document.body.innerText.includes("부분 조회") &&
      !["", "—"].includes(
        document.querySelector(".pt-instrument-header__quote")?.innerText?.trim() ?? ""
      )`,
    45_000,
  );
  await capturePortfolioPage(
    window,
    join(imageDirectory, "paperflow-dashboard.png"),
  );
  await capturePortfolioElement(
    window,
    ".market-chart",
    join(imageDirectory, "paperflow-chart.png"),
  );

  await window.webContents.executeJavaScript(
    `(() => {
      const input = document.querySelector('input[aria-label="국내 종목 검색"]');
      if (!(input instanceof HTMLInputElement)) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(input, "삼");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    })()`,
  );
  await waitForRendererCondition(
    window,
    `document.querySelectorAll(".global-search__result").length >= 3`,
    30_000,
  );
  await capturePortfolioPage(
    window,
    join(imageDirectory, "paperflow-search.png"),
  );
  await window.webContents.executeJavaScript(
    `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
  );

  await waitForRendererCondition(
    window,
    `document.querySelectorAll(".pt-theme-leaders__list > li").length > 0 &&
      (
        document.querySelectorAll(".pt-news__list > li").length > 0 ||
        document.querySelectorAll(".pt-news__context > button").length > 0 ||
        document.body.innerText.includes("선택 종목 ID가 공급자 메타데이터에 정확히 연결")
      )`,
    45_000,
  );
  await window.webContents.executeJavaScript(
    `document.querySelector(".insight-grid")?.scrollIntoView({ block: "start" })`,
  );
  await capturePortfolioPage(
    window,
    join(imageDirectory, "paperflow-insights.png"),
  );

  await window.webContents.executeJavaScript(
    `document.querySelector('button[aria-label="종목 순위"]')?.click()`,
  );
  await waitForRendererCondition(
    window,
    `document.querySelectorAll(".pt-ranking-table-wrap tbody tr").length >= 10`,
    45_000,
  );
  await capturePortfolioPage(
    window,
    join(imageDirectory, "paperflow-rankings.png"),
  );

  await window.webContents.executeJavaScript(
    `document.querySelector('button[aria-label="뉴스와 공시"]')?.click()`,
  );
  await waitForRendererCondition(
    window,
    `document.querySelectorAll(".pt-information-feed > li").length > 0`,
    45_000,
  );
  await capturePortfolioPage(
    window,
    join(imageDirectory, "paperflow-news.png"),
  );

  await window.webContents.executeJavaScript(
    `document.querySelector('button[aria-label="시장 대시보드"]')?.click();
     window.scrollTo(0, 0)`,
  );
  await waitForRendererCondition(
    window,
    `document.querySelectorAll(".market-chart__candle").length > 0`,
    15_000,
  );
  window.setSize(1366, 800);
  await capturePortfolioPage(
    window,
    join(imageDirectory, "paperflow-responsive.png"),
  );

  window.setSize(1800, 1040);
  await window.webContents.executeJavaScript(
    `document.documentElement.setAttribute("data-theme", "light");
     window.scrollTo(0, 0)`,
  );
  await capturePortfolioPage(
    window,
    join(imageDirectory, "paperflow-light.png"),
  );

  const evidence = await window.webContents.executeJavaScript(`({
    hasFixtureBadge: document.body.innerText.includes("FIXTURE UI"),
    hasSyntheticChart: document.body.innerText.includes("SYNTHETIC_UI_FIXTURE"),
    orderBookRows: document.querySelectorAll(".pt-order-book__row").length,
    chartCandles: document.querySelectorAll(".market-chart__candle").length,
    themeCandidates: document.querySelectorAll(".pt-theme-leaders__list > li").length,
    dashboardNews: document.querySelectorAll(".pt-news__list > li").length,
    quoteText: document.querySelector(".pt-instrument-header__quote")?.innerText ?? null
  })`);
  console.log(JSON.stringify({ portfolioCapture: true, ...evidence }));
}

function getDevelopmentRendererUrl(): URL | null {
  if (app.isPackaged) {
    return null;
  }

  const configuredUrl = process.env["VITE_DEV_SERVER_URL"]?.trim();
  const rawUrl =
    configuredUrl ||
    (process.argv.includes("--dev") ? "http://127.0.0.1:5173" : undefined);
  if (!rawUrl) {
    return null;
  }

  const url = new URL(rawUrl);
  const isLocalHttp =
    (url.protocol === "http:" || url.protocol === "https:") &&
    LOCAL_DEV_HOSTS.has(url.hostname);

  if (!isLocalHttp || url.username || url.password) {
    throw new Error(
      "VITE_DEV_SERVER_URL must use HTTP(S) on localhost without credentials.",
    );
  }

  return url;
}

function normalizeFilePath(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isTrustedRendererLocation(candidateUrl: string): boolean {
  if (!trustedRendererUrl) {
    return false;
  }

  let candidate: URL;
  try {
    candidate = new URL(candidateUrl);
  } catch {
    return false;
  }

  if (trustedRendererUrl.protocol === "file:") {
    if (candidate.protocol !== "file:") {
      return false;
    }

    return (
      normalizeFilePath(fileURLToPath(candidate)) ===
      normalizeFilePath(fileURLToPath(trustedRendererUrl))
    );
  }

  return (
    candidate.protocol === trustedRendererUrl.protocol &&
    candidate.origin === trustedRendererUrl.origin
  );
}

function isTrustedIpcSender(event: IpcMainInvokeEvent): boolean {
  const window = mainWindow;
  if (!window || window.isDestroyed()) {
    return false;
  }

  return (
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    isTrustedRendererLocation(event.senderFrame.url)
  );
}

function registerDesktopIpc(runtime: DesktopRuntimeClient): void {
  ipcMain.removeHandler(APP_METADATA_CHANNEL);
  ipcMain.handle(APP_METADATA_CHANNEL, (event) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error("Untrusted renderer frame.");
    }

    return {
      name: app.getName(),
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      platform: process.platform,
      packaged: app.isPackaged,
    };
  });

  for (const channel of [
    DESKTOP_CHANNELS.bootstrapGet,
    DESKTOP_CHANNELS.marketConnect,
    DESKTOP_CHANNELS.marketDisconnect,
    DESKTOP_CHANNELS.marketSelectInstrument,
    DESKTOP_CHANNELS.watchlistQuotesGet,
    DESKTOP_CHANNELS.chartGetHistory,
    DESKTOP_CHANNELS.rankingGet,
    DESKTOP_CHANNELS.investorFlowGet,
    DESKTOP_CHANNELS.shortSellingGet,
    DESKTOP_CHANNELS.instrumentSearch,
    DESKTOP_CHANNELS.marketContextGet,
    DESKTOP_CHANNELS.marketCalendarGet,
    DESKTOP_CHANNELS.informationGet,
    DESKTOP_CHANNELS.informationOpenExternal,
    DESKTOP_CHANNELS.paperSubmit,
  ]) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(DESKTOP_CHANNELS.bootstrapGet, async (event) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error("Untrusted renderer frame.");
    }
    return runtime.getBootstrap();
  });
  ipcMain.handle(DESKTOP_CHANNELS.marketConnect, async (event) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error("Untrusted renderer frame.");
    }
    return runtime.connectMarketReadOnly();
  });
  ipcMain.handle(DESKTOP_CHANNELS.marketDisconnect, async (event) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error("Untrusted renderer frame.");
    }
    return runtime.disconnectMarket();
  });
  ipcMain.handle(
    DESKTOP_CHANNELS.marketSelectInstrument,
    async (event, symbol: unknown) => {
      if (!isTrustedIpcSender(event)) {
        throw new Error("Untrusted renderer frame.");
      }
      if (typeof symbol !== "string" || !/^(?:[0-9A-Z]{6,7}|(?:NAS|NYS|AMS):[A-Z0-9.-]{1,20})$/.test(symbol)) {
        throw new Error("Unsupported instrument symbol.");
      }
      return runtime.selectInstrument(symbol);
    },
  );
  ipcMain.handle(
    DESKTOP_CHANNELS.watchlistQuotesGet,
    async (event, symbols: unknown) => {
      if (!isTrustedIpcSender(event)) throw new Error("Untrusted renderer frame.");
      if (!Array.isArray(symbols) || symbols.length > 50 || !symbols.every((symbol) => typeof symbol === "string" && /^[0-9A-Z]{6,7}$/.test(symbol))) {
        throw new Error("Unsupported watchlist symbols.");
      }
      return runtime.getWatchlistQuotes(symbols);
    },
  );
  ipcMain.handle(
    DESKTOP_CHANNELS.chartGetHistory,
    async (event, interval: unknown, range: unknown) => {
      if (!isTrustedIpcSender(event)) {
        throw new Error("Untrusted renderer frame.");
      }
      if (
        typeof interval !== "string" ||
        !["1m", "5m", "15m", "30m", "60m", "4h", "1d", "1w"].includes(
          interval,
        )
      ) {
        throw new Error("Unsupported chart interval.");
      }
      if (
        typeof range !== "string" ||
        !["1D", "6M", "1Y", "5Y"].includes(range)
      ) {
        throw new Error("Unsupported chart range.");
      }
      const isIntraday = [
        "1m",
        "5m",
        "15m",
        "30m",
        "60m",
        "4h",
      ].includes(interval);
      if ((isIntraday && range !== "1D") || (!isIntraday && range === "1D")) {
        throw new Error("Chart interval and range are incompatible.");
      }
      return runtime.getChartHistory(
        interval as DesktopChartInterval,
        range as DesktopChartRange,
      );
    },
  );
  ipcMain.handle(
    DESKTOP_CHANNELS.rankingGet,
    async (event, market: unknown, sort: unknown) => {
      if (!isTrustedIpcSender(event)) {
        throw new Error("Untrusted renderer frame.");
      }
      if (!["KRX", "US"].includes(String(market)) ||
        typeof sort !== "string" ||
        ![
          "AVERAGE_VOLUME",
          "VOLUME_INCREASE",
          "TURNOVER",
          "CHANGE_RATE_GAINERS",
          "CHANGE_RATE_LOSERS",
        ].includes(sort)
      ) {
        throw new Error("Unsupported ranking sort.");
      }
      return runtime.getRanking(market as "KRX" | "US", sort as DesktopRankingSort);
    },
  );
  ipcMain.handle(DESKTOP_CHANNELS.investorFlowGet, async (event) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error("Untrusted renderer frame.");
    }
    return runtime.getInvestorFlow();
  });
  ipcMain.handle(DESKTOP_CHANNELS.shortSellingGet, async (event) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error("Untrusted renderer frame.");
    }
    return runtime.getShortSelling();
  });
  ipcMain.handle(
    DESKTOP_CHANNELS.instrumentSearch,
    async (event, query: unknown, region: unknown = "KR") => {
      if (!isTrustedIpcSender(event)) {
        throw new Error("Untrusted renderer frame.");
      }
      if (
        (region === "US"
          ? !isSearchableUsInstrumentQuery(query)
          : !isSearchableDomesticInstrumentQuery(query))
      ) {
        throw new Error("Unsupported instrument search query.");
      }
      const normalizedQuery = String(query).trim();
      return region === "US"
        ? runtime.searchUsInstruments(normalizedQuery)
        : runtime.searchDomesticInstruments(normalizedQuery);
    },
  );
  ipcMain.handle(
    DESKTOP_CHANNELS.marketContextGet,
    async (event, forceRefresh: unknown) => {
      if (!isTrustedIpcSender(event)) {
        throw new Error("Untrusted renderer frame.");
      }
      if (typeof forceRefresh !== "boolean") {
        throw new Error("Invalid market-context refresh request.");
      }
      return runtime.getMarketContext(forceRefresh);
    },
  );
  ipcMain.handle(
    DESKTOP_CHANNELS.marketCalendarGet,
    async (event, forceRefresh: unknown) => {
      if (!isTrustedIpcSender(event)) {
        throw new Error("Untrusted renderer frame.");
      }
      if (typeof forceRefresh !== "boolean") {
        throw new Error("Invalid market-calendar refresh request.");
      }
      return runtime.getMarketCalendar(forceRefresh);
    },
  );
  ipcMain.handle(
    DESKTOP_CHANNELS.informationGet,
    async (event, forceRefresh: unknown) => {
      if (!isTrustedIpcSender(event)) {
        throw new Error("Untrusted renderer frame.");
      }
      if (typeof forceRefresh !== "boolean") {
        throw new Error("Invalid information refresh request.");
      }
      return runtime.getInformationFeed(forceRefresh);
    },
  );
  ipcMain.handle(
    DESKTOP_CHANNELS.informationOpenExternal,
    async (event, rawUrl: unknown) => {
      if (!isTrustedIpcSender(event)) {
        throw new Error("Untrusted renderer frame.");
      }
      if (!isAllowedExternalInformationUrl(rawUrl)) {
        throw new Error("Unsupported external information URL.");
      }
      await shell.openExternal(rawUrl, { activate: true });
      return true;
    },
  );
  ipcMain.handle(
    DESKTOP_CHANNELS.paperSubmit,
    async (event, request: unknown) => {
      if (!isTrustedIpcSender(event)) {
        throw new Error("Untrusted renderer frame.");
      }
      return runtime.submitPaperOrder(request);
    },
  );
}

function applySessionSecurityPolicy(): void {
  const appSession = session.defaultSession;

  appSession.setPermissionCheckHandler(() => false);
  appSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => {
      callback(false);
    },
  );
}

function applyWindowNavigationPolicy(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  window.webContents.on("will-navigate", (event, navigationUrl) => {
    if (!isTrustedRendererLocation(navigationUrl)) {
      event.preventDefault();
    }
  });

  window.webContents.on("will-redirect", (event, navigationUrl) => {
    if (!isTrustedRendererLocation(navigationUrl)) {
      event.preventDefault();
    }
  });

  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}

async function createMainWindow(): Promise<void> {
  const developmentUrl = getDevelopmentRendererUrl();
  trustedRendererUrl = developmentUrl ?? pathToFileURL(packagedRendererPath);

  const window = new BrowserWindow({
    width: 1800,
    height: 1040,
    minWidth: 1366,
    minHeight: 800,
    show: false,
    backgroundColor: "#0b0f14",
    title: "PaperTrading HTS",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  mainWindow = window;
  applyWindowNavigationPolicy(window);

  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) {
      window.show();
    }
  });

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  if (developmentUrl) {
    await window.loadURL(developmentUrl.toString());
  } else {
    await window.loadFile(packagedRendererPath);
  }

  if (PORTFOLIO_CAPTURE_MODE) {
    await capturePortfolio(window);
    window.close();
  } else if (process.argv.includes("--diagnostic-smoke")) {
    await new Promise((resolveReady) => setTimeout(resolveReady, 12_000));
    const result = (await window.webContents.executeJavaScript(`({
      bridgeType: typeof window.paperTradingDesktop,
      hasFixtureBadge: document.body.innerText.includes("FIXTURE UI"),
      hasSyntheticChart: document.body.innerText.includes("SYNTHETIC_UI_FIXTURE"),
      hasKisLive: document.body.innerText.includes("KIS LIVE · READ ONLY"),
      hasSqliteReady: document.body.innerText.includes("SQLite READY"),
      hasProjectionError: document.body.innerText.includes("Electron 로컬 projection을 불러오지 못했습니다."),
      quoteText: document.querySelector(".pt-instrument-header__quote")?.innerText ?? null,
      sessionText: document.querySelector(".pt-instrument-header__session")?.innerText ?? null,
      chartIdentity: document.querySelector(".market-chart__identity")?.innerText ?? null
    })`)) as Record<string, unknown>;
    const artifactDirectory = resolve(process.cwd(), "artifacts");
    const diagnosticImagePath = join(
      artifactDirectory,
      "papertrading-live-diagnostic.png",
    );
    await mkdir(artifactDirectory, { recursive: true });
    const image = await window.webContents.capturePage();
    await writeFile(diagnosticImagePath, image.toPNG());
    console.log(JSON.stringify({ desktopDiagnostic: true, ...result }));
    window.close();
  }
}

void app
  .whenReady()
  .then(async () => {
    app.setAppUserModelId("com.papertrading.hts");
    applySessionSecurityPolicy();
    desktopRuntime = await DesktopRuntimeClient.start({
      userDataPath: app.getPath("userData"),
      emitMarket: (projection) => {
        const window = mainWindow;
        if (
          window !== null &&
          !window.isDestroyed() &&
          isTrustedRendererLocation(window.webContents.mainFrame.url)
        ) {
          window.webContents.send(
            DESKTOP_CHANNELS.marketProjection,
            projection,
          );
        }
      },
      emitAccount: (projection) => {
        const window = mainWindow;
        if (
          window !== null &&
          !window.isDestroyed() &&
          isTrustedRendererLocation(window.webContents.mainFrame.url)
        ) {
          window.webContents.send(
            DESKTOP_CHANNELS.accountProjection,
            projection,
          );
        }
      },
      emitChart: (projection) => {
        const window = mainWindow;
        if (
          window !== null &&
          !window.isDestroyed() &&
          isTrustedRendererLocation(window.webContents.mainFrame.url)
        ) {
          window.webContents.send(
            DESKTOP_CHANNELS.chartProjection,
            projection,
          );
        }
      },
    });
    registerDesktopIpc(desktopRuntime);
    await createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow().catch(() => {
          app.quit();
        });
      }
    });
  })
  .catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown startup error";
    console.error(`PaperTrading desktop startup failed: ${message}`);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (shutdownStarted || desktopRuntime === null) {
    return;
  }
  event.preventDefault();
  shutdownStarted = true;
  const runtime = desktopRuntime;
  desktopRuntime = null;
  void runtime.close().finally(() => {
    app.quit();
  });
});
