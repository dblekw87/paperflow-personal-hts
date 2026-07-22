import WebSocket from "ws";

import {
  MarketLiveEventSchema,
  MarketLiveProjectionSchema,
  type MarketLiveError,
  type MarketLiveEvent,
  type MarketLiveProjection,
} from "../../contracts/market-live-projection.js";
import { getKisEndpoints, KIS_TR } from "../endpoints.js";
import { KisApiError } from "../errors.js";
import {
  buildSubscriptionMessage,
  domesticProbeSubscriptions,
  nxtDomesticProbeSubscriptions,
  unifiedDomesticProbeSubscriptions,
  usProbeSubscriptions,
  koreaBusinessDate,
  rawDataToText,
  validateProbeDataFrame,
  type WsSubscription,
} from "./client.js";
import { parseKisWsFrame, type KisPipeFrame } from "./frame.js";
import {
  normalizeDomesticOrderBook,
  normalizeDomesticTrade,
  normalizeNxtOrderBook,
  normalizeNxtTrade,
  normalizeUnifiedDomesticOrderBook,
  normalizeUnifiedDomesticTrade,
  normalizeUsOrderBook,
  normalizeUsTrade,
} from "./normalize.js";
import { resolveUsEquitySession } from "../../market-data/us-equity-session.js";

export interface DomesticLiveStreamOptions {
  environment: "paper" | "prod";
  approvalKey: string;
  symbol: string;
  venue?: "KRX" | "NXT" | "CONSOLIDATED" | "NASDAQ" | "NYSE" | "AMEX";
  providerExchange?: "NAS" | "NYS" | "AMS";
  socketFactory?: (url: string) => WebSocket;
  onEvent?: (event: MarketLiveEvent) => void;
  onProjection?: (projection: MarketLiveProjection) => void;
  onError?: (error: MarketLiveError) => void;
  now?: () => Date;
  random?: () => number;
  staleAfterMs?: number;
  handshakeTimeoutMs?: number;
  reconnect?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    jitterRatio?: number;
  };
}

interface ReadyDeferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: KisApiError) => void;
  settled: boolean;
}

const SAFE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  KIS_WS_CONNECTION_FAILED: "KIS WebSocket connection failed",
  KIS_WS_CONNECTION_CLOSED: "KIS WebSocket connection closed unexpectedly",
  KIS_WS_RECONNECT_EXHAUSTED: "KIS WebSocket reconnect attempts were exhausted",
  KIS_WS_SUBSCRIPTION_REJECTED: "KIS rejected a market-data subscription",
  KIS_WS_SUBSCRIPTION_ACK_TIMEOUT:
    "KIS did not acknowledge market-data subscriptions in time",
  KIS_WS_UNEXPECTED_CONTROL:
    "KIS returned control data for an unrequested subscription",
  KIS_WS_DATA_BEFORE_ACK:
    "KIS sent market data before acknowledging its subscription",
  KIS_WS_UNEXPECTED_INSTRUMENT:
    "KIS sent market data for an unrequested instrument",
  KIS_WS_PROTOCOL_ERROR: "KIS WebSocket market data failed validation",
  KIS_WS_STOPPED: "KIS WebSocket stream was stopped",
};

function safeError(code: string, retryable: boolean): KisApiError {
  return new KisApiError({
    code,
    message: SAFE_ERROR_MESSAGES[code] ?? "KIS WebSocket stream failed",
    retryable,
  });
}

function deferred(): ReadyDeferred {
  let resolvePromise: (() => void) | undefined;
  let rejectPromise: ((error: KisApiError) => void) | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: () => resolvePromise?.(),
    reject: (error) => rejectPromise?.(error),
    settled: false,
  };
}

function freezeDeep<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    freezeDeep(child);
  }
  return Object.freeze(value);
}

function subscriptionIdentity(subscription: WsSubscription): string {
  return `${subscription.trId}:${subscription.trKey}`;
}

function coverage(
  orderBook: MarketLiveProjection["orderBook"],
  trade: MarketLiveProjection["trade"],
): MarketLiveProjection["coverage"] {
  if (orderBook !== null && trade !== null) {
    return "complete";
  }
  return orderBook !== null || trade !== null ? "partial" : "empty";
}

