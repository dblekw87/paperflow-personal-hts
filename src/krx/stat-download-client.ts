export const KRX_STAT_BASE_URL = "https://data.krx.co.kr";

export class KrxStatDownloadError extends Error {
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
    this.name = "KrxStatDownloadError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.status = options.status ?? null;
  }
}

function decodeBody(bytes: ArrayBuffer, contentType: string | null): string {
  const explicitCharset = /charset=([^;\s]+)/i.exec(contentType ?? "")?.[1];
  const charset = explicitCharset?.toLowerCase();
  if (charset !== undefined) {
    return new TextDecoder(charset).decode(bytes);
  }
  const view = new Uint8Array(bytes);
  if (view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function assertKrxStatPath(path: string): void {
  if (!/^\/comm\/fileDn\/[a-z0-9/_-]+\.cmd$/i.test(path)) {
    throw new TypeError("Invalid KRX stat download path");
  }
}

export class KrxStatDownloadClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: {
    readonly baseUrl?: string;
    readonly fetch?: typeof fetch;
    readonly timeoutMs?: number;
  } = {}) {
    this.#baseUrl = options.baseUrl ?? KRX_STAT_BASE_URL;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async generateOtp(params: URLSearchParams): Promise<string> {
    const response = await this.#postText(
      "/comm/fileDn/GenerateOTP/generate.cmd",
      params,
      "text/plain, */*; q=0.01",
    );
    const otp = response.trim();
    if (otp.length === 0 || /<html/i.test(otp)) {
      throw new KrxStatDownloadError({
        code: "KRX_STAT_INVALID_OTP",
        message: "KRX stat download did not return an OTP code",
        retryable: false,
      });
    }
    return otp;
  }

  async downloadCsv(otp: string): Promise<string> {
    if (otp.trim().length === 0) {
      throw new TypeError("KRX stat download OTP is required");
    }
    return this.#postText(
      "/comm/fileDn/download_csv/download.cmd",
      new URLSearchParams({ code: otp }),
      "text/csv, text/plain, */*; q=0.01",
    );
  }

  async downloadCsvByParams(params: URLSearchParams): Promise<string> {
    return this.downloadCsv(await this.generateOtp(params));
  }

  async #postText(
    path: string,
    params: URLSearchParams,
    accept: string,
  ): Promise<string> {
    assertKrxStatPath(path);
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method: "POST",
        headers: {
          Accept: accept,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Origin: this.#baseUrl,
          Referer: `${this.#baseUrl}/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201`,
        },
        body: params.toString(),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw new KrxStatDownloadError({
        code: "KRX_STAT_NETWORK_ERROR",
        message: "KRX stat download endpoint is unreachable",
        retryable: true,
        status: null,
      });
    }
    const text = decodeBody(
      await response.arrayBuffer(),
      response.headers.get("content-type"),
    );
    if (!response.ok) {
      throw new KrxStatDownloadError({
        code: "KRX_STAT_HTTP_ERROR",
        message: `KRX stat download HTTP ${response.status}`,
        retryable: response.status >= 500 || response.status === 429,
        status: response.status,
      });
    }
    return text;
  }
}
