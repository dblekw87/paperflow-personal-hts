import {
  assertLiveReadOnlyAcknowledgement,
  loadRuntimeConfig,
  requireKisCredentials,
} from "../config/runtime-config.js";
import { KisAuthClient } from "../kis/auth.js";
import {
  KIS_DOMESTIC_INDEX_SELECTIONS,
  KIS_US_MARKET_PROXY_SELECTIONS,
  KisMarketContextClient,
} from "../kis/market-context.js";

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  assertLiveReadOnlyAcknowledgement(config);
  const prodConfig = { ...config, KIS_DATA_ENV: "prod" as const };
  const credentials = requireKisCredentials(prodConfig);
  const auth = new KisAuthClient("prod", credentials);
  const client = new KisMarketContextClient({
    environment: "prod",
    credentials,
    getAccessToken: () => auth.getAccessToken(),
  });
  const checks: Array<{
    readonly instrumentId: string;
    readonly run: () => Promise<unknown>;
  }> = [
    ...KIS_DOMESTIC_INDEX_SELECTIONS.map((selection) => ({
      instrumentId: selection.instrumentId,
      run: () => client.getDomesticIndex(selection),
    })),
    ...KIS_US_MARKET_PROXY_SELECTIONS.map((selection) => ({
      instrumentId: selection.instrumentId,
      run: () => client.getUsMarketProxy(selection),
    })),
  ];
  const results: unknown[] = [];
  for (let index = 0; index < checks.length; index += 1) {
    if (index > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
    }
    const check = checks[index]!;
    try {
      results.push({
        instrumentId: check.instrumentId,
        state: "READY",
        snapshot: await check.run(),
      });
    } catch (error) {
      results.push({
        instrumentId: check.instrumentId,
        state: "ERROR",
        code:
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "string"
            ? error.code
            : "MARKET_CONTEXT_PROBE_FAILED",
      });
    }
  }
  process.stdout.write(
    `${JSON.stringify({
      environment: "prod",
      actualOrderCapability: "FORBIDDEN",
      transport: "REST_POLLING",
      results,
    })}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "market-context probe failed"}\n`,
  );
  process.exitCode = 1;
});
