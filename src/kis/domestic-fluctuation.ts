import { z } from "zod";

import type { KisCredentials } from "../config/runtime-config.js";
import { KIS_PATH, KIS_TR, getKisEndpoints } from "./endpoints.js";
import { KisApiError } from "./errors.js";
import { getKisReadOnlyJson } from "./readonly-rest.js";

const unsignedIntegerSchema = z.string().regex(/^\d+$/);
const signedIntegerSchema = z.string().regex(/^[+-]?\d+$/);
const signedDecimalSchema = z.string().regex(/^[+-]?\d+(?:\.\d+)?$/);

const fluctuationItemSchema = z
  .object({
    stck_shrn_iscd: z.string().regex(/^[0-9A-Z]{6,7}$/),
    data_rank: unsignedIntegerSchema,
    hts_kor_isnm: z.string().trim().min(1),
    stck_prpr: unsignedIntegerSchema,
    prdy_vrss: signedIntegerSchema,
    prdy_vrss_sign: z.enum(["1", "2", "3", "4", "5"]),
    prdy_ctrt: signedDecimalSchema,
    acml_vol: unsignedIntegerSchema,
    stck_hgpr: z.string().optional().default(""),
    stck_lwpr: z.string().optional().default(""),
    prd_rsfl: z.string().optional().default(""),
    prd_rsfl_rate: z.string().optional().default(""),
  })
  .loose();

const fluctuationResponseSchema = z
  .object({
    rt_cd: z.string(),
    msg_cd: z.string().optional(),
    msg1: z.string().optional(),
    output: z.array(fluctuationItemSchema).optional(),
  })
  .loose();

export interface DomesticFluctuationItem {
  readonly rank: string;
  readonly symbol: string;
  readonly name: string;
  readonly price: string;
  readonly change: string;
  readonly changeRate: string;
  readonly cumulativeVolume: string;
  readonly highPrice: string | null;
  readonly lowPrice: string | null;
  readonly periodChange: string | null;
  readonly periodChangeRate: string | null;
}

export interface DomesticFluctuationRanking {
  readonly market: "KRX";
  readonly items: readonly DomesticFluctuationItem[];
  readonly source: "KIS_REST";
  readonly dataEnvironment: "prod";
  readonly fetchedAt: string;
  readonly continuation: string | null;
  readonly paginationComplete: boolean;
}

export interface DomesticFluctuationRankingQuery {
  readonly minimumRate?: string;
  readonly maximumRate?: string;
  readonly continuation?: "N";
}

function nullable(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function applyKisSign(value: string, signCode: string): string {
  const absolute = value.replace(/^[+-]/, "");
  return signCode === "4" || signCode === "5" ? `-${absolute}` : absolute;
}

export class KisDomesticFluctuationClient {
  readonly #credentials: KisCredentials;
  readonly #getAccessToken: () => Promise<string>;

  constructor(options: {
    credentials: KisCredentials;
    getAccessToken: () => Promise<string>;
  }) {
    this.#credentials = options.credentials;
    this.#getAccessToken = options.getAccessToken;
  }

  async getRanking(
    options?: DomesticFluctuationRankingQuery,
  ): Promise<DomesticFluctuationRanking> {
    const endpoint = getKisEndpoints("prod");
    const url = new URL(
      `${endpoint.restBaseUrl}${KIS_PATH.domesticFluctuationRank}`,
    );
    url.search = new URLSearchParams({
      fid_cond_mrkt_div_code: "J",
      fid_cond_scr_div_code: "20170",
      fid_input_iscd: "0000",
      fid_rank_sort_cls_code: "0",
      fid_input_cnt_1: "30",
      fid_prc_cls_code: "0",
      fid_input_price_1: "",
      fid_input_price_2: "",
      fid_vol_cnt: "",
      fid_trgt_cls_code: "0",
      fid_trgt_exls_cls_code: "0",
      fid_div_cls_code: "0",
      fid_rsfl_rate1: options?.minimumRate ?? "",
      fid_rsfl_rate2: options?.maximumRate ?? "",
    }).toString();

    const response = await getKisReadOnlyJson({
      url,
      trId: KIS_TR.domesticFluctuationRank,
      credentials: this.#credentials,
      getAccessToken: this.#getAccessToken,
      ...(options?.continuation === undefined
        ? {}
        : { continuation: options.continuation }),
      operation: "domestic fluctuation-ranking",
    });
    const parsed = fluctuationResponseSchema.safeParse(response.payload);
    if (!parsed.success) {
      throw new KisApiError({
        code: "KIS_REST_SCHEMA_MISMATCH",
        message:
          "KIS domestic fluctuation-ranking response did not match the contract",
        retryable: false,
      });
    }
    if (parsed.data.rt_cd !== "0") {
      throw new KisApiError({
        code: parsed.data.msg_cd ?? "KIS_BUSINESS_ERROR",
        message:
          parsed.data.msg1 ??
          "KIS rejected the domestic fluctuation-ranking request",
        retryable: parsed.data.msg_cd === "EGW00201",
      });
    }

    const continuation = response.trContinuation;
    return {
      market: "KRX",
      source: "KIS_REST",
      dataEnvironment: "prod",
      fetchedAt: new Date().toISOString(),
      continuation,
      paginationComplete:
        continuation !== "M" && continuation !== "F",
      items: (parsed.data.output ?? []).map((item) => ({
        rank: item.data_rank,
        symbol: item.stck_shrn_iscd,
        name: item.hts_kor_isnm,
        price: item.stck_prpr,
        change: applyKisSign(item.prdy_vrss, item.prdy_vrss_sign),
        changeRate: applyKisSign(item.prdy_ctrt, item.prdy_vrss_sign),
        cumulativeVolume: item.acml_vol,
        highPrice: nullable(item.stck_hgpr),
        lowPrice: nullable(item.stck_lwpr),
        periodChange: nullable(item.prd_rsfl),
        periodChangeRate: nullable(item.prd_rsfl_rate),
      })),
    };
  }

  async getAllRanking(
    options?: Omit<DomesticFluctuationRankingQuery, "continuation"> & {
      readonly maxPages?: number;
    },
  ): Promise<DomesticFluctuationRanking> {
    const maxPages = options?.maxPages ?? 10;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10) {
      throw new TypeError("maxPages must be an integer between 1 and 10");
    }
    const query = {
      ...(options?.minimumRate === undefined
        ? {}
        : { minimumRate: options.minimumRate }),
      ...(options?.maximumRate === undefined
        ? {}
        : { maximumRate: options.maximumRate }),
    };
    let page = await this.getRanking(query);
    const first = page;
    const items = new Map(page.items.map((item) => [item.symbol, item]));
    let pagesFetched = 1;
    while (!page.paginationComplete && pagesFetched < maxPages) {
      const previousSize = items.size;
      page = await this.getRanking({ ...query, continuation: "N" });
      pagesFetched += 1;
      for (const item of page.items) items.set(item.symbol, item);
      if (items.size === previousSize && !page.paginationComplete) break;
    }
    return {
      ...first,
      items: [...items.values()],
      fetchedAt: page.fetchedAt,
      continuation: page.continuation,
      paginationComplete: page.paginationComplete,
    };
  }
}
