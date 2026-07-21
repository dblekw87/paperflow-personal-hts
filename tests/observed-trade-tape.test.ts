import { describe, expect, it } from "vitest";

import { ObservedTradeTapeAccumulator } from "../apps/desktop/src/renderer/features/orderbook/observed-trade-tape.js";

describe("observed trade tape", () => {
  it("derives only observed cumulative-volume deltas and tick direction", () => {
    const accumulator = new ObservedTradeTapeAccumulator();
    const first = accumulator.observe({
      instrumentId: "KRX:320000",
      occurredAt: "2026-07-21T00:00:01.000Z",
      price: "15970",
      cumulativeVolume: "1000",
    });
    const second = accumulator.observe({
      instrumentId: "KRX:320000",
      occurredAt: "2026-07-21T00:00:02.000Z",
      price: "16000",
      cumulativeVolume: "1012",
    });

    expect(first).toMatchObject({ quantity: null, direction: "flat" });
    expect(second).toMatchObject({ quantity: "12", direction: "positive" });
  });

  it("deduplicates the same projection and rejects malformed trades", () => {
    const accumulator = new ObservedTradeTapeAccumulator();
    const input = {
      instrumentId: "KRX:005930",
      occurredAt: "2026-07-21T00:00:01.000Z",
      price: "244000",
      cumulativeVolume: "100",
    };
    expect(accumulator.observe(input)).not.toBeNull();
    expect(accumulator.observe(input)).toBeNull();
    expect(
      accumulator.observe({
        ...input,
        occurredAt: "2026-07-21T00:00:02.000Z",
      }),
    ).toBeNull();
    expect(accumulator.observe({ ...input, price: "0" })).toBeNull();
  });
});
