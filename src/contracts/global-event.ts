import { z } from "zod";

import {
  DecimalStringSchema,
  InstrumentIdSchema,
  UtcInstantSchema,
} from "./scalars.js";

function exactDecimalParts(value: string): {
  coefficient: bigint;
  scale: number;
} {
  const negative = value.startsWith("-");
  const unsigned = value.replace(/^[+-]/, "");
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const coefficient = BigInt(`${whole}${fraction}`);
  return {
    coefficient: negative ? -coefficient : coefficient,
    scale: fraction.length,
  };
}

function exactDifferenceMatches(
  actual: string,
  consensus: string,
  surprise: string,
): boolean {
  const values = [
    exactDecimalParts(actual),
    exactDecimalParts(consensus),
    exactDecimalParts(surprise),
  ];
  const scale = Math.max(...values.map((value) => value.scale));
  const scaled = values.map(
    (value) => value.coefficient * 10n ** BigInt(scale - value.scale),
  ) as [bigint, bigint, bigint];
  return scaled[0] - scaled[1] === scaled[2];
}

export const GlobalEventProviderSchema = z.enum([
  "KIS_OVERSEAS_NEWS_HEADLINE",
  "SEC_EDGAR",
  "NASDAQ_TRADER",
  "UKMTO",
  "US_MARAD",
  "US_STATE_DEPARTMENT",
  "US_TREASURY_OFAC",
  "UN_OFFICIAL",
  "IMO_OFFICIAL",
  "KOREA_MOFA",
  "KOREA_MOTIE",
  "US_FEDERAL_RESERVE",
  "US_BLS",
  "US_BEA",
  "US_TREASURY",
  "US_EIA",
  "USDA",
  "ECB_OFFICIAL",
  "BOJ_OFFICIAL",
  "BOK_ECOS",
  "KOSIS",
  "KOREA_CUSTOMS",
  "KOREA_MOEF",
  "AI_LAB_OFFICIAL",
  "ISSUER_IR",
  "LICENSED_REUTERS",
  "OTHER_OFFICIAL",
]);

export const GlobalEventEvidenceSchema = z
  .object({
    id: z.string().min(1),
    provider: GlobalEventProviderSchema,
    tier: z.enum([
      "OFFICIAL_PRIMARY",
      "REGULATOR_EXCHANGE",
      "ISSUER_PRIMARY",
      "KIS_NEWS_HEADLINE",
      "LICENSED_NEWS",
    ]),
    sourceDocumentId: z.string().min(1),
    canonicalUrl: z.string().url(),
    documentHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceLanguage: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/),
    rights: z.enum([
      "OFFICIAL_PUBLIC",
      "ISSUER_PUBLIC",
      "KIS_CONTRACT",
      "LICENSED",
    ]),
    headlineOnly: z.boolean(),
    licenseReference: z.string().min(1).optional(),
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

    if (evidence.provider === "KIS_OVERSEAS_NEWS_HEADLINE") {
      if (
        evidence.tier !== "KIS_NEWS_HEADLINE" ||
        evidence.rights !== "KIS_CONTRACT" ||
        !evidence.headlineOnly
      ) {
        context.addIssue({
          code: "custom",
          message:
            "KIS overseas news must remain a contract-scoped headline source",
        });
      }
    }

    if (evidence.provider === "LICENSED_REUTERS") {
      if (
        evidence.tier !== "LICENSED_NEWS" ||
        evidence.rights !== "LICENSED" ||
        !evidence.licenseReference
      ) {
        context.addIssue({
          code: "custom",
          message: "Reuters evidence requires an explicit license reference",
        });
      }
    } else if (
      ["AI_LAB_OFFICIAL", "ISSUER_IR"].includes(evidence.provider) &&
      (evidence.rights !== "ISSUER_PUBLIC" ||
        evidence.tier !== "ISSUER_PRIMARY")
    ) {
      context.addIssue({
        code: "custom",
        message: "AI lab and issuer IR sources must remain issuer evidence",
      });
    } else if (
      evidence.provider !== "KIS_OVERSEAS_NEWS_HEADLINE" &&
      !["AI_LAB_OFFICIAL", "ISSUER_IR"].includes(evidence.provider) &&
      (evidence.rights !== "OFFICIAL_PUBLIC" ||
        !["OFFICIAL_PRIMARY", "REGULATOR_EXCHANGE"].includes(evidence.tier))
    ) {
      context.addIssue({
        code: "custom",
        message: "Official providers must remain official public evidence",
      });
    }
  });

