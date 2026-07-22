import { describe, expect, it } from "vitest";

import {
  applyLiveTradeToCandles,
  type LiveOverlayCandle,
} from "../apps/desktop/src/renderer/features/chart/live-candle-overlay.js";

const baseCandle: LiveOverlayCandle = {
  id: "KRX:005930:1m:2026-07-20T00:01:00.000Z",
  openedAt: "2026-07-20T00:01:00.000Z",
  open: "100",
  high: "100",
  low: "100",
  close: "100",
  volume: "10",
  turnover: null,
  forming: true,
};

describe("live candle overlay", () => {
  it("keeps accumulated high and low while the current bucket receives ticks", () => {
    const high = applyLiveTradeToCandles([baseCandle], {
      interval: "1m",
      occurredAt: "2026-07-20T00:01:30.000Z",
      price: "150",
      cumulativeVolume: "15",
      completeSessionHistory: true,
    });
    const pullback = applyLiveTradeToCandles(high, {
      interval: "1m",
      occurredAt: "2026-07-20T00:01:45.000Z",
      price: "120",
      cumulativeVolume: "16",
      completeSessionHistory: true,
    });
    const low = applyLiveTradeToCandles(pullback, {
      interval: "1m",
      occurredAt: "2026-07-20T00:01:50.000Z",
      price: "80",
      cumulativeVolume: "17",
      completeSessionHistory: true,
    });

    expect(low.at(-1)).toMatchObject({
      high: "150",
      low: "80",
      close: "80",
      volume: "17",
      forming: true,
    });
  });

  it("closes the prior minute and appends the observed next minute without interpolation", () => {
    const next = applyLiveTradeToCandles([baseCandle], {
      interval: "1m",
      occurredAt: "2026-07-20T00:02:01.000Z",
      price: "110",
      cumulativeVolume: "14",
      completeSessionHistory: true,
    });

    expect(next).toHaveLength(2);
    expect(next[0]?.forming).toBe(false);
    expect(next[1]).toMatchObject({
      openedAt: "2026-07-20T00:02:00.000Z",
      open: "110",
      high: "110",
      low: "110",
      close: "110",
      volume: "4",
      turnover: null,
      forming: true,
    });
  });

  it("does not invent bucket volume when the REST session history is partial", () => {
    const next = applyLiveTradeToCandles([baseCandle], {
      interval: "5m",
      occurredAt: "2026-07-20T00:05:01.000Z",
      price: "110",
      cumulativeVolume: "14",
      completeSessionHistory: false,
    });

    expect(next.at(-1)?.volume).toBeNull();
  });

  it("continues the domestic intraday chart with NXT premarket and after-hours ticks", () => {
    const premarket = applyLiveTradeToCandles([baseCandle], {
      interval: "1m",
      occurredAt: "2026-07-21T23:05:11.000Z",
      price: "103",
      cumulativeVolume: "3",
      completeSessionHistory: false,
    });
    expect(premarket).toHaveLength(2);
    expect(premarket[0]).toMatchObject({
      openedAt: "2026-07-20T00:01:00.000Z",
      forming: false,
    });
    expect(premarket.at(-1)).toMatchObject({
      openedAt: "2026-07-21T23:05:00.000Z",
      open: "103",
      close: "103",
      volume: null,
      forming: true,
    });

    const afterHours = applyLiveTradeToCandles(premarket, {
      interval: "5m",
      occurredAt: "2026-07-22T06:42:10.000Z",
      price: "108",
      cumulativeVolume: "12",
      completeSessionHistory: false,
    });
    expect(afterHours.at(-1)).toMatchObject({
      openedAt: "2026-07-22T06:40:00.000Z",
      open: "108",
      close: "108",
      volume: null,
      forming: true,
    });
  });

  it("preserves prior-session candles when the first current-day trade arrives", () => {
    const nextSession = applyLiveTradeToCandles([baseCandle], {
      interval: "1m",
      occurredAt: "2026-07-21T00:00:20.000Z",
      price: "105",
      cumulativeVolume: "7",
      completeSessionHistory: true,
    });

    expect(nextSession).toHaveLength(2);
    expect(nextSession[0]).toMatchObject({
      openedAt: "2026-07-20T00:01:00.000Z",
      forming: false,
    });
    expect(nextSession.at(-1)).toMatchObject({
      openedAt: "2026-07-21T00:00:00.000Z",
      open: "105",
      high: "105",
      low: "105",
      close: "105",
      volume: null,
      forming: true,
    });

    const secondTick = applyLiveTradeToCandles(nextSession, {
      interval: "1m",
      occurredAt: "2026-07-21T00:00:40.000Z",
      price: "106",
      cumulativeVolume: "9",
      completeSessionHistory: true,
    });
    expect(secondTick.at(-1)).toMatchObject({
      close: "106",
      volume: null,
    });
  });
});
