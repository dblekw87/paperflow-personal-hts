import { z } from "zod";

import type { KisCredentials } from "../config/runtime-config.js";
import { getKisEndpoints } from "./endpoints.js";
import { KIS_PATH } from "./endpoints.js";
import { KisApiError } from "./errors.js";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.union([z.number(), z.string()]).optional(),
  access_token_token_expired: z.string().optional(),
});

const approvalResponseSchema = z.object({
  approval_key: z.string().min(1),
});

type Environment = "paper" | "prod";

async function postJson<T>(
  url: string,
  body: Record<string, string>,
  schema: z.ZodType<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        accept: "text/plain",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new KisApiError({
      code: "KIS_NETWORK_ERROR",
      message: "KIS authentication endpoint is unreachable",
      retryable: true,
      cause: error,
    });
  }

  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new KisApiError({
      code: "KIS_AUTH_FAILED",
      message: `KIS authentication failed with HTTP ${response.status}`,
      retryable: response.status >= 500 || response.status === 429,
      status: response.status,
    });
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new KisApiError({
      code: "KIS_AUTH_SCHEMA_MISMATCH",
      message:
        "KIS authentication response did not match the expected contract",
      retryable: false,
    });
  }

  return result.data;
}

export class KisAuthClient {
  readonly #environment: Environment;
  readonly #credentials: KisCredentials;
  #accessTokenPromise: Promise<string> | undefined;
  #accessToken:
    | { readonly value: string; readonly refreshAfter: number }
    | undefined;
  #approvalKeyPromise: Promise<string> | undefined;

  constructor(environment: Environment, credentials: KisCredentials) {
    this.#environment = environment;
    this.#credentials = credentials;
  }

  getAccessToken(): Promise<string> {
    if (
      this.#accessToken !== undefined &&
      Date.now() < this.#accessToken.refreshAfter
    ) {
      return Promise.resolve(this.#accessToken.value);
    }
    this.#accessTokenPromise ??= this.#issueAccessToken().catch((error) => {
      this.#accessTokenPromise = undefined;
      throw error;
    });
    return this.#accessTokenPromise;
  }

  getApprovalKey(): Promise<string> {
    this.#approvalKeyPromise ??= this.#issueApprovalKey().catch((error) => {
      this.#approvalKeyPromise = undefined;
      throw error;
    });
    return this.#approvalKeyPromise;
  }

  async #issueAccessToken(): Promise<string> {
    const endpoint = getKisEndpoints(this.#environment);
    const response = await postJson(
      `${endpoint.restBaseUrl}${KIS_PATH.accessToken}`,
      {
        grant_type: "client_credentials",
        appkey: this.#credentials.appKey,
        appsecret: this.#credentials.appSecret,
      },
      tokenResponseSchema,
    );
    const lifetimeSeconds = Number(response.expires_in ?? 86_400);
    const safeLifetimeSeconds =
      Number.isFinite(lifetimeSeconds) && lifetimeSeconds > 120
        ? lifetimeSeconds - 60
        : 60;
    this.#accessToken = {
      value: response.access_token,
      refreshAfter: Date.now() + safeLifetimeSeconds * 1_000,
    };
    this.#accessTokenPromise = undefined;
    return response.access_token;
  }

  async #issueApprovalKey(): Promise<string> {
    const endpoint = getKisEndpoints(this.#environment);
    const response = await postJson(
      `${endpoint.restBaseUrl}${KIS_PATH.approvalKey}`,
      {
        grant_type: "client_credentials",
        appkey: this.#credentials.appKey,
        secretkey: this.#credentials.appSecret,
      },
      approvalResponseSchema,
    );
    return response.approval_key;
  }
}