export const MacroSurpriseSchema = z
  .object({
    indicator: z.enum([
      "POLICY_RATE",
      "CPI",
      "CORE_CPI",
      "PPI",
      "EMPLOYMENT",
      "UNEMPLOYMENT_RATE",
      "GDP",
      "PMI",
      "RETAIL_SALES",
      "INDUSTRIAL_PRODUCTION",
      "TRADE_BALANCE",
      "OTHER",
    ]),
    economy: z.string().regex(/^[A-Z]{2,3}$/),
    unit: z.string().min(1),
    actual: DecimalStringSchema,
    consensus: DecimalStringSchema.nullable(),
    prior: DecimalStringSchema.nullable(),
    revisedPrior: DecimalStringSchema.nullable(),
    surprise: DecimalStringSchema.nullable(),
    surpriseDirection: z.enum([
      "ABOVE_CONSENSUS",
      "IN_LINE",
      "BELOW_CONSENSUS",
      "NO_CONSENSUS",
    ]),
    releaseAt: UtcInstantSchema,
    sourceEvidenceId: z.string().min(1),
    consensusEvidenceId: z.string().min(1).nullable(),
  })
  .superRefine((release, context) => {
    if (
      release.consensus === null &&
      (release.surprise !== null ||
        release.surpriseDirection !== "NO_CONSENSUS" ||
        release.consensusEvidenceId !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "A release without consensus cannot claim a surprise",
      });
    }
    if (
      release.consensus !== null &&
      (release.surprise === null ||
        release.surpriseDirection === "NO_CONSENSUS" ||
        release.consensusEvidenceId === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "A consensus release requires an explicit surprise",
      });
    }
    if (
      release.consensus !== null &&
      release.surprise !== null &&
      !exactDifferenceMatches(
        release.actual,
        release.consensus,
        release.surprise,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "surprise must exactly equal actual minus consensus",
      });
    }
    if (release.surprise !== null) {
      const surpriseSign = exactDecimalParts(release.surprise).coefficient;
      const expectedDirection =
        surpriseSign === 0n
          ? "IN_LINE"
          : surpriseSign > 0n
            ? "ABOVE_CONSENSUS"
            : "BELOW_CONSENSUS";
      if (release.surpriseDirection !== expectedDirection) {
        context.addIssue({
          code: "custom",
          message:
            "surpriseDirection must match the exact actual-consensus sign",
        });
      }
    }
    if (release.revisedPrior !== null && release.prior === null) {
      context.addIssue({
        code: "custom",
        message: "A revised prior requires the originally reported prior",
      });
    }
  });

export const KoreanTranslationSchema = z
  .object({
    status: z.enum(["COMPLETE", "PENDING", "FAILED", "NOT_REQUIRED"]),
    textKo: z.string().min(1).optional(),
    translatedAt: UtcInstantSchema.optional(),
    translator: z
      .enum(["LOCAL_MACHINE", "LICENSED_PROVIDER", "HUMAN_REVIEW"])
      .optional(),
  })
  .superRefine((translation, context) => {
    if (
      translation.status === "COMPLETE" &&
      (!translation.textKo ||
        !translation.translatedAt ||
        !translation.translator)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A completed translation requires Korean text, time, and translator",
      });
    }
  });

