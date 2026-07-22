import { z } from "zod";

import type { KisCredentials } from "../config/runtime-config.js";
import { KIS_PATH, KIS_TR, getKisEndpoints } from "./endpoints.js";
import { KisApiError } from "./errors.js";
import { getKisReadOnlyJson } from "./readonly-rest.js";

const unsignedIntegerSchema = z.string().regex(/^\d+$/);
const signedIntegerSchema = z.string().regex(/^[+-]?\d+$/);
const signedDecimalSchema = z.string().regex(/^[+-]?\d+(?:\.\d+)?$/);
const providerDateSchema = z.string().regex(/^\d{8}$/);
const providerTimeSchema = z.string().regex(/^\d{6}$/);

const investorFlowSchema = z.object({
  sellQuantity: unsignedIntegerSchema,
  buyQuantity: unsignedIntegerSchema,
  netBuyQuantity: signedIntegerSchema,
  sellAmount: unsignedIntegerSchema,
  buyAmount: unsignedIntegerSchema,
  netBuyAmount: signedIntegerSchema,
});

const providerEnvelopeSchema = z
  .object({
    rt_cd: z.string(),
    msg_cd: z.string().optional(),
    msg1: z.string().optional(),
  })
  .loose();

const investorByStockRowSchema = z
  .object({
    stck_bsop_date: providerDateSchema,
    stck_clpr: unsignedIntegerSchema,
    prdy_vrss: signedIntegerSchema,
    prdy_vrss_sign: z.string().regex(/^[1-5]$/),
    prsn_ntby_qty: signedIntegerSchema,
    frgn_ntby_qty: signedIntegerSchema,
    orgn_ntby_qty: signedIntegerSchema,
    prsn_ntby_tr_pbmn: signedIntegerSchema,
    frgn_ntby_tr_pbmn: signedIntegerSchema,
    orgn_ntby_tr_pbmn: signedIntegerSchema,
    prsn_shnu_vol: unsignedIntegerSchema,
    frgn_shnu_vol: unsignedIntegerSchema,
    orgn_shnu_vol: unsignedIntegerSchema,
    prsn_shnu_tr_pbmn: unsignedIntegerSchema,
    frgn_shnu_tr_pbmn: unsignedIntegerSchema,
    orgn_shnu_tr_pbmn: unsignedIntegerSchema,
    prsn_seln_vol: unsignedIntegerSchema,
    frgn_seln_vol: unsignedIntegerSchema,
    orgn_seln_vol: unsignedIntegerSchema,
    prsn_seln_tr_pbmn: unsignedIntegerSchema,
    frgn_seln_tr_pbmn: unsignedIntegerSchema,
    orgn_seln_tr_pbmn: unsignedIntegerSchema,
  })
  .loose();

const investorByStockResponseSchema = providerEnvelopeSchema.extend({
  output: z.array(investorByStockRowSchema).optional(),
});

const programByStockRowSchema = z
  .object({
    bsop_hour: providerTimeSchema,
    stck_prpr: unsignedIntegerSchema,
    prdy_vrss: signedIntegerSchema,
    prdy_vrss_sign: z.string().regex(/^[1-5]$/),
    prdy_ctrt: signedDecimalSchema,
    acml_vol: unsignedIntegerSchema,
    whol_smtn_seln_vol: unsignedIntegerSchema,
    whol_smtn_shnu_vol: unsignedIntegerSchema,
    whol_smtn_ntby_qty: signedIntegerSchema,
    whol_smtn_seln_tr_pbmn: unsignedIntegerSchema,
    whol_smtn_shnu_tr_pbmn: unsignedIntegerSchema,
    whol_smtn_ntby_tr_pbmn: signedIntegerSchema,
    whol_ntby_vol_icdc: signedIntegerSchema,
    whol_ntby_tr_pbmn_icdc: signedIntegerSchema,
  })
  .loose();

const programByStockResponseSchema = providerEnvelopeSchema.extend({
  output: z.array(programByStockRowSchema).optional(),
});

