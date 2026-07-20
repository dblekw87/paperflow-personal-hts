import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import {
  calculateDailyVolumeChangeRate,
  compareDailyVolumeRatioDescending,
  KisDomesticRankingClient,
} from "../src/kis/domestic-ranking.js";

const capturedPaperResponse = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/kis/domestic-volume-ranking-paper.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Record<string, unknown>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KisDomesticRankingClient", () => {
  it("normalizes the paper-supported volume ranking without inventing blanks", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe(
        "/uapi/domestic-stock/v1/quotations/volume-rank",
      );
      expect(url.searchParams.get("FID_BLNG_CLS_CODE")).toBe("3");
      expect(url.searchParams.get("FID_TRGT_EXLS_CLS_CODE")).toBe("000000");
      return new Response(
        JSON.stringify(capturedPaperResponse),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new KisDomesticRankingClient({
      environment: "paper",
      credentials: { appKey: "app-key", appSecret: "app-secret" },
      getAccessToken: async () => "token",
    });
    const result = await client.getVolumeRanking("TURNOVER");

    expect(result.items[0]).toMatchObject({
      symbol: "000660",
      change: "-78000",
      changeRate: "-4.23",
      previousVolume: "5608812",
      volumeIncreaseRate: "4.77",
      averageTurnover: "10575264659754",
      cumulativeTurnover: "10575264659754",
    });
  });

  it("preserves blank provider fields as unavailable instead of zero", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            rt_cd: "0",
            output: [
              {
                ...(capturedPaperResponse["output"] as Record<
                  string,
                  string
                >[])[0],
                prdy_vol: "",
                avrg_tr_pbmn: "",
              },
            ],
          }),
        ),
      ),
    );
    const client = new KisDomesticRankingClient({
      environment: "paper",
      credentials: { appKey: "app-key", appSecret: "app-secret" },
      getAccessToken: async () => "token",
    });

    const result = await client.getVolumeRanking("TURNOVER");
    expect(result.items[0]?.previousVolume).toBeNull();
    expect(result.items[0]?.averageTurnover).toBeNull();
  });

  it("fails closed when KIS changes the ranking shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ rt_cd: "0", output: [{}] })),
      ),
    );
    const client = new KisDomesticRankingClient({
      environment: "paper",
      credentials: { appKey: "app-key", appSecret: "app-secret" },
      getAccessToken: async () => "token",
    });

    await expect(client.getVolumeRanking("AVERAGE_VOLUME")).rejects.toMatchObject(
      { code: "KIS_REST_SCHEMA_MISMATCH" },
    );
  });
});

describe("calculateDailyVolumeChangeRate", () => {
  it("compares today's current volume with the previous trading day", () => {
    expect(calculateDailyVolumeChangeRate("200", "100")).toBe("100.00");
    expect(calculateDailyVolumeChangeRate("50", "100")).toBe("-50.00");
    expect(calculateDailyVolumeChangeRate("5608812", "5608812")).toBe(
      "0.00",
    );
  });

  it("does not inherit the provider's 9999.99 percentage cap", () => {
    expect(calculateDailyVolumeChangeRate("20000", "100")).toBe(
      "19900.00",
    );
  });

  it("returns unavailable when the previous day has no usable volume", () => {
    expect(calculateDailyVolumeChangeRate("100", null)).toBeNull();
    expect(calculateDailyVolumeChangeRate("100", "0")).toBeNull();
    expect(calculateDailyVolumeChangeRate("not-a-number", "100")).toBeNull();
  });

  it("sorts ratios exactly without converting large integers to Number", () => {
    const values = [
      {
        cumulativeVolume: "900719925474099300",
        previousVolume: "900719925474099200",
      },
      {
        cumulativeVolume: "2",
        previousVolume: "1",
      },
      {
        cumulativeVolume: "10",
        previousVolume: null,
      },
    ].sort(compareDailyVolumeRatioDescending);

    expect(values[0]).toEqual({
      cumulativeVolume: "2",
      previousVolume: "1",
    });
    expect(values[2]?.previousVolume).toBeNull();
  });
});
