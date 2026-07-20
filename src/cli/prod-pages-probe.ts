import {
  assertLiveReadOnlyAcknowledgement,
  loadRuntimeConfig,
  requireKisCredentials,
} from "../config/runtime-config.js";
import { KisAuthClient } from "../kis/auth.js";
import { KisDomesticFluctuationClient } from "../kis/domestic-fluctuation.js";
import { KisProdNewsClient } from "../kis/news-headlines.js";

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  assertLiveReadOnlyAcknowledgement(config);
  const prodConfig = { ...config, KIS_DATA_ENV: "prod" as const };
  const credentials = requireKisCredentials(prodConfig);
  const auth = new KisAuthClient("prod", credentials);
  const getAccessToken = () => auth.getAccessToken();

  const fluctuationClient = new KisDomesticFluctuationClient({
    credentials,
    getAccessToken,
  });
  const newsClient = new KisProdNewsClient({
    credentials,
    getAccessToken,
  });

  const [fluctuation, domesticNews, overseasNews] = await Promise.all([
    fluctuationClient.getRanking(),
    newsClient.getDomesticHeadlines(),
    newsClient.getOverseasHeadlines({ nationCode: "US" }),
  ]);
  process.stdout.write(
    `${JSON.stringify({
      environment: "prod",
      actualOrderCapability: "FORBIDDEN",
      fluctuation: {
        count: fluctuation.items.length,
        continuation: fluctuation.continuation,
        first: fluctuation.items[0] ?? null,
      },
      domesticNews: {
        count: domesticNews.items.length,
        continuation: domesticNews.continuation,
        first: domesticNews.items[0] ?? null,
      },
      overseasNews: {
        count: overseasNews.items.length,
        continuation: overseasNews.continuation,
        first: overseasNews.items[0] ?? null,
      },
    })}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "prod page probe failed"}\n`,
  );
  process.exitCode = 1;
});
