import { resolve } from "node:path";

import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

const runtimeSchema = z.object({
  KIS_DATA_ENV: z.enum(["paper", "prod"]).default("paper"),
  KIS_APP_KEY: z.string().trim().optional(),
  KIS_APP_SECRET: z.string().trim().optional(),
  KIS_PAPER_APP_KEY: z.string().trim().optional(),
  KIS_PAPER_APP_SECRET: z.string().trim().optional(),
  KIS_PROD_DATA_APP_KEY: z.string().trim().optional(),
  KIS_PROD_DATA_APP_SECRET: z.string().trim().optional(),
  KIS_HTS_ID: z.string().trim().optional(),
  KIS_DOMESTIC_SYMBOL: z
    .string()
    .regex(/^[0-9A-Z]{6,7}$/)
    .default("005930"),
  KIS_US_EXCHANGE: z.enum(["NAS", "NYS", "AMS"]).default("NAS"),
  KIS_US_SYMBOL: z
    .string()
    .regex(/^[A-Z0-9.-]{1,20}$/)
    .default("AAPL"),
  CME_DATA_MODE: z.enum(["proxy", "disabled"]).default("proxy"),
  KIS_NASDAQ_PROXY_EXCHANGE: z.enum(["NAS", "NYS", "AMS"]).default("NAS"),
  KIS_NASDAQ_PROXY_SYMBOL: z
    .string()
    .regex(/^[A-Z0-9.-]{1,20}$/)
    .default("QQQ"),
  KIS_RUSSELL_PROXY_EXCHANGE: z.enum(["NAS", "NYS", "AMS"]).default("AMS"),
  KIS_RUSSELL_PROXY_SYMBOL: z
    .string()
    .regex(/^[A-Z0-9.-]{1,20}$/)
    .default("IWM"),
  KIS_OIL_PROXY_EXCHANGE: z.enum(["NAS", "NYS", "AMS"]).default("AMS"),
  KIS_OIL_PROXY_SYMBOL: z
    .string()
    .regex(/^[A-Z0-9.-]{1,20}$/)
    .default("USO"),
  KIS_HEALTH_LIVE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  KIS_PROBE_SECONDS: z.coerce.number().int().min(3).max(120).default(15),
  KIS_LIVE_ACK: z.string().optional(),
  DART_CRTFC_KEY: z.string().trim().optional(),
  DATA_GO_KR_SERVICE_KEY: z.string().trim().optional(),
  KRX_OPENAPI_KEY: z.string().trim().optional(),
  SEC_USER_AGENT: z.string().trim().optional(),
  FINNHUB_API_KEY: z.string().trim().optional(),
  PAPER_FILL_PROFILE: z
    .enum(["INITIAL_CONSERVATIVE_V1", "ADVANCED_QUEUE_V1"])
    .default("INITIAL_CONSERVATIVE_V1"),
  PAPER_QUEUE_SAFETY_FACTOR: z
    .string()
    .regex(/^(?:[1-9]\d*)(?:\.\d+)?$/)
    .default("1.25"),
});

export type RuntimeConfig = z.infer<typeof runtimeSchema>;

export interface KisCredentials {
  appKey: string;
  appSecret: string;
}

export interface OpenDartCredentials {
  crtfcKey: string;
}

export interface PublicDataPortalCredentials {
  serviceKey: string;
}

export interface KrxOpenApiCredentials {
  authKey: string;
}

export interface SecRequestIdentity {
  userAgent: string;
}

export function requireFinnhubApiKey(config: RuntimeConfig): string {
  const key = config.FINNHUB_API_KEY?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
    throw new Error("FINNHUB_PROVIDER_UNCONFIGURED");
  }
  return key;
}

let loaded = false;

export function loadRuntimeConfig(): RuntimeConfig {
  if (!loaded) {
    loadDotEnv({ path: resolve(process.cwd(), ".env.local"), quiet: true });
    loaded = true;
  }

  return runtimeSchema.parse(process.env);
}

export function requireKisCredentials(config: RuntimeConfig): KisCredentials {
  return requireKisCredentialsForEnvironment(config, config.KIS_DATA_ENV);
}

export function requireKisCredentialsForEnvironment(
  config: RuntimeConfig,
  environment: RuntimeConfig["KIS_DATA_ENV"],
): KisCredentials {
  const credentialsSchema = z.object({
    appKey: z.string().min(10, "KIS_APP_KEY is missing or too short"),
    appSecret: z.string().min(10, "KIS_APP_SECRET is missing or too short"),
  });

  return credentialsSchema.parse({
    appKey:
      environment === "paper"
        ? config.KIS_PAPER_APP_KEY ?? config.KIS_APP_KEY
        : config.KIS_PROD_DATA_APP_KEY ?? config.KIS_APP_KEY,
    appSecret:
      environment === "paper"
        ? config.KIS_PAPER_APP_SECRET ?? config.KIS_APP_SECRET
        : config.KIS_PROD_DATA_APP_SECRET ?? config.KIS_APP_SECRET,
  });
}

export function hasKisCredentials(config: RuntimeConfig): boolean {
  const appKey =
    config.KIS_DATA_ENV === "paper"
      ? config.KIS_PAPER_APP_KEY ?? config.KIS_APP_KEY
      : config.KIS_PROD_DATA_APP_KEY ?? config.KIS_APP_KEY;
  const appSecret =
    config.KIS_DATA_ENV === "paper"
      ? config.KIS_PAPER_APP_SECRET ?? config.KIS_APP_SECRET
      : config.KIS_PROD_DATA_APP_SECRET ?? config.KIS_APP_SECRET;
  return Boolean(
    appKey &&
    appKey.length >= 10 &&
    appSecret &&
    appSecret.length >= 10,
  );
}

