import type Database from "better-sqlite3";

import {
  InformationItemInputSchema,
  InformationProviderSchema,
  InformationTranslationInputSchema,
  type InformationItemInput,
  type InformationProvider,
  type InformationTranslationInput,
  type StoredInformationItem,
} from "./contracts.js";

interface InformationRow {
  id: string;
  provider: string;
  provider_item_id: string;
  kind: "NEWS" | "DISCLOSURE";
  title_original: string;
  translated_title: string | null;
  translated_summary: string | null;
  source_name: string;
  source_language: string;
  published_at: string;
  published_at_precision: "SECOND" | "DATE";
  obtained_at: string;
  canonical_url: string | null;
  rights: "KIS_HEADLINE_ONLY" | "PUBLIC_FILING";
  related_instruments_json: string;
  payload_hash: string;
}

export class LocalInformationRepository {
  readonly #database: Database.Database;
  readonly #now: () => string;

  constructor(
    database: Database.Database,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.#database = database;
    this.#now = now;
  }

  ingest(itemInput: InformationItemInput): boolean {
    const item = InformationItemInputSchema.parse(itemInput);
    const result = this.#database
      .prepare(
        `INSERT OR IGNORE INTO information_items(
          id, provider, provider_item_id, kind, title_original, source_name,
          source_language, published_at, published_at_precision, obtained_at,
          canonical_url, rights, related_instruments_json, payload_hash,
          created_at
        ) VALUES (
          @id, @provider, @providerItemId, @kind, @titleOriginal, @sourceName,
          @sourceLanguage, @publishedAt, @publishedAtPrecision, @obtainedAt,
          @canonicalUrl, @rights, @relatedInstrumentsJson, @payloadHash,
          @createdAt
        )`,
      )
      .run({
        ...item,
        canonicalUrl: item.canonicalUrl ?? null,
        relatedInstrumentsJson: JSON.stringify(item.relatedInstrumentIds),
        createdAt: this.#now(),
      });
    return result.changes === 1;
  }

  addTranslation(input: InformationTranslationInput): boolean {
    const translation = InformationTranslationInputSchema.parse(input);
    const source = this.#database
      .prepare(
        "SELECT payload_hash FROM information_items WHERE id = ? LIMIT 1",
      )
      .get(translation.informationItemId) as
      | { payload_hash: string }
      | undefined;
    if (source === undefined) {
      throw new Error("Translation source information item does not exist");
    }
    if (source.payload_hash !== translation.inputHash) {
      throw new Error("Translation input hash does not match source payload");
    }
    const result = this.#database
      .prepare(
        `INSERT OR IGNORE INTO information_translation_versions(
          id, information_item_id, locale, input_hash, translated_title,
          translated_summary, translation_provider, model_version, status,
          generated_at, created_at
        ) VALUES (
          @id, @informationItemId, @locale, @inputHash, @translatedTitle,
          @translatedSummary, @translationProvider, @modelVersion, @status,
          @generatedAt, @createdAt
        )`,
      )
      .run({
        ...translation,
        translatedSummary: translation.translatedSummary ?? null,
        createdAt: this.#now(),
      });
    return result.changes === 1;
  }

  listRecent(options?: {
    kind?: "NEWS" | "DISCLOSURE";
    limit?: number;
  }): StoredInformationItem[] {
    const limit = Math.max(1, Math.min(options?.limit ?? 100, 500));
    const kind = options?.kind;
    const rows = this.#database
      .prepare(
        `SELECT
          item.id,
          item.provider,
          item.provider_item_id,
          item.kind,
          item.title_original,
          (
            SELECT translated_title
            FROM information_translation_versions translation
            WHERE translation.information_item_id = item.id
              AND translation.locale = 'ko-KR'
              AND translation.status IN ('COMPLETE', 'PARTIAL')
              AND translation.input_hash = item.payload_hash
            ORDER BY translation.generated_at DESC, translation.id DESC
            LIMIT 1
          ) AS translated_title,
          (
            SELECT translated_summary
            FROM information_translation_versions translation
            WHERE translation.information_item_id = item.id
              AND translation.locale = 'ko-KR'
              AND translation.status IN ('COMPLETE', 'PARTIAL')
              AND translation.input_hash = item.payload_hash
            ORDER BY translation.generated_at DESC, translation.id DESC
            LIMIT 1
          ) AS translated_summary,
          item.source_name,
          item.source_language,
          item.published_at,
          item.published_at_precision,
          item.obtained_at,
          item.canonical_url,
          item.rights,
          item.related_instruments_json,
          item.payload_hash
        FROM information_items item
        WHERE (@kind IS NULL OR item.kind = @kind)
        ORDER BY item.published_at DESC, item.id DESC
        LIMIT @limit`,
      )
      .all({ kind: kind ?? null, limit }) as InformationRow[];
    return rows.map((row) => this.#toStored(row));
  }

  saveCheckpoint(
    providerInput: InformationProvider,
    cursor: Readonly<Record<string, unknown>>,
    lastSuccessAt: string,
  ): void {
    const provider = InformationProviderSchema.parse(providerInput);
    const cursorJson = JSON.stringify(cursor);
    JSON.parse(cursorJson);
    this.#database
      .prepare(
        `INSERT INTO information_poll_checkpoints(
          provider, cursor_json, last_success_at, updated_at
        ) VALUES (@provider, @cursorJson, @lastSuccessAt, @updatedAt)
        ON CONFLICT(provider) DO UPDATE SET
          cursor_json = excluded.cursor_json,
          last_success_at = excluded.last_success_at,
          updated_at = excluded.updated_at`,
      )
      .run({
        provider,
        cursorJson,
        lastSuccessAt,
        updatedAt: this.#now(),
      });
  }

  #toStored(row: InformationRow): StoredInformationItem {
    const instruments = JSON.parse(row.related_instruments_json) as unknown;
    if (
      !Array.isArray(instruments) ||
      !instruments.every((value) => typeof value === "string")
    ) {
      throw new Error("Invalid related instrument projection in SQLite");
    }
    return {
      id: row.id,
      provider: InformationProviderSchema.parse(row.provider),
      providerItemId: row.provider_item_id,
      kind: row.kind,
      titleOriginal: row.title_original,
      translatedTitle: row.translated_title,
      translatedSummary: row.translated_summary,
      sourceName: row.source_name,
      sourceLanguage: row.source_language,
      publishedAt: row.published_at,
      publishedAtPrecision: row.published_at_precision,
      obtainedAt: row.obtained_at,
      canonicalUrl: row.canonical_url,
      rights: row.rights,
      relatedInstrumentIds: instruments,
      payloadHash: row.payload_hash,
    };
  }
}
