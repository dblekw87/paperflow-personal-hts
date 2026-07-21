import { z } from "zod";

import {
  KrxStatDownloadClient,
  KrxStatDownloadError,
} from "./stat-download-client.js";

const calendarDateSchema = z.string().regex(/^\d{8}$/);
const symbolSchema = z.string().regex(/^[0-9A-Z]{6,7}$/);
const unsignedIntegerSchema = z.string().regex(/^(?:0|[1-9]\d*)$/);
const decimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);

export const KrxShortSellingTradeSchema = z.object({
  source: z.literal("KRX_DATA_PRODUCT"),
  fetchedAt: z.string().datetime(),
  businessDate: calendarDateSchema,
  market: z.enum(["KOSPI", "KOSDAQ", "KONEX", "ALL"]),
  symbol: symbolSchema,
  name: z.string().min(1),
  shortSellVolume: unsignedIntegerSchema,
  shortSellTurnover: unsignedIntegerSchema,
  shortSellRatio: decimalSchema,
});

export type KrxShortSellingTrade = z.infer<
  typeof KrxShortSellingTradeSchema
>;

export const KrxShortSellingBalanceSchema = z.object({
  source: z.literal("KRX_DATA_PRODUCT"),
  fetchedAt: z.string().datetime(),
  businessDate: calendarDateSchema,
  market: z.enum(["KOSPI", "KOSDAQ", "KONEX", "ALL"]),
  symbol: symbolSchema,
  name: z.string().min(1),
  shortBalanceQuantity: unsignedIntegerSchema,
  shortBalanceTurnover: unsignedIntegerSchema,
  shortBalanceRatio: decimalSchema,
});

export type KrxShortSellingBalance = z.infer<
  typeof KrxShortSellingBalanceSchema
>;

export interface KrxShortSellingTradeRequest {
  readonly symbol: string;
  readonly market: "KOSPI" | "KOSDAQ" | "KONEX" | "ALL";
  readonly fromDate: string;
  readonly toDate: string;
}

export interface KrxShortSellingBalanceRequest {
  readonly symbol: string;
  readonly isin: string;
  readonly name: string;
  readonly market: "KOSPI" | "KOSDAQ" | "KONEX" | "ALL";
  readonly fromDate: string;
  readonly toDate: string;
}

function csvRows(csv: string): readonly string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field.trim());
      field = "";
    } else if (char === "\n") {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => value.length > 0));
}

function compact(value: string): string {
  return value.replace(/\s+/g, "").replaceAll("\"", "");
}

function numberText(value: string): string {
  return value.replaceAll(",", "").replaceAll("%", "").trim();
}

function marketCode(market: KrxShortSellingTradeRequest["market"]): string {
  if (market === "KOSPI") return "STK";
  if (market === "KOSDAQ") return "KSQ";
  if (market === "KONEX") return "KNX";
  return "ALL";
}

function buildRequestParams(
  request: KrxShortSellingTradeRequest,
): URLSearchParams {
  return new URLSearchParams({
    locale: "ko_KR",
    searchType: "1",
    mktId: marketCode(request.market),
    secugrpId: "BC",
    inqCond: "STMFRTSCIFDRFSSRSWBC",
    trdDd: request.toDate,
    tboxisuCd_finder_srtisu1_0: "",
    isuCd: "",
    isuCd2: "",
    codeNmisuCd_finder_srtisu1_0: "",
    param1isuCd_finder_srtisu1_0: "",
    strtDd: request.fromDate,
    endDd: request.toDate,
    share: "1",
    money: "1",
    csvxls_isNo: "false",
    name: "fileDown",
    url: "dbms/MDC/STAT/srt/MDCSTAT30101",
  });
}

function buildBalanceRequestParams(
  request: KrxShortSellingBalanceRequest,
): URLSearchParams {
  return new URLSearchParams({
    locale: "ko_KR",
    searchType: "1",
    mktTpCd: request.market === "KOSPI" ? "1" : request.market === "KOSDAQ" ? "2" : "0",
    trdDd: request.toDate,
    tboxisuCd_finder_srtisu0_9: `${request.symbol}/${request.name}`,
    isuCd: request.isin,
    isuCd2: "",
    codeNmisuCd_finder_srtisu0_9: request.name,
    param1isuCd_finder_srtisu0_9: "",
    strtDd: request.fromDate,
    endDd: request.toDate,
    share: "1",
    money: "1",
    csvxls_isNo: "false",
    name: "fileDown",
    url: "dbms/MDC/STAT/srt/MDCSTAT30501",
  });
}

function findHeader(rows: readonly string[][]): {
  readonly index: number;
  readonly columns: readonly string[];
} {
  const index = rows.findIndex((row) =>
    row.some((column) => compact(column).includes("종목코드")) &&
    row.some((column) => compact(column).includes("공매도")),
  );
  if (index < 0) {
    throw new KrxStatDownloadError({
      code: "KRX_SHORT_SELLING_HEADER_MISSING",
      message: "KRX short-selling CSV header was not found",
      retryable: false,
    });
  }
  return { index, columns: rows[index] ?? [] };
}

function findColumn(
  columns: readonly string[],
  patterns: readonly string[],
): number {
  const index = columns.findIndex((column) => {
    const label = compact(column);
    return patterns.every((pattern) => label.includes(pattern));
  });
  if (index < 0) {
    throw new KrxStatDownloadError({
      code: "KRX_SHORT_SELLING_SCHEMA_MISMATCH",
      message: "KRX short-selling CSV omitted a required column",
      retryable: false,
    });
  }
  return index;
}

