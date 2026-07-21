import { z } from "zod";

import {
  DecimalStringSchema,
  InstrumentIdSchema,
  UtcInstantSchema,
} from "./scalars.js";

export const MarketCalendarRegionSchema = z.enum(["KR", "US", "GLOBAL"]);

export const MarketCalendarProviderSchema = z.enum([
  "OPEN_DART",
  "KIND_KRX",
  "KSD_RIGHTS_SCHEDULE",
  "KIS_NEWS_HEADLINE",
  "SEC_EDGAR",
  "NASDAQ_DAILY_LIST",
  "NYSE_CORPORATE_ACTIONS",
  "NASDAQ_TRADER",
  "US_FEDERAL_RESERVE",
  "US_BLS",
  "US_BEA",
  "US_EIA",
  "US_TREASURY",
  "BOK_ECOS",
  "KOSIS",
  "KOREA_MOEF",
  "KRX_DERIVATIVES",
  "CBOE",
  "CME",
  "MSCI",
  "FTSE_RUSSELL",
  "ETF_ISSUER",
  "ALPHA_VANTAGE",
  "FINANCIAL_MODELING_PREP",
  "FINNHUB",
  "LICENSED_CORPORATE_EVENTS",
  "OTHER_OFFICIAL",
  "OTHER_LICENSED",
]);

export const MarketCalendarEventKindSchema = z.enum([
  "EARNINGS",
  "EARNINGS_GUIDANCE",
  "DIVIDEND_DECLARATION",
  "EX_DIVIDEND",
  "DIVIDEND_RECORD_DATE",
  "DIVIDEND_PAYMENT",
  "CAPITAL_INCREASE",
  "BONUS_ISSUE",
  "RIGHTS_OFFERING",
  "STOCK_SPLIT",
  "REVERSE_SPLIT",
  "CAPITAL_REDUCTION",
  "BUYBACK",
  "MERGER_ACQUISITION",
  "SPIN_OFF",
  "SHARE_EXCHANGE",
  "TENDER_OFFER",
  "IPO",
  "NEW_LISTING",
  "DELISTING",
  "LOCKUP_RELEASE",
  "SHAREHOLDER_MEETING",
  "INVESTOR_DAY",
  "CONFERENCE_PRESENTATION",
  "TRADING_HALT",
  "REGULATORY_ACTION",
  "CENTRAL_BANK_RATE_DECISION",
  "CENTRAL_BANK_MINUTES",
  "CENTRAL_BANK_SPEECH",
  "FOMC",
  "MACRO_RELEASE",
  "CPI",
  "PPI",
  "PCE",
  "GDP",
  "EMPLOYMENT",
  "PMI",
  "RETAIL_SALES",
  "TRADE_BALANCE",
  "EIA_INVENTORY",
  "TREASURY_AUCTION",
  "OPTIONS_EXPIRY",
  "FUTURES_EXPIRY",
  "INDEX_REBALANCE",
  "MSCI_REBALANCE",
  "RUSSELL_REBALANCE",
  "ETF_REBALANCE",
  "OTHER_CORPORATE",
  "OTHER_MACRO",
  "OTHER_MARKET_STRUCTURE",
]);

export const MarketCalendarDataQualitySchema = z.enum([
  "OFFICIAL",
  "REGULATOR_EXCHANGE",
  "ISSUER_PRIMARY",
  "LICENSED",
  "AGGREGATED",
  "HEADLINE_ONLY",
  "DELAYED",
  "STALE",
  "UNSUPPORTED",
]);

export const MarketCalendarEvidenceSchema = z
  .object({
    id: z.string().min(1),
    provider: MarketCalendarProviderSchema,
    sourceDocumentId: z.string().min(1),
    canonicalUrl: z.string().url().nullable(),
    documentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    rights: z.enum([
      "OFFICIAL_PUBLIC",
      "ISSUER_PUBLIC",
      "KIS_CONTRACT",
      "LICENSED",
      "PUBLIC_DATA_NON_COMMERCIAL",
      "UNKNOWN",
    ]),
    headlineOnly: z.boolean(),
    publishedAt: UtcInstantSchema,
    obtainedAt: UtcInstantSchema,
    detectedAt: UtcInstantSchema,
  })
  .superRefine((evidence, context) => {
    if (
      Date.parse(evidence.obtainedAt) < Date.parse(evidence.publishedAt) ||
      Date.parse(evidence.detectedAt) < Date.parse(evidence.obtainedAt)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Evidence time must satisfy publishedAt <= obtainedAt <= detectedAt",
      });
    }
    if (
      evidence.provider === "KIS_NEWS_HEADLINE" &&
      (!evidence.headlineOnly || evidence.rights !== "KIS_CONTRACT")
    ) {
      context.addIssue({
        code: "custom",
        message: "KIS news calendar evidence must remain headline-only",
      });
    }
    if (
      evidence.provider === "KSD_RIGHTS_SCHEDULE" &&
      evidence.rights !== "PUBLIC_DATA_NON_COMMERCIAL"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "KSD rights schedule evidence must preserve non-commercial public-data rights",
      });
    }
  });