export const GlobalEventSchema = z
  .object({
    id: z.string().min(1),
    provider: GlobalEventProviderSchema,
    sourceEventId: z.string().min(1),
    type: z.enum([
      "WAR_OUTBREAK",
      "ARMED_CONFLICT_ESCALATION",
      "SANCTION",
      "MARITIME_SECURITY_INCIDENT",
      "HORMUZ_DISRUPTION",
      "RED_SEA_DISRUPTION",
      "PORT_OR_ROUTE_DISRUPTION",
      "ENERGY_SUPPLY_DISRUPTION",
      "AI_MODEL_OR_PRICING_RELEASE",
      "CENTRAL_BANK_RATE_DECISION",
      "CENTRAL_BANK_FORWARD_GUIDANCE",
      "MACRO_DATA_RELEASE",
      "SOVEREIGN_YIELD_DOLLAR_OR_LIQUIDITY_SHOCK",
      "FISCAL_TAX_OR_TARIFF_POLICY",
      "EXPORT_CONTROL",
      "ELECTION_POLICY_OR_REGULATION",
      "BANKING_CREDIT_OR_LIQUIDITY_CRISIS",
      "SUPPLY_CHAIN_OR_STRIKE",
      "COMMODITY_SUPPLY_OR_PRICE_SHOCK",
      "NATURAL_DISASTER",
      "INFECTIOUS_DISEASE",
      "CYBER_OR_INFRASTRUCTURE_INCIDENT",
      "INDUSTRY_SHOCK",
      "TECHNOLOGY_COMPETITION",
      "MONETARY_POLICY_OR_RATE_EVENT",
      "CORPORATE_EARNINGS_OR_GUIDANCE",
      "CEASEFIRE_OR_DEESCALATION",
      "TRADE_HALT_OR_REGULATORY_ACTION",
      "OTHER",
    ]),
    status: z.enum([
      "REPORTED",
      "OFFICIAL_ALERT",
      "CONFIRMED",
      "UPDATED",
      "RESOLVED",
      "RETRACTED",
    ]),
    severity: z.enum(["WATCH", "MATERIAL", "CRITICAL"]),
    titleOriginal: z.string().min(1),
    sourceLanguage: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/),
    translation: KoreanTranslationSchema,
    regions: z.array(z.string().min(1)).min(1),
    affectedRoutes: z.array(
      z.enum([
        "HORMUZ",
        "RED_SEA",
        "SUEZ",
        "BAB_EL_MANDEB",
        "BLACK_SEA",
        "OTHER",
      ]),
    ),
    publishedAt: UtcInstantSchema,
    obtainedAt: UtcInstantSchema,
    detectedAt: UtcInstantSchema,
    macroSurprise: MacroSurpriseSchema.optional(),
    evidenceIds: z.array(z.string().min(1)).min(1),
    dedupeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    supersedesEventId: z.string().min(1).optional(),
  })
  .superRefine((event, context) => {
    const publishedMs = Date.parse(event.publishedAt);
    const obtainedMs = Date.parse(event.obtainedAt);
    const detectedMs = Date.parse(event.detectedAt);
    if (obtainedMs < publishedMs || detectedMs < obtainedMs) {
      context.addIssue({
        code: "custom",
        message:
          "Event time must satisfy publishedAt <= obtainedAt <= detectedAt",
      });
    }
    if (
      event.sourceLanguage !== "ko" &&
      event.translation.status === "NOT_REQUIRED"
    ) {
      context.addIssue({
        code: "custom",
        message: "A non-Korean event cannot skip Korean translation",
      });
    }
    if (
      event.translation.translatedAt &&
      Date.parse(event.translation.translatedAt) < obtainedMs
    ) {
      context.addIssue({
        code: "custom",
        message: "Translation cannot precede event retrieval",
      });
    }
    if (
      event.type === "MACRO_DATA_RELEASE" &&
      event.macroSurprise === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "A macro data release requires actual/consensus surprise data",
      });
    }
    if (
      event.macroSurprise &&
      Date.parse(event.macroSurprise.releaseAt) > obtainedMs
    ) {
      context.addIssue({
        code: "custom",
        message: "A macro release cannot be obtained before releaseAt",
      });
    }
  });

export const GlobalEventFeedSchema = z
  .array(GlobalEventSchema)
  .superRefine((events, context) => {
    const ids = new Set<string>();
    const sourceKeys = new Set<string>();
    for (const event of events) {
      if (ids.has(event.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate global event ID: ${event.id}`,
        });
      }
      ids.add(event.id);

      const sourceKey = `${event.provider}:${event.sourceEventId}`;
      if (sourceKeys.has(sourceKey)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate provider event identity: ${sourceKey}`,
        });
      }
      sourceKeys.add(sourceKey);
    }

    const groups = new Map<string, typeof events>();
    for (const event of events) {
      const group = groups.get(event.dedupeFingerprint) ?? [];
      group.push(event);
      groups.set(event.dedupeFingerprint, group);
    }
    for (const group of groups.values()) {
      const groupIds = new Set(group.map((event) => event.id));
      const successorCounts = new Map<string, number>();
      let rootCount = 0;
      for (const event of group) {
        if (!event.supersedesEventId) {
          rootCount += 1;
          continue;
        }
        if (
          event.supersedesEventId === event.id ||
          !groupIds.has(event.supersedesEventId)
        ) {
          context.addIssue({
            code: "custom",
            message:
              "A supersedes link must reference another event in the same fingerprint chain",
          });
          continue;
        }
        successorCounts.set(
          event.supersedesEventId,
          (successorCounts.get(event.supersedesEventId) ?? 0) + 1,
        );
        const predecessor = group.find(
          (candidate) => candidate.id === event.supersedesEventId,
        )!;
        if (
          Date.parse(event.detectedAt) <= Date.parse(predecessor.detectedAt)
        ) {
          context.addIssue({
            code: "custom",
            message:
              "A superseding event must be detected after its predecessor",
          });
        }
      }
      if (group.length > 1 && rootCount !== 1) {
        context.addIssue({
          code: "custom",
          message: "A fingerprint chain must have exactly one root",
        });
      }
      if ([...successorCounts.values()].some((count) => count > 1)) {
        context.addIssue({
          code: "custom",
          message: "A fingerprint chain cannot branch",
        });
      }
    }
  });

