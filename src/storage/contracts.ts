import { z } from "zod";

import {
  PaperExecutionPlanSchema,
  PaperOrderCommandSchema,
  PaperOrderStatusSchema,
} from "../contracts/paper-order.js";

export const IdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "Expected a stable local identifier");

export const CurrencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Expected an ISO-style three-letter currency code");

export const MinorUnitsTextSchema = z
  .string()
  .regex(
    /^(?:0|[1-9]\d*|-[1-9]\d*)$/,
    "Expected exact signed integer minor units",
  );

export const NonNegativeMinorUnitsTextSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)$/, "Expected exact non-negative integer minor units");

export const SignedIntegerTextSchema = MinorUnitsTextSchema;

export const PositiveIntegerTextSchema = z
  .string()
  .regex(/^[1-9]\d*$/, "Expected an exact positive integer");

export const SafeStorageReferenceSchema = z
  .string()
  .min(16)
  .max(512)
  .regex(
    /^safe-storage:[A-Za-z0-9._:/-]+$/,
    "Expected an opaque safeStorage reference, never a credential value",
  );

export const SimulationAccountInputSchema = z.object({
  id: IdentifierSchema,
  displayName: z.string().trim().min(1).max(100),
  baseCurrency: CurrencySchema,
  initialCashMinor: NonNegativeMinorUnitsTextSchema,
  initialLedgerEntryId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  occurredAt: z.string().datetime({ offset: true }),
});

export const CashLedgerEntryInputSchema = z.object({
  id: IdentifierSchema,
  accountId: IdentifierSchema,
  currency: CurrencySchema,
  amountMinor: MinorUnitsTextSchema,
  entryType: z.enum([
    "INITIAL_FUNDING",
    "MANUAL_ADJUSTMENT",
    "TRADE_PRINCIPAL",
    "FEE",
    "TAX",
    "FX_DEBIT",
    "FX_CREDIT",
  ]),
  idempotencyKey: IdentifierSchema,
  referenceId: IdentifierSchema.optional(),
  occurredAt: z.string().datetime({ offset: true }),
});

export const ProviderProfileInputSchema = z.object({
  id: IdentifierSchema,
  provider: z.enum(["KIS", "TOSS"]),
  environment: z.enum(["PAPER", "PRODUCTION"]),
  displayName: z.string().trim().min(1).max(100),
  safeStorageRef: SafeStorageReferenceSchema,
  enabled: z.boolean().default(true),
});

