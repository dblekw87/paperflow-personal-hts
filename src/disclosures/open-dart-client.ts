import { z } from "zod";
import { strFromU8, unzipSync } from "fflate";

import {
  redactDisclosureSecrets,
  type OpenDartCredentials,
} from "../config/runtime-config.js";

const filingSchema = z
  .object({
    corp_code: z.string(),
    corp_name: z.string(),
    stock_code: z.string(),
    corp_cls: z.string(),
    report_nm: z.string(),
    rcept_no: z.string().regex(/^\d{14}$/),
    flr_nm: z.string(),
    rcept_dt: z.string().regex(/^\d{8}$/),
    rm: z.string(),
  })
  .loose();

const listResponseSchema = z
  .object({
    status: z.string(),
    message: z.string(),
    page_no: z.coerce.number().int().positive().optional(),
    page_count: z.coerce.number().int().positive().optional(),
    total_count: z.coerce.number().int().nonnegative().optional(),
    total_page: z.coerce.number().int().nonnegative().optional(),
    list: z.array(filingSchema).optional(),
  })
  .loose();

export interface OpenDartFiling {
  readonly providerFilingId: string;
  readonly corpCode: string;
  readonly corpName: string;
  readonly stockCode: string | null;
  readonly corpClass: string;
  readonly reportName: string;
  readonly filerName: string;
  readonly providerFiledDate: string;
  readonly providerFiledAtPrecision: "DATE";
  readonly remarks: string | null;
}

export interface OpenDartFilingPage {
  readonly items: readonly OpenDartFiling[];
  readonly page: number;
  readonly pageCount: number;
  readonly totalCount: number;
  readonly totalPages: number;
  readonly obtainedAt: string;
}

export interface OpenDartFilingBatch extends OpenDartFilingPage {
  readonly pagesFetched: number;
  readonly paginationComplete: boolean;
}

export interface OpenDartCorpCode {
  readonly corpCode: string;
  readonly corpName: string;
  readonly stockCode: string | null;
  readonly modifyDate: string;
}

function requireDate(value: string, field: string): string {
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`OPEN_DART_INVALID_${field}`);
  }
  return value;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlTag(block: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
  return decodeXml(match?.[1]?.trim() ?? "");
}

export function parseOpenDartCorpCodes(xml: string): readonly OpenDartCorpCode[] {
  const records: OpenDartCorpCode[] = [];
  for (const match of xml.matchAll(/<list>([\s\S]*?)<\/list>/g)) {
    const block = match[1] ?? "";
    const corpCode = xmlTag(block, "corp_code");
    const corpName = xmlTag(block, "corp_name");
    const stockCode = xmlTag(block, "stock_code");
    const modifyDate = xmlTag(block, "modify_date");
    if (
      !/^\d{8}$/.test(corpCode) ||
      corpName.length === 0 ||
      (stockCode.length > 0 && !/^\d{6}$/.test(stockCode)) ||
      !/^\d{8}$/.test(modifyDate)
    ) {
      continue;
    }
    records.push({ corpCode, corpName, stockCode: stockCode || null, modifyDate });
  }
  return records;
}

export class OpenDartClient {
  readonly #credentials: OpenDartCredentials;
  readonly #fetch: typeof fetch;

