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
import { mkdir, writeFile } from "node:fs/promises";

import {
  DESKTOP_CHANNELS,
  isAllowedExternalInformationUrl,
  type DesktopChartInterval,
  type DesktopChartRange,
  type DesktopRankingSort,
} from "../shared/desktop-contracts.js";
import { DesktopRuntimeClient } from "./desktop-runtime-client.js";

const APP_METADATA_CHANNEL = DESKTOP_CHANNELS.appMetadata;
const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

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
    DESKTOP_CHANNELS.chartGetHistory,
    DESKTOP_CHANNELS.rankingGet,
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
      if (typeof symbol !== "string" || !/^[0-9A-Z]{6,7}$/.test(symbol)) {
        throw new Error("Unsupported domestic instrument symbol.");
      }
      return runtime.selectInstrument(symbol);
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
    async (event, sort: unknown) => {
      if (!isTrustedIpcSender(event)) {
        throw new Error("Untrusted renderer frame.");
      }
      if (
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
      return runtime.getDomesticRanking(sort as DesktopRankingSort);
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

  if (process.argv.includes("--diagnostic-smoke")) {
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
