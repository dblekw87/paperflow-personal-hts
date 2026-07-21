import { z } from "zod";

import { type KrxOpenApiClient, KrxOpenApiError } from "./openapi-client.js";

const integerTextSchema = z.string().regex(/^-?[\d,]+$/);
const decimalTextSchema = z.string().regex(/^-?[\d,.]+$/);
const calendarDateSchema = z.string().regex(/^\d{8}$/);
const symbolSchema = z.string().regex(/^[0-9A-Z]{6,7}$/);

const dailyStockTradeRowSchema = z
  .object({
    BAS_DD: calendarDateSchema,
    ISU_CD: symbolSchema,
    ISU_NM: z.string().min(1),
    MKT_NM: z.string().min(1),
    TDD_CLSPRC: integerTextSchema,
    CMPPREVDD_PRC: integerTextSchema,
    FLUC_RT: decimalTextSchema,
    ACC_TRDVOL: integerTextSchema,
    ACC_TRDVAL: integerTextSchema,
    MKTCAP: integerTextSchema.optional(),
    LIST_SHRS: integerTextSchema.optional(),
  })
  .loose();

export type KrxDailyStockMarket = "KOSPI" | "KOSDAQ";
export type KrxDailyStockRankSort =
  | "TURNOVER"
  | "AVERAGE_VOLUME"
  | "CHANGE_RATE_GAINERS"
  | "CHANGE_RATE_LOSERS";

export interface KrxDailyStockTradeItem {
  readonly businessDate: string;
  readonly market: KrxDailyStockMarket;
  readonly symbol: string;
  readonly name: string;
  readonly price: string;
  readonly change: string;
  readonly changeRate: string;
  readonly cumulativeVolume: string;
  readonly cumulativeTurnover: string;
  readonly marketCap: string | null;
  readonly listedShares: string | null;
}

export interface KrxDailyStockRanking {
  readonly market: "KRX";
  readonly sort: KrxDailyStockRankSort;
  readonly source: "KRX_OPENAPI";
  readonly businessDate: string;
  readonly fetchedAt: string;
  readonly items: readonly KrxDailyStockTradeItem[];
}

function digits(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.replaceAll(",", "").trim();
  return normalized.length === 0 ? null : normalized;
}

function parseSignedDecimal(value: string): number {
  return Number(value.replaceAll(",", ""));
}

function compareIntegerTextDescending(
  left: string,
  right: string,
): number {
  const l = BigInt(left);
  const r = BigInt(right);
  return l === r ? 0 : l > r ? -1 : 1;
}

function endpoint(market: KrxDailyStockMarket): string {
  return market === "KOSPI" ? "/sto/stk_bydd_trd" : "/sto/ksq_bydd_trd";
}

function normalizeRow(
  row: z.infer<typeof dailyStockTradeRowSchema>,
  market: KrxDailyStockMarket,
): KrxDailyStockTradeItem {
  return {
    businessDate: row.BAS_DD,
    market,
    symbol: row.ISU_CD,
    name: row.ISU_NM,
    price: digits(row.TDD_CLSPRC) ?? "0",
    change: digits(row.CMPPREVDD_PRC) ?? "0",
    changeRate: row.FLUC_RT.replaceAll(",", ""),
    cumulativeVolume: digits(row.ACC_TRDVOL) ?? "0",
    cumulativeTurnover: digits(row.ACC_TRDVAL) ?? "0",
    marketCap: digits(row.MKTCAP),
    listedShares: digits(row.LIST_SHRS),
  };
}

export class KrxDailyStockTradeClient {
  readonly #client: KrxOpenApiClient;
  readonly #clock: () => Date;

  constructor(options: {
    readonly client: KrxOpenApiClient;
    readonly clock?: () => Date;
  }) {
    this.#client = options.client;
    this.#clock = options.clock ?? (() => new Date());
  }

  async getDailyTrades(
    market: KrxDailyStockMarket,
    businessDate: string,
  ): Promise<readonly KrxDailyStockTradeItem[]> {
    if (!/^\d{8}$/.test(businessDate)) {
      throw new TypeError("KRX businessDate must be YYYYMMDD");
    }
    const payload = await this.#client.get(
      endpoint(market),
      new URLSearchParams({ basDd: businessDate }),
    );
    const rows = payload.OutBlock_1 ?? [];
    const parsed = z.array(dailyStockTradeRowSchema).safeParse(rows);
    if (!parsed.success) {
      throw new KrxOpenApiError({
        code: "KRX_DAILY_STOCK_SCHEMA_MISMATCH",
        message: "KRX daily stock trade response did not match the contract",
        retryable: false,
        status: null,
      });
    }
    return parsed.data.map((row) => normalizeRow(row, market));
  }

  async getRanking(input: {
    readonly businessDate: string;
    readonly sort: KrxDailyStockRankSort;
    readonly limit?: number;
  }): Promise<KrxDailyStockRanking> {
    const [kospi, kosdaq] = await Promise.all([
      this.getDailyTrades("KOSPI", input.businessDate),
      this.getDailyTrades("KOSDAQ", input.businessDate),
    ]);
    const sorted = [...kospi, ...kosdaq]
      .filter(
        (item) =>
          BigInt(item.price) > 0n &&
          BigInt(item.cumulativeVolume) > 0n &&
          BigInt(item.cumulativeTurnover) > 0n,
      )
      .filter((item) => {
        if (input.sort === "CHANGE_RATE_GAINERS") {
          return parseSignedDecimal(item.changeRate) > 0;
        }
        if (input.sort === "CHANGE_RATE_LOSERS") {
          return parseSignedDecimal(item.changeRate) < 0;
        }
        return true;
      })
      .sort((left, right) => {
        if (input.sort === "TURNOVER") {
          return compareIntegerTextDescending(
            left.cumulativeTurnover,
            right.cumulativeTurnover,
          );
        }
        if (input.sort === "AVERAGE_VOLUME") {
          return compareIntegerTextDescending(
            left.cumulativeVolume,
            right.cumulativeVolume,
          );
        }
        const direction = input.sort === "CHANGE_RATE_GAINERS" ? -1 : 1;
        return (
          direction *
          (parseSignedDecimal(left.changeRate) -
            parseSignedDecimal(right.changeRate))
        );
      })
      .slice(0, input.limit ?? 100);

    return {
      market: "KRX",
      sort: input.sort,
      source: "KRX_OPENAPI",
      businessDate: input.businessDate,
      fetchedAt: this.#clock().toISOString(),
      items: sorted,
    };
  }
}
