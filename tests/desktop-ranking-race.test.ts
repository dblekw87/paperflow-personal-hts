import { describe, expect, it } from "vitest";

import { isCurrentDesktopRankingResponse } from "../apps/desktop/src/shared/desktop-contracts.js";
import { projectDomesticFluctuationItems } from "../apps/desktop/src/main/desktop-runtime.js";

const fluctuationCandidates = [
  {
    rank: "1",
    symbol: "111111",
    name: "상승소형주",
    price: "1250",
    change: "250",
    changeRate: "25.00",
    cumulativeVolume: "9000000",
    highPrice: "1300",
    lowPrice: "980",
    periodChange: null,
    periodChangeRate: null,
  },
  {
    rank: "2",
    symbol: "222222",
    name: "하락소형주",
    price: "810",
    change: "-190",
    changeRate: "-19.00",
    cumulativeVolume: "12000000",
    highPrice: "1010",
    lowPrice: "790",
    periodChange: null,
    periodChangeRate: null,
  },
  {
    rank: "3",
    symbol: "333333",
    name: "보통상승주",
    price: "5300",
    change: "300",
    changeRate: "6.00",
    cumulativeVolume: "500000",
    highPrice: "5400",
    lowPrice: "5000",
    periodChange: null,
    periodChangeRate: null,
  },
  {
    rank: "4",
    symbol: "444444",
    name: "정확한상한가",
    price: "1300",
    change: "300",
    changeRate: "30.00",
    cumulativeVolume: "1000000",
    highPrice: "1300",
    lowPrice: "1000",
    periodChange: null,
    periodChangeRate: null,
  },
] as const;

describe("desktop ranking latest-wins guard", () => {
  it("accepts only the current request with the requested sort", () => {
    expect(
      isCurrentDesktopRankingResponse({
        requestSequence: 3,
        currentSequence: 3,
        requestedSort: "TURNOVER",
        responseSort: "TURNOVER",
      }),
    ).toBe(true);
  });

  it("rejects a slow previous request and a mismatched response", () => {
    expect(
      isCurrentDesktopRankingResponse({
        requestSequence: 2,
        currentSequence: 3,
        requestedSort: "TURNOVER",
        responseSort: "TURNOVER",
      }),
    ).toBe(false);
    expect(
      isCurrentDesktopRankingResponse({
        requestSequence: 3,
        currentSequence: 3,
        requestedSort: "VOLUME_INCREASE",
        responseSort: "TURNOVER",
      }),
    ).toBe(false);
  });

  it("separates and locally ranks KIS gainers and losers without invented turnover", () => {
    const gainers = projectDomesticFluctuationItems(
      fluctuationCandidates,
      "CHANGE_RATE_GAINERS",
    );
    const losers = projectDomesticFluctuationItems(
      fluctuationCandidates,
      "CHANGE_RATE_LOSERS",
    );
    expect(gainers.map((item) => item.symbol)).toEqual([
      "444444",
      "111111",
      "333333",
    ]);
    expect(losers.map((item) => item.symbol)).toEqual(["222222"]);
    expect(gainers[0]).toMatchObject({
      rank: "1",
      cumulativeVolume: "1000000",
      cumulativeTurnover: null,
    });
  });
});
