const { resolve } = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

const projectRoot = resolve(__dirname, "..");
const preloadPath = resolve(
  projectRoot,
  "apps",
  "desktop",
  "dist-electron",
  "apps",
  "desktop",
  "src",
  "preload",
  "preload.cjs",
);
const rendererPath = resolve(
  projectRoot,
  "apps",
  "desktop",
  "dist",
  "renderer",
  "index.html",
);

app.disableHardwareAcceleration();

app
  .whenReady()
  .then(async () => {
    ipcMain.handle("papertrading:bootstrap:get", async () => {
      throw new Error("SMOKE_RUNTIME_INTENTIONALLY_UNAVAILABLE");
    });
    ipcMain.handle("papertrading:chart:get-history", async () => {
      throw new Error("SMOKE_RUNTIME_INTENTIONALLY_UNAVAILABLE");
    });

    const window = new BrowserWindow({
      width: 1366,
      height: 800,
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    let preloadError = null;
    window.webContents.on("preload-error", (_event, _path, error) => {
      preloadError = error;
    });
    await window.loadFile(rendererPath);
    await new Promise((resolveReady) => setTimeout(resolveReady, 800));
    const result = await window.webContents.executeJavaScript(`({
      bridgeType: typeof window.paperTradingDesktop,
      hasFixtureBadge: document.body.innerText.includes("FIXTURE UI"),
      hasSyntheticChart: document.body.innerText.includes("SYNTHETIC_UI_FIXTURE"),
      hasRuntimeWaiting: document.body.innerText.includes("KIS 연결 대기 · 합성 시세 없음")
    })`);
    window.destroy();

    if (
      preloadError !== null ||
      result.bridgeType !== "object" ||
      result.hasFixtureBadge ||
      result.hasSyntheticChart ||
      !result.hasRuntimeWaiting
    ) {
      console.error(
        JSON.stringify({
          ok: false,
          preloadError: preloadError?.message ?? null,
          ...result,
        }),
      );
      app.exit(1);
      return;
    }
    console.log(JSON.stringify({ ok: true, ...result }));
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
