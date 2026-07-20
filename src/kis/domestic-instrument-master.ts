import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { unzipSync } from "fflate";

export type DomesticInstrumentMarket = "KOSPI" | "KOSDAQ";
export type DomesticSecurityType = "STOCK" | "ETF" | "ETN" | "OTHER";

export interface DomesticInstrumentRecord {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly standardCode: string;
  readonly name: string;
  readonly market: DomesticInstrumentMarket;
  readonly securityType: DomesticSecurityType;
}

export interface DomesticInstrumentSearchResult {
  readonly items: readonly DomesticInstrumentRecord[];
  readonly source: "KIS_MASTER" | "CACHED_KIS_MASTER";
  readonly fetchedAt: string;
  readonly stale: boolean;
}

interface MasterDescriptor {
  readonly market: DomesticInstrumentMarket;
  readonly trailerWidth: number;
  readonly url: string;
  readonly fileName: string;
}

interface CachedMaster {
  readonly schemaVersion: 2;
  readonly fetchedAt: string;
  readonly items: readonly DomesticInstrumentRecord[];
}

const MASTER_DESCRIPTORS: readonly MasterDescriptor[] = [
  {
    market: "KOSPI",
    trailerWidth: 228,
    url: "https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip",
    fileName: "kospi_code.mst",
  },
  {
    market: "KOSDAQ",
    trailerWidth: 222,
    url: "https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip",
    fileName: "kosdaq_code.mst",
  },
];

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_ARCHIVE_BYTES = 10 * 1_024 * 1_024;
const MAX_MASTER_BYTES = 30 * 1_024 * 1_024;
const MAX_MASTER_ITEMS = 10_000;

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s._-]+/g, "");
}

export function isSearchableDomesticInstrumentQuery(value: string): boolean {
  const query = value.trim().normalize("NFKC");
  if (query.length === 0 || query.length > 40) return false;
  if (/[\u1100-\u11ff\u3130-\u318f]/u.test(query)) return false;
  if (query.length === 1 && !/[\uac00-\ud7a30-9]/u.test(query)) return false;
  return true;
}

function isDomesticInstrumentRecord(
  value: unknown,
): value is DomesticInstrumentRecord {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item["instrumentId"] === "string" &&
    /^KRX:[0-9A-Z]{6,7}$/.test(item["instrumentId"]) &&
    typeof item["symbol"] === "string" &&
    /^[0-9A-Z]{6,7}$/.test(item["symbol"]) &&
    item["instrumentId"] === `KRX:${item["symbol"]}` &&
    typeof item["standardCode"] === "string" &&
    item["standardCode"].length > 0 &&
    item["standardCode"].length <= 20 &&
    typeof item["name"] === "string" &&
    item["name"].length > 0 &&
    item["name"].length <= 120 &&
    !/[\u0000-\u001f\u007f\ufffd]/u.test(item["name"]) &&
    (item["market"] === "KOSPI" || item["market"] === "KOSDAQ")
    && ["STOCK", "ETF", "ETN", "OTHER"].includes(String(item["securityType"]))
  );
}

function readCache(path: string): CachedMaster | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof value !== "object" || value === null) return null;
    const cache = value as Record<string, unknown>;
    if (
      cache["schemaVersion"] !== 2 ||
      typeof cache["fetchedAt"] !== "string" ||
      !Number.isFinite(Date.parse(cache["fetchedAt"])) ||
      !Array.isArray(cache["items"]) ||
      cache["items"].length === 0 ||
      cache["items"].length > MAX_MASTER_ITEMS ||
      !cache["items"].every(isDomesticInstrumentRecord)
    ) {
      return null;
    }
    return cache as unknown as CachedMaster;
  } catch {
    return null;
  }
}

function writeCache(path: string, cache: CachedMaster): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(cache), {
    encoding: "utf8",
    mode: 0o600,
  });
  rmSync(path, { force: true });
  renameSync(temporaryPath, path);
}

async function readBoundedResponse(response: Response): Promise<Uint8Array> {
  const advertisedLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(advertisedLength) &&
    advertisedLength > MAX_ARCHIVE_BYTES
  ) {
    throw new Error("KIS instrument master archive is too large");
  }
  if (!response.body) {
    throw new Error("KIS instrument master response has no body");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_ARCHIVE_BYTES) {
      await reader.cancel();
      throw new Error("KIS instrument master archive exceeded the size limit");
    }
    chunks.push(part.value);
  }
  const archive = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    archive.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return archive;
}

