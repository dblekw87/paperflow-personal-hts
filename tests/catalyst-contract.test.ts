import { describe, expect, it } from "vitest";

import {
  CatalystAssessmentSchema,
  CatalystEventSchema,
  EvidenceSchema,
  MoveEpisodeSchema,
} from "../src/contracts/catalyst.js";
import { assertPointInTimeCatalystAssessment } from "../src/analysis/catalyst-point-in-time.js";

function assessmentEvidence(
  id: string,
  options?: {
    instrumentId?: string;
    publishedAt?: string;
    obtainedAt?: string;
  },
) {
  return EvidenceSchema.parse({
    id,
    instrumentIds: [options?.instrumentId ?? "KRX:123456"],
    tier: "REGULATOR_EXCHANGE",
    providerDocumentId: `document-${id}`,
    canonicalUrl: `https://dart.fss.or.kr/${id}`,
    documentHash: "a".repeat(64),
    publishedAt: options?.publishedAt ?? "2026-07-20T00:10:00+00:00",
    obtainedAt: options?.obtainedAt ?? "2026-07-20T00:10:03+00:00",
  });
}

describe("catalyst analysis contracts", () => {
  it("accepts a point-in-time KOSDAQ catalyst assessment", () => {
    const event = CatalystEventSchema.parse({
      id: "event-1",
      instrumentId: "KRX:123456",
      provider: "OPEN_DART",
      providerEventId: "20260720000001",
      type: "CONTRACT_ORDER",
      lifecycle: "FILED",
      impact: "UNKNOWN",
      publishedAt: "2026-07-20T00:10:00+00:00",
      detectedAt: "2026-07-20T00:10:03+00:00",
      sourceLanguage: "ko",
      facts: [{ key: "contractAmount", value: "5000000000", unit: "KRW" }],
      evidenceIds: ["evidence-1"],
    });
    const move = MoveEpisodeSchema.parse({
      id: "move-1",
      instrumentId: "KRX:123456",
      venue: "KOSDAQ",
      session: "REGULAR",
      startedAt: "2026-07-20T00:12:00+00:00",
      returnPct: "12.35",
      relativeVolume: "8.2",
      turnoverValue: { value: "10000000000", currency: "KRW" },
      dataQuality: "LIVE",
    });
    const assessment = CatalystAssessmentSchema.parse({
      id: "assessment-1",
      moveEpisodeId: move.id,
      verdict: "PRIMARY_EVENT_TIMING_MATCH",
      confidence: "HIGH",
      catalystIds: [event.id],
      riskSignalIds: [],
      claims: [
        {
          id: "claim-1",
          textKo: "급등 시작 전에 공급계약 공시가 확인됐습니다.",
          evidenceIds: ["evidence-1"],
        },
      ],
      cutoffAt: "2026-07-20T00:15:00+00:00",
      version: 1,
    });

    expect(assessment.confidence).toBe("HIGH");
  });

  it("rejects a natural-language claim without evidence", () => {
    expect(() =>
      CatalystAssessmentSchema.parse({
        id: "assessment-2",
        moveEpisodeId: "move-2",
        verdict: "MARKET_STRUCTURE_ONLY",
        confidence: "LOW",
        catalystIds: [],
        riskSignalIds: ["risk-1"],
        claims: [
          {
            id: "claim-2",
            textKo: "원인이 확인되지 않은 거래량 급증입니다.",
            evidenceIds: [],
          },
        ],
        cutoffAt: "2026-07-20T00:15:00+00:00",
        version: 1,
      }),
    ).toThrow();
  });

  it("rejects future and post-move catalysts from causal assessments", () => {
    const move = MoveEpisodeSchema.parse({
      id: "move-2",
      instrumentId: "KRX:123456",
      venue: "KOSDAQ",
      session: "REGULAR",
      startedAt: "2026-07-20T00:12:00+00:00",
      returnPct: "10",
      dataQuality: "LIVE",
    });
    const event = CatalystEventSchema.parse({
      id: "event-late",
      instrumentId: "KRX:123456",
      provider: "OPEN_DART",
      providerEventId: "20260720000002",
      type: "CONTRACT_ORDER",
      lifecycle: "FILED",
      impact: "UNKNOWN",
      publishedAt: "2026-07-20T00:13:00+00:00",
      detectedAt: "2026-07-20T00:13:03+00:00",
      sourceLanguage: "ko",
      facts: [],
      evidenceIds: ["evidence-late"],
    });
    const assessment = CatalystAssessmentSchema.parse({
      id: "assessment-late",
      moveEpisodeId: move.id,
      verdict: "PRIMARY_EVENT_TIMING_MATCH",
      confidence: "HIGH",
      catalystIds: [event.id],
      riskSignalIds: [],
      claims: [
        {
          id: "claim-late",
          textKo: "급등 이후 공개된 공시입니다.",
          evidenceIds: ["evidence-late"],
        },
      ],
      cutoffAt: "2026-07-20T00:15:00+00:00",
      version: 1,
    });

    expect(() =>
      assertPointInTimeCatalystAssessment({
        assessment,
        move,
        catalysts: [event],
        evidence: [
          assessmentEvidence("evidence-late", {
            publishedAt: event.publishedAt,
            obtainedAt: event.detectedAt,
          }),
        ],
      }),
    ).toThrow(/Post-move catalyst/);
  });

  it("rejects a detection timestamp earlier than publication", () => {
    expect(() =>
      CatalystEventSchema.parse({
        id: "event-time-travel",
        instrumentId: "KRX:123456",
        provider: "OPEN_DART",
        providerEventId: "20260720000003",
        type: "OTHER",
        lifecycle: "FILED",
        impact: "UNKNOWN",
        publishedAt: "2026-07-20T00:10:00+00:00",
        detectedAt: "2026-07-20T00:09:59+00:00",
        sourceLanguage: "ko",
        facts: [],
        evidenceIds: ["evidence-time"],
      }),
    ).toThrow(/detectedAt/);
  });

  it("rejects cross-instrument, backfilled, and pre-move-cutoff assessments", () => {
    const move = MoveEpisodeSchema.parse({
      id: "move-3",
      instrumentId: "KRX:123456",
      venue: "KOSDAQ",
      session: "REGULAR",
      startedAt: "2026-07-20T00:12:00+00:00",
      returnPct: "10",
      dataQuality: "LIVE",
    });
    const baseEvent = {
      id: "event-point-in-time",
      instrumentId: "KRX:123456",
      provider: "OPEN_DART" as const,
      providerEventId: "20260720000004",
      type: "OTHER" as const,
      lifecycle: "FILED" as const,
      impact: "UNKNOWN" as const,
      publishedAt: "2026-07-20T00:10:00+00:00",
      detectedAt: "2026-07-20T00:10:01+00:00",
      sourceLanguage: "ko" as const,
      facts: [],
      evidenceIds: ["evidence-point-in-time"],
    };
    const assessment = CatalystAssessmentSchema.parse({
      id: "assessment-point-in-time",
      moveEpisodeId: move.id,
      verdict: "PRIMARY_EVENT_TIMING_MATCH",
      confidence: "HIGH",
      catalystIds: [baseEvent.id],
      riskSignalIds: [],
      claims: [
        {
          id: "claim-point-in-time",
          textKo: "급등 전에 탐지된 공시입니다.",
          evidenceIds: ["evidence-point-in-time"],
        },
      ],
      cutoffAt: "2026-07-20T00:15:00+00:00",
      version: 1,
    });

    expect(() =>
      assertPointInTimeCatalystAssessment({
        assessment,
        move,
        catalysts: [
          CatalystEventSchema.parse({
            ...baseEvent,
            instrumentId: "KRX:654321",
          }),
        ],
        evidence: [assessmentEvidence("evidence-point-in-time")],
      }),
    ).toThrow(/instrument/);

    expect(() =>
      assertPointInTimeCatalystAssessment({
        assessment,
        move,
        catalysts: [
          CatalystEventSchema.parse({
            ...baseEvent,
            detectedAt: "2026-07-20T00:16:00+00:00",
          }),
        ],
        evidence: [assessmentEvidence("evidence-point-in-time")],
      }),
    ).toThrow(/detected after/);

    expect(() =>
      assertPointInTimeCatalystAssessment({
        assessment: {
          ...assessment,
          cutoffAt: "2026-07-20T00:11:59+00:00",
        },
        move,
        catalysts: [CatalystEventSchema.parse(baseEvent)],
        evidence: [assessmentEvidence("evidence-point-in-time")],
      }),
    ).toThrow(/cannot precede/);
  });

  it("rejects a causal or high-confidence assessment without catalysts", () => {
    expect(() =>
      CatalystAssessmentSchema.parse({
        id: "assessment-empty",
        moveEpisodeId: "move-empty",
        verdict: "PRIMARY_EVENT_TIMING_MATCH",
        confidence: "HIGH",
        catalystIds: [],
        riskSignalIds: [],
        claims: [
          {
            id: "claim-empty",
            textKo: "근거 없는 고신뢰 원인입니다.",
            evidenceIds: ["market-only"],
          },
        ],
        cutoffAt: "2026-07-20T00:15:00+00:00",
        version: 1,
      }),
    ).toThrow(/catalyst/);
  });

  it("rejects unknown, cross-instrument, and future-obtained evidence", () => {
    const move = MoveEpisodeSchema.parse({
      id: "move-evidence",
      instrumentId: "KRX:123456",
      venue: "KOSDAQ",
      session: "REGULAR",
      startedAt: "2026-07-20T00:12:00+00:00",
      returnPct: "10",
      dataQuality: "LIVE",
    });
    const event = CatalystEventSchema.parse({
      id: "event-evidence",
      instrumentId: move.instrumentId,
      provider: "OPEN_DART",
      providerEventId: "20260720000005",
      type: "OTHER",
      lifecycle: "FILED",
      impact: "UNKNOWN",
      publishedAt: "2026-07-20T00:10:00+00:00",
      detectedAt: "2026-07-20T00:10:01+00:00",
      sourceLanguage: "ko",
      facts: [],
      evidenceIds: ["evidence-required"],
    });
    const assessment = CatalystAssessmentSchema.parse({
      id: "assessment-evidence",
      moveEpisodeId: move.id,
      verdict: "PRIMARY_EVENT_TIMING_MATCH",
      confidence: "HIGH",
      catalystIds: [event.id],
      riskSignalIds: [],
      claims: [
        {
          id: "claim-evidence",
          textKo: "근거가 연결된 공시입니다.",
          evidenceIds: ["evidence-required"],
        },
      ],
      cutoffAt: "2026-07-20T00:15:00+00:00",
      version: 1,
    });

    expect(() =>
      assertPointInTimeCatalystAssessment({
        assessment,
        move,
        catalysts: [event],
        evidence: [],
      }),
    ).toThrow(/unknown evidence/);

    expect(() =>
      assertPointInTimeCatalystAssessment({
        assessment,
        move,
        catalysts: [event],
        evidence: [
          assessmentEvidence("evidence-required", {
            instrumentId: "KRX:654321",
          }),
        ],
      }),
    ).toThrow(/instrument/);

    expect(() =>
      assertPointInTimeCatalystAssessment({
        assessment,
        move,
        catalysts: [event],
        evidence: [
          assessmentEvidence("evidence-required", {
            obtainedAt: "2026-07-20T00:16:00+00:00",
          }),
        ],
      }),
    ).toThrow(/obtained after/);
  });
});
