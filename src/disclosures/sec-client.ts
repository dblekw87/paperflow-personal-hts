import { z } from "zod";

import type { SecRequestIdentity } from "../config/runtime-config.js";

const SEC_TICKER_MAPPING_URL =
  "https://www.sec.gov/files/company_tickers_exchange.json";
const SEC_SUBMISSIONS_ORIGIN = "https://data.sec.gov";
const SEC_ARCHIVES_ORIGIN = "https://www.sec.gov";
const MAX_SEC_REQUESTS_PER_SECOND = 10;
const DEFAULT_SEC_REQUESTS_PER_SECOND = 8;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 30_000;

const accessionNumberSchema = z
  .string()
  .regex(/^\d{10}-\d{2}-\d{6}$/);
const filingDateSchema = z.string().refine(isIsoDate, "Invalid filing date");
const cikValueSchema = z.union([
  z.number().int().positive().max(9_999_999_999),
  z
    .string()
    .regex(/^\d{1,10}$/)
    .refine((value) => BigInt(value) > 0n, "CIK must be positive"),
]);

const tickerMappingResponseSchema = z
  .object({
    fields: z.tuple([
      z.literal("cik"),
      z.literal("name"),
      z.literal("ticker"),
      z.literal("exchange"),
    ]),
    data: z.array(
      z.tuple([
        cikValueSchema,
        z.string().min(1),
        z.string().min(1),
        z.string().nullable(),
      ]),
    ),
  })
  .loose();

const recentFilingsSchema = z
  .object({
    accessionNumber: z.array(accessionNumberSchema),
    filingDate: z.array(filingDateSchema),
    reportDate: z.array(z.union([filingDateSchema, z.literal("")])),
    acceptanceDateTime: z.array(
      z.string().refine(isUtcInstant, "Invalid acceptance time"),
    ),
    form: z.array(z.string().min(1)),
    items: z.array(z.string()),
    primaryDocument: z.array(z.string()),
  })
  .loose()
  .superRefine((recent, context) => {
    const expectedLength = recent.accessionNumber.length;
    for (const [field, values] of Object.entries(recent)) {
      if (Array.isArray(values) && values.length !== expectedLength) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "SEC recent filing columns must have equal lengths",
        });
      }
    }
  });

const submissionsResponseSchema = z
  .object({
    cik: cikValueSchema,
    name: z.string().min(1),
    tickers: z.array(z.string()),
    exchanges: z.array(z.string()),
    filings: z
      .object({
        recent: recentFilingsSchema,
        files: z
          .array(
            z
              .object({
                name: z.string().min(1),
                filingCount: z.number().int().nonnegative(),
                filingFrom: filingDateSchema,
                filingTo: filingDateSchema,
              })
              .loose(),
          )
          .optional(),
      })
      .loose(),
  })
  .loose();

export interface SecTickerMapping {
  readonly provider: "SEC_EDGAR";
  readonly providerIssuerId: string;
  readonly issuerName: string;
  readonly ticker: string;
  readonly exchange: string | null;
}

export interface SecTickerMappingSnapshot {
  readonly items: readonly SecTickerMapping[];
  readonly obtainedAt: string;
  readonly sourceUrl: typeof SEC_TICKER_MAPPING_URL;
}

export interface SecRecentFiling {
  readonly provider: "SEC_EDGAR";
  readonly providerFilingId: string;
  readonly dedupeKey: string;
  readonly providerIssuerId: string;
  readonly issuerName: string;
  readonly formType: string;
  readonly isAmendment: boolean;
  readonly filingDate: string;
  readonly reportDate: string | null;
  readonly acceptedAt: string;
  readonly acceptedAtPrecision: "INSTANT";
  readonly itemNumbers: readonly string[];
  readonly primaryDocument: string | null;
  readonly filingIndexUrl: string;
  readonly sourceLanguage: "en";
}

export interface SecRecentFilingsSnapshot {
  readonly providerIssuerId: string;
  readonly issuerName: string;
  readonly tickers: readonly string[];
  readonly exchanges: readonly string[];
  readonly items: readonly SecRecentFiling[];
  readonly obtainedAt: string;
  readonly sourceUrl: string;
}

export interface SecRateLimiterOptions {
  readonly requestsPerSecond?: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export class SecRateLimiter {
  readonly #intervalMs: number;
  readonly #now: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  #nextAllowedAt = 0;
  #tail: Promise<void> = Promise.resolve();

  constructor(options: SecRateLimiterOptions = {}) {
    const requestsPerSecond =
      options.requestsPerSecond ?? DEFAULT_SEC_REQUESTS_PER_SECOND;
    if (
      !Number.isInteger(requestsPerSecond) ||
      requestsPerSecond < 1 ||
      requestsPerSecond > MAX_SEC_REQUESTS_PER_SECOND
    ) {
      throw new Error("SEC_RATE_LIMIT_MUST_BE_BETWEEN_1_AND_10");
    }
    this.#intervalMs = Math.ceil(1_000 / requestsPerSecond);
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? defaultSleep;
  }

  async schedule<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.#tail;
    let release: (() => void) | undefined;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      const waitMs = Math.max(0, this.#nextAllowedAt - this.#now());
      if (waitMs > 0) {
        await this.#sleep(waitMs);
      }
      const startedAt = this.#now();
      this.#nextAllowedAt =
        Math.max(this.#nextAllowedAt, startedAt) + this.#intervalMs;
      return await operation();
    } finally {
      release?.();
    }
  }
}

// SEC's fair-access ceiling is aggregate, not per endpoint. Production clients
// therefore share one process-wide limiter unless a test explicitly injects one.
const sharedSecRateLimiter = new SecRateLimiter();

export class SecProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number | undefined;
  readonly safeUrl: string;