export const PaperPersistenceCommitInputSchema = z
  .object({
    commitId: IdentifierSchema,
    order: PaperOrderCommandSchema,
    execution: PaperExecutionPlanSchema,
    reservedCashMinor: NonNegativeMinorUnitsTextSchema,
    cashLedgerEntries: z.array(CashLedgerEntryInputSchema),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .superRefine((input, context) => {
    const { execution, order } = input;
    if (execution.clientOrderId !== order.clientOrderId) {
      context.addIssue({
        code: "custom",
        path: ["execution", "clientOrderId"],
        message: "execution and order clientOrderId must match",
      });
    }

    const entries = input.cashLedgerEntries;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry === undefined) continue;
      if (entry.accountId !== order.accountId) {
        context.addIssue({
          code: "custom",
          path: ["cashLedgerEntries", index, "accountId"],
          message: "ledger account must match the paper order account",
        });
      }
      if (entry.currency !== order.currency) {
        context.addIssue({
          code: "custom",
          path: ["cashLedgerEntries", index, "currency"],
          message: "ledger currency must match the paper order currency",
        });
      }
      if (!["TRADE_PRINCIPAL", "FEE", "TAX"].includes(entry.entryType)) {
        context.addIssue({
          code: "custom",
          path: ["cashLedgerEntries", index, "entryType"],
          message:
            "paper execution accepts principal, fee and tax entries only",
        });
      }
      const amount = BigInt(entry.amountMinor);
      if (
        entry.entryType === "TRADE_PRINCIPAL" &&
        ((order.side === "BUY" && amount >= 0n) ||
          (order.side === "SELL" && amount <= 0n))
      ) {
        context.addIssue({
          code: "custom",
          path: ["cashLedgerEntries", index, "amountMinor"],
          message: "trade principal sign must match the paper order side",
        });
      }
      if (
        (entry.entryType === "FEE" || entry.entryType === "TAX") &&
        amount > 0n
      ) {
        context.addIssue({
          code: "custom",
          path: ["cashLedgerEntries", index, "amountMinor"],
          message: "fee and tax entries cannot credit cash",
        });
      }
    }

    const hasNewFills = BigInt(execution.newlyFilledQuantity) > 0n;
    if (
      hasNewFills &&
      !entries.some((entry) => entry.entryType === "TRADE_PRINCIPAL")
    ) {
      context.addIssue({
        code: "custom",
        path: ["cashLedgerEntries"],
        message: "a filled execution requires a trade principal ledger entry",
      });
    }
    if (!hasNewFills && entries.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["cashLedgerEntries"],
        message: "an execution without new fills cannot change cash",
      });
    }

    const isOpen = ["ACCEPTED", "RESTING", "PARTIALLY_FILLED"].includes(
      execution.status,
    );
    if (
      order.side === "BUY" &&
      isOpen &&
      BigInt(input.reservedCashMinor) === 0n
    ) {
      context.addIssue({
        code: "custom",
        path: ["reservedCashMinor"],
        message: "an open BUY order requires a positive cash reservation",
      });
    }
    if ((order.side === "SELL" || !isOpen) && input.reservedCashMinor !== "0") {
      context.addIssue({
        code: "custom",
        path: ["reservedCashMinor"],
        message: "only an open BUY order may reserve cash",
      });
    }
  });

export type Currency = z.infer<typeof CurrencySchema>;
export type MinorUnitsText = z.infer<typeof MinorUnitsTextSchema>;
export type SimulationAccountInput = z.infer<
  typeof SimulationAccountInputSchema
>;
export type CashLedgerEntryInput = z.infer<typeof CashLedgerEntryInputSchema>;
export type ProviderProfileInput = z.infer<typeof ProviderProfileInputSchema>;
export type PaperPersistenceCommitInput = z.infer<
  typeof PaperPersistenceCommitInputSchema
>;

export const PaperMarketEventClaimSchema = z.object({
  accountId: IdentifierSchema,
  instrumentId: z.string().min(1).max(128),
  sessionKey: z.string().min(1).max(128),
  sequence: z.string().regex(/^(?:0|[1-9]\d*)$/),
  marketEventId: IdentifierSchema,
  observedAt: z.string().datetime({ offset: true }),
});

export type PaperMarketEventClaim = z.infer<
  typeof PaperMarketEventClaimSchema
>;

export type PaperMarketEventClaimResult =
  | "ACCEPTED"
  | "DUPLICATE"
  | "OUT_OF_ORDER";

export interface StoredPaperOrder {
  readonly accountId: string;
  readonly clientOrderId: string;
  readonly instrumentId: string;
  readonly venue: string;
  readonly currency: Currency;
  readonly side: "BUY" | "SELL";
  readonly orderType: "MARKET" | "LIMIT";
  readonly quantity: string;
  readonly limitPrice: string | null;
  readonly timeInForce: "DAY";
  readonly session: "REGULAR";
  readonly submissionMode: "CONFIRM_TICKET" | "ONE_CLICK_ARMED";
  readonly status: z.infer<typeof PaperOrderStatusSchema>;
  readonly filledQuantity: string;
  readonly remainingQuantity: string;
  readonly cancelledQuantity: string;
  readonly reservedCashMinor: MinorUnitsText;
  readonly submittedAt: string;
  readonly updatedAt: string;
  readonly simulationOnly: true;
}

