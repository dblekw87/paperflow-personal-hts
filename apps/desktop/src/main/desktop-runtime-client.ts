import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import {
  isDesktopChartProjection,
  isDesktopInformationFeedProjection,
  isDesktopInstrumentSearchProjection,
  isDesktopMarketCalendarProjection,
  isDesktopMarketContextProjection,
  isDesktopRankingProjection,
  isDesktopInvestorFlowProjection,
  type DesktopAccountProjection,
  type DesktopBootstrapProjection,
  type DesktopChartInterval,
  type DesktopChartProjection,
  type DesktopChartRange,
  type DesktopMarketProjection,
  type DesktopInformationFeedProjection,
  type DesktopInstrumentSearchProjection,
  type DesktopMarketCalendarProjection,
  type DesktopMarketContextProjection,
  type DesktopPaperOrderResult,
  type DesktopRankingProjection,
  type DesktopRankingSort,
  type DesktopInvestorFlowProjection,
} from "../shared/desktop-contracts.js";

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

type WorkerMessage =
  | { readonly kind: "ready" }
  | {
      readonly kind: "market-projection";
      readonly projection: DesktopMarketProjection;
    }
  | {
      readonly kind: "account-projection";
      readonly projection: DesktopAccountProjection;
    }
  | {
      readonly kind: "chart-projection";
      readonly projection: DesktopChartProjection;
    }
  | {
      readonly kind: "response";
      readonly id: string;
      readonly ok: boolean;
      readonly result?: unknown;
      readonly errorCode?: string;
    };

function isWorkerMessage(value: unknown): value is WorkerMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof value.kind === "string"
  );
}

