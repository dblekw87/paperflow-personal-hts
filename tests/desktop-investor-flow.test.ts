import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isDesktopInvestorFlowProjection,
  type DesktopInvestorFlowProjection,
} from "../apps/desktop/src/shared/desktop-contracts.js";

function flow(participant: "INDIVIDUAL" | "FOREIGN" | "INSTITUTION" | "PROGRAM") {
  return {
    participant,
    sellQuantity: "100",
    buyQuantity: "130",
    netBuyQuantity: "30",
    sellAmount: "7000000",
    buyAmount: "9100000",
    netBuyAmount: "2100000",
  } as const;
}

function validProjection(): DesktopInvestorFlowProjection {
  return {
    schemaVersion: 1,
    state: "READY",
    source: "KIS_REST",
    instrument: {
      instrumentId: "KRX:005930",
      symbol: "005930",
      name: "삼성전자",
      market: "KOSPI",
      currency: "KRW",
      investorSummary: {
        businessDate: "2026-07-20",
        quality: "PROVIDER_REPORTED_AFTER_CLOSE",
        participants: [
          flow("INDIVIDUAL"),
          flow("FOREIGN"),
          flow("INSTITUTION"),
        ],
      },
      programSummary: {
        providerTime: "15:30:00",
        quality: "PROVIDER_REPORTED_FORMING_CUMULATIVE",
        participant: flow("PROGRAM"),
      },
      statusMessage: "종목 수급 수신",
    },
    markets: (["KOSPI", "KOSDAQ"] as const).map((market) => ({
      market,
      currency: "KRW" as const,
      providerTimestamp: null,
      quality: "PROVIDER_REPORTED_SNAPSHOT_FINALITY_UNKNOWN" as const,
      participants: [
        flow("INDIVIDUAL"),
        flow("FOREIGN"),
        flow("INSTITUTION"),
      ],
      statusMessage: `${market} 수급 수신`,
    })),
    fetchedAt: "2026-07-21T06:30:00.000Z",
    statusMessage: "KIS 실제 수급 수신",
  };
}

describe("desktop investor-flow projection", () => {
  it("accepts exact stock, program and KOSPI/KOSDAQ provider projections", () => {
    expect(isDesktopInvestorFlowProjection(validProjection())).toBe(true);
    expect(
      isDesktopInvestorFlowProjection({
        ...validProjection(),
        source: "KRX_DATA_PRODUCT",
        state: "PARTIAL",
      }),
    ).toBe(true);
  });

  it("accepts KRX all-market investor-flow projections", () => {
    const projection = validProjection();
    expect(
      isDesktopInvestorFlowProjection({
        ...projection,
        state: "PARTIAL",
        source: "KRX_DATA_PRODUCT",
        markets: [
          {
            ...projection.markets[0],
            market: "ALL",
            statusMessage: "KRX 전체 시장 수급",
          },
        ],
      }),
    ).toBe(true);
  });

  it("rejects a program row inside a market projection", () => {
    const projection = validProjection();
    const unsafe = {
      ...projection,
      markets: [
        {
          ...projection.markets[0],
          participants: [
            ...projection.markets[0]!.participants.slice(0, 2),
            flow("PROGRAM"),
          ],
        },
      ],
      state: "PARTIAL",
    };
    expect(isDesktopInvestorFlowProjection(unsafe)).toBe(false);
  });

  it("rejects inconsistent net values and unavailable synthetic values", () => {
    const projection = validProjection();
    const inconsistent = {
      ...projection,
      instrument: {
        ...projection.instrument,
        investorSummary: {
          ...projection.instrument!.investorSummary,
          participants: [
            { ...flow("INDIVIDUAL"), netBuyAmount: "0" },
            flow("FOREIGN"),
            flow("INSTITUTION"),
          ],
        },
      },
    };
    expect(isDesktopInvestorFlowProjection(inconsistent)).toBe(false);
    expect(
      isDesktopInvestorFlowProjection({
        ...projection,
        state: "UNAVAILABLE",
      }),
    ).toBe(false);
    expect(
      isDesktopInvestorFlowProjection({
        schemaVersion: 1,
        state: "UNAVAILABLE",
        source: "KIS_REST",
        instrument: null,
        markets: [],
        fetchedAt: null,
        statusMessage: "수급 미수신",
      }),
    ).toBe(true);
  });
});

describe("InvestorFlowPanel safety", () => {
  it("renders explicit missing states and accessible tabs without mock values", () => {
    const component = readFileSync(
      join(
        process.cwd(),
        "apps",
        "desktop",
        "src",
        "renderer",
        "components",
        "organisms",
        "InvestorFlowPanel.tsx",
      ),
      "utf8",
    );
    expect(component).toContain('aria-label="데이터 없음"');
    expect(component).toContain('role="tablist"');
    expect(component).toContain('role="tabpanel"');
    expect(component).toContain("거래소 원천 수급을 우선");
    expect(component).toContain("KIS fallback");
    expect(component).toContain("KRX OpenAPI");
    expect(component).toContain('"ALL"');
    expect(component).toContain("없는 값을 0으로 채우지 않습니다");
    expect(component).not.toContain(">미수신<");
    expect(component).not.toMatch(/SYNTHETIC_UI_FIXTURE|FIXTURE UI|mockInvestor/i);
  });
});