  constructor(options: {
    code: string;
    retryable: boolean;
    safeUrl: string;
    status?: number;
  }) {
    super(`${options.code} ${options.safeUrl}`);
    this.name = "SecProviderError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.status = options.status;
    this.safeUrl = options.safeUrl;
  }
}

export interface SecClientOptions {
  readonly identity: SecRequestIdentity;
  readonly fetchImplementation?: typeof fetch;
  readonly limiter?: SecRateLimiter;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly random?: () => number;
}

export class SecEdgarClient {
  readonly #identity: SecRequestIdentity;
  readonly #fetch: typeof fetch;
  readonly #limiter: SecRateLimiter;
  readonly #timeoutMs: number;
  readonly #maxAttempts: number;
  readonly #now: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #random: () => number;

  constructor(options: SecClientOptions) {
    if (!options.identity.userAgent.trim()) {
      throw new Error("SEC_PROVIDER_UNCONFIGURED");
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error("SEC_TIMEOUT_MUST_BE_POSITIVE");
    }
    if (
      !Number.isInteger(maxAttempts) ||
      maxAttempts < 1 ||
      maxAttempts > 5
    ) {
      throw new Error("SEC_MAX_ATTEMPTS_MUST_BE_BETWEEN_1_AND_5");
    }
    this.#identity = options.identity;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#limiter = options.limiter ?? sharedSecRateLimiter;
    this.#timeoutMs = timeoutMs;
    this.#maxAttempts = maxAttempts;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#random = options.random ?? Math.random;
  }

  async listTickerMappings(): Promise<SecTickerMappingSnapshot> {
    const url = new URL(SEC_TICKER_MAPPING_URL);
    const payload = await this.#requestJson(url);
    const parsed = tickerMappingResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw providerError("SEC_TICKER_MAPPING_SCHEMA_MISMATCH", url, false);
    }
    return {
      items: parsed.data.data.map(([cik, issuerName, ticker, exchange]) => ({
        provider: "SEC_EDGAR",
        providerIssuerId: normalizeCik(cik),
        issuerName,
        ticker: ticker.toUpperCase(),
        exchange,
      })),
      obtainedAt: new Date(this.#now()).toISOString(),
      sourceUrl: SEC_TICKER_MAPPING_URL,
    };
  }

  async getRecentFilings(
    cik: string | number,
  ): Promise<SecRecentFilingsSnapshot> {
    const providerIssuerId = normalizeCik(cik);
    const url = new URL(
      `/submissions/CIK${providerIssuerId}.json`,
      SEC_SUBMISSIONS_ORIGIN,
    );
    const payload = await this.#requestJson(url);
    const parsed = submissionsResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw providerError("SEC_SUBMISSIONS_SCHEMA_MISMATCH", url, false);
    }
    const responseIssuerId = normalizeCik(parsed.data.cik);
    if (responseIssuerId !== providerIssuerId) {
      throw providerError("SEC_SUBMISSIONS_CIK_MISMATCH", url, false);
    }

    const recent = parsed.data.filings.recent;
    const filings = recent.accessionNumber.map((accessionNumber, index) => {
      const formType = requiredColumn(recent.form, index);
      const primaryDocumentValue = requiredColumn(
        recent.primaryDocument,
        index,
      );
      const acceptedAt = new Date(
        requiredColumn(recent.acceptanceDateTime, index),
      ).toISOString();
      return {
        provider: "SEC_EDGAR",
        providerFilingId: accessionNumber,
        dedupeKey: `SEC_EDGAR:${accessionNumber}`,
        providerIssuerId,
        issuerName: parsed.data.name,
        formType,
        isAmendment: formType.endsWith("/A"),
        filingDate: requiredColumn(recent.filingDate, index),
        reportDate: emptyToNull(requiredColumn(recent.reportDate, index)),
        acceptedAt,
        acceptedAtPrecision: "INSTANT",
        itemNumbers: splitItemNumbers(requiredColumn(recent.items, index)),
        primaryDocument: safePrimaryDocument(primaryDocumentValue),
        filingIndexUrl: filingIndexUrl(providerIssuerId, accessionNumber),
        sourceLanguage: "en",
      } satisfies SecRecentFiling;
    });
    assertUniqueAccessions(filings, url);