export const KoreaMarketObservationSchema = z
  .object({
    id: z.string().min(1),
    role: z.enum([
      "KOSPI",
      "KOSDAQ",
      "USD_KRW",
      "OIL_DIRECTION_PROXY",
      "SHIPPING",
      "REFINING",
      "DEFENSE",
      "AIRLINES",
      "TRANSPORT",
      "SEMICONDUCTOR",
      "ELECTRIC_POWER",
      "NASDAQ_DIRECTION_PROXY",
      "RUSSELL_DIRECTION_PROXY",
      "KOREA_EQUITY_PROXY",
      "US_2Y_YIELD",
      "US_10Y_YIELD",
      "USD_BROAD_OFFICIAL",
      "US_SEMICONDUCTOR",
      "US_CLOUD",
      "BANKS_AND_CREDIT",
      "NATURAL_GAS",
      "METALS",
      "AGRICULTURE",
      "OTHER_KR_SECTOR",
    ]),
    instrumentId: InstrumentIdSchema,
    representation: z.enum([
      "OFFICIAL_INDEX_OR_SPOT",
      "OFFICIAL_YIELD",
      "ETF_PROXY",
      "EQUITY_BASKET",
    ]),
    source: z.enum([
      "KIS_MARKET_DATA",
      "US_TREASURY_OFFICIAL",
      "US_FEDERAL_RESERVE_OFFICIAL",
    ]),
    dataQuality: z.enum(["LIVE", "DELAYED", "STALE", "PARTIAL", "PROXY_LIVE"]),
    windowStartAt: UtcInstantSchema,
    windowEndAt: UtcInstantSchema,
    observedAt: UtcInstantSchema,
    latencyMs: z.number().int().nonnegative(),
    returnPct: DecimalStringSchema.optional(),
    value: DecimalStringSchema.optional(),
    changeBps: DecimalStringSchema.optional(),
    volumeChangePct: DecimalStringSchema.optional(),
    turnoverChangePct: DecimalStringSchema.optional(),
  })
  .superRefine((observation, context) => {
    const startMs = Date.parse(observation.windowStartAt);
    const endMs = Date.parse(observation.windowEndAt);
    const observedMs = Date.parse(observation.observedAt);
    if (startMs > endMs || endMs > observedMs) {
      context.addIssue({
        code: "custom",
        message:
          "Observation time must satisfy windowStartAt <= windowEndAt <= observedAt",
      });
    }
    if (
      observation.returnPct === undefined &&
      observation.value === undefined &&
      observation.changeBps === undefined &&
      observation.volumeChangePct === undefined &&
      observation.turnoverChangePct === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "A market observation requires at least one exact metric",
      });
    }
    if (
      observation.role === "OIL_DIRECTION_PROXY" &&
      (observation.instrumentId !== "NYSEARCA:USO" ||
        observation.representation !== "ETF_PROXY" ||
        observation.source !== "KIS_MARKET_DATA" ||
        observation.dataQuality !== "PROXY_LIVE")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Free oil context is NYSEARCA:USO PROXY_LIVE, not a CME futures quote",
      });
    }
    if (
      observation.role === "NASDAQ_DIRECTION_PROXY" &&
      (observation.instrumentId !== "NASDAQ:QQQ" ||
        observation.representation !== "ETF_PROXY" ||
        observation.source !== "KIS_MARKET_DATA" ||
        observation.dataQuality !== "PROXY_LIVE")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Free Nasdaq context is NASDAQ:QQQ PROXY_LIVE, not the Nasdaq index",
      });
    }
    const proxyIdentities: Partial<
      Record<
        (typeof observation)["role"],
        { instrumentId: string; label: string }
      >
    > = {
      RUSSELL_DIRECTION_PROXY: {
        instrumentId: "NYSEARCA:IWM",
        label: "Russell",
      },
      KOREA_EQUITY_PROXY: {
        instrumentId: "NYSEARCA:EWY",
        label: "Korea equity",
      },
    };
    const proxyIdentity = proxyIdentities[observation.role];
    if (
      proxyIdentity &&
      (observation.instrumentId !== proxyIdentity.instrumentId ||
        observation.representation !== "ETF_PROXY" ||
        observation.source !== "KIS_MARKET_DATA" ||
        observation.dataQuality !== "PROXY_LIVE")
    ) {
      context.addIssue({
        code: "custom",
        message: `${proxyIdentity.label} context must remain its KIS ETF PROXY_LIVE quote`,
      });
    }
    const officialYieldIdentities: Partial<
      Record<(typeof observation)["role"], string>
    > = {
      US_2Y_YIELD: "UST:2Y",
      US_10Y_YIELD: "UST:10Y",
    };
    const officialYieldInstrument = officialYieldIdentities[observation.role];
    if (
      officialYieldInstrument &&
      (observation.instrumentId !== officialYieldInstrument ||
        observation.representation !== "OFFICIAL_YIELD" ||
        observation.source !== "US_TREASURY_OFFICIAL" ||
        observation.dataQuality !== "DELAYED")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Free US yield context is delayed official Treasury data, not a live quote",
      });
    }
    if (
      observation.role === "USD_BROAD_OFFICIAL" &&
      (observation.instrumentId !== "FED:DTWEXBGS" ||
        observation.representation !== "OFFICIAL_INDEX_OR_SPOT" ||
        observation.source !== "US_FEDERAL_RESERVE_OFFICIAL" ||
        observation.dataQuality !== "DELAYED")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Free broad-dollar context is the delayed Federal Reserve series",
      });
    }
    const directKoreaIdentities: Partial<
      Record<(typeof observation)["role"], string>
    > = {
      KOSPI: "KRX:KOSPI",
      KOSDAQ: "KRX:KOSDAQ",
      USD_KRW: "FX:USDKRW",
    };
    const directKoreaInstrument = directKoreaIdentities[observation.role];
    if (
      directKoreaInstrument &&
      (observation.instrumentId !== directKoreaInstrument ||
        observation.representation !== "OFFICIAL_INDEX_OR_SPOT" ||
        observation.source !== "KIS_MARKET_DATA")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "KOSPI, KOSDAQ, and USD/KRW roles require their canonical KIS identity",
      });
    }
  });

