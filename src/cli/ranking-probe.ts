import {
  assertLiveReadOnlyAcknowledgement,
  loadRuntimeConfig,
  requireKisCredentials,
} from "../config/runtime-config.js";
import { KisAuthClient } from "../kis/auth.js";
import { KisDomesticRankingClient } from "../kis/domestic-ranking.js";

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  assertLiveReadOnlyAcknowledgement(config);
  const credentials = requireKisCredentials(config);
  const auth = new KisAuthClient(config.KIS_DATA_ENV, credentials);
  const client = new KisDomesticRankingClient({
    environment: config.KIS_DATA_ENV,
    credentials,
    getAccessToken: () => auth.getAccessToken(),
  });
  const result = await client.getVolumeRanking("TURNOVER");
  const first = result.items[0];
  process.stdout.write(
    `${JSON.stringify({
      environment: config.KIS_DATA_ENV,
      source: result.source,
      fetchedAt: result.fetchedAt,
      count: result.items.length,
      first:
        first === undefined
          ? null
          : {
              rank: first.rank,
              symbol: first.symbol,
              name: first.name,
              price: first.price,
              changeRate: first.changeRate,
              cumulativeTurnover: first.cumulativeTurnover,
            },
    })}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "ranking probe failed"}\n`,
  );
  process.exitCode = 1;
});