export class DomesticKisLiveStream {
  readonly #options: DomesticLiveStreamOptions;
  readonly #subscriptions: readonly WsSubscription[];
  readonly #instrumentId: string;
  readonly #now: () => Date;
  readonly #random: () => number;
  readonly #staleAfterMs: number;
  readonly #handshakeTimeoutMs: number;
  readonly #maxReconnectAttempts: number;
  readonly #baseDelayMs: number;
  readonly #maxDelayMs: number;
  readonly #jitterRatio: number;

  #projection: MarketLiveProjection;
  #socket: WebSocket | null = null;
  #ready: ReadyDeferred | null = null;
  #acknowledged = new Set<string>();
  #reconnectAttempt = 0;
  #running = false;
  #stopRequested = false;
  #reconnectTimer: NodeJS.Timeout | null = null;
  #freshnessTimer: NodeJS.Timeout | null = null;
  #handshakeTimer: NodeJS.Timeout | null = null;

  constructor(options: DomesticLiveStreamOptions) {
    const venue = options.venue ?? "KRX";
    const isUsVenue = venue === "NASDAQ" || venue === "NYSE" || venue === "AMEX";
    if (
      (isUsVenue && !/^[A-Z0-9.-]{1,20}$/.test(options.symbol)) ||
      (!isUsVenue && !/^[0-9A-Z]{6,7}$/.test(options.symbol)) ||
      (isUsVenue && options.providerExchange === undefined)
    ) {
      throw safeError("KIS_WS_UNEXPECTED_INSTRUMENT", false);
    }
    if (!options.approvalKey) {
      throw safeError("KIS_WS_CONNECTION_FAILED", false);
    }

    const defaultStaleAfterMs =
      venue === "NXT" || venue === "CONSOLIDATED" || isUsVenue
        ? 60_000
        : 15_000;
    const staleAfterMs = options.staleAfterMs ?? defaultStaleAfterMs;
    const handshakeTimeoutMs = options.handshakeTimeoutMs ?? 7_000;
    const maxAttempts = options.reconnect?.maxAttempts ?? 4;
    const baseDelayMs = options.reconnect?.baseDelayMs ?? 250;
    const maxDelayMs = options.reconnect?.maxDelayMs ?? 5_000;
    const jitterRatio = options.reconnect?.jitterRatio ?? 0.2;
    if (
      !Number.isFinite(staleAfterMs) ||
      staleAfterMs <= 0 ||
      !Number.isFinite(handshakeTimeoutMs) ||
      handshakeTimeoutMs <= 0 ||
      !Number.isInteger(maxAttempts) ||
      maxAttempts < 0 ||
      !Number.isFinite(baseDelayMs) ||
      baseDelayMs < 0 ||
      !Number.isFinite(maxDelayMs) ||
      maxDelayMs < baseDelayMs ||
      !Number.isFinite(jitterRatio) ||
      jitterRatio < 0 ||
      jitterRatio > 1
    ) {
      throw new TypeError(
        "KIS live-stream retry or freshness options are invalid",
      );
    }

    this.#options = options;
    this.#subscriptions =
      venue === "CONSOLIDATED"
        ? unifiedDomesticProbeSubscriptions(options.symbol)
        : venue === "NXT"
          ? nxtDomesticProbeSubscriptions(options.symbol)
        : venue !== "KRX"
          ? usProbeSubscriptions(
              options.providerExchange ?? "NAS",
              options.symbol,
              venue,
            )
        : domesticProbeSubscriptions(options.symbol);
    // A security keeps one portfolio identity across execution venues.
    this.#instrumentId = `${venue === "NXT" || venue === "CONSOLIDATED" ? "KRX" : venue}:${options.symbol}`;
    this.#now = options.now ?? (() => new Date());
    this.#random = options.random ?? Math.random;
    this.#staleAfterMs = staleAfterMs;
    this.#handshakeTimeoutMs = handshakeTimeoutMs;
    this.#maxReconnectAttempts = maxAttempts;
    this.#baseDelayMs = baseDelayMs;
    this.#maxDelayMs = maxDelayMs;
    this.#jitterRatio = jitterRatio;

    const now = this.#now().toISOString();
    this.#projection = MarketLiveProjectionSchema.parse({
      instrumentId: this.#instrumentId,
      environment: options.environment,
      source: "KIS_WS",
      connectionStatus: "idle",
      freshness: "offline",
      coverage: "empty",
      generation: 0,
      reconnectCount: 0,
      acknowledged: { orderBook: false, trade: false },
      orderBook: null,
      trade: null,
      asOf: now,
      lastReceivedAt: null,
      lastOrderBookReceivedAt: null,
      lastTradeReceivedAt: null,
      lastError: null,
    });
  }

  start(): Promise<void> {
    if (this.#running && this.#ready !== null) {
      return this.#ready.promise;
    }
    if (this.#running) {
      return Promise.resolve();
    }

    this.#running = true;
    this.#stopRequested = false;
    this.#reconnectAttempt = 0;
    this.#ready = deferred();
    this.#patchProjection({
      connectionStatus: "connecting",
      freshness: this.#projection.lastReceivedAt ? "stale" : "offline",
      lastError: null,
    });
    this.#connect();
    return this.#ready.promise;
  }

  async stop(): Promise<void> {
    if (!this.#running && this.#projection.connectionStatus === "stopped") {
      return;
    }

    this.#running = false;
    this.#stopRequested = true;
    this.#clearReconnectTimer();
    this.#clearFreshnessTimer();
    this.#clearHandshakeTimer();

    if (this.#ready !== null && !this.#ready.settled) {
      this.#ready.settled = true;
      this.#ready.reject(safeError("KIS_WS_STOPPED", false));
    }

    const socket = this.#socket;
    this.#socket = null;
    if (socket !== null) {
      if (socket.readyState === WebSocket.OPEN) {
        for (const subscription of this.#subscriptions) {
          try {
            socket.send(
              buildSubscriptionMessage(
                this.#options.approvalKey,
                subscription,
                "2",
              ),
            );
          } catch {
            // The stream is already stopping; never surface provider details.
          }
        }
        socket.close(1000, "Local market-data stream stopped");
      } else if (socket.readyState !== WebSocket.CLOSED) {
        socket.terminate();
      }
    }

    this.#patchProjection({
      connectionStatus: "stopped",
      freshness: this.#projection.lastReceivedAt ? "stale" : "offline",
      acknowledged: { orderBook: false, trade: false },
      lastError: null,
    });
  }

  getProjection(): MarketLiveProjection {
    return freezeDeep(
      MarketLiveProjectionSchema.parse(structuredClone(this.#projection)),
    );
  }

  #connect(): void {
    if (!this.#running || this.#stopRequested) {
      return;
    }

    this.#acknowledged.clear();
    this.#patchProjection({
      connectionStatus:
        this.#projection.generation === 0 ? "connecting" : "reconnecting",
      freshness: this.#projection.lastReceivedAt ? "stale" : "offline",
      generation: this.#projection.generation + 1,
      acknowledged: { orderBook: false, trade: false },
    });

    let socket: WebSocket;
    try {
      const url = getKisEndpoints(this.#options.environment).websocketUrl;
      socket = this.#options.socketFactory
        ? this.#options.socketFactory(url)
        : new WebSocket(url);
    } catch {
      this.#handleConnectionFailure();
      return;
    }
    this.#socket = socket;
    this.#scheduleHandshakeTimeout(socket);

    socket.once("open", () => {
      if (!this.#isCurrent(socket)) {
        return;
      }
      this.#patchProjection({ connectionStatus: "subscribing" });
      try {
        for (const subscription of this.#subscriptions) {
          if (!this.#isCurrent(socket)) {
            return;
          }
          socket.send(
            buildSubscriptionMessage(
              this.#options.approvalKey,
              subscription,
              "1",
            ),
          );
        }
      } catch {
        if (!this.#isCurrent(socket)) {
          return;
        }
        this.#reportError("KIS_WS_CONNECTION_FAILED", true);
        socket.terminate();
      }
    });

    socket.on("message", (data) => {
      if (!this.#isCurrent(socket)) {
        return;
      }
      this.#handleMessage(socket, rawDataToText(data));
    });

    socket.once("error", () => {
      if (!this.#isCurrent(socket)) {
        return;
      }
      this.#reportError("KIS_WS_CONNECTION_FAILED", true);
      socket.terminate();
    });

    socket.once("close", () => {
      this.#clearHandshakeTimer();
      if (this.#socket === socket) {
        this.#socket = null;
      }
      if (!this.#running || this.#stopRequested) {
        return;
      }
      this.#reportError("KIS_WS_CONNECTION_CLOSED", true);
      this.#scheduleReconnect();
    });
  }

  #handleMessage(socket: WebSocket, raw: string): void {
    try {
      const frame = parseKisWsFrame(raw);
      if (frame.kind === "CONTROL") {
        if (frame.isPingPong) {
          socket.pong(Buffer.from(raw, "utf8"));
          return;
        }
        const identity =
          frame.trKey === null ? null : `${frame.trId}:${frame.trKey}`;
        const requested = this.#subscriptions.some(
          (subscription) => subscriptionIdentity(subscription) === identity,
        );
        if (!identity || !requested) {
          this.#failPermanently("KIS_WS_UNEXPECTED_CONTROL");
          return;
        }
        if (frame.success !== true) {
          this.#failPermanently("KIS_WS_SUBSCRIPTION_REJECTED");
          return;
        }

        this.#acknowledged.add(identity);
        const orderBookIdentity = subscriptionIdentity(
          this.#subscriptions[0] as WsSubscription,
        );
        const tradeIdentity = subscriptionIdentity(
          this.#subscriptions[1] as WsSubscription,
        );
        const orderBookAcknowledged = this.#acknowledged.has(orderBookIdentity);
        const tradeAcknowledged = this.#acknowledged.has(tradeIdentity);
        this.#patchProjection({
          acknowledged: {
            orderBook: orderBookAcknowledged,
            trade: tradeAcknowledged,
          },
        });
        if (
          orderBookAcknowledged &&
          tradeAcknowledged &&
          this.#subscriptions.every((subscription) =>
            this.#acknowledged.has(subscriptionIdentity(subscription)),
          )
        ) {
          this.#clearHandshakeTimer();
          this.#patchProjection({
            connectionStatus: "live",
            // A subscription ACK confirms transport only. Existing data must
            // remain stale until a new market-data frame actually arrives.
            freshness: this.#projection.lastReceivedAt ? "stale" : "offline",
            lastError: null,
          });
          this.#resolveReady();
        }
        return;
      }

      const dataSubscription = this.#subscriptions.find(
        (subscription) => subscription.trId === frame.trId,
      );
      const identity = dataSubscription
        ? subscriptionIdentity(dataSubscription)
        : `${frame.trId}:${this.#options.symbol}`;
      const allSubscriptionsAcknowledged = this.#subscriptions.every(
        (subscription) =>
          this.#acknowledged.has(subscriptionIdentity(subscription)),
      );
      if (!this.#acknowledged.has(identity) || !allSubscriptionsAcknowledged) {
        this.#reportError("KIS_WS_DATA_BEFORE_ACK", true);
        socket.terminate();
        return;
      }

      try {
        validateProbeDataFrame(frame, this.#subscriptions, this.#now());
      } catch (error) {
        if (
          error instanceof KisApiError &&
          error.code === "KIS_WS_UNEXPECTED_INSTRUMENT"
        ) {
          this.#failPermanently("KIS_WS_UNEXPECTED_INSTRUMENT");
          return;
        }
        throw error;
      }
      this.#applyDataFrame(frame);
    } catch (error) {
      if (!this.#running) {
        return;
      }
      if (
        error instanceof KisApiError &&
        error.code === "KIS_WS_UNEXPECTED_INSTRUMENT"
      ) {
        this.#failPermanently("KIS_WS_UNEXPECTED_INSTRUMENT");
        return;
      }
      this.#reportError("KIS_WS_PROTOCOL_ERROR", true);
      socket.terminate();
    }
  }

  #applyDataFrame(frame: KisPipeFrame): void {
    const receivedAt = this.#now().toISOString();
    if (
      frame.trId === KIS_TR.domesticOrderBook ||
      frame.trId === KIS_TR.domesticNxtOrderBook ||
      frame.trId === KIS_TR.domesticUnifiedOrderBook ||
      frame.trId === KIS_TR.usOrderBook
    ) {
      const snapshots =
        frame.trId === KIS_TR.usOrderBook
          ? normalizeUsOrderBook(
              frame,
              this.#options.venue ?? "NASDAQ",
            )
          : frame.trId === KIS_TR.domesticUnifiedOrderBook
          ? normalizeUnifiedDomesticOrderBook(frame, koreaBusinessDate(this.#now()))
          : frame.trId === KIS_TR.domesticNxtOrderBook
            ? normalizeNxtOrderBook(frame, koreaBusinessDate(this.#now()))
          : normalizeDomesticOrderBook(frame, koreaBusinessDate(this.#now()));
      for (const snapshot of snapshots) {
        const canonicalSnapshot = {
          ...snapshot,
          instrumentId: this.#instrumentId,
        };
        this.#projection = MarketLiveProjectionSchema.parse({
          ...this.#projection,
          connectionStatus: "live",
          freshness: "live",
          coverage: coverage(canonicalSnapshot, this.#projection.trade),
          orderBook: canonicalSnapshot,
          asOf: receivedAt,
          lastReceivedAt: receivedAt,
          lastOrderBookReceivedAt: receivedAt,
          lastError: null,
        });
        this.#emitEvent({
          kind: "ORDER_BOOK",
          receivedAt,
          data: canonicalSnapshot,
        });
        this.#emitProjection();
      }
    } else if (
      frame.trId === KIS_TR.domesticTrade ||
      frame.trId === KIS_TR.domesticNxtTrade ||
      frame.trId === KIS_TR.domesticUnifiedTrade ||
      frame.trId === KIS_TR.usTrade
    ) {
      const ticks =
        frame.trId === KIS_TR.usTrade
          ? normalizeUsTrade(frame, this.#options.venue ?? "NASDAQ")
          : frame.trId === KIS_TR.domesticUnifiedTrade
          ? normalizeUnifiedDomesticTrade(frame)
          : frame.trId === KIS_TR.domesticNxtTrade
            ? normalizeNxtTrade(frame)
          : normalizeDomesticTrade(frame);
      for (const tick of ticks) {
        const canonicalTick = {
          ...tick,
          instrumentId: this.#instrumentId,
          session:
            frame.trId === KIS_TR.usTrade
              ? resolveUsEquitySession(this.#now())
              : tick.session,
        };
        this.#projection = MarketLiveProjectionSchema.parse({
          ...this.#projection,
          connectionStatus: "live",
          freshness: "live",
          coverage: coverage(this.#projection.orderBook, canonicalTick),
          trade: canonicalTick,
          asOf: receivedAt,
          lastReceivedAt: receivedAt,
          lastTradeReceivedAt: receivedAt,
          lastError: null,
        });
        this.#emitEvent({
          kind: "TRADE",
          receivedAt,
          data: canonicalTick,
        });
        this.#emitProjection();
      }
    } else if (frame.trId !== KIS_TR.domesticNxtMarketStatus) {
      throw safeError("KIS_WS_PROTOCOL_ERROR", false);
    }
    this.#scheduleFreshnessCheck();
  }

  #scheduleFreshnessCheck(): void {
    this.#clearFreshnessTimer();
    this.#freshnessTimer = setTimeout(() => {
      this.#freshnessTimer = null;
      if (
        !this.#running ||
        this.#projection.lastReceivedAt === null ||
        this.#projection.freshness !== "live"
      ) {
        return;
      }
      const ageMs =
        this.#now().getTime() -
        new Date(this.#projection.lastReceivedAt).getTime();
      if (ageMs >= this.#staleAfterMs) {
        this.#patchProjection({ freshness: "stale" });
      } else {
        this.#scheduleFreshnessCheck();
      }
    }, this.#staleAfterMs);
  }

  #handleConnectionFailure(): void {
    this.#reportError("KIS_WS_CONNECTION_FAILED", true);
    this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    if (
      !this.#running ||
      this.#stopRequested ||
      this.#reconnectTimer !== null
    ) {
      return;
    }
    if (this.#reconnectAttempt >= this.#maxReconnectAttempts) {
      this.#failPermanently("KIS_WS_RECONNECT_EXHAUSTED");
      return;
    }

    const exponentialDelay = Math.min(
      this.#maxDelayMs,
      this.#baseDelayMs * 2 ** this.#reconnectAttempt,
    );
    const randomValue = this.#random();
    const jitterSample = Number.isFinite(randomValue)
      ? Math.min(1, Math.max(0, randomValue))
      : 0.5;
    const jitter = 1 + (jitterSample * 2 - 1) * this.#jitterRatio;
    const delayMs = Math.max(0, Math.round(exponentialDelay * jitter));
    this.#reconnectAttempt += 1;
    this.#patchProjection({
      connectionStatus: "reconnecting",
      freshness: this.#projection.lastReceivedAt ? "stale" : "offline",
      reconnectCount: this.#projection.reconnectCount + 1,
      acknowledged: { orderBook: false, trade: false },
    });
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, delayMs);
  }

  #failPermanently(code: string): void {
    if (!this.#running) {
      return;
    }
    const error = safeError(code, false);
    this.#running = false;
    this.#stopRequested = false;
    this.#clearReconnectTimer();
    this.#clearFreshnessTimer();
    this.#clearHandshakeTimer();
    const socket = this.#socket;
    this.#socket = null;
    if (
      socket !== null &&
      socket.readyState !== WebSocket.CLOSED &&
      socket.readyState !== WebSocket.CLOSING
    ) {
      socket.terminate();
    }
    this.#patchProjection({
      connectionStatus: "failed",
      freshness: this.#projection.lastReceivedAt ? "stale" : "offline",
      acknowledged: { orderBook: false, trade: false },
      lastError: { code: error.code, retryable: error.retryable },
    });
    this.#emitError(error);
    this.#rejectReady(error);
  }

  #reportError(code: string, retryable: boolean): void {
    const error = safeError(code, retryable);
    this.#patchProjection({
      freshness: this.#projection.lastReceivedAt ? "stale" : "offline",
      lastError: { code: error.code, retryable: error.retryable },
    });
    this.#emitError(error);
  }

  #patchProjection(
    patch: Partial<
      Pick<
        MarketLiveProjection,
        | "connectionStatus"
        | "freshness"
        | "generation"
        | "reconnectCount"
        | "acknowledged"
        | "lastError"
      >
    >,
  ): void {
    this.#projection = MarketLiveProjectionSchema.parse({
      ...this.#projection,
      ...patch,
      asOf: this.#now().toISOString(),
    });
    this.#emitProjection();
  }

  #emitEvent(event: MarketLiveEvent): void {
    const safeEvent = freezeDeep(MarketLiveEventSchema.parse(event));
    try {
      this.#options.onEvent?.(safeEvent);
    } catch {
      // Consumer callbacks cannot affect the market-data lifecycle.
    }
  }

  #emitProjection(): void {
    try {
      this.#options.onProjection?.(this.getProjection());
    } catch {
      // Consumer callbacks cannot affect the market-data lifecycle.
    }
  }

  #emitError(error: KisApiError): void {
    const safe = freezeDeep({
      code: error.code,
      retryable: error.retryable,
    });
    try {
      this.#options.onError?.(safe);
    } catch {
      // Consumer callbacks cannot affect the market-data lifecycle.
    }
  }

  #resolveReady(): void {
    if (this.#ready !== null && !this.#ready.settled) {
      this.#ready.settled = true;
      this.#ready.resolve();
    }
  }

  #rejectReady(error: KisApiError): void {
    if (this.#ready !== null && !this.#ready.settled) {
      this.#ready.settled = true;
      this.#ready.reject(error);
    }
  }

  #isCurrent(socket: WebSocket): boolean {
    return this.#running && !this.#stopRequested && this.#socket === socket;
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #clearFreshnessTimer(): void {
    if (this.#freshnessTimer !== null) {
      clearTimeout(this.#freshnessTimer);
      this.#freshnessTimer = null;
    }
  }

  #scheduleHandshakeTimeout(socket: WebSocket): void {
    this.#clearHandshakeTimer();
    this.#handshakeTimer = setTimeout(() => {
      this.#handshakeTimer = null;
      if (!this.#isCurrent(socket)) {
        return;
      }
      this.#reportError("KIS_WS_SUBSCRIPTION_ACK_TIMEOUT", true);
      socket.terminate();
    }, this.#handshakeTimeoutMs);
  }

  #clearHandshakeTimer(): void {
    if (this.#handshakeTimer !== null) {
      clearTimeout(this.#handshakeTimer);
      this.#handshakeTimer = null;
    }
  }
}