export const GlobalEventClaimSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "EVENT_FACT",
    "MARKET_REACTION",
    "TRANSMISSION_HYPOTHESIS",
    "OFFICIAL_LINKAGE",
    "CONTEXT_LIMITATION",
  ]),
  textKo: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
  observationIds: z.array(z.string().min(1)),
});

export const GlobalEventCoverageCategorySchema = z.enum([
  "GEOPOLITICS_AND_SANCTIONS",
  "MARITIME_AND_ENERGY",
  "CENTRAL_BANKS",
  "MACRO_INDICATORS",
  "RATES_DOLLAR_AND_LIQUIDITY",
  "FISCAL_TAX_TARIFF_AND_EXPORT_CONTROL",
  "ELECTION_POLICY_AND_REGULATION",
  "BANKING_CREDIT_AND_LIQUIDITY",
  "SUPPLY_CHAIN_AND_LABOR",
  "COMMODITIES",
  "DISASTER_HEALTH_CYBER_AND_INFRASTRUCTURE",
  "CORPORATE_AND_INDUSTRY",
  "TECHNOLOGY_COMPETITION",
  "US_MARKET_REACTION",
  "KOREA_MARKET_REACTION",
  "KOREAN_TRANSLATION",
]);

export const GlobalEventCoverageProviderSchema = z.union([
  GlobalEventProviderSchema,
  z.enum([
    "KIS_MARKET_DATA",
    "US_TREASURY_MARKET_DATA",
    "US_FEDERAL_RESERVE_MARKET_DATA",
    "LOCAL_TRANSLATION_ENGINE",
  ]),
]);

