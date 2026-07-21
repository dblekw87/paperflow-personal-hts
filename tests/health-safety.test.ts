import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { HealthReportSchema } from "../src/contracts/health.js";
import type { RuntimeConfig } from "../src/config/runtime-config.js";
import { runHealth } from "../src/health/health.js";
import {
  inspectReadOnlyKisRegistry,
  isKnownKisOrderTrId,
  KIS_ORDER_TR_ID_PATTERN,
  KIS_READ_ONLY_ALLOWLIST,
} from "../src/kis/endpoints.js";
import {
  HYPERLIQUID_PUBLIC_INFO_URL,
  HYPERLIQUID_PUBLIC_WS_URL,
  inspectReadOnlyHyperliquidRegistry,
} from "../src/hyperliquid/endpoints.js";

const fixtureConfig: RuntimeConfig = {
  KIS_DATA_ENV: "paper",
  KIS_DOMESTIC_SYMBOL: "005930",
  KIS_US_EXCHANGE: "NAS",
  KIS_US_SYMBOL: "AAPL",
  CME_DATA_MODE: "proxy",
  KIS_NASDAQ_PROXY_EXCHANGE: "NAS",
  KIS_NASDAQ_PROXY_SYMBOL: "QQQ",
  KIS_RUSSELL_PROXY_EXCHANGE: "AMS",
  KIS_RUSSELL_PROXY_SYMBOL: "IWM",
  KIS_OIL_PROXY_EXCHANGE: "AMS",
  KIS_OIL_PROXY_SYMBOL: "USO",
  KIS_HEALTH_LIVE: false,
  KIS_PROBE_SECONDS: 15,
  PAPER_FILL_PROFILE: "INITIAL_CONSERVATIVE_V1",
  PAPER_QUEUE_SAFETY_FACTOR: "1.25",
};

describe("offline health and safety", () => {
  it("runs fixture health without any network request", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network must be disabled"));
    const report = await runHealth(fixtureConfig, "FIXTURE");

    expect(HealthReportSchema.parse(report)).toEqual(report);
    expect(report.overall).not.toBe("FAIL");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "database",
        status: "PASS",
        code: "SQLITE_HEALTHY",
      }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "forbidden-order-endpoints",
        status: "PASS",
        code: "READ_ONLY_REGISTRY",
      }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "hyperliquid-read-only-market-data",
        status: "PASS",
        code: "HYPERLIQUID_READ_ONLY_REGISTRY",
      }),
    );
  });

  it("contains no KIS trading endpoint or known order TR in product source", async () => {
    const files = [
      ...(await listTypeScriptFiles(join(process.cwd(), "src"))),
      ...(await listTypeScriptFiles(
        join(process.cwd(), "apps", "desktop", "src"),
      )),
    ];
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");

    expect(source).not.toMatch(/\/uapi\/[^"']*\/(?:order|trading)\b/i);
    expect(source).not.toMatch(KIS_ORDER_TR_ID_PATTERN);
    expect(inspectReadOnlyKisRegistry()).toEqual({
      valid: true,
      violations: [],
    });
    expect(KIS_READ_ONLY_ALLOWLIST).toEqual({
      paths: [
        "/oauth2/tokenP",
        "/oauth2/Approval",
        "/uapi/domestic-stock/v1/quotations/inquire-price",
        "/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn",
        "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice",
        "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
        "/uapi/domestic-stock/v1/quotations/volume-rank",
        "/uapi/domestic-stock/v1/ranking/fluctuation",
        "/uapi/domestic-stock/v1/quotations/news-title",
        "/uapi/overseas-price/v1/quotations/news-title",
        "/uapi/domestic-stock/v1/quotations/inquire-index-price",
        "/uapi/overseas-price/v1/quotations/price",
        "/uapi/overseas-price/v1/quotations/inquire-asking-price",
        "/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice",
        "/uapi/overseas-price/v1/quotations/dailyprice",
        "/uapi/overseas-stock/v1/ranking/updown-rate",
        "/uapi/overseas-stock/v1/ranking/trade-vol",
        "/uapi/overseas-stock/v1/ranking/trade-pbmn",
        "/uapi/overseas-stock/v1/ranking/trade-growth",
        "/uapi/domestic-stock/v1/quotations/inquire-investor",
        "/uapi/domestic-stock/v1/quotations/inquire-investor-time-by-market",
        "/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market",
        "/uapi/domestic-stock/v1/quotations/program-trade-by-stock",
        "/uapi/domestic-stock/v1/quotations/program-trade-by-stock-daily",
      ],
      trIds: [
        "FHKST01010100",
        "FHKST01010200",
        "FHKST03010200",
        "FHKST03010100",
        "FHPST01710000",
        "FHPST01700000",
        "FHKST01011800",
        "HHPSTH60100C1",
        "FHPUP02100000",
        "HHDFS00000300",
        "HHDFS76200100",
        "HHDFS76950200",
        "HHDFS76240000",
        "HHDFS76290000",
        "HHDFS76310010",
        "HHDFS76320010",
        "HHDFS76330000",
        "FHKST01010900",
        "FHPTJ04030000",
        "FHPTJ04040000",
        "FHPPG04650101",
        "FHPPG04650201",
        "H0STASP0",
        "H0STCNT0",
        "H0NXASP0",
        "H0NXCNT0",
        "H0NXMKO0",
        "H0UNASP0",
        "H0UNCNT0",
        "HDFSASP0",
        "HDFSCNT0",
      ],
    });
  });

  it("contains no Hyperliquid signed-action endpoint in product source", async () => {
    const files = [
      ...(await listTypeScriptFiles(join(process.cwd(), "src"))),
      ...(await listTypeScriptFiles(
        join(process.cwd(), "apps", "desktop", "src"),
      )),
    ];
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");

    expect(source).not.toContain(["api.hyperliquid.xyz", "exchange"].join("/"));
    expect(HYPERLIQUID_PUBLIC_INFO_URL).toBe(
      "https://api.hyperliquid.xyz/info",
    );
    expect(HYPERLIQUID_PUBLIC_WS_URL).toBe("wss://api.hyperliquid.xyz/ws");
    expect(inspectReadOnlyHyperliquidRegistry()).toEqual({
      valid: true,
      violations: [],
    });
  });

  it.each([
    "TTTC0011U",
    "VTTC0012U",
    "TTTT1002U",
    "VTTT1001U",
    "TTTS1002U",
    "VTTS1001U",
  ])("recognizes real domestic and overseas order TR family %s", (trId) => {
    expect(isKnownKisOrderTrId(trId)).toBe(true);
  });

  it("does not leak obvious secret fields in fixture health JSON", async () => {
    const report = await runHealth(
      {
        ...fixtureConfig,
        KIS_APP_KEY: "A".repeat(32),
        KIS_APP_SECRET: "S".repeat(32),
      },
      "FIXTURE",
    );
    const json = JSON.stringify(report);
    expect(json).not.toContain("A".repeat(32));
    expect(json).not.toContain("S".repeat(32));
    expect(json).not.toMatch(/approval_key|access_token|appsecret/i);
  });
});

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return listTypeScriptFiles(path);
      }
      return entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
        ? [path]
        : [];
    }),
  );
  return nested.flat();
}
