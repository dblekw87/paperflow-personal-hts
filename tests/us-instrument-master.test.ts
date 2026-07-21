import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

import {
  KisUsInstrumentMaster,
  parseUsInstrumentMaster,
  searchUsInstrumentRecords,
} from "../src/kis/us-instrument-master.js";

const fixture = readFileSync(new URL("./fixtures/kis/us-master-sample.cod", import.meta.url), "utf8");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("KIS US instrument master", () => {
  it("parses the anonymized tab-separated contract and searches Korean, English and ticker text", () => {
    const items = parseUsInstrumentMaster(fixture, "NASDAQ");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      instrumentId: "NASDAQ:AAPL", symbol: "AAPL", name: "애플",
      englishName: "Apple Inc", market: "NASDAQ", securityType: "STOCK",
    });
    expect(searchUsInstrumentRecords(items, "애플")[0]?.symbol).toBe("AAPL");
    expect(searchUsInstrumentRecords(items, "apple")[0]?.symbol).toBe("AAPL");
    expect(searchUsInstrumentRecords(items, "QQQ")[0]).toMatchObject({ securityType: "ETF" });
  });

  it("downloads NASDAQ, NYSE and AMEX archives once then serves the validated cache", async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "us-master-"));
    temporaryDirectories.push(userDataPath);
    let calls = 0;
    const asciiFixture = fixture.replace("애플", "Apple Korea").replace("인베스코 QQQ", "Invesco QQQ");
    const fetchImpl: typeof fetch = async (input) => {
      calls += 1;
      const url = String(input);
      const code = /\/(nas|nys|ams)mst\.cod\.zip$/.exec(url)?.[1];
      if (!code) throw new Error("unexpected URL");
      const archive = zipSync({ [`${code}mst.cod`]: new TextEncoder().encode(asciiFixture) });
      return new Response(archive, { status: 200, headers: { "content-type": "application/zip" } });
    };
    const master = new KisUsInstrumentMaster({ userDataPath, fetchImpl, minimumRecordsPerMarket: 1 });
    const first = await master.search("Apple");
    const second = await master.search("QQQ");
    expect(first.source).toBe("KIS_MASTER");
    expect(first.items).toHaveLength(3);
    expect(second.source).toBe("CACHED_KIS_MASTER");
    expect(calls).toBe(3);
  });
});
