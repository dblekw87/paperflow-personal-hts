import { z } from "zod";

const itemSchema = z.object({
  id: z.number().int(),
  category: z.string().catch("company"),
  datetime: z.number().int().nonnegative(),
  headline: z.string().min(1),
  related: z.string().catch(""),
  source: z.string().min(1),
  summary: z.string().catch(""),
  url: z.string().url(),
});

export interface FinnhubNewsItem {
  readonly providerItemId: string;
  readonly title: string;
  readonly summary: string | null;
  readonly sourceName: string;
  readonly publishedAt: string;
  readonly canonicalUrl: string;
  readonly relatedTickers: readonly string[];
}

export class FinnhubNewsClient {
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(options: { apiKey: string; fetchImpl?: typeof fetch }) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async getCompanyNews(symbol: string, now = new Date()): Promise<readonly FinnhubNewsItem[]> {
    if (!/^[A-Z0-9.-]{1,20}$/.test(symbol)) throw new Error("FINNHUB_INVALID_SYMBOL");
    const to = now.toISOString().slice(0, 10);
    const from = new Date(now.getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
    const url = new URL("https://finnhub.io/api/v1/company-news");
    url.search = new URLSearchParams({ symbol, from, to, token: this.#apiKey }).toString();
    const response = await this.#fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`FINNHUB_HTTP_${response.status}`);
    const parsed = z.array(itemSchema).safeParse(await response.json());
    if (!parsed.success) throw new Error("FINNHUB_SCHEMA_MISMATCH");
    return parsed.data.map((item) => ({
      providerItemId: String(item.id),
      title: item.headline,
      summary: item.summary.trim() || null,
      sourceName: item.source,
      publishedAt: new Date(item.datetime * 1000).toISOString(),
      canonicalUrl: item.url,
      relatedTickers: item.related.split(",").map((value) => value.trim()).filter(Boolean),
    }));
  }
}
