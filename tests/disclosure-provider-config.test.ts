import { describe, expect, it } from "vitest";

import {
  hasOpenDartCredentials,
  hasSecRequestIdentity,
  loadRuntimeConfig,
  redactDisclosureSecrets,
  requireOpenDartCredentials,
  requireSecRequestIdentity,
  type RuntimeConfig,
} from "../src/config/runtime-config.js";

function configWith(
  values: Partial<RuntimeConfig>,
): RuntimeConfig {
  return { ...loadRuntimeConfig(), ...values };
}

describe("disclosure provider configuration", () => {
  it("rejects malformed DART keys before any provider request", () => {
    const config = configWith({ DART_CRTFC_KEY: "short" });
    expect(hasOpenDartCredentials(config)).toBe(false);
    expect(() => requireOpenDartCredentials(config)).toThrow(
      "DART_PROVIDER_UNCONFIGURED",
    );
  });

  it("accepts only a 40-character DART provider key", () => {
    const config = configWith({ DART_CRTFC_KEY: "a".repeat(40) });
    expect(requireOpenDartCredentials(config)).toEqual({
      crtfcKey: "a".repeat(40),
    });
  });

  it("rejects placeholder SEC identities", () => {
    for (const value of [
      "PaperFlow/0.0.1 your-email@example.com",
      "PaperTradingHTS/0.0.1 contact@example.com",
      "PaperTradingHTS admin@example.com",
      "plain-email@company.co.kr",
    ]) {
      const config = configWith({ SEC_USER_AGENT: value });
      expect(hasSecRequestIdentity(config)).toBe(false);
      expect(() => requireSecRequestIdentity(config)).toThrow(
        "SEC_PROVIDER_UNCONFIGURED",
      );
    }
  });

  it("accepts an app/version token and reachable contact address", () => {
    const value = "PaperTradingHTS/0.0.1 ops@papertrading.co.kr";
    const config = configWith({ SEC_USER_AGENT: value });
    expect(requireSecRequestIdentity(config)).toEqual({ userAgent: value });
  });

  it("redacts DART query and structured error values", () => {
    const secret = "a".repeat(40);
    const redacted = redactDisclosureSecrets(
      `https://opendart.fss.or.kr/api/list.json?crtfc_key=${secret}&bgn_de=20260720 {"crtfc_key":"${secret}"}`,
    );
    expect(redacted).not.toContain(secret);
    expect(redacted).toContain("crtfc_key=[REDACTED]");
    expect(redacted).toContain('"crtfc_key":"[REDACTED]"');
  });
});