const marketInvestorTimeRowSchema = z
  .object({
    frgn_seln_vol: unsignedIntegerSchema,
    frgn_shnu_vol: unsignedIntegerSchema,
    frgn_ntby_qty: signedIntegerSchema,
    frgn_seln_tr_pbmn: unsignedIntegerSchema,
    frgn_shnu_tr_pbmn: unsignedIntegerSchema,
    frgn_ntby_tr_pbmn: signedIntegerSchema,
    prsn_seln_vol: unsignedIntegerSchema,
    prsn_shnu_vol: unsignedIntegerSchema,
    prsn_ntby_qty: signedIntegerSchema,
    prsn_seln_tr_pbmn: unsignedIntegerSchema,
    prsn_shnu_tr_pbmn: unsignedIntegerSchema,
    prsn_ntby_tr_pbmn: signedIntegerSchema,
    orgn_seln_vol: unsignedIntegerSchema,
    orgn_shnu_vol: unsignedIntegerSchema,
    orgn_ntby_qty: signedIntegerSchema,
    orgn_seln_tr_pbmn: unsignedIntegerSchema,
    orgn_shnu_tr_pbmn: unsignedIntegerSchema,
    orgn_ntby_tr_pbmn: signedIntegerSchema,
  })
  .loose();

const marketInvestorTimeResponseSchema = providerEnvelopeSchema.extend({
  output: z.array(marketInvestorTimeRowSchema).optional(),
});

export const DomesticInvestorByStockSchema = z.object({
  instrumentId: z.string().regex(/^KRX:[0-9A-Z]{6,7}$/),
  venue: z.enum(["KRX", "NXT"]),
  source: z.literal("KIS_REST"),
  dataEnvironment: z.literal("prod"),
  fetchedAt: z.string().datetime(),
  quality: z.literal("PROVIDER_REPORTED_AFTER_CLOSE"),
  rows: z.array(
    z.object({
      businessDate: providerDateSchema,
      closePrice: unsignedIntegerSchema,
      change: signedIntegerSchema,
      changeSignCode: z.string().regex(/^[1-5]$/),
      individual: investorFlowSchema,
      foreign: investorFlowSchema,
      institution: investorFlowSchema,
    }),
  ),
});

export const DomesticProgramByStockSchema = z.object({
  instrumentId: z.string().regex(/^KRX:[0-9A-Z]{6,7}$/),
  venue: z.enum(["KRX", "NXT", "UNIFIED"]),
  source: z.literal("KIS_REST"),
  dataEnvironment: z.literal("prod"),
  fetchedAt: z.string().datetime(),
  quality: z.literal("PROVIDER_REPORTED_FORMING_CUMULATIVE"),
  rows: z.array(
    z.object({
      providerTime: providerTimeSchema,
      price: unsignedIntegerSchema,
      change: signedIntegerSchema,
      changeSignCode: z.string().regex(/^[1-5]$/),
      changeRate: signedDecimalSchema,
      cumulativeVolume: unsignedIntegerSchema,
      program: investorFlowSchema,
      netBuyQuantityChange: signedIntegerSchema,
      netBuyAmountChange: signedIntegerSchema,
    }),
  ),
});

export const DomesticMarketInvestorTimeSchema = z.object({
  market: z.enum(["KOSPI", "KOSDAQ"]),
  source: z.literal("KIS_REST"),
  dataEnvironment: z.literal("prod"),
  fetchedAt: z.string().datetime(),
  providerTimestamp: z.null(),
  quality: z.literal("PROVIDER_REPORTED_SNAPSHOT_FINALITY_UNKNOWN"),
  rows: z.array(
    z.object({
      foreign: investorFlowSchema,
      individual: investorFlowSchema,
      institution: investorFlowSchema,
    }),
  ),
});

export type DomesticInvestorByStock = z.infer<
  typeof DomesticInvestorByStockSchema
>;
export type DomesticProgramByStock = z.infer<
  typeof DomesticProgramByStockSchema
>;
export type DomesticMarketInvestorTime = z.infer<
  typeof DomesticMarketInvestorTimeSchema
>;

function assertSymbol(symbol: string): void {
  if (!/^[0-9A-Z]{6,7}$/.test(symbol)) {
    throw new TypeError("Expected a six or seven character domestic symbol");
  }
}

function businessError(operation: string, data: z.infer<typeof providerEnvelopeSchema>): KisApiError {
  return new KisApiError({
    code: data.msg_cd ?? "KIS_BUSINESS_ERROR",
    message: data.msg1 ?? `KIS rejected the ${operation} request`,
    retryable: data.msg_cd === "EGW00201",
  });
}

function schemaError(operation: string): KisApiError {
  return new KisApiError({
    code: "KIS_REST_SCHEMA_MISMATCH",
    message: `KIS ${operation} response did not match the expected contract`,
    retryable: false,
  });
}

