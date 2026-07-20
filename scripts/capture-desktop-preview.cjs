const { mkdir, writeFile } = require("node:fs/promises");
const { mkdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { app, BrowserWindow } = require("electron");

const projectRoot = resolve(__dirname, "..");
const imageDirectory = resolve(projectRoot, "docs", "images");
const outputPath = resolve(imageDirectory, "paperflow-dashboard.png");
const ordersOutputPath = resolve(
  imageDirectory,
  "paperflow-orders.png",
);
const rankingsOutputPath = resolve(
  imageDirectory,
  "paperflow-rankings.png",
);
const newsOutputPath = resolve(
  imageDirectory,
  "paperflow-news.png",
);
const compactOutputPath = resolve(
  imageDirectory,
  "paperflow-responsive.png",
);
const lightOutputPath = resolve(imageDirectory, "paperflow-light.png");
const captureProfilePath = resolve(projectRoot, ".capture-electron-profile");

const wait = (milliseconds) =>
  new Promise((resolveReady) => setTimeout(resolveReady, milliseconds));

async function captureSettled(window, milliseconds = 500) {
  await wait(milliseconds);
  return window.webContents.capturePage();
}

mkdirSync(captureProfilePath, { recursive: true });
app.setPath("userData", captureProfilePath);
app.disableHardwareAcceleration();
const failTimer = setTimeout(() => app.exit(2), 15_000);

app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      width: 1800,
      height: 1040,
      show: true,
      backgroundColor: "#090c11",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.on("console-message", (_event, details) => {
      console.log(`[renderer:${details.level}] ${details.message}`);
    });
    window.webContents.on(
      "did-fail-load",
      (_event, code, description, validatedUrl) => {
        console.error(`load failed ${code} ${description} ${validatedUrl}`);
      },
    );
    await window.loadFile(
      resolve(projectRoot, "apps", "desktop", "dist", "renderer", "index.html"),
      { query: { theme: "dark" } },
    );
    await wait(900);
    const diagnostics = await window.webContents.executeJavaScript(
      "({ text: document.body.innerText.slice(0, 120), htmlLength: document.body.innerHTML.length })",
    );
    console.log(JSON.stringify(diagnostics));
    await mkdir(imageDirectory, { recursive: true });
    await window.webContents.executeJavaScript(
      "document.querySelectorAll('.navigation-rail nav button')[1]?.click()",
    );
    const rankingsImage = await captureSettled(window);
    await writeFile(rankingsOutputPath, rankingsImage.toPNG());
    await window.webContents.executeJavaScript(
      "document.querySelectorAll('.navigation-rail nav button')[0]?.click()",
    );
    const image = await captureSettled(window);
    await writeFile(outputPath, image.toPNG());
    await window.webContents.executeJavaScript(
      "document.querySelectorAll('.navigation-rail nav button')[3]?.click()",
    );
    await wait(700);
    console.log(
      await window.webContents.executeJavaScript(
        "document.querySelector('.pt-functional-page h1')?.textContent ?? 'page-missing'",
      ),
    );
    const ordersImage = await captureSettled(window, 200);
    await writeFile(ordersOutputPath, ordersImage.toPNG());
    await window.webContents.executeJavaScript(
      "document.querySelectorAll('.navigation-rail nav button')[4]?.click()",
    );
    const newsImage = await captureSettled(window);
    await writeFile(newsOutputPath, newsImage.toPNG());
    window.setSize(1366, 800);
    await window.webContents.executeJavaScript(
      "document.querySelectorAll('.navigation-rail nav button')[0]?.click()",
    );
    const compactImage = await captureSettled(window, 600);
    await writeFile(compactOutputPath, compactImage.toPNG());
    window.setSize(1800, 1040);
    await window.webContents.executeJavaScript(
      "document.documentElement.setAttribute('data-theme', 'light')",
    );
    const lightImage = await captureSettled(window, 600);
    await writeFile(lightOutputPath, lightImage.toPNG());
    window.destroy();
    clearTimeout(failTimer);
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    clearTimeout(failTimer);
    app.exit(1);
  });
