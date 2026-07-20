import { z } from "zod";

import type { KisCredentials } from "../config/runtime-config.js";
import { getKisEndpoints, KIS_PATH, KIS_TR } from "./endpoints.js";
import { KisApiError } from "./errors.js";

const rankItemSchema = z
  .object({
    mksc_shrn_iscd: z.string(),
    hts_kor_isnm: z.string(),
    data_rank: z.string(),
    stck_prpr: z.string(),
    prdy_vrss_sign: z.string(),
    prdy_vrss: z.string(),
    prdy_ctrt: z.string(),
    acml_vol: z.string(),
    prdy_vol: z.string().optional().default(""),
    avrg_vol: z.string().optional().default(""),
    vol_inrt: z.string().optional().default(""),
    vol_tnrt: z.string().optional().default(""),
    avrg_tr_pbmn: z.string().optional().default(""),
    tr_pbmn_tnrt: z.string().optional().default(""),
    acml_tr_pbmn: z.string(),
  })
  .loose();

const rankResponseSchema = z
  .object({
    rt_cd: z.string(),
    msg_cd: z.string().optional(),
    msg1: z.string().optional(),
    output: z.array(rankItemSchema).optional(),
  })
  .loose();

export type DomesticVolumeRankSort =
  | "AVERAGE_VOLUME"
  | "VOLUME_INCREASE"
  | "TURNOVER";

export interface DomesticVolumeRankItem {
  readonly rank: string;
  readonly symbol: string;
  readonly name: string;
  readonly price: string;
  readonly change: string;
  readonly changeRate: string;
  readonly cumulativeVolume: string;
  readonly previousVolume: string | null;
  readonly averageVolume: string | null;
  readonly volumeIncreaseRate: string | null;
  readonly volumeTurnoverRate: string | null;
  readonly averageTurnover: string | null;
  readonly turnoverTurnoverRate: string | null;
  readonly cumulativeTurnover: string;
}

export interface DomesticVolumeRanking {
  readonly market: "KRX";
  readonly sort: DomesticVolumeRankSort;
  readonly items: readonly DomesticVolumeRankItem[];
  readonly source: "KIS_REST";
  readonly fetchedAt: string;
}

