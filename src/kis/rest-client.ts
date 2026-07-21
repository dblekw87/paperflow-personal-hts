import { z } from "zod";

import type { KisCredentials } from "../config/runtime-config.js";
import { getKisEndpoints, KIS_PATH, KIS_TR } from "./endpoints.js";
import { KisApiError } from "./errors.js";

const currentPriceOutputSchema = z
  .object({
    stck_prpr: z.string(),
    prdy_vrss: z.string(),
    prdy_vrss_sign: z.string(),
    prdy_ctrt: z.string(),
    acml_vol: z.string(),
    acml_tr_pbmn: z.string(),
    stck_oprc: z.string(),
    stck_hgpr: z.string(),
    stck_lwpr: z.string(),
  })
  .loose();

const currentPriceResponseSchema = z
  .object({
    rt_cd: z.string(),
    msg_cd: z.string().optional(),
    msg1: z.string().optional(),
    output: currentPriceOutputSchema.optional(),
  })
  .loose();

const orderBookOutputSchema = z
  .object({
    aspr_acpt_hour: z.string(),
    askp1: z.string(),
    askp2: z.string(),
    askp3: z.string(),
    askp4: z.string(),
    askp5: z.string(),
    askp6: z.string(),
    askp7: z.string(),
    askp8: z.string(),
    askp9: z.string(),
    askp10: z.string(),
    bidp1: z.string(),
    bidp2: z.string(),
    bidp3: z.string(),
    bidp4: z.string(),
    bidp5: z.string(),
    bidp6: z.string(),
    bidp7: z.string(),
    bidp8: z.string(),
    bidp9: z.string(),
    bidp10: z.string(),
    askp_rsqn1: z.string(),
    askp_rsqn2: z.string(),
    askp_rsqn3: z.string(),
    askp_rsqn4: z.string(),
    askp_rsqn5: z.string(),
    askp_rsqn6: z.string(),
    askp_rsqn7: z.string(),
    askp_rsqn8: z.string(),
    askp_rsqn9: z.string(),
    askp_rsqn10: z.string(),
    bidp_rsqn1: z.string(),
    bidp_rsqn2: z.string(),
    bidp_rsqn3: z.string(),
    bidp_rsqn4: z.string(),
    bidp_rsqn5: z.string(),
    bidp_rsqn6: z.string(),
    bidp_rsqn7: z.string(),
    bidp_rsqn8: z.string(),
    bidp_rsqn9: z.string(),
    bidp_rsqn10: z.string(),
    total_askp_rsqn: z.string(),
    total_bidp_rsqn: z.string(),
  })
  .loose();

const orderBookResponseSchema = z
  .object({
    rt_cd: z.string(),
    msg_cd: z.string().optional(),
    msg1: z.string().optional(),
    output1: orderBookOutputSchema.optional(),
  })
  .loose();

const overseasOrderBookPartSchema = z
  .object({
    last: z.string().optional(),
    base: z.string().optional(),
    open: z.string().optional(),
    high: z.string().optional(),
    low: z.string().optional(),
    pbid1: z.string().optional(),
    pask1: z.string().optional(),
    vbid1: z.string().optional(),
    vask1: z.string().optional(),
    bvol: z.string().optional(),
    avol: z.string().optional(),
    dymd: z.string().optional(),
    dhms: z.string().optional(),
  })
  .loose();

const overseasOrderBookResponseSchema = z
  .object({
    rt_cd: z.string(),
    msg_cd: z.string().optional(),
    msg1: z.string().optional(),
    output1: overseasOrderBookPartSchema.optional(),
    output2: overseasOrderBookPartSchema.optional(),
    output3: overseasOrderBookPartSchema.optional(),
  })
  .loose();

export interface DomesticQuote {
  instrumentId: string;
  currency: "KRW";
  price: string;
  change: string;
  changeRate: string;
  cumulativeVolume: string;
  cumulativeTurnover: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  source: "KIS_REST";
  receivedAt: string;
}

export interface DomesticOrderBookSnapshot {
  instrumentId: string;
  venue: "KRX";
  bids: readonly { readonly price: string; readonly quantity: string }[];
  asks: readonly { readonly price: string; readonly quantity: string }[];
  totalBidQuantity: string;
  totalAskQuantity: string;
  providerTime: string;
  source: "KIS_REST";
  receivedAt: string;
}

