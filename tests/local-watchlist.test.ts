import { describe, expect, it } from "vitest";

import { readLocalWatchlist } from "../apps/desktop/src/renderer/features/watchlist/local-watchlist.js";

describe("local watchlist", () => {
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
