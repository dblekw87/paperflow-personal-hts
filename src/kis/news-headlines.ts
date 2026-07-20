import { z } from "zod";

import type { KisCredentials } from "../config/runtime-config.js";
import { KIS_PATH, KIS_TR, getKisEndpoints } from "./endpoints.js";
import { KisApiError } from "./errors.js";
import { getKisReadOnlyJson } from "./readonly-rest.js";

const providerDateSchema = z.string().regex(/^\d{8}$/);
const providerTimeSchema = z.string().regex(/^\d{6}$/);

const domesticHeadlineSchema = z
  .object({
    cntt_usiq_srno: z.string().trim().min(1),
    news_ofer_entp_code: z.string().trim().min(1),
    data_dt: providerDateSchema,
    data_tm: providerTimeSchema,
    hts_pbnt_titl_cntt: z.string().trim().min(1),
    news_lrdv_code: z.string().optional().default(""),
    dorg: z.string().optional().default(""),
    iscd1: z.string().optional().default(""),
    iscd2: z.string().optional().default(""),
    iscd3: z.string().optional().default(""),
    iscd4: z.string().optional().default(""),
    iscd5: z.string().optional().default(""),
    iscd6: z.string().optional().default(""),
    iscd7: z.string().optional().default(""),
    iscd8: z.string().optional().default(""),
    iscd9: z.string().optional().default(""),
    iscd10: z.string().optional().default(""),
    kor_isnm1: z.string().optional().default(""),
    kor_isnm2: z.string().optional().default(""),
    kor_isnm3: z.string().optional().default(""),
    kor_isnm4: z.string().optional().default(""),
    kor_isnm5: z.string().optional().default(""),
    kor_isnm6: z.string().optional().default(""),
    kor_isnm7: z.string().optional().default(""),
    kor_isnm8: z.string().optional().default(""),
    kor_isnm9: z.string().optional().default(""),
    kor_isnm10: z.string().optional().default(""),
  })
  .loose();

const domesticNewsResponseSchema = z
  .object({
    rt_cd: z.string(),
    msg_cd: z.string().optional(),
    msg1: z.string().optional(),
    output: z.array(domesticHeadlineSchema).optional(),
  })
  .loose();

const overseasHeadlineSchema = z
  .object({
    info_gb: z.string().trim().min(1),
    news_key: z.string().trim().min(1),
    data_dt: providerDateSchema,
    data_tm: providerTimeSchema,
    class_cd: z.string().optional().default(""),
    class_name: z.string().optional().default(""),
    source: z.string().optional().default(""),
    nation_cd: z.string().optional().default(""),
    exchange_cd: z.string().optional().default(""),
    symb: z.string().optional().default(""),
    symb_name: z.string().optional().default(""),
    title: z.string().trim().min(1),
  })
  .loose();

const overseasNewsResponseSchema = z
  .object({
    rt_cd: z.string(),
    msg_cd: z.string().optional(),
    msg1: z.string().optional(),
    outblock1: z.array(overseasHeadlineSchema).optional(),
    outblock2: z.unknown().optional(),
  })
  .loose();

export interface KisHeadlineRights {
  readonly contentScope: "HEADLINE_ONLY";
  readonly originalUrl: null;
}

export interface DomesticNewsHeadline {
  readonly providerKey: string;
  readonly providerCode: string;
  readonly providerDate: string;
  readonly providerTime: string;
  readonly title: string;
  readonly categoryCode: string | null;
  readonly sourceName: string | null;
  readonly relatedSymbols: readonly string[];
  readonly relatedNames: readonly string[];
  readonly rights: KisHeadlineRights;
}

export interface OverseasNewsHeadline {
  readonly providerKey: string;
  readonly newsType: string;
  readonly providerDate: string;
  readonly providerTime: string;
  readonly title: string;
  readonly categoryCode: string | null;
  readonly categoryName: string | null;
  readonly sourceName: string | null;
  readonly nationCode: string | null;
  readonly exchangeCode: string | null;
  readonly symbol: string | null;
  readonly symbolName: string | null;
  readonly rights: KisHeadlineRights;
}

export interface KisHeadlinePage<T> {
  readonly items: readonly T[];
  readonly source: "KIS_REST";
  readonly dataEnvironment: "prod";
  readonly fetchedAt: string;
  readonly continuation: string | null;
  readonly paginationComplete: boolean;
}

const HEADLINE_RIGHTS = Object.freeze({
  contentScope: "HEADLINE_ONLY",
  originalUrl: null,
} as const);