function workerEnvironment(): NodeJS.ProcessEnv {
  const allowedKeys = [
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "PATH",
    "Path",
    "PATHEXT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "NODE_ENV",
    "KIS_DATA_ENV",
    "KIS_APP_KEY",
    "KIS_APP_SECRET",
    "KIS_PAPER_APP_KEY",
    "KIS_PAPER_APP_SECRET",
    "KIS_PROD_DATA_APP_KEY",
    "KIS_PROD_DATA_APP_SECRET",
    "KIS_HTS_ID",
    "KIS_DOMESTIC_SYMBOL",
    "KIS_US_EXCHANGE",
    "KIS_US_SYMBOL",
    "CME_DATA_MODE",
    "KIS_NASDAQ_PROXY_EXCHANGE",
    "KIS_NASDAQ_PROXY_SYMBOL",
    "KIS_RUSSELL_PROXY_EXCHANGE",
    "KIS_RUSSELL_PROXY_SYMBOL",
    "KIS_OIL_PROXY_EXCHANGE",
    "KIS_OIL_PROXY_SYMBOL",
    "KIS_LIVE_ACK",
    "DART_CRTFC_KEY",
    "SEC_USER_AGENT",
    "PAPER_FILL_PROFILE",
    "PAPER_QUEUE_SAFETY_FACTOR",
  ] as const;
  const environment: NodeJS.ProcessEnv = {};
  for (const key of allowedKeys) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

export class DesktopRuntimeClient {
  readonly #child: ChildProcess;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #emitMarket: (projection: DesktopMarketProjection) => void;
  readonly #emitAccount: (projection: DesktopAccountProjection) => void;
  readonly #emitChart: (projection: DesktopChartProjection) => void;
  #closed = false;

  private constructor(
    child: ChildProcess,
    emitMarket: (projection: DesktopMarketProjection) => void,
    emitAccount: (projection: DesktopAccountProjection) => void,
    emitChart: (projection: DesktopChartProjection) => void,
  ) {
    this.#child = child;
    this.#emitMarket = emitMarket;
    this.#emitAccount = emitAccount;
    this.#emitChart = emitChart;
    child.on("message", (value: unknown) => this.#handleMessage(value));
    child.once("exit", () => {
      this.#closed = true;
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Desktop worker stopped"));
      }
      this.#pending.clear();
    });
  }

  public static start(options: {
    userDataPath: string;
    emitMarket: (projection: DesktopMarketProjection) => void;
    emitAccount: (projection: DesktopAccountProjection) => void;
    emitChart: (projection: DesktopChartProjection) => void;
  }): Promise<DesktopRuntimeClient> {
    const workerPath = fileURLToPath(
      new URL("./desktop-worker.js", import.meta.url),
    );
    const child = fork(workerPath, [options.userDataPath], {
      execPath: process.env["PAPERTRADING_NODE_EXECUTABLE"]?.trim() || "node",
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: workerEnvironment(),
    });
    const client = new DesktopRuntimeClient(
      child,
      options.emitMarket,
      options.emitAccount,
      options.emitChart,
    );
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("Desktop worker startup timed out"));
      }, 10_000);
      const onMessage = (value: unknown) => {
        if (isWorkerMessage(value) && value.kind === "ready") {
          clearTimeout(timeout);
          child.off("message", onMessage);
          resolve(client);
        }
      };
      child.on("message", onMessage);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Desktop worker exited during startup (${code})`));
      });
    });
  }

  public getBootstrap(): Promise<DesktopBootstrapProjection> {
    return this.#request<DesktopBootstrapProjection>({ kind: "bootstrap" });
  }

  public connectMarketReadOnly(): Promise<DesktopMarketProjection> {
    return this.#request<DesktopMarketProjection>({
      kind: "market-connect",
    });
  }

  public disconnectMarket(): Promise<DesktopMarketProjection> {
    return this.#request<DesktopMarketProjection>({
      kind: "market-disconnect",
    });
  }

  public selectInstrument(symbol: string): Promise<DesktopMarketProjection> {
    return this.#request<DesktopMarketProjection>({
      kind: "market-select-instrument",
      symbol,
    });
  }

  public getWatchlistQuotes(symbols: readonly string[]) {
    return this.#request<readonly import("../shared/desktop-contracts.js").DesktopWatchlistQuoteProjection[]>({
      kind: "watchlist-quotes-get",
      symbols,
    });
  }

  public async getChartHistory(
    interval: DesktopChartInterval,
    range: DesktopChartRange,
  ): Promise<DesktopChartProjection> {
    const projection = await this.#request<unknown>(
      {
        kind: "chart-history",
        interval,
        range,
      },
      120_000,
    );
    if (!isDesktopChartProjection(projection)) {
      throw new Error("Desktop worker returned an invalid chart projection");
    }
    return projection;
  }

  public async getRanking(
    market: "KRX" | "US",
    sort: DesktopRankingSort,
  ): Promise<DesktopRankingProjection> {
    const projection = await this.#request<unknown>({
      kind: "ranking-get",
      market,
      sort,
    });
    if (!isDesktopRankingProjection(projection)) {
      throw new Error("Desktop worker returned an invalid ranking projection");
    }
    return projection;
  }

  public async getInvestorFlow(): Promise<DesktopInvestorFlowProjection> {
    const projection = await this.#request<unknown>(
      { kind: "investor-flow-get" },
      30_000,
    );
    if (!isDesktopInvestorFlowProjection(projection)) {
      throw new Error("Desktop worker returned an invalid investor-flow projection");
    }
    return projection;
  }

  public async searchDomesticInstruments(
    query: string,
  ): Promise<DesktopInstrumentSearchProjection> {
    const projection = await this.#request<unknown>(
      {
        kind: "instrument-search",
        query,
      },
      30_000,
    );
    if (!isDesktopInstrumentSearchProjection(projection)) {
      throw new Error(
        "Desktop worker returned an invalid instrument search projection",
      );
    }
    return projection;
  }

  public async searchUsInstruments(
    query: string,
  ): Promise<DesktopInstrumentSearchProjection> {
    const projection = await this.#request<unknown>(
      { kind: "instrument-search", query, region: "US" },
      30_000,
    );
    if (!isDesktopInstrumentSearchProjection(projection)) {
      throw new Error("Desktop worker returned an invalid US instrument search projection");
    }
    return projection;
  }

  public async getInformationFeed(
    forceRefresh = false,
  ): Promise<DesktopInformationFeedProjection> {
    const projection = await this.#request<unknown>(
      {
        kind: "information-get",
        forceRefresh,
      },
      45_000,
    );
    if (!isDesktopInformationFeedProjection(projection)) {
      throw new Error(
        "Desktop worker returned an invalid information projection",
      );
    }
    return projection;
  }

  public async getMarketContext(
    forceRefresh = false,
  ): Promise<DesktopMarketContextProjection> {
    const projection = await this.#request<unknown>(
      {
        kind: "market-context-get",
        forceRefresh,
      },
      30_000,
    );
    if (!isDesktopMarketContextProjection(projection)) {
      throw new Error(
        "Desktop worker returned an invalid market-context projection",
      );
    }
    return projection;
  }

  public async getMarketCalendar(
    forceRefresh = false,
  ): Promise<DesktopMarketCalendarProjection> {
    const projection = await this.#request<unknown>(
      {
        kind: "market-calendar-get",
        forceRefresh,
      },
      15_000,
    );
    if (!isDesktopMarketCalendarProjection(projection)) {
      throw new Error(
        "Desktop worker returned an invalid market-calendar projection",
      );
    }
    return projection;
  }

  public submitPaperOrder(request: unknown): Promise<DesktopPaperOrderResult> {
    return this.#request<DesktopPaperOrderResult>({
      kind: "paper-submit",
      request,
    });
  }

  public async close(): Promise<void> {
    if (this.#closed) return;
    try {
      await this.#request<null>({ kind: "close" });
    } catch {
      // Continue with bounded process cleanup even if the worker is unhealthy.
    } finally {
      this.#closed = true;
      if (this.#child.connected) this.#child.disconnect();
    }
    if (await this.#waitForExit(3_000)) return;
    this.#child.kill();
    await this.#waitForExit(1_000);
  }

  #request<T>(
    command: Readonly<Record<string, unknown>>,
    timeoutMs = 15_000,
  ): Promise<T> {
    if (this.#closed || !this.#child.connected) {
      return Promise.reject(new Error("Desktop worker is unavailable"));
    }
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error("Desktop worker request timed out"));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.#child.send({ ...command, id }, (error) => {
        if (!error) return;
        const pending = this.#pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending.delete(id);
        pending.reject(new Error("Desktop worker request failed"));
      });
    });
  }

  #handleMessage(value: unknown): void {
    if (!isWorkerMessage(value)) return;
    if (value.kind === "market-projection") {
      this.#emitMarket(value.projection);
      return;
    }
    if (value.kind === "account-projection") {
      this.#emitAccount(value.projection);
      return;
    }
    if (value.kind === "chart-projection") {
      if (isDesktopChartProjection(value.projection)) {
        this.#emitChart(value.projection);
      }
      return;
    }
    if (value.kind !== "response") return;
    const pending = this.#pending.get(value.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(value.id);
    if (value.ok) {
      pending.resolve(value.result);
    } else {
      pending.reject(
        new Error(value.errorCode ?? "Desktop worker request failed"),
      );
    }
  }

  #waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#child.off("exit", onExit);
        resolve(false);
      }, timeoutMs);
      const onExit = () => {
        clearTimeout(timer);
        resolve(true);
      };
      this.#child.once("exit", onExit);
    });
  }
}
