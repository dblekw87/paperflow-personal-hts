import WebSocket, { type RawData } from "ws";

import { getKisEndpoints, KIS_TR } from "../endpoints.js";
import { KisApiError } from "../errors.js";
import { parseKisWsFrame, type KisPipeFrame } from "./frame.js";
import type { SupportedWsTrId } from "./layouts.js";
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

export interface WsSubscription {
  trId: SupportedWsTrId;
  trKey: string;
  canonicalVenue?: "NASDAQ" | "NYSE" | "AMEX" | "NYSEARCA";
}

export interface WsProbeResult {
  connected: boolean;
  completedNormally: boolean;
  startedAt: string;
  endedAt: string;
  receivedRecords: number;
  receivedByTrId: Partial<Record<SupportedWsTrId, number>>;
  acknowledgedSubscriptions: WsSubscription[];
  failedSubscriptions: Array<WsSubscription & { message: string }>;
  controlMessages: number;
  pingPongs: number;
  parseErrors: Array<{ code: string; message: string }>;
  firstDataAt: string | null;
  lastDataAt: string | null;
  closeCode: number | null;
  closeReason: string | null;
}

export function buildUsRegularTrKey(
  exchange: "NAS" | "NYS" | "AMS",
  symbol: string,
): string {
  if (!/^[A-Z0-9.-]{1,20}$/.test(symbol)) {
    throw new Error("US symbol contains unsupported characters");
  }
  return `D${exchange}${symbol}`;
}

export function buildSubscriptionMessage(
  approvalKey: string,
  subscription: WsSubscription,
  action: "1" | "2",
): string {
  return JSON.stringify({
    header: {
      "content-type": "utf-8",
      approval_key: approvalKey,
      tr_type: action,
      custtype: "P",
    },
    body: {
      input: {
        tr_id: subscription.trId,
        tr_key: subscription.trKey,
      },
    },
  });
}

export function rawDataToText(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  return data.toString("utf8");
}

interface ExpectedSubscription {
  subscription: WsSubscription;
  identity: string;
  instrumentId: string;
  venue:
    | "KRX"
    | "NXT"
    | "CONSOLIDATED"
    | "NASDAQ"
    | "NYSE"
    | "AMEX"
    | "NYSEARCA";
}

const US_VENUES = {
  NAS: "NASDAQ",
  NYS: "NYSE",
  AMS: "AMEX",
} as const;

function subscriptionIdentity(subscription: WsSubscription): string {
  return `${subscription.trId}:${subscription.trKey}`;
}

function expectedSubscription(
  subscription: WsSubscription,
): ExpectedSubscription {
  const domesticVenue =
    subscription.trId === KIS_TR.domesticOrderBook ||
    subscription.trId === KIS_TR.domesticTrade
      ? "KRX"
      : subscription.trId === KIS_TR.domesticNxtOrderBook ||
          subscription.trId === KIS_TR.domesticNxtTrade ||
          subscription.trId === KIS_TR.domesticNxtMarketStatus
        ? "NXT"
        : subscription.trId === KIS_TR.domesticUnifiedOrderBook ||
            subscription.trId === KIS_TR.domesticUnifiedTrade
          ? "CONSOLIDATED"
          : null;
  if (domesticVenue !== null) {
    if (!/^[0-9A-Z]{6,7}$/.test(subscription.trKey)) {
      throw new KisApiError({
        code: "KIS_WS_INVALID_SUBSCRIPTION_KEY",
        message: "Domestic WebSocket subscription key is invalid",
        retryable: false,
      });
    }
    return {
      subscription,
      identity: subscriptionIdentity(subscription),
      instrumentId: `${domesticVenue}:${subscription.trKey}`,
      venue: domesticVenue,
    };
  }

  const match = /^D(NAS|NYS|AMS)([A-Z0-9.-]{1,20})$/.exec(subscription.trKey);
  if (!match) {
    throw new KisApiError({
      code: "KIS_WS_INVALID_SUBSCRIPTION_KEY",
      message: "US WebSocket subscription key is invalid",
      retryable: false,
    });
  }
  const exchange = match[1] as keyof typeof US_VENUES;
  const symbol = match[2];
  const venue = subscription.canonicalVenue ?? US_VENUES[exchange];
  return {
    subscription,
    identity: subscriptionIdentity(subscription),
    instrumentId: `${venue}:${symbol}`,
    venue,
  };
}