export function parseDomesticInstrumentMaster(
  text: string,
  descriptor: Pick<MasterDescriptor, "market" | "trailerWidth">,
): readonly DomesticInstrumentRecord[] {
  const items: DomesticInstrumentRecord[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, "");
    if (line.length <= 21 + descriptor.trailerWidth) continue;
    const identityLength = line.length - descriptor.trailerWidth;
    const symbol = line.slice(0, 9).trim();
    const standardCode = line.slice(9, 21).trim();
    const name = line.slice(21, identityLength).trim();
    const securityGroupCode = line
      .slice(identityLength, identityLength + 2)
      .trim()
      .toLocaleUpperCase("en-US");
    const securityType: DomesticSecurityType =
      securityGroupCode === "ST"
        ? "STOCK"
        : securityGroupCode === "EF"
          ? "ETF"
          : securityGroupCode === "EN"
            ? "ETN"
            : "OTHER";
    if (
      !/^[0-9A-Z]{6,7}$/.test(symbol) ||
      standardCode.length === 0 ||
      name.length === 0 ||
      /[\u0000-\u001f\u007f\ufffd]/u.test(name)
    ) {
      continue;
    }
    items.push({
      instrumentId: `KRX:${symbol}`,
      symbol,
      standardCode,
      name,
      market: descriptor.market,
      securityType,
    });
  }
  return items;
}

function rankSearchItem(
  item: DomesticInstrumentRecord,
  query: string,
  normalizedQuery: string,
): number | null {
  const normalizedName = normalizeSearchText(item.name);
  const normalizedSymbol = normalizeSearchText(item.symbol);
  if (item.symbol === query) return 0;
  if (normalizedName === normalizedQuery) return 1;
  if (normalizedSymbol.startsWith(normalizedQuery)) return 2;
  if (normalizedName.startsWith(normalizedQuery)) return 3;
  if (normalizedName.includes(normalizedQuery)) return 4;
  if (normalizedSymbol.includes(normalizedQuery)) return 5;
  return null;
}

export function searchDomesticInstrumentRecords(
  items: readonly DomesticInstrumentRecord[],
  rawQuery: string,
  limit = 20,
): readonly DomesticInstrumentRecord[] {
  const query = rawQuery.trim().toLocaleUpperCase("ko-KR");
  const normalizedQuery = normalizeSearchText(query);
  if (
    !isSearchableDomesticInstrumentQuery(rawQuery) ||
    normalizedQuery.length === 0 ||
    normalizedQuery.length > 40 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    return [];
  }
  return items
    .map((item, index) => ({
      item,
      index,
      rank: rankSearchItem(item, query, normalizedQuery),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        readonly item: DomesticInstrumentRecord;
        readonly index: number;
        readonly rank: number;
      } => candidate.rank !== null,
    )
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.index - right.index,
    )
    .slice(0, limit)
    .map(({ item }) => item);
}

