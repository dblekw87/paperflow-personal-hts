import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isDesktopShortSellingProjection } from "../apps/desktop/src/shared/desktop-contracts.js";

describe("ShortSellingPanel safety", () => {
  it("accepts KRX trade projections without requiring balance providers", () => {
    expect(
      isDesktopShortSellingProjection({
        schemaVersion: 1,
        state: "PARTIAL",
        source: "KRX_DATA_PRODUCT",
        instrumentId: "KRX:005930",
        symbol: "005930",
        marketScope: "KR",
        fetchedAt: "2026-07-22T00:00:00.000Z",
        trade: {
          businessDate: "2026-07-21",
          shortSellVolume: "1234",
          shortSellTurnover: "319606",
          shortSellRatio: "6.12",
        },
        balance: null,
        lendingBalance: null,
        statusMessage: "KRX 공매도 거래 수신",
      }),
    ).toBe(true);
  });

  it("renders unsupported provider states without synthetic short-selling values", () => {
    const component = readFileSync(
      join(
        process.cwd(),
        "apps",
        "desktop",
        "src",
        "renderer",
        "components",
        "organisms",
        "ShortSellingPanel.tsx",
      ),
      "utf8",
    );
    expect(component).toContain("KRX 공매도 거래·잔고");
    expect(component).toContain("FINRA/거래소 short interest");
    expect(component).toContain("미제공");
    expect(component).toContain("KRX CSV");
    expect(component).toContain("shortSellTurnover");
    expect(component).toContain("shortSellRatio");
    expect(component).toContain("공매도 주문 금지는 유지");
    expect(component).not.toMatch(/SYNTHETIC_UI_FIXTURE|mockShort|shortRatio:|shortBalance:/i);
  });

  it("is mounted in the trading workspace", () => {
    const app = readFileSync(
      join(
        process.cwd(),
        "apps",
        "desktop",
        "src",
        "renderer",
        "app",
        "App.tsx",
      ),
      "utf8",
    );
    expect(app).toContain("ShortSellingPanel");
    expect(app).toContain('marketScope={isUsSelection ? "US" : "KR"}');
    expect(app).toContain("projection={desktop.shortSelling}");
    expect(app).toContain("desktop.loadShortSelling()");
  });
});