export function koreaBusinessDate(receivedAt: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(receivedAt);
  const part = (type: "year" | "month" | "day") =>
    parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) {
    throw new KisApiError({
      code: "KIS_WS_BUSINESS_DATE_UNAVAILABLE",
      message:
        "Could not derive the Korea business date for an order-book frame",
      retryable: false,
    });
  }
  return `${year}${month}${day}`;
}

function providerSymbol(
  frame: KisPipeFrame,
  recordIndex: number,
): string | null {
  const record = frame.records[recordIndex];
  if (!record) {
    return null;
  }
  if (
    frame.trId === KIS_TR.domesticOrderBook ||
    frame.trId === KIS_TR.domesticTrade ||
    frame.trId === KIS_TR.domesticNxtOrderBook ||
    frame.trId === KIS_TR.domesticNxtTrade ||
    frame.trId === KIS_TR.domesticNxtMarketStatus ||
    frame.trId === KIS_TR.domesticUnifiedOrderBook ||
    frame.trId === KIS_TR.domesticUnifiedTrade
  ) {
    return record.MKSC_SHRN_ISCD ?? null;
  }
  return frame.trId === KIS_TR.usOrderBook
    ? (record.symb ?? null)
    : (record.SYMB ?? null);
}

export function validateProbeDataFrame(
  frame: KisPipeFrame,
  subscriptions: readonly WsSubscription[],
  receivedAt = new Date(),
): number {
  const expected = subscriptions.map(expectedSubscription);

  for (let index = 0; index < frame.records.length; index += 1) {
    const symbol = providerSymbol(frame, index);
    const candidates = expected.filter(
      (item) =>
        item.subscription.trId === frame.trId &&
        item.instrumentId.endsWith(`:${symbol ?? ""}`),
    );
    if (symbol === null || candidates.length !== 1) {
      throw new KisApiError({
        code: "KIS_WS_UNEXPECTED_INSTRUMENT",
        message: `TR ${frame.trId} delivered an unrequested or ambiguous instrument`,
        retryable: false,
      });
    }

    const target = candidates[0];
    if (!target) {
      throw new KisApiError({
        code: "KIS_WS_UNEXPECTED_INSTRUMENT",
        message: `TR ${frame.trId} delivered an unrequested instrument`,
        retryable: false,
      });
    }
    const singleRecordFrame: KisPipeFrame = {
      ...frame,
      recordCount: 1,
      records: [
        frame.records[index] as Readonly<Record<string, string | null>>,
      ],
    };
    if (frame.trId === KIS_TR.domesticNxtMarketStatus) {
      continue;
    }
    const normalized =
      frame.trId === KIS_TR.domesticTrade
        ? normalizeDomesticTrade(singleRecordFrame)[0]
        : frame.trId === KIS_TR.domesticOrderBook
          ? normalizeDomesticOrderBook(
              singleRecordFrame,
              koreaBusinessDate(receivedAt),
            )[0]
          : frame.trId === KIS_TR.domesticNxtTrade
            ? normalizeNxtTrade(singleRecordFrame)[0]
            : frame.trId === KIS_TR.domesticNxtOrderBook
              ? normalizeNxtOrderBook(
                  singleRecordFrame,
                  koreaBusinessDate(receivedAt),
                )[0]
              : frame.trId === KIS_TR.domesticUnifiedTrade
                ? normalizeUnifiedDomesticTrade(singleRecordFrame)[0]
                : frame.trId === KIS_TR.domesticUnifiedOrderBook
                  ? normalizeUnifiedDomesticOrderBook(
                      singleRecordFrame,
                      koreaBusinessDate(receivedAt),
                    )[0]
          : frame.trId === KIS_TR.usTrade
            ? normalizeUsTrade(singleRecordFrame, target.venue)[0]
            : normalizeUsOrderBook(singleRecordFrame, target.venue)[0];

    if (!normalized || normalized.instrumentId !== target.instrumentId) {
      throw new KisApiError({
        code: "KIS_WS_CANONICAL_INSTRUMENT_MISMATCH",
        message: `TR ${frame.trId} canonical instrument did not match the subscription`,
        retryable: false,
      });
    }
  }

  return frame.records.length;
}

