import type {
  DesktopBootstrapProjection,
  DesktopAccountProjection,
  DesktopChartProjection,
  DesktopMarketProjection,
  DesktopInformationFeedProjection,
  DesktopInstrumentSearchProjection,
  DesktopMarketContextProjection,
  DesktopPaperOrderRequest,
  DesktopPaperOrderResult,
  DesktopRankingProjection,
} from "../shared/desktop-contracts.js";
import { DesktopRuntime } from "./desktop-runtime.js";

type WorkerCommand =
  | { readonly id: string; readonly kind: "bootstrap" }
  | { readonly id: string; readonly kind: "market-connect" }
  | { readonly id: string; readonly kind: "market-disconnect" }
  | {
      readonly id: string;
      readonly kind: "market-select-instrument";
      readonly symbol: unknown;
    }
  | {
      readonly id: string;
      readonly kind: "chart-history";
      readonly interval: unknown;
      readonly range: unknown;
    }
  | {
      readonly id: string;
      readonly kind: "ranking-get";
      readonly sort: unknown;
    }
  | {
      readonly id: string;
      readonly kind: "instrument-search";
      readonly query: unknown;
    }
  | {
      readonly id: string;
      readonly kind: "information-get";
      readonly forceRefresh: unknown;
    }
  | {
      readonly id: string;
      readonly kind: "market-context-get";
      readonly forceRefresh: unknown;
    }
  | {
      readonly id: string;
      readonly kind: "paper-submit";
      readonly request: unknown;
    }
  | { readonly id: string; readonly kind: "close" };

type WorkerResult =
  | DesktopBootstrapProjection
  | DesktopChartProjection
  | DesktopMarketProjection
  | DesktopInformationFeedProjection
  | DesktopInstrumentSearchProjection
  | DesktopMarketContextProjection
  | DesktopPaperOrderResult
  | DesktopRankingProjection
  | null;

function isWorkerCommand(value: unknown): value is WorkerCommand {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["id"] === "string" &&
    typeof record["kind"] === "string" &&
    [
      "bootstrap",
      "market-connect",
      "market-disconnect",
      "market-select-instrument",
      "chart-history",
      "ranking-get",
      "instrument-search",
      "information-get",
      "market-context-get",
      "paper-submit",
      "close",
    ].includes(record["kind"])
  );
}

function send(message: unknown): void {
  if (typeof process.send === "function") {
    process.send(message);
  }
}

const userDataPath = process.argv[2];
if (!userDataPath) {
  throw new Error("Desktop worker requires an Electron userData path");
}

const runtime = new DesktopRuntime({
  userDataPath,
  emitMarket: (projection) => {
    send({ kind: "market-projection", projection });
  },
  emitAccount: (projection: DesktopAccountProjection) => {
    send({ kind: "account-projection", projection });
  },
  emitChart: (projection: DesktopChartProjection) => {
    send({ kind: "chart-projection", projection });
  },
});

send({ kind: "ready" });

process.on("message", (value: unknown) => {
  if (!isWorkerCommand(value)) return;
  void (async () => {
    let result: WorkerResult;
    switch (value.kind) {
      case "bootstrap":
        result = runtime.getBootstrap();
        break;
      case "market-connect":
        result = await runtime.connectMarketReadOnly();
        break;
      case "market-disconnect":
        result = await runtime.disconnectMarket();
        break;
      case "market-select-instrument":
        result = await runtime.selectInstrument(value.symbol);
        break;
      case "chart-history":
        result = await runtime.getChartHistory(value.interval, value.range);
        break;
      case "ranking-get":
        result = await runtime.getDomesticRanking(value.sort);
        break;
      case "instrument-search":
        result = await runtime.searchDomesticInstruments(value.query);
        break;
      case "information-get":
        result = await runtime.getInformationFeed(
          value.forceRefresh === true,
        );
        break;
      case "market-context-get":
        result = await runtime.getMarketContext(value.forceRefresh === true);
        break;
      case "paper-submit":
        result = runtime.submitPaperOrder(
          value.request as DesktopPaperOrderRequest,
        );
        break;
      case "close":
        await runtime.close();
        result = null;
        break;
    }
    send({ kind: "response", id: value.id, ok: true, result });
    if (value.kind === "close") {
      process.disconnect();
    }
  })().catch((error: unknown) => {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "DESKTOP_WORKER_ERROR";
    send({ kind: "response", id: value.id, ok: false, errorCode: code });
  });
});

process.on("disconnect", () => {
  void runtime.close().finally(() => {
    process.exit(0);
  });
});
