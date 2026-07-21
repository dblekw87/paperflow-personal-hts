import { describe, expect, it } from "vitest";

import { readLocalWatchlist } from "../apps/desktop/src/renderer/features/watchlist/local-watchlist.js";

describe("local watchlist", () => {
  it("keeps valid US instruments so market tabs can be filtered independently", () => {
    expect(readLocalWatchlist(JSON.stringify([
      { instrumentId: "KRX:005930", symbol: "005930", name: "삼성전자", market: "KOSPI", securityType: "STOCK" },
      { instrumentId: "NASDAQ:AAPL", symbol: "AAPL", name: "Apple", market: null, securityType: "STOCK" },
    ]))).toHaveLength(2);
  });

  it("only restores explicitly stored valid KRX instruments", () => {
    expect(
      readLocalWatchlist(
        JSON.stringify([
          {
            instrumentId: "KRX:320000",
            symbol: "320000",
            name: "한울반도체",
            market: "KOSDAQ",
            securityType: "STOCK",
          },
          {
            instrumentId: "KRX:320000",
            symbol: "320000",
            name: "한울반도체",
            market: "KOSDAQ",
            securityType: "STOCK",
          },
          { instrumentId: "../secret", symbol: "secret", name: "x", market: null },
        ]),
      ),
    ).toEqual([
      {
        instrumentId: "KRX:320000",
        symbol: "320000",
        name: "한울반도체",
        market: "KOSDAQ",
        securityType: "STOCK",
      },
    ]);
  });

  it("starts empty and rejects malformed persisted state", () => {
    expect(readLocalWatchlist(null)).toEqual([]);
    expect(readLocalWatchlist("not-json")).toEqual([]);
  });
});