export async function runWsProbe(options: {
  environment: "paper" | "prod";
  approvalKey: string;
  subscriptions: WsSubscription[];
  durationSeconds: number;
  socketFactory?: (url: string) => WebSocket;
}): Promise<WsProbeResult> {
  if (options.subscriptions.length === 0 || options.subscriptions.length > 6) {
    throw new Error(
      "The Phase 0 probe supports between one and six subscriptions",
    );
  }
  const expectedSubscriptions = new Map(
    options.subscriptions.map((subscription) => [
      subscriptionIdentity(subscription),
      expectedSubscription(subscription),
    ]),
  );
  if (expectedSubscriptions.size !== options.subscriptions.length) {
    throw new Error("The Phase 0 probe does not allow duplicate subscriptions");
  }

  const startedAt = new Date().toISOString();
  const result: WsProbeResult = {
    connected: false,
    completedNormally: false,
    startedAt,
    endedAt: startedAt,
    receivedRecords: 0,
    receivedByTrId: {},
    acknowledgedSubscriptions: [],
    failedSubscriptions: [],
    controlMessages: 0,
    pingPongs: 0,
    parseErrors: [],
    firstDataAt: null,
    lastDataAt: null,
    closeCode: null,
    closeReason: null,
  };

  const endpoint = getKisEndpoints(options.environment);
  const socket = options.socketFactory
    ? options.socketFactory(endpoint.websocketUrl)
    : new WebSocket(endpoint.websocketUrl);

  await new Promise<void>((resolve) => {
    let finished = false;
    let stopRequested = false;
    let durationTimer: NodeJS.Timeout | undefined;
    let closeTimer: NodeJS.Timeout | undefined;
    const acknowledged = new Set<string>();
    const failed = new Set<string>();

    const addProbeError = (code: string, message: string) => {
      result.parseErrors.push({ code, message });
    };

    const recordMissingAcknowledgements = () => {
      for (const [identity, expected] of expectedSubscriptions) {
        if (acknowledged.has(identity) || failed.has(identity)) {
          continue;
        }
        failed.add(identity);
        result.failedSubscriptions.push({
          ...expected.subscription,
          message: "KIS did not acknowledge this subscription",
        });
        addProbeError(
          "KIS_WS_SUBSCRIPTION_ACK_MISSING",
          `KIS did not acknowledge subscription ${identity}`,
        );
      }
    };

    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      if (durationTimer) {
        clearTimeout(durationTimer);
      }
      if (closeTimer) {
        clearTimeout(closeTimer);
      }
      result.endedAt = new Date().toISOString();
      resolve();
    };

    const requestStop = (reason: string) => {
      if (finished || stopRequested) {
        return;
      }
      stopRequested = true;
      if (socket.readyState === WebSocket.OPEN) {
        for (const subscription of options.subscriptions) {
          try {
            socket.send(
              buildSubscriptionMessage(options.approvalKey, subscription, "2"),
            );
          } catch {
            addProbeError(
              "KIS_WS_UNSUBSCRIBE_FAILED",
              `Could not send unsubscribe for ${subscriptionIdentity(subscription)}`,
            );
          }
        }
        socket.close(1000, reason);
      } else {
        if (!result.connected) {
          addProbeError(
            "KIS_WS_CONNECTION_TIMEOUT",
            "KIS WebSocket did not open in time",
          );
        }
        socket.terminate();
      }
      closeTimer = setTimeout(() => {
        if (finished) {
          return;
        }
        addProbeError(
          "KIS_WS_CLOSE_TIMEOUT",
          "KIS WebSocket did not complete the close handshake",
        );
        recordMissingAcknowledgements();
        socket.terminate();
        finish();
      }, 2_000);
    };

    durationTimer = setTimeout(
      () => requestStop("Phase 0 probe completed"),
      options.durationSeconds * 1_000,
    );

    socket.once("open", () => {
      result.connected = true;
      for (const subscription of options.subscriptions) {
        socket.send(
          buildSubscriptionMessage(options.approvalKey, subscription, "1"),
        );
      }
    });

    socket.on("message", (data) => {
      const raw = rawDataToText(data);
      try {
        const frame = parseKisWsFrame(raw);
        if (frame.kind === "CONTROL") {
          result.controlMessages += 1;
          if (frame.isPingPong) {
            result.pingPongs += 1;
            socket.pong(Buffer.from(raw, "utf8"));
            return;
          }
          if (stopRequested) {
            return;
          }

          const identity =
            frame.trKey === null ? null : `${frame.trId}:${frame.trKey}`;
          const expected =
            identity === null ? undefined : expectedSubscriptions.get(identity);
          if (!identity || !expected) {
            addProbeError(
              "KIS_WS_UNEXPECTED_CONTROL",
              `KIS sent an acknowledgement for an unrequested subscription ${frame.trId}`,
            );
            requestStop("Unexpected KIS acknowledgement");
            return;
          }
          if (frame.success === true) {
            if (!acknowledged.has(identity)) {
              acknowledged.add(identity);
              result.acknowledgedSubscriptions.push(expected.subscription);
            }
            return;
          }
          if (!failed.has(identity)) {
            failed.add(identity);
            const message = frame.message ?? "KIS rejected the subscription";
            result.failedSubscriptions.push({
              ...expected.subscription,
              message,
            });
            addProbeError(
              frame.success === false
                ? "KIS_WS_SUBSCRIPTION_REJECTED"
                : "KIS_WS_SUBSCRIPTION_ACK_INVALID",
              `${identity}: ${message}`,
            );
          }
          requestStop("KIS subscription rejected");
          return;
        }

        const validatedRecords = validateProbeDataFrame(
          frame,
          options.subscriptions,
        );
        const now = new Date().toISOString();
        result.firstDataAt ??= now;
        result.lastDataAt = now;
        result.receivedRecords += validatedRecords;
        result.receivedByTrId[frame.trId] =
          (result.receivedByTrId[frame.trId] ?? 0) + validatedRecords;
      } catch (error) {
        const code =
          error instanceof KisApiError ? error.code : "KIS_WS_PARSE_ERROR";
        const message =
          error instanceof Error
            ? error.message
            : "Unknown WebSocket parse error";
        addProbeError(code, message);
      }
    });

    socket.once("error", () => {
      addProbeError(
        "KIS_WS_CONNECTION_FAILED",
        "KIS WebSocket connection failed",
      );
      requestStop("KIS WebSocket connection failed");
    });

    socket.once("close", (code, reason) => {
      result.closeCode = code;
      result.closeReason = reason.toString("utf8") || null;
      recordMissingAcknowledgements();
      if (!stopRequested) {
        addProbeError(
          "KIS_WS_UNEXPECTED_CLOSE",
          `KIS WebSocket closed unexpectedly with code ${code}`,
        );
      } else if (code !== 1000) {
        addProbeError(
          "KIS_WS_ABNORMAL_CLOSE",
          `KIS WebSocket closed with code ${code} during probe cleanup`,
        );
      }
      result.completedNormally = stopRequested && code === 1000;
      finish();
    });
  });

  return result;
}