function nullable(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function applyKisSign(value: string, signCode: string): string {
  const absolute = value.replace(/^[+-]/, "");
  return signCode === "4" || signCode === "5" ? `-${absolute}` : absolute;
}

/**
 * Compares today's session-to-now volume with the previous trading day's
 * completed volume. The KIS `vol_inrt` field is intentionally not used here:
 * its comparison window and provider-side cap are not explicit enough for the
 * desktop UI to label it as a daily percentage.
 */
export function calculateDailyVolumeChangeRate(
  todayVolume: string,
  previousTradingDayVolume: string | null,
): string | null {
  if (
    !/^\d+$/.test(todayVolume) ||
    previousTradingDayVolume === null ||
    !/^\d+$/.test(previousTradingDayVolume)
  ) {
    return null;
  }

  const today = BigInt(todayVolume);
  const previous = BigInt(previousTradingDayVolume);
  if (today === 0n || previous === 0n) {
    return null;
  }

  const numerator = (today - previous) * 10_000n;
  const absoluteNumerator =
    numerator < 0n ? -numerator : numerator;
  const roundedHundredths =
    (absoluteNumerator + previous / 2n) / previous;
  const signedHundredths =
    numerator < 0n ? -roundedHundredths : roundedHundredths;
  const absoluteHundredths =
    signedHundredths < 0n ? -signedHundredths : signedHundredths;
  const integer = absoluteHundredths / 100n;
  const fraction = String(absoluteHundredths % 100n).padStart(2, "0");
  const sign = signedHundredths < 0n ? "-" : "";
  return `${sign}${integer}.${fraction}`;
}

export function isUsableDailyRankingItem(
  item: Pick<
    DomesticVolumeRankItem,
    | "price"
    | "changeRate"
    | "cumulativeVolume"
    | "cumulativeTurnover"
  >,
): boolean {
  if (
    !/^\d+$/.test(item.price) ||
    !/^\d+$/.test(item.cumulativeVolume) ||
    !/^\d+$/.test(item.cumulativeTurnover) ||
    BigInt(item.price) === 0n ||
    BigInt(item.cumulativeVolume) === 0n ||
    BigInt(item.cumulativeTurnover) === 0n
  ) {
    return false;
  }
  const changeRate = Number(item.changeRate);
  return (
    Number.isFinite(changeRate) &&
    changeRate >= -30 &&
    changeRate <= 30
  );
}

export function compareDailyVolumeRatioDescending(
  left: Pick<
    DomesticVolumeRankItem,
    "cumulativeVolume" | "previousVolume"
  >,
  right: Pick<
    DomesticVolumeRankItem,
    "cumulativeVolume" | "previousVolume"
  >,
): number {
  const usable = (
    item: Pick<
      DomesticVolumeRankItem,
      "cumulativeVolume" | "previousVolume"
    >,
  ): item is {
    cumulativeVolume: string;
    previousVolume: string;
  } =>
    /^\d+$/.test(item.cumulativeVolume) &&
    item.previousVolume !== null &&
    /^\d+$/.test(item.previousVolume) &&
    BigInt(item.previousVolume) > 0n;

  const leftUsable = usable(left);
  const rightUsable = usable(right);
  if (!leftUsable || !rightUsable) {
    return leftUsable ? -1 : rightUsable ? 1 : 0;
  }

  const leftScaled =
    BigInt(left.cumulativeVolume) * BigInt(right.previousVolume);
  const rightScaled =
    BigInt(right.cumulativeVolume) * BigInt(left.previousVolume);
  return leftScaled === rightScaled ? 0 : leftScaled > rightScaled ? -1 : 1;
}

function sortCode(sort: DomesticVolumeRankSort): string {
  switch (sort) {
    case "AVERAGE_VOLUME":
      return "0";
    case "VOLUME_INCREASE":
      return "1";
    case "TURNOVER":
      return "3";
  }
}

export class KisDomesticRankingClient {
  readonly #environment: "paper" | "prod";
  readonly #credentials: KisCredentials;
  readonly #getAccessToken: () => Promise<string>;

  constructor(options: {
    environment: "paper" | "prod";
    credentials: KisCredentials;
    getAccessToken: () => Promise<string>;
  }) {
    this.#environment = options.environment;
    this.#credentials = options.credentials;
    this.#getAccessToken = options.getAccessToken;
  }

  async getVolumeRanking(
    sort: DomesticVolumeRankSort,
  ): Promise<DomesticVolumeRanking> {
    const endpoint = getKisEndpoints(this.#environment);
    const url = new URL(
      `${endpoint.restBaseUrl}${KIS_PATH.domesticVolumeRank}`,
    );
    url.search = new URLSearchParams({
      FID_COND_MRKT_DIV_CODE: "J",
      FID_COND_SCR_DIV_CODE: "20171",
      FID_INPUT_ISCD: "0000",
      FID_DIV_CLS_CODE: "0",
      FID_BLNG_CLS_CODE: sortCode(sort),
      FID_TRGT_CLS_CODE: "111111111",
      // The official executable KIS sample currently uses six zeroes here.
      FID_TRGT_EXLS_CLS_CODE: "000000",
      FID_INPUT_PRICE_1: "0",
      FID_INPUT_PRICE_2: "100000000",
      FID_VOL_CNT: "0",
      FID_INPUT_DATE_1: "",
    }).toString();

    // Authentication failures have their own KIS error code and must not be
    // flattened into a retryable transport failure.
    const accessToken = await this.#getAccessToken();
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${accessToken}`,
          appkey: this.#credentials.appKey,
          appsecret: this.#credentials.appSecret,
          tr_id: KIS_TR.domesticVolumeRank,
          custtype: "P",
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new KisApiError({
        code: "KIS_NETWORK_ERROR",
        message: "KIS volume-ranking endpoint is unreachable",
        retryable: true,
        cause: error,
      });
    }

    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new KisApiError({
        code: response.status === 429 ? "KIS_RATE_LIMITED" : "KIS_REST_FAILED",
        message: `KIS volume-ranking request failed with HTTP ${response.status}`,
        retryable: response.status >= 500 || response.status === 429,
        status: response.status,
      });
    }

    const parsed = rankResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new KisApiError({
        code: "KIS_REST_SCHEMA_MISMATCH",
        message: "KIS volume-ranking response did not match the contract",
        retryable: false,
      });
    }
    if (parsed.data.rt_cd !== "0") {
      throw new KisApiError({
        code: parsed.data.msg_cd ?? "KIS_BUSINESS_ERROR",
        message: parsed.data.msg1 ?? "KIS rejected the volume-ranking request",
        retryable: parsed.data.msg_cd === "EGW00201",
      });
    }

    return {
      market: "KRX",
      sort,
      source: "KIS_REST",
      fetchedAt: new Date().toISOString(),
      items: (parsed.data.output ?? []).map((item) => {
        const previousVolume = nullable(item.prdy_vol);
        return {
          rank: item.data_rank,
          symbol: item.mksc_shrn_iscd,
          name: item.hts_kor_isnm,
          price: item.stck_prpr,
          change: applyKisSign(item.prdy_vrss, item.prdy_vrss_sign),
          changeRate: applyKisSign(item.prdy_ctrt, item.prdy_vrss_sign),
          cumulativeVolume: item.acml_vol,
          previousVolume,
          averageVolume: nullable(item.avrg_vol),
          volumeIncreaseRate: calculateDailyVolumeChangeRate(
            item.acml_vol,
            previousVolume,
          ),
          volumeTurnoverRate: nullable(item.vol_tnrt),
          averageTurnover: nullable(item.avrg_tr_pbmn),
          turnoverTurnoverRate: nullable(item.tr_pbmn_tnrt),
          cumulativeTurnover: item.acml_tr_pbmn,
        };
      }),
    };
  }
}
