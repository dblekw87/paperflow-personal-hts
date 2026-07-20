import type { HealthCheck, HealthReport } from "../contracts/health.js";
import { HealthReportSchema } from "../contracts/health.js";
import type { RuntimeConfig } from "../config/runtime-config.js";
import {
  publicConfig,
  requireKisCredentials,
} from "../config/runtime-config.js";
import { KisAuthClient } from "../kis/auth.js";
import { inspectReadOnlyKisRegistry, KIS_TR } from "../kis/endpoints.js";
import { redactError } from "../kis/errors.js";
import { KisRestClient } from "../kis/rest-client.js";
import { parseKisWsFrame } from "../kis/ws/frame.js";
import {
  normalizeDomesticOrderBook,
  normalizeDomesticTrade,
  normalizeUsOrderBook,
  normalizeUsTrade,
} from "../kis/ws/normalize.js";
import { domesticProbeSubscriptions, runWsProbe } from "../kis/ws/client.js";
import { PINNED_PROTOCOL_VECTORS } from "../testkit/pinned-protocol-vectors.js";
import { openPaperTradingDatabase } from "../storage/database.js";
import { inspectDatabaseHealth } from "../storage/health.js";
import { inspectReadOnlyHyperliquidRegistry } from "../hyperliquid/endpoints.js";

const REFERENCE_COMMIT = "885dd4e2f5c37e4f7e23dd63c15555a9967bc7bc" as const;

function check(
  name: string,
  status: HealthCheck["status"],
  code: string,
  message: string,
  options?: { retryable?: boolean; latencyMs?: number; evidenceIds?: string[] },
): HealthCheck {
  return {
    name,
    status,
    code,
    message,
    retryable: options?.retryable ?? false,
    ...(options?.latencyMs === undefined
      ? {}
      : { latencyMs: options.latencyMs }),
    asOf: new Date().toISOString(),
    evidenceIds: options?.evidenceIds ?? [],
  };
}

function fixtureChecks(): HealthCheck[] {
  try {
    const domesticTrade = parseKisWsFrame(
      PINNED_PROTOCOL_VECTORS.domesticTrade.raw,
    );
    const domesticBook = parseKisWsFrame(
      PINNED_PROTOCOL_VECTORS.domesticOrderBook.raw,
    );
    const usTrade = parseKisWsFrame(PINNED_PROTOCOL_VECTORS.usTrade.raw);
    const usBook = parseKisWsFrame(PINNED_PROTOCOL_VECTORS.usOrderBook.raw);

    if (
      domesticTrade.kind !== "DATA" ||
      domesticBook.kind !== "DATA" ||
      usTrade.kind !== "DATA" ||
      usBook.kind !== "DATA"
    ) {
      throw new Error(
        "Pinned protocol vector unexpectedly parsed as a control frame",
      );
    }

    normalizeDomesticTrade(domesticTrade);
    normalizeDomesticOrderBook(domesticBook, "20260720");
    normalizeUsTrade(usTrade, "NASDAQ");
    normalizeUsOrderBook(usBook, "NASDAQ");

    return [
      check(
        "fixture-contracts",
        "PASS",
        "FIXTURE_CONTRACTS_VALID",
        "All four pinned read-only WebSocket protocol vectors parsed and normalized",
        {
          evidenceIds: [
            KIS_TR.domesticOrderBook,
            KIS_TR.domesticTrade,
            KIS_TR.usOrderBook,
            KIS_TR.usTrade,
          ],
        },
      ),
    ];
  } catch (error) {
    return [
      check(
        "fixture-contracts",
        "FAIL",
        "FIXTURE_CONTRACTS_INVALID",
        redactError(error),
      ),
    ];
  }
}

function databaseCheck(): HealthCheck {
  try {
    const opened = openPaperTradingDatabase({ filename: ":memory:" });
    try {
      const health = inspectDatabaseHealth(opened.database);
      return check(
        "database",
        health.healthy ? "PASS" : "FAIL",
        health.code,
        health.message,
        { evidenceIds: [`schema-version:${health.schemaVersion}`] },
      );
    } finally {
      opened.database.close();
    }
  } catch (error) {
    return check("database", "FAIL", "SQLITE_UNHEALTHY", redactError(error));
  }
}