function hasCredentialPair(
  appKey: string | undefined,
  appSecret: string | undefined,
): boolean {
  return Boolean(
    appKey &&
      appKey.length >= 10 &&
      appSecret &&
      appSecret.length >= 10,
  );
}

export function hasOpenDartCredentials(config: RuntimeConfig): boolean {
  return Boolean(
    config.DART_CRTFC_KEY &&
      /^[A-Za-z0-9]{40}$/.test(config.DART_CRTFC_KEY),
  );
}

export function hasPublicDataPortalCredentials(config: RuntimeConfig): boolean {
  const key = config.DATA_GO_KR_SERVICE_KEY?.trim() ?? "";
  return key.length >= 20 && !/^(?:your-|change-me|sample)/i.test(key);
}

export function hasKrxOpenApiCredentials(config: RuntimeConfig): boolean {
  const key = config.KRX_OPENAPI_KEY?.trim() ?? "";
  return key.length >= 20 && !/^(?:your-|change-me|sample)/i.test(key);
}

export function hasSecRequestIdentity(config: RuntimeConfig): boolean {
  const value = config.SEC_USER_AGENT?.trim() ?? "";
  const email = value.match(
    /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i,
  );
  return Boolean(
    /^[A-Za-z][A-Za-z0-9_-]*\/\d+(?:\.\d+){1,3}\s+/.test(value) &&
      email &&
      !/^(?:example\.(?:com|org|net)|invalid)$/i.test(email[1] ?? "") &&
      !/(?:your-email|placeholder|change-me)/i.test(value),
  );
}

export function requireOpenDartCredentials(
  config: RuntimeConfig,
): OpenDartCredentials {
  if (!hasOpenDartCredentials(config)) {
    throw new Error("DART_PROVIDER_UNCONFIGURED");
  }
  return { crtfcKey: config.DART_CRTFC_KEY! };
}

export function requirePublicDataPortalCredentials(
  config: RuntimeConfig,
): PublicDataPortalCredentials {
  if (!hasPublicDataPortalCredentials(config)) {
    throw new Error("PUBLIC_DATA_PORTAL_PROVIDER_UNCONFIGURED");
  }
  return { serviceKey: config.DATA_GO_KR_SERVICE_KEY! };
}

export function requireKrxOpenApiCredentials(
  config: RuntimeConfig,
): KrxOpenApiCredentials {
  if (!hasKrxOpenApiCredentials(config)) {
    throw new Error("KRX_OPENAPI_PROVIDER_UNCONFIGURED");
  }
  return { authKey: config.KRX_OPENAPI_KEY! };
}

export function requireSecRequestIdentity(
  config: RuntimeConfig,
): SecRequestIdentity {
  if (!hasSecRequestIdentity(config)) {
    throw new Error("SEC_PROVIDER_UNCONFIGURED");
  }
  return { userAgent: config.SEC_USER_AGENT! };
}

export function redactDisclosureSecrets(value: string): string {
  return value
    .replace(
      /([?&]crtfc_key=)[^&#\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /(["']crtfc_key["']\s*:\s*["'])[^"']+(["'])/gi,
      "$1[REDACTED]$2",
    );
}

export function publicConfig(config: RuntimeConfig) {
  return {
    dataEnvironment: config.KIS_DATA_ENV,
    hasCredentials: hasKisCredentials(config),
    hasPaperCredentials: hasCredentialPair(
      config.KIS_PAPER_APP_KEY ?? config.KIS_APP_KEY,
      config.KIS_PAPER_APP_SECRET ?? config.KIS_APP_SECRET,
    ),
    hasProdDataCredentials: hasCredentialPair(
      config.KIS_PROD_DATA_APP_KEY,
      config.KIS_PROD_DATA_APP_SECRET,
    ),
    hasHtsId: Boolean(config.KIS_HTS_ID),
    domesticSymbol: config.KIS_DOMESTIC_SYMBOL,
    usExchange: config.KIS_US_EXCHANGE,
    usSymbol: config.KIS_US_SYMBOL,
    cmeDataMode: config.CME_DATA_MODE,
    nasdaqProxy: `${config.KIS_NASDAQ_PROXY_EXCHANGE}:${config.KIS_NASDAQ_PROXY_SYMBOL}`,
    russellProxy: `${config.KIS_RUSSELL_PROXY_EXCHANGE}:${config.KIS_RUSSELL_PROXY_SYMBOL}`,
    oilProxy: `${config.KIS_OIL_PROXY_EXCHANGE}:${config.KIS_OIL_PROXY_SYMBOL}`,
    probeSeconds: config.KIS_PROBE_SECONDS,
    paperFillProfile: config.PAPER_FILL_PROFILE,
    paperQueueSafetyFactor: config.PAPER_QUEUE_SAFETY_FACTOR,
    hasOpenDartKey: hasOpenDartCredentials(config),
    hasPublicDataPortalKey: hasPublicDataPortalCredentials(config),
    hasKrxOpenApiKey: hasKrxOpenApiCredentials(config),
    hasSecUserAgent: hasSecRequestIdentity(config),
    hasFinnhubApiKey: Boolean(config.FINNHUB_API_KEY?.trim()),
  };
}

export function assertLiveReadOnlyAcknowledgement(config: RuntimeConfig): void {
  if (config.KIS_LIVE_ACK !== "READ_ONLY_MARKET_DATA") {
    throw new Error(
      "Set KIS_LIVE_ACK=READ_ONLY_MARKET_DATA in .env.local before a live probe",
    );
  }
}
