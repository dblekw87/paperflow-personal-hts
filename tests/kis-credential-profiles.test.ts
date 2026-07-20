import { describe, expect, it } from "vitest";

import {
  hasKisCredentials,
  publicConfig,
  requireKisCredentials,
  requireKisCredentialsForEnvironment,
  type RuntimeConfig,
} from "../src/config/runtime-config.js";

function withValues(
  environment: "paper" | "prod",
  values: Partial<RuntimeConfig>,
): RuntimeConfig {
  return {
    KIS_DATA_ENV: environment,
    KIS_DOMESTIC_SYMBOL: "005930",
    KIS_US_EXCHANGE: "NAS",
    KIS_US_SYMBOL: "AAPL",
    CME_DATA_MODE: "proxy",
    KIS_NASDAQ_PROXY_EXCHANGE: "NAS",
    KIS_NASDAQ_PROXY_SYMBOL: "QQQ",
    KIS_RUSSELL_PROXY_EXCHANGE: "AMS",
    KIS_RUSSELL_PROXY_SYMBOL: "IWM",
    KIS_OIL_PROXY_EXCHANGE: "AMS",
    KIS_OIL_PROXY_SYMBOL: "USO",
    KIS_HEALTH_LIVE: false,
    KIS_PROBE_SECONDS: 15,
    PAPER_FILL_PROFILE: "INITIAL_CONSERVATIVE_V1",
    PAPER_QUEUE_SAFETY_FACTOR: "1.25",
    ...values,
  };
}

describe("KIS credential profiles", () => {
  it("selects the paper pair in paper mode", () => {
    const config = withValues("paper", {
      KIS_PAPER_APP_KEY: "paper-app-key",
      KIS_PAPER_APP_SECRET: "paper-app-secret",
      KIS_PROD_DATA_APP_KEY: "production-app-key",
      KIS_PROD_DATA_APP_SECRET: "production-app-secret",
    });
    expect(requireKisCredentials(config)).toEqual({
      appKey: "paper-app-key",
      appSecret: "paper-app-secret",
    });
  });

  it("selects only the production data pair in prod mode", () => {
    const config = withValues("prod", {
      KIS_PAPER_APP_KEY: "paper-app-key",
      KIS_PAPER_APP_SECRET: "paper-app-secret",
      KIS_PROD_DATA_APP_KEY: "production-app-key",
      KIS_PROD_DATA_APP_SECRET: "production-app-secret",
    });
    expect(requireKisCredentials(config)).toEqual({
      appKey: "production-app-key",
      appSecret: "production-app-secret",
    });
  });

  it("can resolve production data while the active market profile remains paper", () => {
    const config = withValues("paper", {
      KIS_PAPER_APP_KEY: "paper-app-key",
      KIS_PAPER_APP_SECRET: "paper-app-secret",
      KIS_PROD_DATA_APP_KEY: "production-app-key",
      KIS_PROD_DATA_APP_SECRET: "production-app-secret",
    });
    expect(requireKisCredentialsForEnvironment(config, "prod")).toEqual({
      appKey: "production-app-key",
      appSecret: "production-app-secret",
    });
  });

  it("keeps the legacy pair as a backward-compatible active fallback", () => {
    const config = withValues("paper", {
      KIS_APP_KEY: "legacy-app-key",
      KIS_APP_SECRET: "legacy-app-secret",
    });
    expect(hasKisCredentials(config)).toBe(true);
    expect(requireKisCredentials(config)).toEqual({
      appKey: "legacy-app-key",
      appSecret: "legacy-app-secret",
    });
  });

  it("reports profile readiness without exposing values", () => {
    const config = withValues("paper", {
      KIS_PAPER_APP_KEY: "paper-app-key",
      KIS_PAPER_APP_SECRET: "paper-app-secret",
      KIS_PROD_DATA_APP_KEY: "production-app-key",
      KIS_PROD_DATA_APP_SECRET: "production-app-secret",
    });
    const visible = publicConfig(config);
    expect(visible.hasPaperCredentials).toBe(true);
    expect(visible.hasProdDataCredentials).toBe(true);
    expect(JSON.stringify(visible)).not.toContain("production-app-key");
  });
});
