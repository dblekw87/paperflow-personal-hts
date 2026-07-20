import { describe, expect, it } from "vitest";

import { resolveChartCandleGeometry } from "../apps/desktop/src/renderer/features/chart/chart-candle-geometry.js";

describe("chart candle geometry", () => {
  it("keeps a short or zoomed series dense and attached to the latest edge", () => {
    const geometry = resolveChartCandleGeometry(20, 18, 890);
    expect(geometry).toEqual({
      plotStart: 450,
      plotEnd: 890,
      step: 22,
      candleWidth: 19.8,
    });
    expect(geometry.step - geometry.candleWidth).toBeCloseTo(2.2);
  });

  it("uses the full plot while keeping long histories tightly packed", () => {
    const geometry = resolveChartCandleGeometry(160, 18, 890);
    expect(geometry.plotStart).toBeCloseTo(18);
    expect(geometry.plotEnd).toBe(890);
    expect(geometry.step).toBeCloseTo(5.45);
    expect(geometry.candleWidth).toBeCloseTo(4.905);
  });
});
