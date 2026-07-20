import { z } from "zod";

import type { KisCredentials } from "../config/runtime-config.js";
import { getKisEndpoints, KIS_PATH, KIS_TR } from "./endpoints.js";
import { KisApiError } from "./errors.js";
import { getKisReadOnlyJson } from "./readonly-rest.js";

const decimalSchema = z.string().regex(/^[+-]?\d+(?:\.\d+)?$/);

const domesticIndexResponseSchema = z
  .object({
    rt_cd: z.string(),
    msg_cd: z.string().optional(),
    msg1: z.string().optional(),
    output: z
      .object({
        bstp_nmix_prpr: decimalSchema,
        bstp_nmix_prdy_vrss: decimalSchema,
        prdy_vrss_sign: z.string(),
        bstp_nmix_prdy_ctrt: decimalSchema,
      })
      .loose()
      .optional(),
  })
  .loose();

const overseasPriceResponseSchema = z
  .object({
    rt_cd: z.string(),
    msg_cd: z.string().optional(),
    msg1: z.string().optional(),
    output: z
      .object({
        rsym: z.string(),
        last: decimalSchema,
        sign: z.string(),
        diff: decimalSchema,
        rate: decimalSchema,
        curr: z.string().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

export interface KisMarketContextSnapshot {
  readonly instrumentId: string;
  readonly price: string;
  readonly change: string;
  readonly changeRate: string;
  readonly currency: "KRW" | "USD";
  readonly receivedAt: string;
}

export const KIS_DOMESTIC_INDEX_SELECTIONS = [
  {
    instrumentId: "KRX:KOSPI",
    code: "0001",
  },
  {
    instrumentId: "KRX:KOSDAQ",
    code: "1001",
  },
  {
    instrumentId: "KRX:KOSPI200",
    code: "2001",
  },
] as const;

export const KIS_US_MARKET_PROXY_SELECTIONS = [
  {
    instrumentId: "NASDAQ:QQQ",
    providerExchange: "NAS",
    symbol: "QQQ",
  },
  {
    instrumentId: "NYSEARCA:SPY",
    providerExchange: "AMS",
    symbol: "SPY",
  },
  {
    instrumentId: "NYSEARCA:IWM",
    providerExchange: "AMS",
    symbol: "IWM",
  },
  {
    instrumentId: "NYSEARCA:USO",
    providerExchange: "AMS",
    symbol: "USO",
  },
  {
    instrumentId: "NYSEARCA:GLD",
    providerExchange: "AMS",
    symbol: "GLD",
  },
] as const;

function signedValue(value: string, signCode: string): string {
  const absolute = value.replace(/^[+-]/, "");
  if (absolute === "0" || /^0(?:\.0+)?$/.test(absolute)) return absolute;
  return signCode === "4" || signCode === "5" || signCode === "-"
    ? `-${absolute}`
    : absolute;
}

function assertBusinessSuccess(input: {
  readonly rtCd: string;
  readonly messageCode: string | undefined;
  readonly message: string | undefined;
  readonly hasOutput: boolean;
  readonly operation: string;
}): void {
  if (input.rtCd === "0" && input.hasOutput) return;
  throw new KisApiError({
    code: input.messageCode ?? "KIS_BUSINESS_ERROR",
    message: input.message ?? `KIS rejected the ${input.operation} request`,
    retryable: input.messageCode === "EGW00201",
  });
}

export function normalizeDomesticIndexResponse(
  payload: unknown,
  instrumentId: string,
  receivedAt: string,
): KisMarketContextSnapshot {
  const parsed = domesticIndexResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new KisApiError({
      code: "KIS_REST_SCHEMA_MISMATCH",
      message: "KIS domestic index response did not match the expected contract",
      retryable: false,
    });
  }
  assertBusinessSuccess({
    rtCd: parsed.data.rt_cd,
    messageCode: parsed.data.msg_cd,
    message: parsed.data.msg1,
    hasOutput: parsed.data.output !== undefined,
    operation: "domestic index",
  });
  const output = parsed.data.output!;
  return {
    instrumentId,
    price: output.bstp_nmix_prpr,
    change: signedValue(
      output.bstp_nmix_prdy_vrss,
      output.prdy_vrss_sign,
    ),
    changeRate: signedValue(
      output.bstp_nmix_prdy_ctrt,
      output.prdy_vrss_sign,
    ),
    currency: "KRW",
    receivedAt,
  };
}

export function normalizeUsMarketProxyResponse(
  payload: unknown,
  instrumentId: string,
  receivedAt: string,
  expectedRealtimeSymbol?: string,
): KisMarketContextSnapshot {
  const parsed = overseasPriceResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new KisApiError({
      code: "KIS_REST_SCHEMA_MISMATCH",
      message: "KIS overseas price response did not match the expected contract",
      retryable: false,
    });
  }
  assertBusinessSuccess({
    rtCd: parsed.data.rt_cd,
    messageCode: parsed.data.msg_cd,
    message: parsed.data.msg1,
    hasOutput: parsed.data.output !== undefined,
    operation: "overseas market proxy",
  });
  const output = parsed.data.output!;
  if (
    expectedRealtimeSymbol !== undefined &&
    output.rsym !== expectedRealtimeSymbol
  ) {
    throw new KisApiError({
      code: "KIS_INSTRUMENT_MISMATCH",
      message: "KIS overseas response instrument did not match the request",
      retryable: false,
    });
  }
  return {
    instrumentId,
    price: output.last,
    change: signedValue(output.diff, output.sign),
    changeRate: signedValue(output.rate, output.sign),
    currency: "USD",
    receivedAt,
  };
}

export class KisMarketContextClient {
  readonly #environment: "paper" | "prod";
  readonly #credentials: KisCredentials;
  readonly #getAccessToken: () => Promise<string>;

  constructor(options: {
    readonly environment: "paper" | "prod";
    readonly credentials: KisCredentials;
    readonly getAccessToken: () => Promise<string>;
  }) {
    this.#environment = options.environment;
    this.#credentials = options.credentials;
    this.#getAccessToken = options.getAccessToken;
  }

  async getDomesticIndex(
    selection: (typeof KIS_DOMESTIC_INDEX_SELECTIONS)[number],
  ): Promise<KisMarketContextSnapshot> {
    const endpoint = getKisEndpoints(this.#environment);
    const url = new URL(
      `${endpoint.restBaseUrl}${KIS_PATH.domesticIndexPrice}`,
    );
    url.search = new URLSearchParams({
      FID_COND_MRKT_DIV_CODE: "U",
      FID_INPUT_ISCD: selection.code,
    }).toString();
    const response = await getKisReadOnlyJson({
      url,
      trId: KIS_TR.domesticIndexPrice,
      credentials: this.#credentials,
      getAccessToken: this.#getAccessToken,
      operation: "domestic-index-price",
    });
    return normalizeDomesticIndexResponse(
      response.payload,
      selection.instrumentId,
      new Date().toISOString(),
    );
  }

  async getUsMarketProxy(
    selection: (typeof KIS_US_MARKET_PROXY_SELECTIONS)[number],
  ): Promise<KisMarketContextSnapshot> {
    const endpoint = getKisEndpoints(this.#environment);
    const url = new URL(
      `${endpoint.restBaseUrl}${KIS_PATH.overseasCurrentPrice}`,
    );
    url.search = new URLSearchParams({
      AUTH: "",
      EXCD: selection.providerExchange,
      SYMB: selection.symbol,
    }).toString();
    const response = await getKisReadOnlyJson({
      url,
      trId: KIS_TR.overseasCurrentPrice,
      credentials: this.#credentials,
      getAccessToken: this.#getAccessToken,
      operation: "overseas-market-proxy-price",
    });
    return normalizeUsMarketProxyResponse(
      response.payload,
      selection.instrumentId,
      new Date().toISOString(),
      `D${selection.providerExchange}${selection.symbol}`,
    );
  }
}