export const MarketCalendarMetricSchema = z
  .object({
    name: z.enum([
      "EPS",
      "REVENUE",
      "DPS",
      "DIVIDEND_YIELD",
      "RATE",
      "ACTUAL",
      "CONSENSUS",
      "PRIOR",
      "REVISED_PRIOR",
      "SURPRISE",
      "RATIO_FROM",
      "RATIO_TO",
      "SHARES",
      "AMOUNT",
      "PRICE",
      "OTHER",
    ]),
    value: DecimalStringSchema,
    unit: z.string().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    evidenceId: z.string().min(1).nullable(),
  })
  .strict();

export const MarketCalendarEventSchema = z
  .object({
    id: z.string().min(1),
    kind: MarketCalendarEventKindSchema,
    marketScope: MarketCalendarRegionSchema,
    affectedMarkets: z.array(MarketCalendarRegionSchema).min(1),
    instrumentIds: z.array(InstrumentIdSchema),
    titleKo: z.string().min(1),
    titleOriginal: z.string().min(1).nullable(),
    scheduledAt: UtcInstantSchema,
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().min(1),
    status: z.enum([
      "SCHEDULED",
      "CONFIRMED",
      "REPORTED",
      "UPDATED",
      "CANCELLED",
      "TENTATIVE",
    ]),
    importance: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    provider: MarketCalendarProviderSchema,
    sourceEventId: z.string().min(1),
    sourceUrl: z.string().url().nullable(),
    dataQuality: MarketCalendarDataQualitySchema,
    metrics: z.array(MarketCalendarMetricSchema),
    evidenceIds: z.array(z.string().min(1)).min(1),
    supersedesEventId: z.string().min(1).nullable(),
    detectedAt: UtcInstantSchema,
    updatedAt: UtcInstantSchema,
    payloadVersion: z.number().int().positive(),
  })
  .strict()
  .superRefine((event, context) => {
    if (!event.affectedMarkets.includes(event.marketScope)) {
      context.addIssue({
        code: "custom",
        message: "affectedMarkets must include marketScope",
      });
    }
    if (Date.parse(event.updatedAt) < Date.parse(event.detectedAt)) {
      context.addIssue({
        code: "custom",
        message: "updatedAt cannot precede detectedAt",
      });
    }
    if (
      event.dataQuality === "UNSUPPORTED" &&
      event.status !== "TENTATIVE" &&
      event.status !== "CANCELLED"
    ) {
      context.addIssue({
        code: "custom",
        message: "Unsupported calendar data cannot be shown as confirmed",
      });
    }
    if (
      event.provider === "KIS_NEWS_HEADLINE" &&
      event.dataQuality !== "HEADLINE_ONLY"
    ) {
      context.addIssue({
        code: "custom",
        message: "KIS news calendar events must remain headline-only",
      });
    }
  });

export const MarketCalendarFeedSchema = z
  .object({
    generatedAt: UtcInstantSchema,
    events: z.array(MarketCalendarEventSchema),
    evidence: z.array(MarketCalendarEvidenceSchema),
  })
  .strict()
  .superRefine((feed, context) => {
    const eventIds = new Set<string>();
    const providerIds = new Set<string>();
    for (const event of feed.events) {
      if (eventIds.has(event.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate calendar event ID: ${event.id}`,
        });
      }
      eventIds.add(event.id);
      const providerKey = `${event.provider}:${event.sourceEventId}`;
      if (providerIds.has(providerKey)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate provider calendar event identity: ${providerKey}`,
        });
      }
      providerIds.add(providerKey);
    }

    const evidenceIds = new Set(feed.evidence.map((item) => item.id));
    for (const event of feed.events) {
      for (const evidenceId of event.evidenceIds) {
        if (!evidenceIds.has(evidenceId)) {
          context.addIssue({
            code: "custom",
            message: `Unknown calendar evidence: ${evidenceId}`,
          });
        }
      }
      for (const metric of event.metrics) {
        if (metric.evidenceId !== null && !evidenceIds.has(metric.evidenceId)) {
          context.addIssue({
            code: "custom",
            message: `Unknown calendar metric evidence: ${metric.evidenceId}`,
          });
        }
      }
    }
  });

export type MarketCalendarRegion = z.infer<
  typeof MarketCalendarRegionSchema
>;
export type MarketCalendarEvent = z.infer<typeof MarketCalendarEventSchema>;
export type MarketCalendarFeed = z.infer<typeof MarketCalendarFeedSchema>;

export function inferMarketCalendarRegion(
  instrumentId: string,
): MarketCalendarRegion | null {
  if (/^(KRX|NXT):/.test(instrumentId)) return "KR";
  if (/^(NASDAQ|NYSE|AMEX|NYSEARCA):/.test(instrumentId)) return "US";
  return null;
}

export function filterMarketCalendarEventsForInstrument(
  events: MarketCalendarEvent[],
  instrumentId: string,
): MarketCalendarEvent[] {
  const region = inferMarketCalendarRegion(instrumentId);
  return events.filter((event) => {
    if (event.instrumentIds.includes(instrumentId)) return true;
    if (region === null) return event.marketScope === "GLOBAL";
    return (
      event.affectedMarkets.includes(region) ||
      event.affectedMarkets.includes("GLOBAL")
    );
  });
}
