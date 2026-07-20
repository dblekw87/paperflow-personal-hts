import type { KisCredentials } from "../config/runtime-config.js";
import { KisApiError } from "./errors.js";

export interface KisReadOnlyResponse {
  readonly payload: unknown;
  readonly trContinuation: string | null;
}

export async function getKisReadOnlyJson(options: {
  readonly url: URL;
  readonly trId: string;
  readonly credentials: KisCredentials;
  readonly getAccessToken: () => Promise<string>;
  readonly continuation?: string;
  readonly operation: string;
}): Promise<KisReadOnlyResponse> {
  const accessToken = await options.getAccessToken();
  let response: Response;
  try {
    response = await fetch(options.url, {
      method: "GET",
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${accessToken}`,
        appkey: options.credentials.appKey,
        appsecret: options.credentials.appSecret,
        tr_id: options.trId,
        custtype: "P",
        ...(options.continuation === undefined
          ? {}
          : { tr_cont: options.continuation }),
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new KisApiError({
      code: "KIS_NETWORK_ERROR",
      message: `KIS ${options.operation} endpoint is unreachable`,
      retryable: true,
      cause: error,
    });
  }

  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new KisApiError({
      code: response.status === 429 ? "KIS_RATE_LIMITED" : "KIS_REST_FAILED",
      message: `KIS ${options.operation} request failed with HTTP ${response.status}`,
      retryable: response.status >= 500 || response.status === 429,
      status: response.status,
    });
  }

  return {
    payload,
    trContinuation: response.headers.get("tr_cont"),
  };
}