export class KisDomesticInstrumentMaster {
  readonly #cachePath: string;
  readonly #fetch: typeof fetch;
  readonly #minimumRecordsPerMarket: number;
  #loaded: CachedMaster | null = null;
  #loading: Promise<{
    readonly cache: CachedMaster;
    readonly source: "KIS_MASTER" | "CACHED_KIS_MASTER";
    readonly stale: boolean;
  }> | null = null;

  public constructor(options: {
    readonly userDataPath: string;
    readonly fetchImpl?: typeof fetch;
    readonly minimumRecordsPerMarket?: number;
  }) {
    this.#cachePath = join(options.userDataPath, "instrument-master-v2.json");
    this.#fetch = options.fetchImpl ?? fetch;
    this.#minimumRecordsPerMarket = options.minimumRecordsPerMarket ?? 500;
    if (
      !Number.isInteger(this.#minimumRecordsPerMarket) ||
      this.#minimumRecordsPerMarket < 1 ||
      this.#minimumRecordsPerMarket > 5_000
    ) {
      throw new TypeError("Invalid instrument master minimum coverage");
    }
  }

  public async search(
    rawQuery: string,
    limit = 20,
  ): Promise<DomesticInstrumentSearchResult> {
    if (
      typeof rawQuery !== "string" ||
      !isSearchableDomesticInstrumentQuery(rawQuery)
    ) {
      throw new TypeError("Expected a domestic instrument search query");
    }
    const loaded = await this.#load();
    return {
      items: searchDomesticInstrumentRecords(
        loaded.cache.items,
        rawQuery,
        limit,
      ),
      source: loaded.source,
      fetchedAt: loaded.cache.fetchedAt,
      stale: loaded.stale,
    };
  }

  async #load(): Promise<{
    readonly cache: CachedMaster;
    readonly source: "KIS_MASTER" | "CACHED_KIS_MASTER";
    readonly stale: boolean;
  }> {
    if (this.#loading) return this.#loading;
    this.#loading = this.#loadOnce();
    try {
      return await this.#loading;
    } finally {
      this.#loading = null;
    }
  }

  async #loadOnce(): Promise<{
    readonly cache: CachedMaster;
    readonly source: "KIS_MASTER" | "CACHED_KIS_MASTER";
    readonly stale: boolean;
  }> {
    const candidate = this.#loaded ?? readCache(this.#cachePath);
    const cached =
      candidate !== null && this.#hasMinimumCoverage(candidate.items)
        ? candidate
        : null;
    this.#loaded = cached;
    const cacheAge =
      cached === null ? Number.POSITIVE_INFINITY : Date.now() - Date.parse(cached.fetchedAt);
    if (cached !== null && cacheAge <= CACHE_MAX_AGE_MS) {
      return { cache: cached, source: "CACHED_KIS_MASTER", stale: false };
    }
    try {
      const groups = await Promise.all(
        MASTER_DESCRIPTORS.map((descriptor) => this.#download(descriptor)),
      );
      const deduplicated = new Map<string, DomesticInstrumentRecord>();
      for (const item of groups.flat()) deduplicated.set(item.instrumentId, item);
      if (
        deduplicated.size === 0 ||
        deduplicated.size > MAX_MASTER_ITEMS
      ) {
        throw new Error("KIS instrument master item count is invalid");
      }
      const fresh: CachedMaster = {
        schemaVersion: 2,
        fetchedAt: new Date().toISOString(),
        items: [...deduplicated.values()],
      };
      writeCache(this.#cachePath, fresh);
      this.#loaded = fresh;
      return { cache: fresh, source: "KIS_MASTER", stale: false };
    } catch (error) {
      if (cached !== null) {
        return { cache: cached, source: "CACHED_KIS_MASTER", stale: true };
      }
      throw error;
    }
  }

  async #download(
    descriptor: MasterDescriptor,
  ): Promise<readonly DomesticInstrumentRecord[]> {
    const response = await this.#fetch(descriptor.url, {
      headers: { Accept: "application/zip, application/octet-stream" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const finalUrl = new URL(response.url || descriptor.url);
    if (
      finalUrl.protocol !== "https:" ||
      finalUrl.hostname !== "new.real.download.dws.co.kr" ||
      finalUrl.username !== "" ||
      finalUrl.password !== "" ||
      finalUrl.port !== ""
    ) {
      throw new Error("KIS instrument master redirected to an unsafe origin");
    }
    if (!response.ok) {
      throw new Error(`KIS instrument master request failed (${response.status})`);
    }
    const archive = await readBoundedResponse(response);
    const extracted = unzipSync(archive, {
      filter: (file) =>
        file.name.toLocaleLowerCase("en-US") ===
          descriptor.fileName.toLocaleLowerCase("en-US") &&
        file.originalSize > 0 &&
        file.originalSize <= MAX_MASTER_BYTES,
    });
    const entry = Object.entries(extracted).find(
      ([name]) =>
        name.toLocaleLowerCase("en-US") ===
        descriptor.fileName.toLocaleLowerCase("en-US"),
    )?.[1];
    if (!entry || entry.byteLength === 0 || entry.byteLength > MAX_MASTER_BYTES) {
      throw new Error("KIS instrument master archive is missing its data file");
    }
    const text = new TextDecoder("euc-kr", { fatal: true }).decode(entry);
    const items = parseDomesticInstrumentMaster(text, descriptor);
    if (items.length < this.#minimumRecordsPerMarket) {
      throw new Error(
        `KIS ${descriptor.market} instrument master coverage is incomplete`,
      );
    }
    return items;
  }

  #hasMinimumCoverage(
    items: readonly DomesticInstrumentRecord[],
  ): boolean {
    const counts: Record<DomesticInstrumentMarket, number> = {
      KOSPI: 0,
      KOSDAQ: 0,
    };
    for (const item of items) counts[item.market] += 1;
    return MASTER_DESCRIPTORS.every(
      ({ market }) => counts[market] >= this.#minimumRecordsPerMarket,
    );
  }
}
