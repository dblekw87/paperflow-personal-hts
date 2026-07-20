import { describe, expect, it } from "vitest";

import {
  averagePaperPositionPrice,
  valuePaperPosition,
} from "../apps/desktop/src/shared/paper-valuation.js";

describe("local paper position valuation", () => {
  it("keeps a weighted average price in the local fill ledger", () => {
    expect(
      averagePaperPositionPrice(
        [
          { side: "BUY", price: "100", quantity: "10" },
          { side: "BUY", price: "120", quantity: "10" },
          { side: "SELL", price: "130", quantity: "5" },
        ],
        "15",
      ),
    ).toBe("110");
  });

  it("marks the local position to the provider market price", () => {
    expect(
      valuePaperPosition({
        quantity: "15",
        averagePrice: "110",
        marketPrice: "120",
      }),
    ).toEqual({
      averagePrice: "110",
      marketValueMinor: "1800",
      unrealizedPnlMinor: "150",
      unrealizedReturnRate: "9.0909",
    });
  });

  it("does not invent a valuation without a holding or market price", () => {
    expect(
      valuePaperPosition({
        quantity: "0",
        averagePrice: null,
        marketPrice: "120",
      }),
    ).toMatchObject({
      marketValueMinor: null,
      unrealizedPnlMinor: null,
      unrealizedReturnRate: null,
    });
  });

  it("fails closed when fills and the stored DB position disagree", () => {
    expect(() =>
      averagePaperPositionPrice(
        [{ side: "BUY", price: "100", quantity: "2" }],
        "3",
      ),
    ).toThrow(/do not match/);
  });
});