export interface PaperFillMarker {
  readonly fillId: string;
  readonly clientOrderId: string;
  readonly instrumentId: string;
  readonly side: "BUY" | "SELL";
  readonly price: string;
  readonly quantity: string;
  readonly marketEventId: string;
  readonly occurredAt: string;
  readonly partial: boolean;
  readonly simulationOnly: true;
}

export interface PaperPosition {
  readonly accountId: string;
  readonly instrumentId: string;
  readonly venue: string;
  readonly currency: Currency;
  readonly quantity: string;
  readonly reservedSellQuantity: string;
  readonly availableQuantity: string;
  readonly updatedAt: string;
}

export interface PaperAccountSummary {
  readonly accountId: string;
  readonly displayName: string;
  readonly baseCurrency: Currency;
  readonly cashBalances: ReadonlyArray<{
    readonly currency: Currency;
    readonly balanceMinor: MinorUnitsText;
    readonly reservedMinor: MinorUnitsText;
    readonly availableMinor: MinorUnitsText;
  }>;
  readonly positions: readonly PaperPosition[];
  readonly openOrderCount: number;
  readonly fillCount: number;
}

export interface PaperCommitResult {
  readonly idempotent: boolean;
  readonly order: StoredPaperOrder;
}

export function minorUnitsToBigInt(value: MinorUnitsText): bigint {
  return BigInt(MinorUnitsTextSchema.parse(value));
}

export function bigIntToMinorUnits(value: bigint): MinorUnitsText {
  return MinorUnitsTextSchema.parse(value.toString());
}

export const InformationProviderSchema = z.enum([
  "KIS_DOMESTIC_NEWS",
  "KIS_OVERSEAS_NEWS",
  "SEC_EDGAR",
  "OPEN_DART",
]);

export const InformationItemInputSchema = z.object({
  id: IdentifierSchema,
  provider: InformationProviderSchema,
  providerItemId: z.string().min(1).max(256),
  kind: z.enum(["NEWS", "DISCLOSURE"]),
  titleOriginal: z.string().trim().min(1).max(2_000),
  sourceName: z.string().trim().min(1).max(200),
  sourceLanguage: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/),
  publishedAt: z.string().datetime({ offset: true }),
  publishedAtPrecision: z.enum(["SECOND", "DATE"]),
  obtainedAt: z.string().datetime({ offset: true }),
  canonicalUrl: z.string().url().optional(),
  rights: z.enum(["KIS_HEADLINE_ONLY", "PUBLIC_FILING"]),
  relatedInstrumentIds: z.array(z.string().min(1).max(128)).max(20),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const InformationTranslationInputSchema = z.object({
  id: IdentifierSchema,
  informationItemId: IdentifierSchema,
  locale: z.literal("ko-KR"),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  translatedTitle: z.string().trim().min(1).max(2_000),
  translatedSummary: z.string().trim().max(10_000).optional(),
  translationProvider: z.string().trim().min(1).max(100),
  modelVersion: z.string().trim().min(1).max(100),
  status: z.enum(["COMPLETE", "PARTIAL", "STALE"]),
  generatedAt: z.string().datetime({ offset: true }),
});

export type InformationProvider = z.infer<typeof InformationProviderSchema>;
export type InformationItemInput = z.infer<typeof InformationItemInputSchema>;
export type InformationTranslationInput = z.infer<
  typeof InformationTranslationInputSchema
>;

export interface StoredInformationItem {
  readonly id: string;
  readonly provider: InformationProvider;
  readonly providerItemId: string;
  readonly kind: "NEWS" | "DISCLOSURE";
  readonly titleOriginal: string;
  readonly translatedTitle: string | null;
  readonly translatedSummary: string | null;
  readonly sourceName: string;
  readonly sourceLanguage: string;
  readonly publishedAt: string;
  readonly publishedAtPrecision: "SECOND" | "DATE";
  readonly obtainedAt: string;
  readonly canonicalUrl: string | null;
  readonly rights: "KIS_HEADLINE_ONLY" | "PUBLIC_FILING";
  readonly relatedInstrumentIds: readonly string[];
  readonly payloadHash: string;
}