export const GlobalEventCoverageEntrySchema = z
  .object({
    category: GlobalEventCoverageCategorySchema,
    status: z.enum(["AVAILABLE", "UNSUPPORTED", "MISSING", "DELAYED", "STALE"]),
    providers: z.array(GlobalEventCoverageProviderSchema),
    cadence: z.enum([
      "REALTIME",
      "INTRADAY",
      "DAILY",
      "SCHEDULED_RELEASE",
      "EVENT_DRIVEN",
      "UNKNOWN",
    ]),
    observedLatencyMs: z.number().int().nonnegative().nullable(),
    revisionPolicy: z.enum([
      "VERSIONED",
      "LATEST_ONLY",
      "NOT_APPLICABLE",
      "UNKNOWN",
    ]),
    rights: z.enum([
      "OFFICIAL_PUBLIC",
      "ISSUER_PUBLIC",
      "KIS_CONTRACT",
      "LICENSED",
      "NOT_APPLICABLE",
    ]),
    lastSuccessAt: UtcInstantSchema.nullable(),
    reasonCode: z.string().min(1).nullable(),
  })
  .superRefine((entry, context) => {
    if (
      entry.status === "AVAILABLE" &&
      (entry.providers.length === 0 || entry.lastSuccessAt === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "AVAILABLE coverage requires a provider and last success time",
      });
    }
    if (
      ["UNSUPPORTED", "MISSING", "DELAYED", "STALE"].includes(entry.status) &&
      entry.reasonCode === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Non-available coverage requires a reason code",
      });
    }
    if (
      entry.status === "DELAYED" &&
      (entry.observedLatencyMs === null || entry.observedLatencyMs === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "DELAYED coverage requires a measured positive latency",
      });
    }
  });

export const GlobalEventCoverageRegistrySchema = z
  .object({
    generatedAt: UtcInstantSchema,
    entries: z.array(GlobalEventCoverageEntrySchema),
  })
  .superRefine((registry, context) => {
    const categories = new Set(registry.entries.map((entry) => entry.category));
    if (categories.size !== registry.entries.length) {
      context.addIssue({
        code: "custom",
        message: "Coverage registry categories must be unique",
      });
    }
    const missing = GlobalEventCoverageCategorySchema.options.filter(
      (category) => !categories.has(category),
    );
    if (missing.length > 0) {
      context.addIssue({
        code: "custom",
        message: `Coverage registry is missing categories: ${missing.join(", ")}`,
      });
    }
  });

export const CounterEvidenceSchema = z
  .object({
    id: z.string().min(1),
    textKo: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)),
    observationIds: z.array(z.string().min(1)),
  })
  .superRefine((counterEvidence, context) => {
    if (
      counterEvidence.evidenceIds.length === 0 &&
      counterEvidence.observationIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Counter-evidence requires evidence or a market observation",
      });
    }
  });

export const GlobalEventImpactAssessmentSchema = z
  .object({
    id: z.string().min(1),
    eventId: z.string().min(1),
    relationship: z.enum([
      "OFFICIAL_LINKAGE",
      "PLAUSIBLE_CONTEXT",
      "OBSERVED_COINCIDENCE",
      "INSUFFICIENT_EVIDENCE",
    ]),
    direction: z.enum(["RISK_OFF", "RISK_ON", "MIXED", "NO_CLEAR_SIGNAL"]),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW", "NONE"]),
    channels: z.array(
      z.object({
        role: KoreaMarketObservationSchema.shape.role,
        observedDirection: z.enum(["UP", "DOWN", "MIXED", "FLAT", "UNKNOWN"]),
        observationIds: z.array(z.string().min(1)).min(1),
      }),
    ),
    observationIds: z.array(z.string().min(1)),
    claims: z.array(GlobalEventClaimSchema).min(1),
    counterEvidence: z.array(CounterEvidenceSchema),
    freshness: z.enum([
      "LIVE",
      "NEAR_REAL_TIME",
      "DELAYED",
      "STALE",
      "OFFLINE",
    ]),
    latencyMs: z.number().int().nonnegative(),
    asOfAt: UtcInstantSchema,
    cutoffAt: UtcInstantSchema,
    version: z.number().int().positive(),
  })
  .superRefine((assessment, context) => {
    if (Date.parse(assessment.asOfAt) > Date.parse(assessment.cutoffAt)) {
      context.addIssue({
        code: "custom",
        message: "asOfAt cannot follow cutoffAt",
      });
    }
    if (
      assessment.relationship === "INSUFFICIENT_EVIDENCE" &&
      (assessment.confidence !== "NONE" ||
        assessment.direction !== "NO_CLEAR_SIGNAL")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "INSUFFICIENT_EVIDENCE requires NONE confidence and no clear signal",
      });
    }
    if (
      assessment.relationship !== "INSUFFICIENT_EVIDENCE" &&
      assessment.observationIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "A market relationship requires an actual observation",
      });
    }
    if (
      assessment.confidence === "HIGH" &&
      assessment.relationship !== "OFFICIAL_LINKAGE"
    ) {
      context.addIssue({
        code: "custom",
        message: "HIGH confidence is reserved for an official linkage",
      });
    }
    if (
      ["STALE", "OFFLINE"].includes(assessment.freshness) &&
      assessment.confidence === "HIGH"
    ) {
      context.addIssue({
        code: "custom",
        message: "Stale context cannot have HIGH confidence",
      });
    }
    if (
      (assessment.confidence === "HIGH" ||
        assessment.confidence === "MEDIUM") &&
      assessment.counterEvidence.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "MEDIUM and HIGH assessments must record counter-evidence",
      });
    }
  });