export function domesticProbeSubscriptions(symbol: string): WsSubscription[] {
  return [
    { trId: KIS_TR.domesticOrderBook, trKey: symbol },
    { trId: KIS_TR.domesticTrade, trKey: symbol },
  ];
}

export function nxtDomesticProbeSubscriptions(
  symbol: string,
): WsSubscription[] {
  return [
    { trId: KIS_TR.domesticNxtOrderBook, trKey: symbol },
    { trId: KIS_TR.domesticNxtTrade, trKey: symbol },
    { trId: KIS_TR.domesticNxtMarketStatus, trKey: symbol },
  ];
}

export function unifiedDomesticProbeSubscriptions(
  symbol: string,
): WsSubscription[] {
  return [
    { trId: KIS_TR.domesticUnifiedOrderBook, trKey: symbol },
    { trId: KIS_TR.domesticUnifiedTrade, trKey: symbol },
  ];
}

export function usProbeSubscriptions(
  exchange: "NAS" | "NYS" | "AMS",
  symbol: string,
  canonicalVenue?: WsSubscription["canonicalVenue"],
): WsSubscription[] {
  const trKey = buildUsRegularTrKey(exchange, symbol);
  return [
    {
      trId: KIS_TR.usOrderBook,
      trKey,
      ...(canonicalVenue ? { canonicalVenue } : {}),
    },
    {
      trId: KIS_TR.usTrade,
      trKey,
      ...(canonicalVenue ? { canonicalVenue } : {}),
    },
  ];
}
