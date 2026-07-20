import {
  assertLiveReadOnlyAcknowledgement,
  loadRuntimeConfig,
  requireKisCredentials,
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
const credentials = requireKisCredentials(config);
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
const auth = new KisAuthClient(config.KIS_DATA_ENV, credentials);
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
  environment: config.KIS_DATA_ENV,
  approvalKey,
  subscriptions,
  durationSeconds: config.KIS_PROBE_SECONDS,
});

console.log(
  JSON.stringify(
    {
      market,
      environment: config.KIS_DATA_ENV,
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
                  dataUse: "DISPLAY_ONLY",
                  paperFillEligible: false,
                  note:
                    "NXT paper fills remain locked until H0NXMKO0 phase/VI evidence is normalized",
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
