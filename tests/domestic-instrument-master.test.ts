import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KisDomesticInstrumentMaster,
  parseDomesticInstrumentMaster,
  searchDomesticInstrumentRecords,
} from "../src/kis/domestic-instrument-master.js";
import { isSearchableDomesticInstrumentQuery } from "../apps/desktop/src/shared/desktop-contracts.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function masterLine(
  symbol: string,
  standardCode: string,
  name: string,
  trailerWidth: number,
): string {
  return `${symbol.padEnd(9)}${standardCode.padEnd(12)}${name}${" ".repeat(
    trailerWidth,
  )}\n`;
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function cp949MasterLine(
  symbol: string,
  standardCode: string,
  nameBytes: Uint8Array,
  trailerWidth: number,
): Uint8Array {
  return concatBytes(
    new TextEncoder().encode(
      `${symbol.padEnd(9)}${standardCode.padEnd(12)}`,
    ),
    nameBytes,
    new TextEncoder().encode(`${" ".repeat(trailerWidth)}\n`),
  );
}

function zippedMaster(fileName: string, bytes: Uint8Array): Uint8Array {
  return zipSync({
    [fileName]: bytes,
  });
}

describe("KIS domestic instrument master", () => {
  it("uses the same complete-Hangul and code query policy at the IPC boundary", () => {
    expect(isSearchableDomesticInstrumentQuery("삼")).toBe(true);
    expect(isSearchableDomesticInstrumentQuery("0")).toBe(true);
    expect(isSearchableDomesticInstrumentQuery("ㅅ")).toBe(false);
    expect(isSearchableDomesticInstrumentQuery("S")).toBe(false);
  });

  it("parses fixed-width identity fields without leaking trailer data", () => {
    const items = parseDomesticInstrumentMaster(
      masterLine("005930", "KR7005930003", "삼성전자", 228),
      { market: "KOSPI", trailerWidth: 228 },
    );
    expect(items).toEqual([
      {
        instrumentId: "KRX:005930",
        symbol: "005930",
        standardCode: "KR7005930003",
        name: "삼성전자",
        market: "KOSPI",
      },
    ]);
  });

  it("ranks exact codes and names before prefix and substring matches", () => {
    const items = [
      {
        instrumentId: "KRX:005930",
        symbol: "005930",
        standardCode: "KR7005930003",
        name: "삼성전자",
        market: "KOSPI" as const,
      },
      {
        instrumentId: "KRX:009150",
        symbol: "009150",
        standardCode: "KR7009150004",
        name: "삼성전기",
        market: "KOSPI" as const,
      },
    ];
    expect(
      searchDomesticInstrumentRecords(items, "005930").map(
        (item) => item.symbol,
      ),
    ).toEqual(["005930"]);
    expect(
      searchDomesticInstrumentRecords(items, "삼성전").map(
        (item) => item.symbol,
      ),
    ).toEqual(["005930", "009150"]);
    expect(
      searchDomesticInstrumentRecords(items, "삼").map((item) => item.symbol),
    ).toEqual(["005930", "009150"]);
    expect(searchDomesticInstrumentRecords(items, "ㅅ")).toEqual([]);
  });

  it("downloads official KOSPI and KOSDAQ archives once and reuses local cache", async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "paperflow-master-"));
    temporaryDirectories.push(userDataPath);
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      const kosdaq = value.includes("kosdaq");
      const body = kosdaq
        ? zippedMaster(
            "kosdaq_code.mst",
            cp949MasterLine(
              "247540",
              "KR7247540008",
              new TextEncoder().encode("ECOPRO BM"),
              222,
            ),
          )
        : zippedMaster(
            "kospi_code.mst",
            concatBytes(
              cp949MasterLine(
                "005930",
                "KR7005930003",
                // Anonymous raw CP949 fixture for "삼성전자".
                new Uint8Array([
                  0xbb, 0xef, 0xbc, 0xba, 0xc0, 0xfc, 0xc0, 0xda,
                ]),
                228,
              ),
              cp949MasterLine(
                "000660",
                "KR7000660001",
                new TextEncoder().encode("SK HYNIX"),
                228,
              ),
            ),
          );
      return new Response(body, {
        status: 200,
        headers: { "content-length": String(body.byteLength) },
      });
    });
    const master = new KisDomesticInstrumentMaster({
      userDataPath,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minimumRecordsPerMarket: 1,
    });

    await expect(master.search("삼")).resolves.toMatchObject({
      source: "KIS_MASTER",
      stale: false,
      items: [{ symbol: "005930", name: "삼성전자", market: "KOSPI" }],
    });
    await expect(master.search("247540")).resolves.toMatchObject({
      source: "CACHED_KIS_MASTER",
      stale: false,
      items: [{ symbol: "247540", market: "KOSDAQ" }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a partial market archive instead of caching incomplete coverage", async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "paperflow-master-"));
    temporaryDirectories.push(userDataPath);
    const master = new KisDomesticInstrumentMaster({
      userDataPath,
      minimumRecordsPerMarket: 1,
      fetchImpl: vi.fn(async (url: string | URL | Request) => {
        const kosdaq = String(url).includes("kosdaq");
        const body = zippedMaster(
          kosdaq ? "kosdaq_code.mst" : "kospi_code.mst",
          kosdaq
            ? new TextEncoder().encode("invalid\n")
            : cp949MasterLine(
                "005930",
                "KR7005930003",
                new Uint8Array([
                  0xbb, 0xef, 0xbc, 0xba, 0xc0, 0xfc, 0xc0, 0xda,
                ]),
                228,
              ),
        );
        return new Response(body, { status: 200 });
      }) as unknown as typeof fetch,
    });

    await expect(master.search("삼")).rejects.toThrow(/coverage is incomplete/);
    expect(
      existsSync(join(userDataPath, "instrument-master-v1.json")),
    ).toBe(false);
  });

  it("falls back to a stale validated cache when refresh is unavailable", async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "paperflow-master-"));
    temporaryDirectories.push(userDataPath);
    const cachePath = join(userDataPath, "instrument-master-v1.json");
    writeFileSync(
      cachePath,
      JSON.stringify({
        schemaVersion: 1,
        fetchedAt: "2026-01-01T00:00:00.000Z",
        items: [
          {
            instrumentId: "KRX:005930",
            symbol: "005930",
            standardCode: "KR7005930003",
            name: "삼성전자",
            market: "KOSPI",
          },
          {
            instrumentId: "KRX:247540",
            symbol: "247540",
            standardCode: "KR7247540008",
            name: "에코프로비엠",
            market: "KOSDAQ",
          },
        ],
      }),
    );
    const master = new KisDomesticInstrumentMaster({
      userDataPath,
      fetchImpl: vi.fn(async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
      minimumRecordsPerMarket: 1,
    });

    await expect(master.search("삼성전자")).resolves.toMatchObject({
      source: "CACHED_KIS_MASTER",
      stale: true,
      items: [{ symbol: "005930" }],
    });
    expect(JSON.parse(readFileSync(cachePath, "utf8")).schemaVersion).toBe(1);
  });
});