export async function runHealth(
  config: RuntimeConfig,
  mode: "FIXTURE" | "LIVE",
): Promise<HealthReport> {
  const registryInspection = inspectReadOnlyKisRegistry();
  const hyperliquidRegistryInspection = inspectReadOnlyHyperliquidRegistry();
  const checks: HealthCheck[] = [
    ...fixtureChecks(),
    check(
      "forbidden-order-endpoints",
      registryInspection.valid ? "PASS" : "FAIL",
      registryInspection.valid
        ? "READ_ONLY_REGISTRY"
        : "FORBIDDEN_KIS_REGISTRY_ENTRY",
      registryInspection.valid
        ? "The Phase 0 endpoint registry matches the exact auth and market-data allowlist"
        : `KIS registry contains forbidden entries: ${registryInspection.violations.join(", ")}`,
    ),
    check(
      "hyperliquid-read-only-market-data",
      hyperliquidRegistryInspection.valid ? "PASS" : "FAIL",
      hyperliquidRegistryInspection.valid
        ? "HYPERLIQUID_READ_ONLY_REGISTRY"
        : "FORBIDDEN_HYPERLIQUID_REGISTRY_ENTRY",
      hyperliquidRegistryInspection.valid
        ? "Hyperliquid registry contains only public info and market-data subscriptions"
        : `Hyperliquid registry violations: ${hyperliquidRegistryInspection.violations.join(", ")}`,
    ),
    databaseCheck(),
  ];

  if (mode === "FIXTURE") {
    checks.push(
      check(
        "credentials",
        publicConfig(config).hasCredentials ? "PASS" : "WARN",
        publicConfig(config).hasCredentials
          ? "CREDENTIALS_CONFIGURED"
          : "CREDENTIALS_NOT_CONFIGURED",
        publicConfig(config).hasCredentials
          ? "KIS credentials are configured but were not used"
          : "Fixture mode does not require KIS credentials",
      ),
      check(
        "network",
        "NOT_APPLICABLE",
        "NETWORK_DISABLED_FIXTURE_MODE",
        "Fixture health performs no external network requests",
      ),
    );
  } else {
    const startedAt = Date.now();
    try {
      const credentials = requireKisCredentials(config);
      const auth = new KisAuthClient(config.KIS_DATA_ENV, credentials);
      const accessToken = await auth.getAccessToken();
      checks.push(
        check(
          "auth-rest",
          "PASS",
          "ACCESS_TOKEN_ISSUED",
          "REST access token issued",
          {
            latencyMs: Date.now() - startedAt,
          },
        ),
      );

      const rest = new KisRestClient({
        environment: config.KIS_DATA_ENV,
        credentials,
        getAccessToken: async () => accessToken,
      });
      const quoteStartedAt = Date.now();
      const quote = await rest.getDomesticCurrentPrice(
        config.KIS_DOMESTIC_SYMBOL,
      );
      checks.push(
        check(
          "domestic-current-price",
          "PASS",
          "DOMESTIC_QUOTE_RECEIVED",
          `Received ${quote.instrumentId} quote at ${quote.receivedAt}`,
          {
            latencyMs: Date.now() - quoteStartedAt,
            evidenceIds: [quote.instrumentId],
          },
        ),
      );

      const wsStartedAt = Date.now();
      const approvalKey = await auth.getApprovalKey();
      const subscriptions = domesticProbeSubscriptions(
        config.KIS_DOMESTIC_SYMBOL,
      );
      const ws = await runWsProbe({
        environment: config.KIS_DATA_ENV,
        approvalKey,
        subscriptions,
        durationSeconds: config.KIS_PROBE_SECONDS,
      });
      const wsFailed =
        !ws.connected ||
        !ws.completedNormally ||
        ws.parseErrors.length > 0 ||
        ws.failedSubscriptions.length > 0 ||
        ws.acknowledgedSubscriptions.length !== subscriptions.length;
      checks.push(
        check(
          "domestic-websocket",
          wsFailed ? "FAIL" : ws.receivedRecords > 0 ? "PASS" : "WARN",
          wsFailed
            ? "WS_PROBE_FAILED"
            : ws.receivedRecords > 0
              ? "WS_MARKET_DATA_RECEIVED"
              : "WS_NO_MARKET_DATA",
          `Connected=${ws.connected}, acknowledged=${ws.acknowledgedSubscriptions.length}/${subscriptions.length}, records=${ws.receivedRecords}, parseErrors=${ws.parseErrors.length}`,
          {
            latencyMs: Date.now() - wsStartedAt,
            retryable: wsFailed || ws.receivedRecords === 0,
            evidenceIds: Object.keys(ws.receivedByTrId),
          },
        ),
      );
    } catch (error) {
      checks.push(
        check("live-kis", "FAIL", "LIVE_KIS_CHECK_FAILED", redactError(error), {
          latencyMs: Date.now() - startedAt,
          retryable: true,
        }),
      );
    }
  }

  const overall: HealthReport["overall"] = checks.some(
    (item) => item.status === "FAIL",
  )
    ? "FAIL"
    : checks.some((item) => item.status === "WARN")
      ? "WARN"
      : "PASS";

  return HealthReportSchema.parse({
    schemaVersion: 1,
    overall,
    generatedAt: new Date().toISOString(),
    mode,
    referenceCommit: REFERENCE_COMMIT,
    publicConfig: publicConfig(config),
    checks,
  });
}