export interface OverseasQuoteAndOrderBookSnapshot {
  instrumentId: string;
  venue: "NASDAQ" | "NYSE" | "AMEX";
  price: string;
  previousClose: string | null;
  openPrice: string | null;
  highPrice: string | null;
  lowPrice: string | null;
  bids: readonly { readonly price: string; readonly quantity: string }[];
  asks: readonly { readonly price: string; readonly quantity: string }[];
  totalBidQuantity: string | null;
  totalAskQuantity: string | null;
  providerTime: string | null;
  receivedAt: string;
}

function applyKisSign(value: string, signCode: string): string {
  const absolute = value.replace(/^[+-]/, "");
  return signCode === "4" || signCode === "5" ? `-${absolute}` : absolute;
}

export class KisRestClient {
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

  async getOverseasQuoteAndOrderBook(
    exchange: "NAS" | "NYS" | "AMS",
    symbol: string,
  ): Promise<OverseasQuoteAndOrderBookSnapshot> {
    if (this.#environment !== "prod" || !/^[A-Z0-9.\-]{1,20}$/.test(symbol)) {
      throw new TypeError("Overseas quotes require prod data and a valid symbol");
    }
    const endpoint = getKisEndpoints(this.#environment);
    const url = new URL(`${endpoint.restBaseUrl}${KIS_PATH.overseasOrderBookSnapshot}`);
    url.search = new URLSearchParams({ AUTH: "", EXCD: exchange, SYMB: symbol }).toString();
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${await this.#getAccessToken()}`,
          appkey: this.#credentials.appKey,
          appsecret: this.#credentials.appSecret,
          tr_id: KIS_TR.overseasOrderBookSnapshot,
          custtype: "P",
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new KisApiError({ code: "KIS_NETWORK_ERROR", message: "KIS overseas order book is unreachable", retryable: true, cause: error });
    }
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new KisApiError({ code: response.status === 429 ? "KIS_RATE_LIMITED" : "KIS_REST_FAILED", message: `KIS overseas order book failed with HTTP ${response.status}`, retryable: response.status >= 500 || response.status === 429, status: response.status });
    }
    const parsed = overseasOrderBookResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.rt_cd !== "0") {
      throw new KisApiError({ code: parsed.success ? (parsed.data.msg_cd ?? "KIS_BUSINESS_ERROR") : "KIS_REST_SCHEMA_MISMATCH", message: parsed.success ? (parsed.data.msg1 ?? "KIS rejected the overseas order book request") : "KIS overseas order book response did not match the expected contract", retryable: false });
    }
    const output = { ...(parsed.data.output1 ?? {}), ...(parsed.data.output2 ?? {}), ...(parsed.data.output3 ?? {}) };
    const price = output.last?.trim();
    if (!price || price === "0") throw new KisApiError({ code: "KIS_REST_SCHEMA_MISMATCH", message: "KIS overseas order book omitted current price", retryable: false });
    const bid = output.pbid1?.trim();
    const ask = output.pask1?.trim();
    const venue = exchange === "NAS" ? "NASDAQ" : exchange === "NYS" ? "NYSE" : "AMEX";
    return {
      instrumentId: `${venue}:${symbol}`,
      venue,
      price,
      previousClose: output.base?.trim() || null,
      openPrice: output.open?.trim() || null,
      highPrice: output.high?.trim() || null,
      lowPrice: output.low?.trim() || null,
      bids: bid && bid !== "0" ? [{ price: bid, quantity: output.vbid1?.trim() || "0" }] : [],
      asks: ask && ask !== "0" ? [{ price: ask, quantity: output.vask1?.trim() || "0" }] : [],
      totalBidQuantity: output.bvol?.trim() || null,
      totalAskQuantity: output.avol?.trim() || null,
      providerTime: output.dhms?.trim() || null,
      receivedAt: new Date().toISOString(),
    };
  }

  async getDomesticCurrentPrice(symbol: string): Promise<DomesticQuote> {
    const endpoint = getKisEndpoints(this.#environment);
    const url = new URL(
      `${endpoint.restBaseUrl}${KIS_PATH.domesticCurrentPrice}`,
    );
    url.search = new URLSearchParams({
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: symbol,
    }).toString();

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${await this.#getAccessToken()}`,
          appkey: this.#credentials.appKey,
          appsecret: this.#credentials.appSecret,
          tr_id: KIS_TR.domesticCurrentPrice,
          custtype: "P",
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new KisApiError({
        code: "KIS_NETWORK_ERROR",
        message: "KIS current-price endpoint is unreachable",
        retryable: true,
        cause: error,
      });
    }

    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new KisApiError({
        code: response.status === 429 ? "KIS_RATE_LIMITED" : "KIS_REST_FAILED",
        message: `KIS current-price request failed with HTTP ${response.status}`,
        retryable: response.status >= 500 || response.status === 429,
        status: response.status,
      });
    }

    const parsed = currentPriceResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new KisApiError({
        code: "KIS_REST_SCHEMA_MISMATCH",
        message:
          "KIS current-price response did not match the expected contract",
        retryable: false,
      });
    }

    if (parsed.data.rt_cd !== "0" || !parsed.data.output) {
      throw new KisApiError({
        code: parsed.data.msg_cd ?? "KIS_BUSINESS_ERROR",
        message: parsed.data.msg1 ?? "KIS rejected the current-price request",
        retryable: parsed.data.msg_cd === "EGW00201",
      });
    }

    return {
      instrumentId: `KRX:${symbol}`,
      currency: "KRW",
      price: parsed.data.output.stck_prpr,
      change: applyKisSign(
        parsed.data.output.prdy_vrss,
        parsed.data.output.prdy_vrss_sign,
      ),
      changeRate: applyKisSign(
        parsed.data.output.prdy_ctrt,
        parsed.data.output.prdy_vrss_sign,
      ),
      cumulativeVolume: parsed.data.output.acml_vol,
      cumulativeTurnover: parsed.data.output.acml_tr_pbmn,
      openPrice: parsed.data.output.stck_oprc,
      highPrice: parsed.data.output.stck_hgpr,
      lowPrice: parsed.data.output.stck_lwpr,
      source: "KIS_REST",
      receivedAt: new Date().toISOString(),
    };
  }

  async getDomesticOrderBook(
    symbol: string,
  ): Promise<DomesticOrderBookSnapshot> {
    const endpoint = getKisEndpoints(this.#environment);
    const url = new URL(
      `${endpoint.restBaseUrl}${KIS_PATH.domesticOrderBookSnapshot}`,
    );
    url.search = new URLSearchParams({
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: symbol,
    }).toString();

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${await this.#getAccessToken()}`,
          appkey: this.#credentials.appKey,
          appsecret: this.#credentials.appSecret,
          tr_id: KIS_TR.domesticOrderBookSnapshot,
          custtype: "P",
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new KisApiError({
        code: "KIS_NETWORK_ERROR",
        message: "KIS order-book snapshot endpoint is unreachable",
        retryable: true,
        cause: error,
      });
    }

    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new KisApiError({
        code: response.status === 429 ? "KIS_RATE_LIMITED" : "KIS_REST_FAILED",
        message: `KIS order-book snapshot failed with HTTP ${response.status}`,
        retryable: response.status >= 500 || response.status === 429,
        status: response.status,
      });
    }

    const parsed = orderBookResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new KisApiError({
        code: "KIS_REST_SCHEMA_MISMATCH",
        message: "KIS order-book snapshot did not match the expected contract",
        retryable: false,
      });
    }
    if (parsed.data.rt_cd !== "0" || !parsed.data.output1) {
      throw new KisApiError({
        code: parsed.data.msg_cd ?? "KIS_BUSINESS_ERROR",
        message:
          parsed.data.msg1 ?? "KIS rejected the order-book snapshot request",
        retryable: parsed.data.msg_cd === "EGW00201",
      });
    }

    const output = parsed.data.output1;
    const asks = Array.from({ length: 10 }, (_, index) => ({
      price: output[`askp${index + 1}` as keyof typeof output] as string,
      quantity: output[
        `askp_rsqn${index + 1}` as keyof typeof output
      ] as string,
    })).filter((level) => level.price !== "0" && level.price !== "");
    const bids = Array.from({ length: 10 }, (_, index) => ({
      price: output[`bidp${index + 1}` as keyof typeof output] as string,
      quantity: output[
        `bidp_rsqn${index + 1}` as keyof typeof output
      ] as string,
    })).filter((level) => level.price !== "0" && level.price !== "");

    return {
      instrumentId: `KRX:${symbol}`,
      venue: "KRX",
      bids,
      asks,
      totalBidQuantity: output.total_bidp_rsqn,
      totalAskQuantity: output.total_askp_rsqn,
      providerTime: output.aspr_acpt_hour,
      source: "KIS_REST",
      receivedAt: new Date().toISOString(),
    };
  }
}