function flow(input: {
  readonly sellQuantity: string;
  readonly buyQuantity: string;
  readonly netBuyQuantity: string;
  readonly sellAmount: string;
  readonly buyAmount: string;
  readonly netBuyAmount: string;
}): z.infer<typeof investorFlowSchema> {
  const parsed = investorFlowSchema.parse(input);
  return {
    sellQuantity: BigInt(parsed.sellQuantity).toString(),
    buyQuantity: BigInt(parsed.buyQuantity).toString(),
    netBuyQuantity: BigInt(parsed.netBuyQuantity).toString(),
    sellAmount: BigInt(parsed.sellAmount).toString(),
    buyAmount: BigInt(parsed.buyAmount).toString(),
    netBuyAmount: BigInt(parsed.netBuyAmount).toString(),
  };
}

export class KisDomesticInvestorFlowClient {
  readonly #credentials: KisCredentials;
  readonly #getAccessToken: () => Promise<string>;
  readonly #clock: () => Date;

  constructor(options: {
    environment: "prod";
    credentials: KisCredentials;
    getAccessToken: () => Promise<string>;
    clock?: () => Date;
  }) {
    if (options.environment !== "prod") {
      throw new TypeError("Domestic investor-flow endpoints require prod data credentials");
    }
    this.#credentials = options.credentials;
    this.#getAccessToken = options.getAccessToken;
    this.#clock = options.clock ?? (() => new Date());
  }

  async getInvestorByStock(
    symbol: string,
    venue: "KRX" | "NXT" = "KRX",
  ): Promise<DomesticInvestorByStock> {
    assertSymbol(symbol);
    const url = new URL(
      `${getKisEndpoints("prod").restBaseUrl}${KIS_PATH.domesticInvestorByStock}`,
    );
    url.search = new URLSearchParams({
      FID_COND_MRKT_DIV_CODE: venue === "KRX" ? "J" : "NX",
      FID_INPUT_ISCD: symbol,
    }).toString();
    const response = await getKisReadOnlyJson({
      url,
      trId: KIS_TR.domesticInvestorByStock,
      credentials: this.#credentials,
      getAccessToken: this.#getAccessToken,
      operation: "domestic investor-by-stock",
    });
    const parsed = investorByStockResponseSchema.safeParse(response.payload);
    if (!parsed.success) throw schemaError("investor-by-stock");
    if (parsed.data.rt_cd !== "0") {
      throw businessError("investor-by-stock", parsed.data);
    }
    if (parsed.data.output === undefined) throw schemaError("investor-by-stock");

    return DomesticInvestorByStockSchema.parse({
      instrumentId: `KRX:${symbol}`,
      venue,
      source: "KIS_REST",
      dataEnvironment: "prod",
      fetchedAt: this.#clock().toISOString(),
      quality: "PROVIDER_REPORTED_AFTER_CLOSE",
      rows: parsed.data.output.map((row) => ({
        businessDate: row.stck_bsop_date,
        closePrice: row.stck_clpr,
        change: row.prdy_vrss,
        changeSignCode: row.prdy_vrss_sign,
        individual: flow({
          sellQuantity: row.prsn_seln_vol,
          buyQuantity: row.prsn_shnu_vol,
          netBuyQuantity: row.prsn_ntby_qty,
          sellAmount: row.prsn_seln_tr_pbmn,
          buyAmount: row.prsn_shnu_tr_pbmn,
          netBuyAmount: row.prsn_ntby_tr_pbmn,
        }),
        foreign: flow({
          sellQuantity: row.frgn_seln_vol,
          buyQuantity: row.frgn_shnu_vol,
          netBuyQuantity: row.frgn_ntby_qty,
          sellAmount: row.frgn_seln_tr_pbmn,
          buyAmount: row.frgn_shnu_tr_pbmn,
          netBuyAmount: row.frgn_ntby_tr_pbmn,
        }),
        institution: flow({
          sellQuantity: row.orgn_seln_vol,
          buyQuantity: row.orgn_shnu_vol,
          netBuyQuantity: row.orgn_ntby_qty,
          sellAmount: row.orgn_seln_tr_pbmn,
          buyAmount: row.orgn_shnu_tr_pbmn,
          netBuyAmount: row.orgn_ntby_tr_pbmn,
        }),
      })),
    });
  }

