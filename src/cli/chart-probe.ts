import {
  assertLiveReadOnlyAcknowledgement,
  loadRuntimeConfig,
  requireKisCredentials,
} from "../config/runtime-config.js";
import { KisAuthClient } from "../kis/auth.js";
import { KisDomesticChartClient } from "../kis/domestic-chart.js";

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  assertLiveReadOnlyAcknowledgement(config);
  const prodConfig = { ...config, KIS_DATA_ENV: "prod" as const };
  const credentials = requireKisCredentials(prodConfig);
  const auth = new KisAuthClient("prod", credentials);
  let lastRequestAt = 0;
  const chart = new KisDomesticChartClient({
    environment: "prod",
    credentials,
    getAccessToken: () => auth.getAccessToken(),
    beforeRequest: async () => {
      const waitMs = 1_000 - (Date.now() - lastRequestAt);
      if (waitMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      }
      lastRequestAt = Date.now();
    },
  });
  const history = await chart.getDomesticMinuteCandles({
    symbol: config.KIS_DOMESTIC_SYMBOL,
    beforeOrAt: "153000",
    maxPages: 24,
  });
  const prices = history.candles.flatMap((candle) => [
    BigInt(candle.low),
    BigInt(candle.high),
  ]);
  const minimum = prices.reduce<bigint | null>(
    (selected, value) =>
      selected === null || value < selected ? value : selected,
    null,
  );
  const maximum = prices.reduce<bigint | null>(
    (selected, value) =>
      selected === null || value > selected ? value : selected,
    null,
  );

  process.stdout.write(
    `${JSON.stringify({
      environment: "prod",
      actualOrderCapability: "FORBIDDEN",
      instrumentId: history.instrumentId,
      interval: history.interval,
      candleCount: history.candles.length,
      first: history.candles[0] ?? null,
      last: history.candles.at(-1) ?? null,
      priceRange:
        minimum === null || maximum === null
          ? null
          : { minimum: minimum.toString(), maximum: maximum.toString() },
      pagination: history.pagination,
      quality: history.quality,
    })}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "chart probe failed"}\n`,
  );
  process.exitCode = 1;
});
