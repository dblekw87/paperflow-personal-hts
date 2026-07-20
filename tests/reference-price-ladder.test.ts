import { describe, expect, it } from "vitest";

import { buildReferencePriceLadder } from "../apps/desktop/src/renderer/features/orderbook/reference-price-ladder.js";

describe("reference price ladder", () => {
  it("builds ten display-only KOSDAQ stock levels around the real anchor", () => {
    const ladder = buildReferencePriceLadder({
      anchorPrice: "15970",
      previousClosePrice: "15970",
      market: "KOSDAQ",
      securityType: "STOCK",
    });

    expect(ladder.asks).toHaveLength(10);
    expect(ladder.bids).toHaveLength(10);
    expect(ladder.asks.at(-1)).toMatchObject({
      price: "16,000",
      quantity: "—",
    });
    expect(ladder.bids[0]).toMatchObject({
      price: "15,900",
      quantity: "—",
    });
  });

  it("uses the different KOSPI and KOSDAQ stock ticks above 100,000 won", () => {
    const kospi = buildReferencePriceLadder({
      anchorPrice: "244000",
      previousClosePrice: "244000",
      market: "KOSPI",
      securityType: "STOCK",
    });
    const kosdaq = buildReferencePriceLadder({
      anchorPrice: "244000",
      previousClosePrice: "244000",
      market: "KOSDAQ",
      securityType: "STOCK",
    });

    expect(kospi.asks.at(-1)?.price).toBe("244,500");
    expect(kosdaq.asks.at(-1)?.price).toBe("244,100");
  });

  it("crosses a tick-size boundary without skipping its first valid price", () => {
    const ladder = buildReferencePriceLadder({
      anchorPrice: "999",
      previousClosePrice: "999",
      market: "KOSPI",
      securityType: "STOCK",
    });

    expect(ladder.asks.at(-1)?.price).toBe("1,000");
    expect(ladder.bids[0]?.price).toBe("998");
  });

  it("does not invent a ladder without a verified market and anchor", () => {
    expect(
      buildReferencePriceLadder({
        anchorPrice: null,
        previousClosePrice: null,
        market: "KOSPI",
        securityType: "STOCK",
      }),
    ).toEqual({ asks: [], bids: [] });
    expect(
      buildReferencePriceLadder({
        anchorPrice: "15970",
        previousClosePrice: "15970",
        market: null,
        securityType: "STOCK",
      }),
    ).toEqual({ asks: [], bids: [] });
    expect(
      buildReferencePriceLadder({
        anchorPrice: "50000",
        previousClosePrice: "50000",
        market: "KOSPI",
        securityType: "ETF",
      }),
    ).toEqual({ asks: [], bids: [] });
  });
});