  async getProgramByStock(
    symbol: string,
    venue: "KRX" | "NXT" | "UNIFIED" = "KRX",
  ): Promise<DomesticProgramByStock> {
    assertSymbol(symbol);
    const marketCode = { KRX: "J", NXT: "NX", UNIFIED: "UN" }[venue];
    const url = new URL(
      `${getKisEndpoints("prod").restBaseUrl}${KIS_PATH.domesticProgramByStock}`,
    );
    url.search = new URLSearchParams({
      FID_COND_MRKT_DIV_CODE: marketCode,
      FID_INPUT_ISCD: symbol,
    }).toString();
    const response = await getKisReadOnlyJson({
      url,
      trId: KIS_TR.domesticProgramByStock,
      credentials: this.#credentials,
      getAccessToken: this.#getAccessToken,
      operation: "domestic program-by-stock",
    });
    const parsed = programByStockResponseSchema.safeParse(response.payload);
    if (!parsed.success) throw schemaError("program-by-stock");
    if (parsed.data.rt_cd !== "0") {
      throw businessError("program-by-stock", parsed.data);
    }
    if (parsed.data.output === undefined) throw schemaError("program-by-stock");

    return DomesticProgramByStockSchema.parse({
      instrumentId: `KRX:${symbol}`,
      venue,
      source: "KIS_REST",
      dataEnvironment: "prod",
      fetchedAt: this.#clock().toISOString(),
      quality: "PROVIDER_REPORTED_FORMING_CUMULATIVE",
      rows: parsed.data.output.map((row) => ({
        providerTime: row.bsop_hour,
        price: row.stck_prpr,
        change: row.prdy_vrss,
        changeSignCode: row.prdy_vrss_sign,
        changeRate: row.prdy_ctrt,
        cumulativeVolume: row.acml_vol,
        program: flow({
          sellQuantity: row.whol_smtn_seln_vol,
          buyQuantity: row.whol_smtn_shnu_vol,
          netBuyQuantity: row.whol_smtn_ntby_qty,
          sellAmount: row.whol_smtn_seln_tr_pbmn,
          buyAmount: row.whol_smtn_shnu_tr_pbmn,
          netBuyAmount: row.whol_smtn_ntby_tr_pbmn,
        }),
        netBuyQuantityChange: row.whol_ntby_vol_icdc,
        netBuyAmountChange: row.whol_ntby_tr_pbmn_icdc,
      })),
    });
  }

  async getMarketInvestorTime(
    market: "KOSPI" | "KOSDAQ",
  ): Promise<DomesticMarketInvestorTime> {
    const codes =
      market === "KOSPI"
        ? { market: "KSP", industry: "0001" }
        : { market: "KSQ", industry: "1001" };
    const url = new URL(
      `${getKisEndpoints("prod").restBaseUrl}${KIS_PATH.domesticInvestorByMarketTime}`,
    );
    url.search = new URLSearchParams({
      FID_INPUT_ISCD: codes.market,
      FID_INPUT_ISCD_2: codes.industry,
    }).toString();
    const response = await getKisReadOnlyJson({
      url,
      trId: KIS_TR.domesticInvestorByMarketTime,
      credentials: this.#credentials,
      getAccessToken: this.#getAccessToken,
      operation: "domestic market investor-time",
    });
    const parsed = marketInvestorTimeResponseSchema.safeParse(response.payload);
    if (!parsed.success) throw schemaError("market investor-time");
    if (parsed.data.rt_cd !== "0") {
      throw businessError("market investor-time", parsed.data);
    }
    if (parsed.data.output === undefined) throw schemaError("market investor-time");

    return DomesticMarketInvestorTimeSchema.parse({
      market,
      source: "KIS_REST",
      dataEnvironment: "prod",
      fetchedAt: this.#clock().toISOString(),
      providerTimestamp: null,
      quality: "PROVIDER_REPORTED_SNAPSHOT_FINALITY_UNKNOWN",
      rows: parsed.data.output.map((row) => ({
        foreign: flow({
          sellQuantity: row.frgn_seln_vol,
          buyQuantity: row.frgn_shnu_vol,
          netBuyQuantity: row.frgn_ntby_qty,
          sellAmount: row.frgn_seln_tr_pbmn,
          buyAmount: row.frgn_shnu_tr_pbmn,
          netBuyAmount: row.frgn_ntby_tr_pbmn,
        }),
        individual: flow({
          sellQuantity: row.prsn_seln_vol,
          buyQuantity: row.prsn_shnu_vol,
          netBuyQuantity: row.prsn_ntby_qty,
          sellAmount: row.prsn_seln_tr_pbmn,
          buyAmount: row.prsn_shnu_tr_pbmn,
          netBuyAmount: row.prsn_ntby_tr_pbmn,
        }),
        institution: flow({
          sellQuantity: row.orgn_seln_vol,
          buyQuantity: row.orgn_shnu_vol,
          netBuyQuantity: row.orgn_ntby_qty,
          sellAmount: row.orgn_seln_tr_pbmn,
          buyAmount: row.orgn_shnu_tr_pbmn,
          netBuyAmount: row.orgn_ntby_tr_pbmn,
        }),
      })),
    });
  }
}