function latestTradeFromCsv(
  csv: string,
  request: KrxShortSellingTradeRequest,
  fetchedAt: string,
): KrxShortSellingTrade {
  const rows = csvRows(csv);
  const header = findHeader(rows);
  const symbolColumn = findColumn(header.columns, ["종목코드"]);
  const nameColumn = findColumn(header.columns, ["종목명"]);
  const dateColumn = header.columns.findIndex((column) =>
    compact(column).includes("일자"),
  );
  const shortVolumeColumn = findColumn(header.columns, ["공매도", "거래량"]);
  const shortTurnoverColumn = findColumn(header.columns, ["공매도", "거래대금"]);
  const ratioColumn = findColumn(header.columns, ["비중"]);
  const dataRows = rows.slice(header.index + 1);
  const matched = dataRows.find((row) => compact(row[symbolColumn] ?? "") === request.symbol);
  if (matched === undefined) {
    throw new KrxStatDownloadError({
      code: "KRX_SHORT_SELLING_SYMBOL_NOT_FOUND",
      message: "KRX short-selling CSV did not include the selected symbol",
      retryable: false,
    });
  }
  const businessDate =
    dateColumn >= 0 && /^\d{4}\/\d{2}\/\d{2}$/.test(matched[dateColumn] ?? "")
      ? String(matched[dateColumn]).replaceAll("/", "")
      : request.toDate;
  return KrxShortSellingTradeSchema.parse({
    source: "KRX_DATA_PRODUCT",
    fetchedAt,
    businessDate,
    market: request.market,
    symbol: request.symbol,
    name: matched[nameColumn] ?? request.symbol,
    shortSellVolume: numberText(matched[shortVolumeColumn] ?? ""),
    shortSellTurnover: numberText(matched[shortTurnoverColumn] ?? ""),
    shortSellRatio: numberText(matched[ratioColumn] ?? "0"),
  });
}

function latestBalanceFromCsv(
  csv: string,
  request: KrxShortSellingBalanceRequest,
  fetchedAt: string,
): KrxShortSellingBalance {
  const rows = csvRows(csv);
  const header = findHeader(rows);
  const symbolColumn = findColumn(header.columns, ["종목코드"]);
  const nameColumn = findColumn(header.columns, ["종목명"]);
  const dateColumn = header.columns.findIndex((column) =>
    compact(column).includes("일자"),
  );
  const quantityColumn = findColumn(header.columns, ["잔고", "수량"]);
  const turnoverColumn = findColumn(header.columns, ["잔고", "금액"]);
  const ratioColumn = findColumn(header.columns, ["비중"]);
  const dataRows = rows.slice(header.index + 1);
  const matched = dataRows.find(
    (row) => compact(row[symbolColumn] ?? "") === request.symbol,
  );
  if (matched === undefined) {
    throw new KrxStatDownloadError({
      code: "KRX_SHORT_BALANCE_SYMBOL_NOT_FOUND",
      message: "KRX short-selling balance CSV did not include the selected symbol",
      retryable: false,
    });
  }
  const businessDate =
    dateColumn >= 0 && /^\d{4}\/\d{2}\/\d{2}$/.test(matched[dateColumn] ?? "")
      ? String(matched[dateColumn]).replaceAll("/", "")
      : request.toDate;
  return KrxShortSellingBalanceSchema.parse({
    source: "KRX_DATA_PRODUCT",
    fetchedAt,
    businessDate,
    market: request.market,
    symbol: request.symbol,
    name: matched[nameColumn] ?? request.name,
    shortBalanceQuantity: numberText(matched[quantityColumn] ?? ""),
    shortBalanceTurnover: numberText(matched[turnoverColumn] ?? ""),
    shortBalanceRatio: numberText(matched[ratioColumn] ?? "0"),
  });
}

export class KrxShortSellingClient {
  readonly #client: KrxStatDownloadClient;
  readonly #clock: () => Date;

  constructor(options: {
    readonly client?: KrxStatDownloadClient;
    readonly clock?: () => Date;
  } = {}) {
    this.#client = options.client ?? new KrxStatDownloadClient();
    this.#clock = options.clock ?? (() => new Date());
  }

  async getTradeByStock(
    request: KrxShortSellingTradeRequest,
  ): Promise<KrxShortSellingTrade> {
    if (!symbolSchema.safeParse(request.symbol).success) {
      throw new TypeError("KRX short-selling symbol must be six or seven characters");
    }
    if (
      !calendarDateSchema.safeParse(request.fromDate).success ||
      !calendarDateSchema.safeParse(request.toDate).success
    ) {
      throw new TypeError("KRX short-selling dates must be YYYYMMDD");
    }
    const fetchedAt = this.#clock().toISOString();
    const csv = await this.#client.downloadCsvByParams(
      buildRequestParams(request),
    );
    return latestTradeFromCsv(csv, request, fetchedAt);
  }

  async getBalanceByStock(
    request: KrxShortSellingBalanceRequest,
  ): Promise<KrxShortSellingBalance> {
    if (!symbolSchema.safeParse(request.symbol).success) {
      throw new TypeError("KRX short-selling balance symbol must be six or seven characters");
    }
    if (!/^KR[0-9A-Z]{10}$/.test(request.isin)) {
      throw new TypeError("KRX short-selling balance ISIN must be a Korean standard code");
    }
    if (
      !calendarDateSchema.safeParse(request.fromDate).success ||
      !calendarDateSchema.safeParse(request.toDate).success
    ) {
      throw new TypeError("KRX short-selling balance dates must be YYYYMMDD");
    }
    const fetchedAt = this.#clock().toISOString();
    const csv = await this.#client.downloadCsvByParams(
      buildBalanceRequestParams(request),
    );
    return latestBalanceFromCsv(csv, request, fetchedAt);
  }
}
