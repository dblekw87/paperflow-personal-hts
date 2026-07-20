import WebSocket, { WebSocketServer } from "ws";

import { describe, expect, it } from "vitest";

import { KIS_TR } from "../src/kis/endpoints.js";
import {
  buildSubscriptionMessage,
  buildUsRegularTrKey,
  domesticProbeSubscriptions,
  nxtDomesticProbeSubscriptions,
  runWsProbe,
  validateProbeDataFrame,
} from "../src/kis/ws/client.js";
import { parseKisWsFrame } from "../src/kis/ws/frame.js";
import { PINNED_PROTOCOL_VECTORS } from "../src/testkit/pinned-protocol-vectors.js";

describe("KIS WebSocket subscription contracts", () => {
  it("uses executable helper values 1 for subscribe and 2 for unsubscribe", () => {
    const subscription = {
      trId: KIS_TR.domesticTrade,
      trKey: "005930",
    } as const;
    const subscribe = JSON.parse(
      buildSubscriptionMessage("approval", subscription, "1"),
    ) as Record<string, unknown>;
    const unsubscribe = JSON.parse(
      buildSubscriptionMessage("approval", subscription, "2"),
    ) as Record<string, unknown>;

    expect(subscribe).toMatchObject({
      header: {
        "content-type": "utf-8",
        approval_key: "approval",
        tr_type: "1",
        custtype: "P",
      },
      body: { input: { tr_id: "H0STCNT0", tr_key: "005930" } },
    });
    expect(unsubscribe).toMatchObject({
      header: { tr_type: "2" },
    });
  });

  it("builds the official regular-session US key shape", () => {
    expect(buildUsRegularTrKey("NAS", "AAPL")).toBe("DNASAAPL");
    expect(buildUsRegularTrKey("NYS", "BRK.B")).toBe("DNYSBRK.B");
    expect(() => buildUsRegularTrKey("NAS", "AAPL<script>")).toThrow();
  });

  it("registers NXT book, trade and market-status as separate read-only channels", () => {
    expect(nxtDomesticProbeSubscriptions("005930")).toEqual([
      { trId: "H0NXASP0", trKey: "005930" },
      { trId: "H0NXCNT0", trKey: "005930" },
      { trId: "H0NXMKO0", trKey: "005930" },
    ]);
  });

  it("counts only canonical records for the requested instrument", () => {
    const parsed = parseKisWsFrame(PINNED_PROTOCOL_VECTORS.domesticTrade.raw);
    expect(parsed.kind).toBe("DATA");
    if (parsed.kind !== "DATA") {
      throw new Error("Expected a data frame");
    }

    expect(
      validateProbeDataFrame(parsed, domesticProbeSubscriptions("005930")),
    ).toBe(1);
    expect(() =>
      validateProbeDataFrame(parsed, domesticProbeSubscriptions("000660")),
    ).toThrow(/unrequested or ambiguous instrument/);

    const invalidNumeric = parseKisWsFrame(
      PINNED_PROTOCOL_VECTORS.domesticTrade.raw.replace(
        "^80000^",
        "^NOT_A_PRICE^",
      ),
    );
    expect(invalidNumeric.kind).toBe("DATA");
    if (invalidNumeric.kind !== "DATA") {
      throw new Error("Expected a data frame");
    }
    expect(() =>
      validateProbeDataFrame(
        invalidNumeric,
        domesticProbeSubscriptions("005930"),
      ),
    ).toThrow();
  });

  it("tracks positive and negative subscription acknowledgements without partial success", async () => {
    const server = await startServer((socket, message) => {
      const request = JSON.parse(message) as {
        header: { tr_type: string };
        body: { input: { tr_id: string; tr_key: string } };
      };
      if (request.header.tr_type !== "1") {
        return;
      }
      const { tr_id: trId, tr_key: trKey } = request.body.input;
      const accepted = trId === KIS_TR.domesticOrderBook;
      socket.send(
        JSON.stringify({
          header: { tr_id: trId, tr_key: trKey, encrypt: "N" },
          body: {
            rt_cd: accepted ? "0" : "1",
            msg1: accepted ? "SUBSCRIBE SUCCESS" : "SUBSCRIBE REJECTED",
          },
        }),
      );
      if (accepted) {
        socket.send(PINNED_PROTOCOL_VECTORS.domesticOrderBook.raw);
      }
    });

    try {
      const result = await runWsProbe({
        environment: "paper",
        approvalKey: "approval",
        subscriptions: domesticProbeSubscriptions("005930"),
        durationSeconds: 1,
        socketFactory: () => new WebSocket(server.url),
      });

      expect(result.receivedRecords).toBe(1);
      expect(result.acknowledgedSubscriptions).toEqual([
        { trId: KIS_TR.domesticOrderBook, trKey: "005930" },
      ]);
      expect(result.failedSubscriptions).toContainEqual(
        expect.objectContaining({
          trId: KIS_TR.domesticTrade,
          trKey: "005930",
          message: "SUBSCRIBE REJECTED",
        }),
      );
      expect(result.parseErrors).toContainEqual(
        expect.objectContaining({ code: "KIS_WS_SUBSCRIPTION_REJECTED" }),
      );
    } finally {
      await server.close();
    }
  });

  it("records an unexpected close even after every subscription was acknowledged", async () => {
    let acknowledgementCount = 0;
    const server = await startServer((socket, message) => {
      const request = JSON.parse(message) as {
        header: { tr_type: string };
        body: { input: { tr_id: string; tr_key: string } };
      };
      if (request.header.tr_type !== "1") {
        return;
      }
      const { tr_id: trId, tr_key: trKey } = request.body.input;
      socket.send(
        JSON.stringify({
          header: { tr_id: trId, tr_key: trKey, encrypt: "N" },
          body: { rt_cd: "0", msg1: "SUBSCRIBE SUCCESS" },
        }),
      );
      acknowledgementCount += 1;
      if (acknowledgementCount === 2) {
        socket.close(1011, "upstream failure");
      }
    });

    try {
      const result = await runWsProbe({
        environment: "paper",
        approvalKey: "approval",
        subscriptions: domesticProbeSubscriptions("005930"),
        durationSeconds: 1,
        socketFactory: () => new WebSocket(server.url),
      });

      expect(result.completedNormally).toBe(false);
      expect(result.closeCode).toBe(1011);
      expect(result.parseErrors).toContainEqual(
        expect.objectContaining({ code: "KIS_WS_UNEXPECTED_CLOSE" }),
      );
    } finally {
      await server.close();
    }
  });
});

async function startServer(
  onMessage: (socket: WebSocket, message: string) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  server.on("connection", (socket) => {
    socket.on("message", (data) => onMessage(socket, data.toString("utf8")));
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new Error("Expected an ephemeral TCP address");
  }

  return {
    url: `ws://127.0.0.1:${address.port}`,
    close: async () => {
      for (const client of server.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
