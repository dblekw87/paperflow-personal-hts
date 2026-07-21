import { EventEmitter } from "node:events";

import WebSocket from "ws";

import { describe, expect, it } from "vitest";

import { KIS_TR } from "../src/kis/endpoints.js";
import {
  DomesticKisLiveStream,
  type DomesticLiveStreamOptions,
} from "../src/kis/ws/live-stream.js";
import { SYNTHETIC_FIXTURES } from "../src/testkit/synthetic-fixtures.js";

interface SubscriptionRequest {
  header: {
    approval_key: string;
    tr_type: "1" | "2";
  };
  body: {
    input: {
      tr_id: string;
      tr_key: string;
    };
  };
}

class FakeWebSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING;
  readonly sent: string[] = [];
  readonly pongs: Buffer[] = [];
  onSend: ((request: SubscriptionRequest) => void) | null = null;

  open(): void {
    if (this.readyState !== WebSocket.CONNECTING) {
      return;
    }
    this.readyState = WebSocket.OPEN;
    this.emit("open");
  }

  send(raw: string): void {
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error("fake socket is not open");
    }
    this.sent.push(raw);
    this.onSend?.(JSON.parse(raw) as SubscriptionRequest);
  }

  deliver(raw: string): void {
    if (this.readyState === WebSocket.OPEN) {
      this.emit("message", Buffer.from(raw, "utf8"));
    }
  }

  pong(raw: Buffer): void {
    this.pongs.push(raw);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === WebSocket.CLOSED) {
      return;
    }
    this.readyState = WebSocket.CLOSING;
    queueMicrotask(() => {
      this.readyState = WebSocket.CLOSED;
      this.emit("close", code, Buffer.from(reason, "utf8"));
    });
  }

  terminate(): void {
    this.close(1006, "");
  }

  asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }
}

function acknowledgement(
  trId: string,
  trKey: string,
  success = true,
  message = "SUBSCRIBE SUCCESS",
): string {
  return JSON.stringify({
    header: { tr_id: trId, tr_key: trKey, encrypt: "N" },
    body: { rt_cd: success ? "0" : "1", msg1: message },
  });
}

function installPositiveAcknowledgements(
  socket: FakeWebSocket,
  afterBoth?: () => void,
): void {
  let count = 0;
  socket.onSend = (request) => {
    if (request.header.tr_type !== "1") {
      return;
    }
    const { tr_id: trId, tr_key: trKey } = request.body.input;
    socket.deliver(acknowledgement(trId, trKey));
    count += 1;
    if (count === 2) {
      queueMicrotask(() => afterBoth?.());
    }
  };
}

function createOptions(
  socketFactory: NonNullable<DomesticLiveStreamOptions["socketFactory"]>,
  overrides: Partial<DomesticLiveStreamOptions> = {},
): DomesticLiveStreamOptions {
  return {
    environment: "paper",
    approvalKey: "approval-secret-must-not-leak",
    symbol: "005930",
    socketFactory,
    reconnect: {
      maxAttempts: 2,
      baseDelayMs: 1,
      maxDelayMs: 2,
      jitterRatio: 0,
    },
    ...overrides,
  };
}

async function eventually(
  predicate: () => boolean,
  timeoutMs = 750,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for fake WebSocket state");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
}

