import { z } from "zod";

import {
  DecimalStringSchema,
  InstrumentIdSchema,
  UtcInstantSchema,
} from "./scalars.js";

export const CatalystTypeSchema = z.enum([
  "MATERIAL_AGREEMENT",
  "CONTRACT_ORDER",
  "ACQUISITION",
  "DISPOSITION",
  "CHANGE_OF_CONTROL",
  "REGULATORY_APPROVAL",
  "CLINICAL_RESULT",
  "EARNINGS",
  "GUIDANCE",
  "BUYBACK",
  "OWNERSHIP_CHANGE",
  "TENDER_OFFER",
  "REGISTERED_OFFERING",
  "PRIVATE_PLACEMENT",
  "ATM",
  "CONVERTIBLE",
  "WARRANT",
  "CAPITAL_RAISE",
  "REVERSE_SPLIT",
  "LISTING_COMPLIANCE",
  "TRADING_HALT",
  "EXCHANGE_ALERT",
  "OTHER",
]);

export const EvidenceSchema = z.object({
  id: z.string().min(1),
  instrumentIds: z.array(InstrumentIdSchema).min(1),
  tier: z.enum([
    "REGULATOR_EXCHANGE",
    "ISSUER_FILED",
    "ISSUER_IR",
    "MARKET_DATA",
    "LICENSED_NEWS",
  ]),
  providerDocumentId: z.string().min(1),
  canonicalUrl: z.string().url(),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sectionLocator: z.string().min(1).optional(),
  excerptHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  publishedAt: UtcInstantSchema,
  obtainedAt: UtcInstantSchema,
});

export const CatalystEventSchema = z
  .object({
    id: z.string().min(1),
    instrumentId: InstrumentIdSchema,
    provider: z.enum([
      "SEC_EDGAR",
      "OPEN_DART",
      "KRX_KIND",
      "NASDAQ",
      "NYSE",
      "NXT",
      "ISSUER_IR",
    ]),
    providerEventId: z.string().min(1),
    type: CatalystTypeSchema,
    lifecycle: z.enum([
      "PROPOSED",
      "FILED",
      "EFFECTIVE",
      "COMPLETED",
      "EXERCISED",
      "CANCELLED",
      "AMENDED",
      "UNKNOWN",
    ]),
    impact: z.enum(["POSITIVE", "NEGATIVE", "MIXED", "NEUTRAL", "UNKNOWN"]),
    eventAt: UtcInstantSchema.optional(),
    publishedAt: UtcInstantSchema,
    detectedAt: UtcInstantSchema,
    effectiveAt: UtcInstantSchema.optional(),
    sourceLanguage: z.enum(["en", "ko"]),
    facts: z.array(
      z.object({
        key: z.string().min(1),
        value: z.string().min(1),
        unit: z.string().min(1).optional(),
        asOf: UtcInstantSchema.optional(),
      }),
    ),
    evidenceIds: z.array(z.string().min(1)).min(1),
    amendmentOf: z.string().min(1).optional(),
  })
  .superRefine((event, context) => {
    if (Date.parse(event.detectedAt) < Date.parse(event.publishedAt)) {
      context.addIssue({
        code: "custom",
        message: "detectedAt cannot precede publishedAt",
      });
    }
  });

export const MoveEpisodeSchema = z.object({
  id: z.string().min(1),
  instrumentId: InstrumentIdSchema,
  venue: z.string().min(1),
  session: z.enum(["PRE", "REGULAR", "AFTER"]),
  startedAt: UtcInstantSchema,
  peakAt: UtcInstantSchema.optional(),
  returnPct: DecimalStringSchema,
  relativeVolume: DecimalStringSchema.optional(),
  turnoverValue: z
    .object({
      value: DecimalStringSchema,
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .optional(),
  floatTurnover: DecimalStringSchema.optional(),
  spreadBps: DecimalStringSchema.optional(),
  dataQuality: z.enum(["LIVE", "DELAYED", "STALE", "PARTIAL"]),
});

export const EvidenceClaimSchema = z.object({
  id: z.string().min(1),
  textKo: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
});

export const CatalystAssessmentSchema = z
  .object({
    id: z.string().min(1),
    moveEpisodeId: z.string().min(1),
    verdict: z.enum([
      "PRIMARY_EVENT_TIMING_MATCH",
      "ASSOCIATED_PRIMARY_EVENT",
      "MARKET_STRUCTURE_ONLY",
      "NO_VERIFIED_CATALYST",
    ]),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW", "NONE"]),
    catalystIds: z.array(z.string().min(1)),
    riskSignalIds: z.array(z.string().min(1)),
    claims: z.array(EvidenceClaimSchema),
    cutoffAt: UtcInstantSchema,
    version: z.number().int().positive(),
  })
  .superRefine((assessment, context) => {
    const isCausalVerdict =
      assessment.verdict === "PRIMARY_EVENT_TIMING_MATCH" ||
      assessment.verdict === "ASSOCIATED_PRIMARY_EVENT";
    if (isCausalVerdict && assessment.catalystIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: "A causal verdict must reference at least one catalyst",
      });
    }
    if (
      assessment.confidence === "HIGH" &&
      assessment.catalystIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "HIGH confidence requires at least one official catalyst",
      });
    }
    if (
      assessment.verdict === "NO_VERIFIED_CATALYST" &&
      (assessment.catalystIds.length > 0 || assessment.confidence !== "NONE")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "NO_VERIFIED_CATALYST cannot reference a catalyst or confidence",
      });
    }
    if (
      assessment.verdict === "MARKET_STRUCTURE_ONLY" &&
      assessment.catalystIds.length > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "MARKET_STRUCTURE_ONLY cannot reference a catalyst",
      });
    }
  });

export type CatalystEvent = z.infer<typeof CatalystEventSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type MoveEpisode = z.infer<typeof MoveEpisodeSchema>;
export type CatalystAssessment = z.infer<typeof CatalystAssessmentSchema>;
