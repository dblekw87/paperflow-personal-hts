import {
  assertLiveReadOnlyAcknowledgement,
  loadRuntimeConfig,
  requireKisCredentialsForEnvironment,
} from "../config/runtime-config.js";
import { KisAuthClient } from "../kis/auth.js";
import {
  domesticProbeSubscriptions,
  nxtDomesticProbeSubscriptions,
  runWsProbe,
  usProbeSubscriptions,
} from "../kis/ws/client.js";
import {
  describeFreeMarketContextProxy,
  freeMarketContextProxyProbeSubscriptions,
} from "../kis/proxy-market-data.js";

const config = loadRuntimeConfig();
assertLiveReadOnlyAcknowledgement(config);
function requestedMarket(): "kr" | "nxt" | "us" | "proxy" {
  const index = process.argv.indexOf("--market");
  const value = index >= 0 ? process.argv[index + 1] : "kr";
  if (
    value !== "kr" &&
    value !== "nxt" &&
    value !== "us" &&
    value !== "proxy"
  ) {
    throw new Error("Use --market kr, --market nxt, --market us, or --market proxy");
  }
  return value;
}

const market = requestedMarket();
const environment = market === "us" ? "prod" : config.KIS_DATA_ENV;
const credentials = requireKisCredentialsForEnvironment(config, environment);
const auth = new KisAuthClient(environment, credentials);
const approvalKey = await auth.getApprovalKey();

const subscriptions =
  market === "us"
    ? usProbeSubscriptions(config.KIS_US_EXCHANGE, config.KIS_US_SYMBOL)
    : market === "proxy"
      ? freeMarketContextProxyProbeSubscriptions({
          nasdaq: {
            exchange: config.KIS_NASDAQ_PROXY_EXCHANGE,
            symbol: config.KIS_NASDAQ_PROXY_SYMBOL,
          },
          russell: {
            exchange: config.KIS_RUSSELL_PROXY_EXCHANGE,
            symbol: config.KIS_RUSSELL_PROXY_SYMBOL,
          },
          oil: {
            exchange: config.KIS_OIL_PROXY_EXCHANGE,
            symbol: config.KIS_OIL_PROXY_SYMBOL,
          },
        })
      : market === "nxt"
        ? nxtDomesticProbeSubscriptions(config.KIS_DOMESTIC_SYMBOL)
        : domesticProbeSubscriptions(config.KIS_DOMESTIC_SYMBOL);

const result = await runWsProbe({
  environment,
  approvalKey,
  subscriptions,
  durationSeconds: config.KIS_PROBE_SECONDS,
});

console.log(
  JSON.stringify(
    {
      market,
      environment,
      symbol:
        market === "us"
          ? `${config.KIS_US_EXCHANGE}:${config.KIS_US_SYMBOL}`
          : market === "proxy"
            ? [
                describeFreeMarketContextProxy("nasdaq", {
                  exchange: config.KIS_NASDAQ_PROXY_EXCHANGE,
                  symbol: config.KIS_NASDAQ_PROXY_SYMBOL,
                }),
                describeFreeMarketContextProxy("russell", {
                  exchange: config.KIS_RUSSELL_PROXY_EXCHANGE,
                  symbol: config.KIS_RUSSELL_PROXY_SYMBOL,
                }),
                describeFreeMarketContextProxy("oil", {
                  exchange: config.KIS_OIL_PROXY_EXCHANGE,
                  symbol: config.KIS_OIL_PROXY_SYMBOL,
                }),
              ]
            : `${market === "nxt" ? "NXT" : "KRX"}:${config.KIS_DOMESTIC_SYMBOL}`,
      support:
        market === "us"
          ? {
              verification: result.receivedRecords > 0 ? "verified" : "unknown",
              realtime: null,
              orderBookDepth: result.receivedByTrId.HDFSASP0 ? 1 : null,
              note: "Realtime entitlement and observed delay require timestamp analysis",
            }
          : market === "proxy"
            ? {
                verification:
                  result.receivedRecords > 0 ? "verified" : "unknown",
                quality: "PROXY_LIVE",
                actualCmeFutures: false,
                note: "QQQ, IWM and USO are KIS equity streams, not NQ, RTY or CL futures",
              }
            : market === "nxt"
              ? {
                  verification:
                    result.receivedRecords > 0 ? "verified" : "ack-only",
                  dataUse: "LOCAL_PAPER_EXECUTION_EVIDENCE",
                  paperFillEligible:
                    (result.receivedByTrId.H0NXASP0 ?? 0) > 0 &&
                    (result.receivedByTrId.H0NXCNT0 ?? 0) > 0 &&
                    result.acknowledgedSubscriptions.some(
                      (item) => item.trId === "H0NXMKO0",
                    ),
                  note:
                    "Local simulation only; official NXT window plus fresh venue-attributed book and trade are required",
                }
              : {
                verification:
                  result.receivedRecords > 0 ? "verified" : "unknown",
              },
      result,
    },
    null,
    2,
  ),
);

process.exitCode =
  result.connected &&
  result.parseErrors.length === 0 &&
  result.receivedRecords > 0
    ? 0
    : 1;