describe("DomesticKisLiveStream", () => {
  it("subscribes to US one-level book and trade channels and publishes a USD three-session projection", async () => {
    const events: unknown[] = [];
    const socket = new FakeWebSocket();
    installPositiveAcknowledgements(socket, () => {
      socket.deliver(SYNTHETIC_FIXTURES.usOrderBook);
      socket.deliver(SYNTHETIC_FIXTURES.usTrade);
    });
    const stream = new DomesticKisLiveStream(
      createOptions(() => socket.asWebSocket(), {
        environment: "prod",
        symbol: "AAPL",
        venue: "NASDAQ",
        providerExchange: "NAS",
        now: () => new Date("2026-07-20T14:15:30.000Z"),
        onEvent: (event) => events.push(event),
      }),
    );

    const started = stream.start();
    queueMicrotask(() => socket.open());
    await started;
    await eventually(() => events.length === 2);

    expect(stream.getProjection()).toMatchObject({
      instrumentId: "NASDAQ:AAPL",
      connectionStatus: "live",
      freshness: "live",
      coverage: "complete",
      acknowledged: { orderBook: true, trade: true },
      orderBook: {
        venue: "NASDAQ",
        bids: [{ price: "250.120", quantity: "100" }],
        asks: [{ price: "250.130", quantity: "90" }],
      },
      trade: { venue: "NASDAQ", price: "250.125", session: "REGULAR" },
    });
    const subscriptions = socket.sent.map((raw) =>
      (JSON.parse(raw) as SubscriptionRequest).body.input,
    );
    expect(subscriptions).toContainEqual({ tr_id: KIS_TR.usOrderBook, tr_key: "DNASAAPL" });
    expect(subscriptions).toContainEqual({ tr_id: KIS_TR.usTrade, tr_key: "DNASAAPL" });
    await stream.stop();
  });

  it("requires positive ACKs and publishes a frozen combined canonical projection", async () => {
    const events: unknown[] = [];
    const projections: unknown[] = [];
    const socket = new FakeWebSocket();
    installPositiveAcknowledgements(socket, () => {
      socket.deliver(SYNTHETIC_FIXTURES.domesticOrderBook);
      socket.deliver(SYNTHETIC_FIXTURES.domesticTrade);
    });

    const stream = new DomesticKisLiveStream(
      createOptions(() => socket.asWebSocket(), {
        onEvent: (event) => events.push(event),
        onProjection: (projection) => projections.push(projection),
      }),
    );
    const firstStart = stream.start();
    const secondStart = stream.start();
    queueMicrotask(() => socket.open());
    await Promise.all([firstStart, secondStart]);
    await eventually(() => events.length === 2);

    const projection = stream.getProjection();
    expect(projection).toMatchObject({
      instrumentId: "KRX:005930",
      connectionStatus: "live",
      freshness: "live",
      coverage: "complete",
      acknowledged: { orderBook: true, trade: true },
      trade: {
        price: "80000",
        quantity: "10",
        executionStrength: "109.00",
      },
    });
    expect(projection.orderBook?.asks[0]).toEqual({
      price: "80100",
      quantity: "120",
    });
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.orderBook?.asks)).toBe(true);
    expect(events).toEqual([
      expect.objectContaining({ kind: "ORDER_BOOK" }),
      expect.objectContaining({ kind: "TRADE" }),
    ]);
    expect(projections.length).toBeGreaterThan(0);
    expect(JSON.stringify({ projection, events, projections })).not.toContain(
      "approval-secret-must-not-leak",
    );
    expect(
      socket.sent.filter(
        (raw) =>
          (JSON.parse(raw) as SubscriptionRequest).header.tr_type === "1",
      ),
    ).toHaveLength(2);

    await stream.stop();
    await stream.stop();
  });

  it("rejects negative ACKs without exposing provider messages or approval keys", async () => {
    const errors: unknown[] = [];
    const socket = new FakeWebSocket();
    socket.onSend = (request) => {
      if (request.header.tr_type !== "1") {
        return;
      }
      socket.deliver(
        acknowledgement(
          request.body.input.tr_id,
          request.body.input.tr_key,
          false,
          "provider echoed approval-secret-must-not-leak",
        ),
      );
    };
    const stream = new DomesticKisLiveStream(
      createOptions(() => socket.asWebSocket(), {
        onError: (error) => errors.push(error),
      }),
    );
    const started = stream.start();
    queueMicrotask(() => socket.open());

    await expect(started).rejects.toMatchObject({
      code: "KIS_WS_SUBSCRIPTION_REJECTED",
      retryable: false,
    });
    expect(stream.getProjection()).toMatchObject({
      connectionStatus: "failed",
      freshness: "offline",
      lastError: {
        code: "KIS_WS_SUBSCRIPTION_REJECTED",
        retryable: false,
      },
    });
    expect(
      JSON.stringify({
        projection: stream.getProjection(),
        errors,
      }),
    ).not.toContain("approval-secret-must-not-leak");
    expect(JSON.stringify(errors)).not.toContain("provider echoed");
  });

  it("fails closed when a normalized frame belongs to another instrument", async () => {
    const events: unknown[] = [];
    const errors: unknown[] = [];
    const socket = new FakeWebSocket();
    installPositiveAcknowledgements(socket, () => {
      socket.deliver(
        SYNTHETIC_FIXTURES.domesticTrade.replace(
          "|001|005930^",
          "|001|000660^",
        ),
      );
    });
    const stream = new DomesticKisLiveStream(
      createOptions(() => socket.asWebSocket(), {
        onEvent: (event) => events.push(event),
        onError: (error) => errors.push(error),
      }),
    );
    const started = stream.start();
    queueMicrotask(() => socket.open());
    await started;
    await eventually(
      () => stream.getProjection().connectionStatus === "failed",
    );

    expect(events).toEqual([]);
    expect(stream.getProjection()).toMatchObject({
      instrumentId: "KRX:005930",
      connectionStatus: "failed",
      coverage: "empty",
      lastError: {
        code: "KIS_WS_UNEXPECTED_INSTRUMENT",
        retryable: false,
      },
    });
    expect(errors).toContainEqual({
      code: "KIS_WS_UNEXPECTED_INSTRUMENT",
      retryable: false,
    });
  });

  it("answers PINGPONG, reconnects with injected jitter, then never reconnects after stop", async () => {
    const sockets: FakeWebSocket[] = [];
    const stream = new DomesticKisLiveStream(
      createOptions(
        () => {
          const socket = new FakeWebSocket();
          const socketIndex = sockets.length;
          sockets.push(socket);
          installPositiveAcknowledgements(socket, () => {
            if (socketIndex === 0) {
              socket.deliver(JSON.stringify({ header: { tr_id: "PINGPONG" } }));
            } else {
              socket.deliver(SYNTHETIC_FIXTURES.domesticTrade);
            }
          });
          queueMicrotask(() => socket.open());
          return socket.asWebSocket();
        },
        {
          random: () => 0.5,
        },
      ),
    );

    await stream.start();
    await eventually(() => sockets[0]?.pongs.length === 1);
    sockets[0]?.close(1011, "upstream failure");
    await eventually(() => sockets.length === 2);
    await eventually(() => stream.getProjection().trade?.price === "80000");

    expect(stream.getProjection()).toMatchObject({
      connectionStatus: "live",
      freshness: "live",
      reconnectCount: 1,
      generation: 2,
    });
    await stream.stop();
    await stream.stop();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(sockets).toHaveLength(2);
  });

  it("keeps the previous book stale after reconnect ACK until a new frame arrives", async () => {
    const sockets: FakeWebSocket[] = [];
    const stream = new DomesticKisLiveStream(
      createOptions(() => {
        const socket = new FakeWebSocket();
        const socketIndex = sockets.length;
        sockets.push(socket);
        installPositiveAcknowledgements(socket, () => {
          if (socketIndex === 0) {
            socket.deliver(SYNTHETIC_FIXTURES.domesticOrderBook);
            socket.deliver(SYNTHETIC_FIXTURES.domesticTrade);
          }
        });
        queueMicrotask(() => socket.open());
        return socket.asWebSocket();
      }),
    );

    await stream.start();
    await eventually(() => stream.getProjection().coverage === "complete");
    sockets[0]?.close(1011, "upstream failure");
    await eventually(() => sockets.length === 2);
    await eventually(
      () =>
        stream.getProjection().acknowledged.orderBook &&
        stream.getProjection().acknowledged.trade,
    );

    const reconnected = stream.getProjection();
    expect(reconnected).toMatchObject({
      connectionStatus: "live",
      freshness: "stale",
    });
    expect(reconnected.orderBook?.asks[0]).toEqual({
      price: "80100",
      quantity: "120",
    });
    expect(reconnected.orderBook?.asks).toHaveLength(10);

    sockets[1]?.deliver(SYNTHETIC_FIXTURES.domesticTrade);
    await eventually(() => stream.getProjection().freshness === "live");
    await stream.stop();
  });

  it("bounds consecutive reconnects and marks an aged projection stale", async () => {
    const sockets: FakeWebSocket[] = [];
    const stream = new DomesticKisLiveStream(
      createOptions(
        () => {
          const socket = new FakeWebSocket();
          sockets.push(socket);
          installPositiveAcknowledgements(socket, () => {
            socket.deliver(SYNTHETIC_FIXTURES.domesticTrade);
            queueMicrotask(() => socket.close(1011, "repeat failure"));
          });
          queueMicrotask(() => socket.open());
          return socket.asWebSocket();
        },
        {
          staleAfterMs: 5,
        },
      ),
    );

    await stream.start();
    await eventually(
      () => stream.getProjection().connectionStatus === "failed",
    );

    expect(sockets).toHaveLength(3);
    expect(stream.getProjection()).toMatchObject({
      connectionStatus: "failed",
      freshness: "stale",
      coverage: "partial",
      reconnectCount: 2,
      generation: 3,
      lastError: {
        code: "KIS_WS_RECONNECT_EXHAUSTED",
        retryable: false,
      },
    });
  });

  it("marks connected but aged data stale and bounds a missing handshake", async () => {
    const liveSocket = new FakeWebSocket();
    installPositiveAcknowledgements(liveSocket, () => {
      liveSocket.deliver(SYNTHETIC_FIXTURES.domesticTrade);
    });
    const liveStream = new DomesticKisLiveStream(
      createOptions(() => liveSocket.asWebSocket(), {
        staleAfterMs: 5,
      }),
    );
    const liveStarted = liveStream.start();
    queueMicrotask(() => liveSocket.open());
    await liveStarted;
    await eventually(() => liveStream.getProjection().freshness === "stale");
    expect(liveStream.getProjection()).toMatchObject({
      connectionStatus: "live",
      freshness: "stale",
      coverage: "partial",
    });
    await liveStream.stop();

    const errors: unknown[] = [];
    const hangingSocket = new FakeWebSocket();
    const hangingStream = new DomesticKisLiveStream(
      createOptions(() => hangingSocket.asWebSocket(), {
        handshakeTimeoutMs: 5,
        onError: (error) => errors.push(error),
        reconnect: {
          maxAttempts: 0,
          baseDelayMs: 0,
          maxDelayMs: 0,
          jitterRatio: 0,
        },
      }),
    );
    await expect(hangingStream.start()).rejects.toMatchObject({
      code: "KIS_WS_RECONNECT_EXHAUSTED",
      retryable: false,
    });
    expect(errors).toContainEqual({
      code: "KIS_WS_SUBSCRIPTION_ACK_TIMEOUT",
      retryable: true,
    });
  });

  it("does not publish data that arrives before its channel ACK", async () => {
    const events: unknown[] = [];
    const sockets: FakeWebSocket[] = [];
    const stream = new DomesticKisLiveStream(
      createOptions(
        () => {
          const socket = new FakeWebSocket();
          sockets.push(socket);
          socket.onSend = (request) => {
            if (
              request.header.tr_type === "1" &&
              request.body.input.tr_id === KIS_TR.domesticOrderBook
            ) {
              socket.deliver(SYNTHETIC_FIXTURES.domesticTrade);
            }
          };
          queueMicrotask(() => socket.open());
          return socket.asWebSocket();
        },
        {
          onEvent: (event) => events.push(event),
          reconnect: {
            maxAttempts: 0,
            baseDelayMs: 0,
            maxDelayMs: 0,
            jitterRatio: 0,
          },
        },
      ),
    );

    const started = stream.start();
    await expect(started).rejects.toMatchObject({
      code: "KIS_WS_RECONNECT_EXHAUSTED",
    });
    expect(events).toEqual([]);
    expect(stream.getProjection().coverage).toBe("empty");
  });
});