export type GlobalEventEvidence = z.infer<typeof GlobalEventEvidenceSchema>;
export type GlobalEvent = z.infer<typeof GlobalEventSchema>;
export type KoreaMarketObservation = z.infer<
  typeof KoreaMarketObservationSchema
>;
export type GlobalEventImpactAssessment = z.infer<
  typeof GlobalEventImpactAssessmentSchema
>;
export type GlobalEventCoverageRegistry = z.infer<
  typeof GlobalEventCoverageRegistrySchema
>;

export function assertPointInTimeGlobalEventAssessment(input: {
  assessment: GlobalEventImpactAssessment;
  event: GlobalEvent;
  evidence: GlobalEventEvidence[];
  observations: KoreaMarketObservation[];
}): void {
  const assessment = GlobalEventImpactAssessmentSchema.parse(input.assessment);
  const event = GlobalEventSchema.parse(input.event);
  const evidence = input.evidence.map((item) =>
    GlobalEventEvidenceSchema.parse(item),
  );
  const observations = input.observations.map((item) =>
    KoreaMarketObservationSchema.parse(item),
  );

  if (assessment.eventId !== event.id) {
    throw new Error("Assessment and global event IDs do not match");
  }

  const asOfMs = Date.parse(assessment.asOfAt);
  if (
    Date.parse(event.publishedAt) > asOfMs ||
    Date.parse(event.obtainedAt) > asOfMs ||
    Date.parse(event.detectedAt) > asOfMs
  ) {
    throw new Error("Global event was not available by assessment asOfAt");
  }
  if (
    event.sourceLanguage !== "ko" &&
    event.translation.status !== "COMPLETE"
  ) {
    throw new Error(
      "A non-Korean global event requires completed Korean translation",
    );
  }
  if (
    event.translation.translatedAt &&
    Date.parse(event.translation.translatedAt) > asOfMs
  ) {
    throw new Error("Korean translation was completed after asOfAt");
  }

  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const observationById = new Map(observations.map((item) => [item.id, item]));
  if (evidenceById.size !== evidence.length) {
    throw new Error("Duplicate evidence IDs are not allowed");
  }
  if (observationById.size !== observations.length) {
    throw new Error("Duplicate observation IDs are not allowed");
  }

  const referencedEvidenceIds = new Set([
    ...event.evidenceIds,
    ...assessment.claims.flatMap((claim) => claim.evidenceIds),
    ...assessment.counterEvidence.flatMap((item) => item.evidenceIds),
  ]);
  for (const evidenceId of referencedEvidenceIds) {
    const item = evidenceById.get(evidenceId);
    if (!item) {
      throw new Error(`Unknown global-event evidence: ${evidenceId}`);
    }
    if (
      Date.parse(item.publishedAt) > asOfMs ||
      Date.parse(item.obtainedAt) > asOfMs ||
      Date.parse(item.detectedAt) > asOfMs
    ) {
      throw new Error(
        `Global-event evidence was unavailable at asOfAt: ${evidenceId}`,
      );
    }
  }
  const providerIdentityEvidence = event.evidenceIds
    .map((evidenceId) => evidenceById.get(evidenceId))
    .find(
      (item) =>
        item?.provider === event.provider &&
        item.sourceDocumentId === event.sourceEventId,
    );
  if (!providerIdentityEvidence) {
    throw new Error(
      "Global event requires evidence matching its provider identity",
    );
  }
  if (
    providerIdentityEvidence.sourceLanguage !== event.sourceLanguage ||
    Date.parse(providerIdentityEvidence.publishedAt) !==
      Date.parse(event.publishedAt) ||
    Date.parse(providerIdentityEvidence.obtainedAt) !==
      Date.parse(event.obtainedAt) ||
    Date.parse(providerIdentityEvidence.detectedAt) !==
      Date.parse(event.detectedAt)
  ) {
    throw new Error(
      "Global event language and timestamps must match provider identity evidence",
    );
  }
  if (event.macroSurprise) {
    if (
      !event.evidenceIds.includes(event.macroSurprise.sourceEvidenceId) ||
      !evidenceById.has(event.macroSurprise.sourceEvidenceId)
    ) {
      throw new Error("Macro surprise requires its release source evidence");
    }
    if (Date.parse(event.macroSurprise.releaseAt) > asOfMs) {
      throw new Error("Macro release occurred after assessment asOfAt");
    }
    if (
      event.macroSurprise.consensusEvidenceId &&
      (!event.evidenceIds.includes(event.macroSurprise.consensusEvidenceId) ||
        !evidenceById.has(event.macroSurprise.consensusEvidenceId))
    ) {
      throw new Error("Macro consensus requires licensed source evidence");
    }
    if (event.macroSurprise.consensusEvidenceId) {
      const consensusEvidence = evidenceById.get(
        event.macroSurprise.consensusEvidenceId,
      )!;
      if (
        consensusEvidence.rights !== "LICENSED" ||
        consensusEvidence.tier !== "LICENSED_NEWS" ||
        !consensusEvidence.licenseReference
      ) {
        throw new Error(
          "Macro consensus evidence requires licensed rights, tier, and reference",
        );
      }
    }
  }

  const referencedObservationIds = new Set([
    ...assessment.observationIds,
    ...assessment.channels.flatMap((channel) => channel.observationIds),
    ...assessment.claims.flatMap((claim) => claim.observationIds),
    ...assessment.counterEvidence.flatMap((item) => item.observationIds),
  ]);
  for (const observationId of referencedObservationIds) {
    const item = observationById.get(observationId);
    if (!item) {
      throw new Error(`Unknown market observation: ${observationId}`);
    }
    if (
      Date.parse(item.windowEndAt) > asOfMs ||
      Date.parse(item.observedAt) > asOfMs
    ) {
      throw new Error(
        `Market observation was unavailable at asOfAt: ${observationId}`,
      );
    }
  }
  for (const channel of assessment.channels) {
    for (const observationId of channel.observationIds) {
      if (observationById.get(observationId)?.role !== channel.role) {
        throw new Error(
          `Channel role does not match market observation: ${observationId}`,
        );
      }
    }
  }

  if (
    assessment.relationship !== "INSUFFICIENT_EVIDENCE" &&
    (event.type === "AI_MODEL_OR_PRICING_RELEASE" ||
      event.type === "TECHNOLOGY_COMPETITION")
  ) {
    const claimKinds = new Set(assessment.claims.map((claim) => claim.kind));
    for (const requiredKind of [
      "EVENT_FACT",
      "MARKET_REACTION",
      "TRANSMISSION_HYPOTHESIS",
    ] as const) {
      if (!claimKinds.has(requiredKind)) {
        throw new Error(
          `AI event assessment requires a separate ${requiredKind} claim`,
        );
      }
    }
  }

  if (assessment.confidence === "HIGH") {
    const hasOfficialIdentity =
      providerIdentityEvidence.tier === "OFFICIAL_PRIMARY" &&
      !providerIdentityEvidence.headlineOnly;
    const hasOfficialLinkageClaim = assessment.claims.some(
      (claim) =>
        claim.kind === "OFFICIAL_LINKAGE" &&
        claim.evidenceIds.includes(providerIdentityEvidence.id) &&
        claim.observationIds.length > 0,
    );
    const hasDirectKoreaObservation = [...referencedObservationIds].some(
      (observationId) => {
        const observation = observationById.get(observationId);
        return (
          observation !== undefined &&
          ["KOSPI", "KOSDAQ", "USD_KRW"].includes(observation.role) &&
          observation.dataQuality !== "STALE" &&
          observation.dataQuality !== "PROXY_LIVE"
        );
      },
    );
    if (
      !hasOfficialIdentity ||
      !hasOfficialLinkageClaim ||
      !hasDirectKoreaObservation
    ) {
      throw new Error(
        "HIGH confidence requires official identity evidence, an official linkage claim, and direct Korean market reaction",
      );
    }
  }
}
