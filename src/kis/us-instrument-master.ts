import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { unzipSync } from "fflate";

export type UsInstrumentMarket = "NASDAQ" | "NYSE" | "AMEX";
export type UsSecurityType = "STOCK" | "ETF" | "ETN" | "OTHER";

export interface UsInstrumentRecord {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly standardCode: string;
  readonly name: string;
  readonly englishName: string;
  readonly market: UsInstrumentMarket;
  readonly securityType: UsSecurityType;
}

interface Descriptor {
  readonly code: "nas" | "nys" | "ams";
  readonly market: UsInstrumentMarket;
}

interface Cache {
  readonly schemaVersion: 1;
  readonly fetchedAt: string;
  readonly items: readonly UsInstrumentRecord[];
}

const DESCRIPTORS: readonly Descriptor[] = [
  { code: "nas", market: "NASDAQ" },
  { code: "nys", market: "NYSE" },
  { code: "ams", market: "AMEX" },
];
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_ARCHIVE_BYTES = 20 * 1_024 * 1_024;
const MAX_MASTER_BYTES = 50 * 1_024 * 1_024;
const MAX_ITEMS = 50_000;

export function isSearchableUsInstrumentQuery(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const query = value.trim().normalize("NFKC");
  if (query.length < 1 || query.length > 40) return false;
  return !/[\u0000-\u001f\u007f]/u.test(query);
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[\s._-]+/g, "");
}

function validRecord(value: unknown): value is UsInstrumentRecord {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item["symbol"] === "string" && /^[A-Z0-9.-]{1,20}$/.test(item["symbol"]) &&
    typeof item["market"] === "string" && ["NASDAQ", "NYSE", "AMEX"].includes(item["market"]) &&
    item["instrumentId"] === `${item["market"]}:${item["symbol"]}` &&
    typeof item["standardCode"] === "string" && item["standardCode"].length > 0 && item["standardCode"].length <= 20 &&
    typeof item["name"] === "string" && item["name"].length > 0 && item["name"].length <= 160 &&
    typeof item["englishName"] === "string" && item["englishName"].length > 0 && item["englishName"].length <= 160 &&
    ["STOCK", "ETF", "ETN", "OTHER"].includes(String(item["securityType"]))
  );
}

export function parseUsInstrumentMaster(text: string, market: UsInstrumentMarket): readonly UsInstrumentRecord[] {
  const items: UsInstrumentRecord[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const fields = rawLine.replace(/\r$/, "").split("\t");
    if (fields.length < 24) continue;
    const symbol = (fields[4] ?? "").trim().toLocaleUpperCase("en-US");
    const realtimeSymbol = (fields[5] ?? "").trim();
    const koreanName = (fields[6] ?? "").trim();
    const englishName = (fields[7] ?? "").trim();
    const securityCode = (fields[8] ?? "").trim();
    const etpCode = (fields[22] ?? "").trim();
    if (!/^[A-Z0-9.-]{1,20}$/.test(symbol) || englishName.length === 0) continue;
    const securityType: UsSecurityType = securityCode === "2"
      ? "STOCK"
      : securityCode === "3"
        ? etpCode === "002" ? "ETN" : "ETF"
        : "OTHER";
    items.push({
      instrumentId: `${market}:${symbol}`,
      symbol,
      standardCode: realtimeSymbol || symbol,
      name: koreanName || englishName,
      englishName,
      market,
      securityType,
    });
  }
  return items;
}

export function searchUsInstrumentRecords(items: readonly UsInstrumentRecord[], rawQuery: string, limit = 20): readonly UsInstrumentRecord[] {
  if (!isSearchableUsInstrumentQuery(rawQuery) || !Number.isInteger(limit) || limit < 1 || limit > 50) return [];
  const exact = rawQuery.trim().toLocaleUpperCase("en-US");
  const query = normalize(rawQuery);
  return items.map((item, index) => {
    const symbol = normalize(item.symbol);
    const korean = normalize(item.name);
    const english = normalize(item.englishName);
    const rank = item.symbol === exact ? 0
      : korean === query || english === query ? 1
      : symbol.startsWith(query) ? 2
      : korean.startsWith(query) || english.startsWith(query) ? 3
      : korean.includes(query) || english.includes(query) ? 4
      : symbol.includes(query) ? 5 : null;
    return { item, index, rank };
  }).filter((candidate): candidate is { item: UsInstrumentRecord; index: number; rank: number } => candidate.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit).map(({ item }) => item);
}

function readCache(path: string): Cache | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<Cache>;
    return value.schemaVersion === 1 && typeof value.fetchedAt === "string" && Number.isFinite(Date.parse(value.fetchedAt)) &&
      Array.isArray(value.items) && value.items.length > 0 && value.items.length <= MAX_ITEMS && value.items.every(validRecord)
      ? value as Cache : null;
  } catch { return null; }
}