    return {
      providerIssuerId,
      issuerName: parsed.data.name,
      tickers: parsed.data.tickers.map((ticker) => ticker.toUpperCase()),
      exchanges: parsed.data.exchanges,
      items: filings,
      obtainedAt: new Date(this.#now()).toISOString(),
      sourceUrl: safeSecUrl(url),
    };
  }

  async #requestJson(url: URL): Promise<unknown> {
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.#limiter.schedule(() =>
          this.#fetch(url, {
            method: "GET",
            headers: {
              accept: "application/json",
              "accept-encoding": "gzip, deflate",
              "user-agent": this.#identity.userAgent,
            },
            signal: AbortSignal.timeout(this.#timeoutMs),
          }),
        );
      } catch {
        if (attempt < this.#maxAttempts) {
          await this.#sleep(this.#backoffDelay(attempt));
          continue;
        }
        throw providerError("SEC_NETWORK_ERROR", url, true);
      }

      if (isRetryableStatus(response.status)) {
        if (attempt < this.#maxAttempts) {
          await this.#sleep(this.#retryDelay(response, attempt));
          continue;
        }
        throw providerError(
          response.status === 429
            ? "SEC_RATE_LIMITED"
            : "SEC_TEMPORARILY_UNAVAILABLE",
          url,
          true,
          response.status,
        );
      }
      if (!response.ok) {
        throw providerError(
          "SEC_REQUEST_REJECTED",
          url,
          false,
          response.status,
        );
      }

      let text: string;
      try {
        text = await response.text();
      } catch {
        throw providerError("SEC_RESPONSE_READ_ERROR", url, true);
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw providerError("SEC_RESPONSE_JSON_INVALID", url, false);
      }
    }
    throw providerError("SEC_RETRY_EXHAUSTED", url, true);
  }

  #retryDelay(response: Response, attempt: number): number {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(MAX_RETRY_DELAY_MS, Math.ceil(seconds * 1_000));
      }
      const retryAt = Date.parse(retryAfter);
      if (Number.isFinite(retryAt)) {
        return Math.min(
          MAX_RETRY_DELAY_MS,
          Math.max(0, retryAt - this.#now()),
        );
      }
    }
    return this.#backoffDelay(attempt);
  }

  #backoffDelay(attempt: number): number {
    const base = Math.min(
      MAX_RETRY_DELAY_MS,
      500 * 2 ** Math.max(0, attempt - 1),
    );
    return Math.min(
      MAX_RETRY_DELAY_MS,
      Math.ceil(base + base * 0.25 * this.#random()),
    );
  }
}

export function findSecIssuerMappings(
  snapshot: SecTickerMappingSnapshot,
  ticker: string,
  exchange?: string,
): readonly SecTickerMapping[] {
  const normalizedTicker = ticker.trim().toUpperCase();
  const normalizedExchange = exchange?.trim().toUpperCase();
  return snapshot.items.filter(
    (item) =>
      item.ticker === normalizedTicker &&
      (normalizedExchange === undefined ||
        item.exchange?.toUpperCase() === normalizedExchange),
  );
}

function normalizeCik(value: string | number): string {
  const parsed = cikValueSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("SEC_INVALID_CIK");
  }
  return BigInt(parsed.data).toString().padStart(10, "0");
}

function filingIndexUrl(cik: string, accessionNumber: string): string {
  const cikWithoutPadding = String(BigInt(cik));
  const directory = accessionNumber.replaceAll("-", "");
  return `${SEC_ARCHIVES_ORIGIN}/Archives/edgar/data/${cikWithoutPadding}/${directory}/${accessionNumber}-index.html`;
}

function safePrimaryDocument(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : null;
}

function splitItemNumbers(value: string): readonly string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function emptyToNull(value: string): string | null {
  return value || null;
}

function requiredColumn<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error("SEC_SUBMISSIONS_COLUMN_MISMATCH");
  }
  return value;
}

function assertUniqueAccessions(
  filings: readonly SecRecentFiling[],
  url: URL,
): void {
  const ids = new Set(filings.map((filing) => filing.providerFilingId));
  if (ids.size !== filings.length) {
    throw providerError("SEC_DUPLICATE_ACCESSION", url, false);
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isUtcInstant(value: string): boolean {
  return (
    /Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isRetryableStatus(status: number): boolean {
  return status === 403 || status === 429 || status >= 500;
}

function safeSecUrl(url: URL): string {
  if (
    url.protocol !== "https:" ||
    !["data.sec.gov", "www.sec.gov"].includes(url.hostname)
  ) {
    return "SEC_OFFICIAL_ENDPOINT";
  }
  return `${url.origin}${url.pathname}`;
}

function providerError(
  code: string,
  url: URL,
  retryable: boolean,
  status?: number,
): SecProviderError {
  return new SecProviderError({
    code,
    retryable,
    safeUrl: safeSecUrl(url),
    ...(status === undefined ? {} : { status }),
  });
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
