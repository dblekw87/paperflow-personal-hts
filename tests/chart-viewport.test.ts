import { describe, expect, it } from "vitest";

import {
  fullChartViewport,
  normalizeChartViewport,
  panChartViewport,
  zoomChartViewport,
} from "../apps/desktop/src/renderer/features/chart/chart-viewport.js";

describe("market chart viewport", () => {
  it("zooms around the cursor anchor without leaving the loaded history", () => {
    const full = fullChartViewport(1_000);
    expect(zoomChartViewport(full, 1_000, 0.5, "IN")).toEqual({
      start: 100,
      end: 900,
    });
    expect(zoomChartViewport(full, 1_000, 0, "IN")).toEqual({
      start: 0,
      end: 800,
    });
  });

  it("pans backward and forward while preserving the visible count", () => {
    const viewport = { start: 500, end: 700 };
    expect(panChartViewport(viewport, 1_000, -125)).toEqual({
      start: 375,
      end: 575,
    });
    expect(panChartViewport(viewport, 1_000, 900)).toEqual({
      start: 800,
      end: 1_000,
    });
  });

  it("never invents candles outside the loaded range", () => {
    expect(
      normalizeChartViewport({ start: -100, end: 500 }, 381),
    ).toEqual({
      start: 0,
      end: 381,
    });
    expect(zoomChartViewport({ start: 0, end: 30 }, 381, 0.5, "IN")).toEqual({
      start: 3,
      end: 27,
    });
  });
});
