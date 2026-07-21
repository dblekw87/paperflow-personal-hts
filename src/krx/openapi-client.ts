import { z } from "zod";

import type { KrxOpenApiCredentials } from "../config/runtime-config.js";

export const KRX_OPENAPI_BASE_URL = "https://data-dbg.krx.co.kr/svc/apis";

const krxOpenApiPayloadSchema = z
  .object({
    OutBlock_1: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .loose();

export type KrxOpenApiPayload = z.infer<typeof krxOpenApiPayloadSchema>;

export class KrxOpenApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(options: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    readonly status?: number | null;
  }) {
    super(options.message);
    this.name = "KrxOpenApiError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.status = options.status ?? null;
  }
}

function assertPath(path: string): void {
  if (!/^\/[a-z0-9/_-]+$/i.test(path) || path.includes("..")) {
    throw new TypeError("Invalid KRX OpenAPI path");
  }
}

function redactAuthKey(value: string): string {
  return value.replace(/[A-Za-z0-9]{20,}/g, "[REDACTED]");
}

export class KrxOpenApiClient {
  readonly #credentials: KrxOpenApiCredentials;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: {
    readonly credentials: KrxOpenApiCredentials;
    readonly baseUrl?: string;
    readonly fetch?: typeof fetch;
    readonly timeoutMs?: number;
  }) {
    this.#credentials = options.credentials;
    this.#baseUrl = options.baseUrl ?? KRX_OPENAPI_BASE_URL;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async get(path: string, params: URLSearchParams): Promise<KrxOpenApiPayload> {
    assertPath(path);
    const url = new URL(`${this.#baseUrl}${path}`);
    url.search = params.toString();
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          AUTH_KEY: this.#credentials.authKey,
        },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw new KrxOpenApiError({
        code: "KRX_OPENAPI_NETWORK_ERROR",
        message: "KRX OpenAPI endpoint is unreachable",
        retryable: true,
        status: null,
      });
    }
    const body = await response.text();
    if (!response.ok) {
      throw new KrxOpenApiError({
        code: "KRX_OPENAPI_HTTP_ERROR",
        message: `KRX OpenAPI HTTP ${response.status}: ${redactAuthKey(body).slice(0, 240)}`,
        retryable: response.status >= 500 || response.status === 429,
        status: response.status,
      });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new KrxOpenApiError({
        code: "KRX_OPENAPI_INVALID_JSON",
        message: "KRX OpenAPI returned a non-JSON response",
        retryable: false,
        status: response.status,
      });
    }
    const parsed = krxOpenApiPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new KrxOpenApiError({
        code: "KRX_OPENAPI_SCHEMA_MISMATCH",
        message: "KRX OpenAPI response did not match the expected envelope",
        retryable: false,
        status: response.status,
      });
    }
    return parsed.data;
  }
}