function nullable(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function businessError(
  parsed: {
    readonly rt_cd: string;
    readonly msg_cd?: string | undefined;
    readonly msg1?: string | undefined;
  },
  operation: string,
): void {
  if (parsed.rt_cd === "0") return;
  throw new KisApiError({
    code: parsed.msg_cd ?? "KIS_BUSINESS_ERROR",
    message: parsed.msg1 ?? `KIS rejected the ${operation} request`,
    retryable: parsed.msg_cd === "EGW00201",
  });
}

export class KisProdNewsClient {
  readonly #credentials: KisCredentials;
  readonly #getAccessToken: () => Promise<string>;

  constructor(options: {
    credentials: KisCredentials;
    getAccessToken: () => Promise<string>;
  }) {
    this.#credentials = options.credentials;
    this.#getAccessToken = options.getAccessToken;
  }

  async getDomesticHeadlines(options?: {
    readonly symbol?: string;
    readonly providerDate?: string;
    readonly providerTime?: string;
    readonly continuation?: "N";
  }): Promise<KisHeadlinePage<DomesticNewsHeadline>> {
    const endpoint = getKisEndpoints("prod");
    const url = new URL(
      `${endpoint.restBaseUrl}${KIS_PATH.domesticNewsHeadlines}`,
    );
    url.search = new URLSearchParams({
      FID_NEWS_OFER_ENTP_CODE: "",
      FID_COND_MRKT_CLS_CODE: "",
      FID_INPUT_ISCD: options?.symbol ?? "",
      FID_TITL_CNTT: "",
      FID_INPUT_DATE_1: options?.providerDate ?? "",
      FID_INPUT_HOUR_1: options?.providerTime ?? "",
      FID_RANK_SORT_CLS_CODE: "",
      FID_INPUT_SRNO: "",
    }).toString();
    const response = await getKisReadOnlyJson({
      url,
      trId: KIS_TR.domesticNewsHeadlines,
      credentials: this.#credentials,
      getAccessToken: this.#getAccessToken,
      ...(options?.continuation === undefined
        ? {}
        : { continuation: options.continuation }),
      operation: "domestic news-headline",
    });
    const parsed = domesticNewsResponseSchema.safeParse(response.payload);
    if (!parsed.success) {
      throw new KisApiError({
        code: "KIS_REST_SCHEMA_MISMATCH",
        message:
          "KIS domestic news-headline response did not match the contract",
        retryable: false,
      });
    }
    businessError(parsed.data, "domestic news-headline");
    const continuation = response.trContinuation;
    return {
      source: "KIS_REST",
      dataEnvironment: "prod",
      fetchedAt: new Date().toISOString(),
      continuation,
      paginationComplete:
        continuation !== "M" && continuation !== "F",
      items: (parsed.data.output ?? []).map((item) => ({
        providerKey: item.cntt_usiq_srno,
        providerCode: item.news_ofer_entp_code,
        providerDate: item.data_dt,
        providerTime: item.data_tm,
        title: item.hts_pbnt_titl_cntt,
        categoryCode: nullable(item.news_lrdv_code),
        sourceName: nullable(item.dorg),
        relatedSymbols: [
          item.iscd1,
          item.iscd2,
          item.iscd3,
          item.iscd4,
          item.iscd5,
          item.iscd6,
          item.iscd7,
          item.iscd8,
          item.iscd9,
          item.iscd10,
        ].filter((value) => value.trim().length > 0),
        relatedNames: [
          item.kor_isnm1,
          item.kor_isnm2,
          item.kor_isnm3,
          item.kor_isnm4,
          item.kor_isnm5,
          item.kor_isnm6,
          item.kor_isnm7,
          item.kor_isnm8,
          item.kor_isnm9,
          item.kor_isnm10,
        ]
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
        rights: HEADLINE_RIGHTS,
      })),
    };
  }

  async getOverseasHeadlines(options?: {
    readonly nationCode?: string;
    readonly exchangeCode?: string;
    readonly symbol?: string;
    readonly providerDate?: string;
    readonly providerTime?: string;
    readonly nextKey?: string;
    readonly continuation?: "N";
  }): Promise<KisHeadlinePage<OverseasNewsHeadline>> {
    const endpoint = getKisEndpoints("prod");
    const url = new URL(
      `${endpoint.restBaseUrl}${KIS_PATH.overseasNewsHeadlines}`,
    );
    url.search = new URLSearchParams({
      INFO_GB: "",
      CLASS_CD: "",
      NATION_CD: options?.nationCode ?? "",
      EXCHANGE_CD: options?.exchangeCode ?? "",
      SYMB: options?.symbol ?? "",
      DATA_DT: options?.providerDate ?? "",
      DATA_TM: options?.providerTime ?? "",
      CTS: options?.nextKey ?? "",
    }).toString();
    const response = await getKisReadOnlyJson({
      url,
      trId: KIS_TR.overseasNewsHeadlines,
      credentials: this.#credentials,
      getAccessToken: this.#getAccessToken,
      ...(options?.continuation === undefined
        ? {}
        : { continuation: options.continuation }),
      operation: "overseas news-headline",
    });
    const parsed = overseasNewsResponseSchema.safeParse(response.payload);
    if (!parsed.success) {
      throw new KisApiError({
        code: "KIS_REST_SCHEMA_MISMATCH",
        message:
          "KIS overseas news-headline response did not match the contract",
        retryable: false,
      });
    }
    businessError(parsed.data, "overseas news-headline");
    const continuation = response.trContinuation;
    return {
      source: "KIS_REST",
      dataEnvironment: "prod",
      fetchedAt: new Date().toISOString(),
      continuation,
      paginationComplete:
        continuation !== "M" && continuation !== "F",
      items: (parsed.data.outblock1 ?? []).map((item) => ({
        providerKey: item.news_key,
        newsType: item.info_gb,
        providerDate: item.data_dt,
        providerTime: item.data_tm,
        title: item.title,
        categoryCode: nullable(item.class_cd),
        categoryName: nullable(item.class_name),
        sourceName: nullable(item.source),
        nationCode: nullable(item.nation_cd),
        exchangeCode: nullable(item.exchange_cd),
        symbol: nullable(item.symb),
        symbolName: nullable(item.symb_name),
        rights: HEADLINE_RIGHTS,
      })),
    };
  }
}
