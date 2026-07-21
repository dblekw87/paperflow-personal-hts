import { z } from "zod";

import {
  KrxStatDownloadClient,
  KrxStatDownloadError,
} from "./stat-download-client.js";

const calendarDateSchema = z.string().regex(/^\d{8}$/);
const symbolSchema = z.string().regex(/^[0-9A-Z]{6,7}$/);
const isinSchema = z.string().regex(/^KR[0-9A-Z]{10}$/);
const signedIntegerSchema = z.string().regex(/^(?:0|[+-]?[1-9]\d*)$/);
const unsignedIntegerSchema = z.string().regex(/^(?:0|[1-9]\d*)$/);

const investorFlowSchema = z.object({
  sellQuantity: unsignedIntegerSchema,
  buyQuantity: unsignedIntegerSchema,
  netBuyQuantity: signedIntegerSchema,
  sellAmount: unsignedIntegerSchema,
  buyAmount: unsignedIntegerSchema,
  netBuyAmount: signedIntegerSchema,
});

export const KrxInvestorByStockSchema = z.object({
  instrumentId: z.string().regex(/^KRX:[0-9A-Z]{6,7}$/),
  source: z.literal("KRX_DATA_PRODUCT"),
  fetchedAt: z.string().datetime(),
  quality: z.literal("PROVIDER_REPORTED_AFTER_CLOSE"),
  rows: z.array(
    z.object({
      businessDate: calendarDateSchema,
      individual: investorFlowSchema,
      foreign: investorFlowSchema,
      institution: investorFlowSchema,
    }),
  ),
});

export type KrxInvestorByStock = z.infer<typeof KrxInvestorByStockSchema>;

export interface KrxInvestorByStockRequest {
  readonly symbol: string;
  readonly isin: string;
  readonly name: string;
  readonly fromDate: string;
  readonly toDate: string;
}

type ParsedCsvRow = readonly string[];

const PARTICIPANT_LABELS = {
  individual: ["개인"],
  foreign: ["외국인"],
  institution: ["기관합계", "기관"],
} as const;

function assertRequest(request: KrxInvestorByStockRequest): void {
  if (!symbolSchema.safeParse(request.symbol).success) {
    throw new TypeError("KRX investor-flow symbol must be six or seven characters");
  }
  if (!isinSchema.safeParse(request.isin).success) {
    throw new TypeError("KRX investor-flow ISIN must be a Korean standard code");
  }
  if (
    !calendarDateSchema.safeParse(request.fromDate).success ||
    !calendarDateSchema.safeParse(request.toDate).success
  ) {
    throw new TypeError("KRX investor-flow dates must be YYYYMMDD");
  }
  if (request.name.trim().length === 0) {
    throw new TypeError("KRX investor-flow instrument name is required");
  }
}

function csvRows(csv: string): ParsedCsvRow[] {
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
  return rows.filter((item) => item.some((fieldValue) => fieldValue !== ""));
}

function numericText(value: string): string {
  return value.replaceAll(",", "").replaceAll("\"", "").trim();
}

function parseScaledInteger(
  value: string,
  scale: bigint,
  signed: boolean,
): string {
  const normalized = numericText(value);
  const pattern = signed ? /^[+-]?\d+$/ : /^\d+$/;
  if (!pattern.test(normalized)) {
    throw new KrxStatDownloadError({
      code: "KRX_INVESTOR_FLOW_INVALID_NUMBER",
      message: "KRX investor-flow CSV contained an invalid numeric field",
      retryable: false,
    });
  }
  return (BigInt(normalized) * scale).toString();
}

function findParticipantRow(
  rows: readonly ParsedCsvRow[],
  labels: readonly string[],
): ParsedCsvRow | null {
  return (
    rows.find((row) => labels.includes((row[0] ?? "").replace(/\s+/g, ""))) ??
    null
  );
}

function flowFromRow(row: ParsedCsvRow) {
  if (row.length < 7) {
    throw new KrxStatDownloadError({
      code: "KRX_INVESTOR_FLOW_SCHEMA_MISMATCH",
      message: "KRX investor-flow CSV row did not contain the expected columns",
      retryable: false,
    });
  }
  return investorFlowSchema.parse({
    sellQuantity: parseScaledInteger(row[1] ?? "", 1_000n, false),
    buyQuantity: parseScaledInteger(row[2] ?? "", 1_000n, false),
    netBuyQuantity: parseScaledInteger(row[3] ?? "", 1_000n, true),
    sellAmount: parseScaledInteger(row[4] ?? "", 1_000_000n, false),
    buyAmount: parseScaledInteger(row[5] ?? "", 1_000_000n, false),
    netBuyAmount: parseScaledInteger(row[6] ?? "", 1_000_000n, true),
  });
}

function investorRowsFromCsv(csv: string): {
  readonly individual: z.infer<typeof investorFlowSchema>;
  readonly foreign: z.infer<typeof investorFlowSchema>;
  readonly institution: z.infer<typeof investorFlowSchema>;
} {
  const rows = csvRows(csv);
  const individual = findParticipantRow(rows, PARTICIPANT_LABELS.individual);
  const foreign = findParticipantRow(rows, PARTICIPANT_LABELS.foreign);
  const institution = findParticipantRow(rows, PARTICIPANT_LABELS.institution);
  if (individual === null || foreign === null || institution === null) {
    throw new KrxStatDownloadError({
      code: "KRX_INVESTOR_FLOW_MISSING_PARTICIPANT",
      message: "KRX investor-flow CSV omitted a required participant row",
      retryable: false,
    });
  }
  return {
    individual: flowFromRow(individual),
    foreign: flowFromRow(foreign),
    institution: flowFromRow(institution),
  };
}

function requestParams(request: KrxInvestorByStockRequest): URLSearchParams {
  return new URLSearchParams({
    locale: "ko_KR",
    inqTpCd: "1",
    trdVolVal: "2",
    askBid: "3",
    tboxisuCd_finder_stkisu0_1: `${request.symbol}/${request.name}`,
    isuCd: request.isin,
    isuCd2: "",
    codeNmisuCd_finder_stkisu0_1: request.name,
    param1isuCd_finder_stkisu0_1: "ALL",
    strtDd: request.fromDate,
    endDd: request.toDate,
    share: "1",
    money: "1",
    csvxls_isNo: "false",
    name: "fileDown",
    url: "dbms/MDC/STAT/standard/MDCSTAT02301",
  });
}

export class KrxInvestorFlowClient {
  readonly #client: KrxStatDownloadClient;
  readonly #clock: () => Date;

  constructor(options: {
    readonly client?: KrxStatDownloadClient;
    readonly clock?: () => Date;
  } = {}) {
    this.#client = options.client ?? new KrxStatDownloadClient();
    this.#clock = options.clock ?? (() => new Date());
  }

  async getInvestorByStock(
    request: KrxInvestorByStockRequest,
  ): Promise<KrxInvestorByStock> {
    assertRequest(request);
    const csv = await this.#client.downloadCsvByParams(requestParams(request));
    const parsedRows = investorRowsFromCsv(csv);
    return KrxInvestorByStockSchema.parse({
      instrumentId: `KRX:${request.symbol}`,
      source: "KRX_DATA_PRODUCT",
      fetchedAt: this.#clock().toISOString(),
      quality: "PROVIDER_REPORTED_AFTER_CLOSE",
      rows: [
        {
          businessDate: request.toDate,
          ...parsedRows,
        },
      ],
    });
  }
}