function writeCache(path: string, cache: Cache): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(cache), { encoding: "utf8", mode: 0o600 });
  rmSync(path, { force: true });
  renameSync(temporary, path);
}

async function boundedResponse(response: Response): Promise<Uint8Array> {
  if (!response.body) throw new Error("KIS US master response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_ARCHIVE_BYTES) { await reader.cancel(); throw new Error("KIS US master archive is too large"); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export class KisUsInstrumentMaster {
  readonly #cachePath: string;
  readonly #fetch: typeof fetch;
  readonly #minimumRecordsPerMarket: number;
  #loaded: Cache | null = null;
  #loading: Promise<{ cache: Cache; source: "KIS_MASTER" | "CACHED_KIS_MASTER"; stale: boolean }> | null = null;

  constructor(options: { userDataPath: string; fetchImpl?: typeof fetch; minimumRecordsPerMarket?: number }) {
    this.#cachePath = join(options.userDataPath, "us-instrument-master-v1.json");
    this.#fetch = options.fetchImpl ?? fetch;
    this.#minimumRecordsPerMarket = options.minimumRecordsPerMarket ?? 100;
  }

  async search(query: string, limit = 20) {
    if (!isSearchableUsInstrumentQuery(query)) throw new TypeError("Expected a US instrument search query");
    const loaded = await this.#load();
    return { items: searchUsInstrumentRecords(loaded.cache.items, query, limit), source: loaded.source, fetchedAt: loaded.cache.fetchedAt, stale: loaded.stale } as const;
  }

  async #load() {
    if (this.#loading) return this.#loading;
    this.#loading = this.#loadOnce();
    try { return await this.#loading; } finally { this.#loading = null; }
  }

  async #loadOnce() {
    const candidate = this.#loaded ?? readCache(this.#cachePath);
    const cached = candidate !== null && this.#hasCoverage(candidate.items) ? candidate : null;
    this.#loaded = cached;
    if (cached !== null && Date.now() - Date.parse(cached.fetchedAt) <= CACHE_MAX_AGE_MS) {
      return { cache: cached, source: "CACHED_KIS_MASTER" as const, stale: false };
    }
    try {
      const groups = await Promise.all(DESCRIPTORS.map((descriptor) => this.#download(descriptor)));
      const deduplicated = new Map<string, UsInstrumentRecord>();
      for (const item of groups.flat()) deduplicated.set(item.instrumentId, item);
      if (deduplicated.size === 0 || deduplicated.size > MAX_ITEMS) throw new Error("KIS US master item count is invalid");
      const fresh: Cache = { schemaVersion: 1, fetchedAt: new Date().toISOString(), items: [...deduplicated.values()] };
      writeCache(this.#cachePath, fresh); this.#loaded = fresh;
      return { cache: fresh, source: "KIS_MASTER" as const, stale: false };
    } catch (error) {
      if (cached !== null) return { cache: cached, source: "CACHED_KIS_MASTER" as const, stale: true };
      throw error;
    }
  }

  async #download(descriptor: Descriptor): Promise<readonly UsInstrumentRecord[]> {
    const fileName = `${descriptor.code}mst.cod`;
    const url = `https://new.real.download.dws.co.kr/common/master/${fileName}.zip`;
    const response = await this.#fetch(url, { headers: { Accept: "application/zip, application/octet-stream" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    const finalUrl = new URL(response.url || url);
    if (finalUrl.protocol !== "https:" || finalUrl.hostname !== "new.real.download.dws.co.kr" || finalUrl.username || finalUrl.password || finalUrl.port) throw new Error("KIS US master redirected to an unsafe origin");
    if (!response.ok) throw new Error(`KIS US master request failed (${response.status})`);
    const extracted = unzipSync(await boundedResponse(response), { filter: (file) => file.name.toLowerCase() === fileName && file.originalSize > 0 && file.originalSize <= MAX_MASTER_BYTES });
    const entry = Object.entries(extracted).find(([name]) => name.toLowerCase() === fileName)?.[1];
    if (!entry || entry.byteLength === 0 || entry.byteLength > MAX_MASTER_BYTES) throw new Error("KIS US master archive is missing its data file");
    const items = parseUsInstrumentMaster(new TextDecoder("euc-kr", { fatal: true }).decode(entry), descriptor.market);
    if (items.length < this.#minimumRecordsPerMarket) throw new Error(`KIS ${descriptor.market} master coverage is incomplete`);
    return items;
  }

  #hasCoverage(items: readonly UsInstrumentRecord[]): boolean {
    return DESCRIPTORS.every(({ market }) => items.filter((item) => item.market === market).length >= this.#minimumRecordsPerMarket);
  }
}