  constructor(options: {
    credentials: OpenDartCredentials;
    fetchImplementation?: typeof fetch;
  }) {
    this.#credentials = options.credentials;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async listFilings(input: {
    beginDate: string;
    endDate: string;
    page?: number;
  }): Promise<OpenDartFilingPage> {
    const beginDate = requireDate(input.beginDate, "BEGIN_DATE");
    const endDate = requireDate(input.endDate, "END_DATE");
    const page = input.page ?? 1;
    if (!Number.isInteger(page) || page < 1) {
      throw new Error("OPEN_DART_INVALID_PAGE");
    }
    const url = new URL("https://opendart.fss.or.kr/api/list.json");
    url.search = new URLSearchParams({
      crtfc_key: this.#credentials.crtfcKey,
      bgn_de: beginDate,
      end_de: endDate,
      last_reprt_at: "N",
      page_no: String(page),
      page_count: "100",
    }).toString();

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      const safeUrl = redactDisclosureSecrets(url.toString());
      // Do not retain the raw fetch error as `cause`: some transports include
      // the complete query URL in their message or stack.
      throw new Error(`OPEN_DART_NETWORK_ERROR ${safeUrl}`);
    }
    if (!response.ok) {
      throw new Error(`OPEN_DART_HTTP_${response.status}`);
    }
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = listResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("OPEN_DART_SCHEMA_MISMATCH");
    }
    if (parsed.data.status === "013") {
      return {
        items: [],
        page,
        pageCount: 100,
        totalCount: 0,
        totalPages: 0,
        obtainedAt: new Date().toISOString(),
      };
    }
    if (parsed.data.status !== "000") {
      throw new Error(`OPEN_DART_${parsed.data.status}`);
    }
    return {
      items: (parsed.data.list ?? []).map((filing) => ({
        providerFilingId: filing.rcept_no,
        corpCode: filing.corp_code,
        corpName: filing.corp_name,
        stockCode: filing.stock_code.trim() || null,
        corpClass: filing.corp_cls,
        reportName: filing.report_nm,
        filerName: filing.flr_nm,
        providerFiledDate: filing.rcept_dt,
        providerFiledAtPrecision: "DATE",
        remarks: filing.rm.trim() || null,
      })),
      page: parsed.data.page_no ?? page,
      pageCount: parsed.data.page_count ?? 100,
      totalCount: parsed.data.total_count ?? 0,
      totalPages: parsed.data.total_page ?? 0,
      obtainedAt: new Date().toISOString(),
    };
  }

  async listAllFilings(input: {
    beginDate: string;
    endDate: string;
    maxPages?: number;
  }): Promise<OpenDartFilingBatch> {
    const maxPages = input.maxPages ?? 100;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) {
      throw new Error("OPEN_DART_INVALID_MAX_PAGES");
    }
    const first = await this.listFilings(input);
    const lastPage = Math.min(first.totalPages, maxPages);
    const pages = [first];
    for (let page = 2; page <= lastPage; page += 1) {
      pages.push(await this.listFilings({ ...input, page }));
    }
    const unique = new Map<string, OpenDartFiling>();
    for (const page of pages) {
      for (const filing of page.items) unique.set(filing.providerFilingId, filing);
    }
    return {
      ...first,
      items: [...unique.values()],
      pagesFetched: pages.length,
      paginationComplete: first.totalPages <= maxPages,
      obtainedAt: pages.at(-1)?.obtainedAt ?? first.obtainedAt,
    };
  }

  async listCorpCodes(): Promise<readonly OpenDartCorpCode[]> {
    const url = new URL("https://opendart.fss.or.kr/api/corpCode.xml");
    url.searchParams.set("crtfc_key", this.#credentials.crtfcKey);
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error(
        `OPEN_DART_NETWORK_ERROR ${redactDisclosureSecrets(url.toString())}`,
      );
    }
    if (!response.ok) throw new Error(`OPEN_DART_HTTP_${response.status}`);
    let archive: Record<string, Uint8Array>;
    try {
      archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
    } catch {
      throw new Error("OPEN_DART_CORP_CODE_ARCHIVE_INVALID");
    }
    const xmlEntry = Object.entries(archive).find(([name]) =>
      name.toLowerCase().endsWith(".xml"),
    );
    if (!xmlEntry) throw new Error("OPEN_DART_CORP_CODE_XML_MISSING");
    const records = parseOpenDartCorpCodes(strFromU8(xmlEntry[1]));
    if (records.length === 0) throw new Error("OPEN_DART_CORP_CODE_SCHEMA_MISMATCH");
    return records;
  }
}
