import type Database from "better-sqlite3";

import {
  bigIntToMinorUnits,
  CashLedgerEntryInputSchema,
  type CashLedgerEntryInput,
  type Currency,
  type MinorUnitsText,
  ProviderProfileInputSchema,
  type ProviderProfileInput,
  SimulationAccountInputSchema,
  type SimulationAccountInput,
} from "./contracts.js";

interface LedgerAmountRow {
  readonly amount_minor: string;
}

export class LocalSimulationRepository {
  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public createAccount(input: SimulationAccountInput): void {
    const parsed = SimulationAccountInputSchema.parse(input);
    const create = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO simulation_accounts(
             id, display_name, base_currency, status, created_at
           ) VALUES (?, ?, ?, 'ACTIVE', ?)`,
        )
        .run(parsed.id, parsed.displayName, parsed.baseCurrency, this.now());

      this.insertLedgerEntry({
        id: parsed.initialLedgerEntryId,
        accountId: parsed.id,
        currency: parsed.baseCurrency,
        amountMinor: parsed.initialCashMinor,
        entryType: "INITIAL_FUNDING",
        idempotencyKey: parsed.idempotencyKey,
        occurredAt: parsed.occurredAt,
      });
    });
    create.immediate();
  }

  public appendCashLedgerEntry(input: CashLedgerEntryInput): void {
    this.insertLedgerEntry(CashLedgerEntryInputSchema.parse(input));
  }

  public getCashBalance(accountId: string, currency: Currency): MinorUnitsText {
    const rows = this.database
      .prepare(
        `SELECT amount_minor
           FROM cash_ledger
          WHERE account_id = ? AND currency = ?
          ORDER BY occurred_at, id`,
      )
      .all(accountId, currency) as LedgerAmountRow[];
    const balance = rows.reduce(
      (sum, row) => sum + BigInt(row.amount_minor),
      0n,
    );
    return bigIntToMinorUnits(balance);
  }

  public listCashLedger(accountId: string): CashLedgerEntryInput[] {
    const rows = this.database
      .prepare(
        `SELECT id, account_id, currency, amount_minor, entry_type,
                idempotency_key, reference_id, occurred_at
           FROM cash_ledger
          WHERE account_id = ?
          ORDER BY occurred_at, id`,
      )
      .all(accountId) as Array<Record<string, unknown>>;

    return rows.map((row) =>
      CashLedgerEntryInputSchema.parse({
        id: row.id,
        accountId: row.account_id,
        currency: row.currency,
        amountMinor: row.amount_minor,
        entryType: row.entry_type,
        idempotencyKey: row.idempotency_key,
        ...(row.reference_id === null ? {} : { referenceId: row.reference_id }),
        occurredAt: row.occurred_at,
      }),
    );
  }

  public saveProviderProfile(input: ProviderProfileInput): void {
    const parsed = ProviderProfileInputSchema.parse(input);
    const timestamp = this.now();
    this.database
      .prepare(
        `INSERT INTO provider_profiles(
           id, provider, environment, display_name, safe_storage_ref,
           enabled, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           provider = excluded.provider,
           environment = excluded.environment,
           display_name = excluded.display_name,
           safe_storage_ref = excluded.safe_storage_ref,
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`,
      )
      .run(
        parsed.id,
        parsed.provider,
        parsed.environment,
        parsed.displayName,
        parsed.safeStorageRef,
        parsed.enabled ? 1 : 0,
        timestamp,
        timestamp,
      );
  }

  private insertLedgerEntry(input: CashLedgerEntryInput): void {
    const parsed = CashLedgerEntryInputSchema.parse(input);
    this.database
      .prepare(
        `INSERT INTO cash_ledger(
           id, account_id, currency, amount_minor, entry_type,
           idempotency_key, reference_id, occurred_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.id,
        parsed.accountId,
        parsed.currency,
        parsed.amountMinor,
        parsed.entryType,
        parsed.idempotencyKey,
        parsed.referenceId ?? null,
        parsed.occurredAt,
        this.now(),
      );
  }
}
