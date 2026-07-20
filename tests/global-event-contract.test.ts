import { describe, expect, it } from "vitest";

import {
  GlobalEventEvidenceSchema,
  GlobalEventCoverageCategorySchema,
  GlobalEventCoverageRegistrySchema,
  GlobalEventFeedSchema,
  GlobalEventImpactAssessmentSchema,
  GlobalEventSchema,
  KoreaMarketObservationSchema,
  MacroSurpriseSchema,
  assertPointInTimeGlobalEventAssessment,
  type GlobalEvent,
  type GlobalEventEvidence,
  type GlobalEventImpactAssessment,
  type KoreaMarketObservation,
} from "../src/contracts/global-event.js";

const hash = "a".repeat(64);

function officialEvidence(
  overrides: Partial<GlobalEventEvidence> = {},
): GlobalEventEvidence {
  return GlobalEventEvidenceSchema.parse({
    id: "evidence-ukmto-1",
    provider: "UKMTO",
    tier: "OFFICIAL_PRIMARY",
    sourceDocumentId: "ukmto-warning-1",
    canonicalUrl: "https://www.ukmto.org/example-warning",
    documentHash: hash,
    sourceLanguage: "en",
    rights: "OFFICIAL_PUBLIC",
    headlineOnly: false,
    publishedAt: "2026-07-20T00:00:00Z",
    obtainedAt: "2026-07-20T00:00:30Z",
    detectedAt: "2026-07-20T00:00:40Z",
    ...overrides,
  });
}

function event(overrides: Partial<GlobalEvent> = {}): GlobalEvent {
  return GlobalEventSchema.parse({
    id: "event-hormuz-1",
    provider: "UKMTO",
    sourceEventId: "ukmto-warning-1",
    type: "HORMUZ_DISRUPTION",
    status: "OFFICIAL_ALERT",
    severity: "MATERIAL",
    titleOriginal: "Advisory for vessels near the Strait of Hormuz",
    sourceLanguage: "en",
    translation: {
      status: "COMPLETE",
      textKo: "호르무즈 해협 인근 선박에 대한 주의보",
      translatedAt: "2026-07-20T00:01:00Z",
      translator: "LOCAL_MACHINE",
    },
    regions: ["Middle East"],
    affectedRoutes: ["HORMUZ"],
    publishedAt: "2026-07-20T00:00:00Z",
    obtainedAt: "2026-07-20T00:00:30Z",
    detectedAt: "2026-07-20T00:00:40Z",
    evidenceIds: ["evidence-ukmto-1"],
    dedupeFingerprint: hash,
    ...overrides,
  });
}

function observation(
  overrides: Partial<KoreaMarketObservation> = {},
): KoreaMarketObservation {
  return KoreaMarketObservationSchema.parse({
    id: "observation-kospi-1",
    role: "KOSPI",
    instrumentId: "KRX:KOSPI",
    representation: "OFFICIAL_INDEX_OR_SPOT",
    source: "KIS_MARKET_DATA",
    dataQuality: "LIVE",
    windowStartAt: "2026-07-20T00:00:00Z",
    windowEndAt: "2026-07-20T00:05:00Z",
    observedAt: "2026-07-20T00:05:01Z",
    latencyMs: 1000,
    returnPct: "-1.25",
    ...overrides,
  });
}

function assessment(
  overrides: Partial<GlobalEventImpactAssessment> = {},
): GlobalEventImpactAssessment {
  return GlobalEventImpactAssessmentSchema.parse({
    id: "assessment-1",
    eventId: "event-hormuz-1",
    relationship: "PLAUSIBLE_CONTEXT",
    direction: "RISK_OFF",
    confidence: "MEDIUM",
    channels: [
      {
        role: "KOSPI",
        observedDirection: "DOWN",
        observationIds: ["observation-kospi-1"],
      },
    ],
    observationIds: ["observation-kospi-1"],
    claims: [
      {
        id: "claim-1",
        kind: "MARKET_REACTION",
        textKo:
          "공식 해상 주의보 이후 코스피 하락이 관측됐지만 직접 인과로 확정할 수 없습니다.",
        evidenceIds: ["evidence-ukmto-1"],
        observationIds: ["observation-kospi-1"],
      },
    ],
    counterEvidence: [
      {
        id: "counter-1",
        textKo: "동일 구간 코스닥 반응은 별도로 확인해야 합니다.",
        evidenceIds: [],
        observationIds: ["observation-kospi-1"],
      },
    ],
    freshness: "NEAR_REAL_TIME",
    latencyMs: 1000,
    asOfAt: "2026-07-20T00:05:01Z",
    cutoffAt: "2026-07-20T00:06:00Z",
    version: 1,
    ...overrides,
  });
}

describe("global event source contracts", () => {
  it("requires a Reuters license reference", () => {
    expect(() =>
      officialEvidence({
        provider: "LICENSED_REUTERS",
        tier: "LICENSED_NEWS",
        rights: "LICENSED",
      }),
    ).toThrow(/license reference/);
  });

  it("keeps KIS overseas news as contract-scoped headline evidence", () => {
    expect(() =>
      officialEvidence({
        provider: "KIS_OVERSEAS_NEWS_HEADLINE",
        tier: "KIS_NEWS_HEADLINE",
        rights: "KIS_CONTRACT",
        headlineOnly: false,
      }),
    ).toThrow(/headline source/);
  });

  it("accepts a linear three-version supersession chain", () => {
    const first = event();
    const second = event({
      id: "event-hormuz-2",
      sourceEventId: "ukmto-warning-2",
      status: "UPDATED",
      detectedAt: "2026-07-20T00:00:50Z",
      supersedesEventId: first.id,
    });
    const third = event({
      id: "event-hormuz-3",
      sourceEventId: "ukmto-warning-3",
      status: "RESOLVED",
      detectedAt: "2026-07-20T00:01:00Z",
      supersedesEventId: second.id,
    });

    expect(GlobalEventFeedSchema.parse([third, first, second])).toHaveLength(3);
  });

  it("rejects a branching supersession chain", () => {
    const first = event();
    const second = event({
      id: "event-hormuz-2",
      sourceEventId: "ukmto-warning-2",
      detectedAt: "2026-07-20T00:00:50Z",
      supersedesEventId: first.id,
    });
    const branch = event({
      id: "event-hormuz-branch",
      sourceEventId: "ukmto-warning-branch",
      detectedAt: "2026-07-20T00:01:00Z",
      supersedesEventId: first.id,
    });
    expect(() => GlobalEventFeedSchema.parse([first, second, branch])).toThrow(
      /cannot branch/,
    );
  });
});

describe("Korean market reaction contract", () => {
  it("labels free oil data as the USO ETF proxy and never CME futures", () => {
    expect(
      KoreaMarketObservationSchema.parse({
        ...observation(),
        id: "observation-oil-1",
        role: "OIL_DIRECTION_PROXY",
        instrumentId: "NYSEARCA:USO",
        representation: "ETF_PROXY",
        dataQuality: "PROXY_LIVE",
      }).instrumentId,
    ).toBe("NYSEARCA:USO");

    expect(() =>
      KoreaMarketObservationSchema.parse({
        ...observation(),
        role: "OIL_DIRECTION_PROXY",
        instrumentId: "CME:CL",
        representation: "OFFICIAL_INDEX_OR_SPOT",
        dataQuality: "LIVE",
      }),
    ).toThrow(/not a CME futures quote/);
  });

  it("rejects market observations that occur after assessment asOfAt", () => {
    expect(() =>
      assertPointInTimeGlobalEventAssessment({
        assessment: assessment(),
        event: event(),
        evidence: [officialEvidence()],
        observations: [
          observation({
            windowEndAt: "2026-07-20T00:07:00Z",
            observedAt: "2026-07-20T00:07:01Z",
          }),
        ],
      }),
    ).toThrow(/unavailable at asOfAt/);
  });

  it("rejects evidence obtained after assessment asOfAt", () => {
    expect(() =>
      assertPointInTimeGlobalEventAssessment({
        assessment: assessment(),
        event: event(),
        evidence: [
          officialEvidence({
            obtainedAt: "2026-07-20T00:07:00Z",
            detectedAt: "2026-07-20T00:07:01Z",
          }),
        ],
        observations: [observation()],
      }),
    ).toThrow(/unavailable at asOfAt/);
  });

  it("requires completed Korean translation before an English event is assessed", () => {
    const untranslated = event({
      translation: {
        status: "PENDING",
      },
    });
    expect(() =>
      assertPointInTimeGlobalEventAssessment({
        assessment: assessment(),
        event: untranslated,
        evidence: [officialEvidence()],
        observations: [observation()],
      }),
    ).toThrow(/completed Korean translation/);
  });

  it("validates a point-in-time, evidence-backed assessment", () => {
    expect(() =>
      assertPointInTimeGlobalEventAssessment({
        assessment: assessment(),
        event: event(),
        evidence: [officialEvidence()],
        observations: [observation()],
      }),
    ).not.toThrow();
  });

  it("treats equivalent timestamp offsets as the same provider instant", () => {
    const offsetEvent = event({
      publishedAt: "2026-07-20T09:00:00+09:00",
      obtainedAt: "2026-07-20T09:00:30+09:00",
      detectedAt: "2026-07-20T09:00:40+09:00",
    });
    expect(() =>
      assertPointInTimeGlobalEventAssessment({
        assessment: assessment(),
        event: offsetEvent,
        evidence: [officialEvidence()],
        observations: [observation()],
      }),
    ).not.toThrow();
  });

  it("does not allow headline-only news to support HIGH confidence", () => {
    const kisEvidence = officialEvidence({
      id: "evidence-kis-news-1",
      provider: "KIS_OVERSEAS_NEWS_HEADLINE",
      tier: "KIS_NEWS_HEADLINE",
      rights: "KIS_CONTRACT",
      headlineOnly: true,
    });
    const kisEvent = event({
      provider: "KIS_OVERSEAS_NEWS_HEADLINE",
      evidenceIds: [kisEvidence.id],
    });
    const high = assessment({
      relationship: "OFFICIAL_LINKAGE",
      confidence: "HIGH",
      claims: [
        {
          id: "claim-high",
          kind: "OFFICIAL_LINKAGE",
          textKo: "라이선스 범위의 뉴스 제목과 시장 반응을 함께 확인했습니다.",
          evidenceIds: [kisEvidence.id, "evidence-ukmto-1"],
          observationIds: ["observation-kospi-1"],
        },
      ],
    });

    expect(() =>
      assertPointInTimeGlobalEventAssessment({
        assessment: high,
        event: kisEvent,
        evidence: [kisEvidence, officialEvidence()],
        observations: [observation()],
      }),
    ).toThrow(/official identity evidence/);
  });

  it("does not allow event language to bypass provider-source translation", () => {
    const disguisedAsKorean = event({
      sourceLanguage: "ko",
      translation: { status: "NOT_REQUIRED" },
    });
    expect(() =>
      assertPointInTimeGlobalEventAssessment({
        assessment: assessment(),
        event: disguisedAsKorean,
        evidence: [officialEvidence()],
        observations: [observation()],
      }),
    ).toThrow(/language and timestamps/);
  });

  it("represents unavailable analysis without inventing a market observation", () => {
    const unavailable = assessment({
      relationship: "INSUFFICIENT_EVIDENCE",
      direction: "NO_CLEAR_SIGNAL",
      confidence: "NONE",
      channels: [],
      observationIds: [],
      claims: [
        {
          id: "claim-unavailable",
          kind: "CONTEXT_LIMITATION",
          textKo: "시장 관측 feed가 offline이라 영향 방향을 판정하지 않습니다.",
          evidenceIds: ["evidence-ukmto-1"],
          observationIds: [],
        },
      ],
      counterEvidence: [],
      freshness: "OFFLINE",
    });
    expect(() =>
      assertPointInTimeGlobalEventAssessment({
        assessment: unavailable,
        event: event(),
        evidence: [officialEvidence()],
        observations: [],
      }),
    ).not.toThrow();
  });

  it("rejects a spoofed direct-Korea role before HIGH confidence evaluation", () => {
    expect(() =>
      KoreaMarketObservationSchema.parse({
        ...observation(),
        role: "KOSPI",
        instrumentId: "NASDAQ:AAPL",
        representation: "OFFICIAL_INDEX_OR_SPOT",
        source: "US_TREASURY_OFFICIAL",
      }),
    ).toThrow(/canonical KIS identity/);
  });

  it("keeps an AI release, valuation hypothesis, and counter-evidence separate", () => {
    const aiEvidence = officialEvidence({
      id: "evidence-ai-release-1",
      provider: "AI_LAB_OFFICIAL",
      tier: "ISSUER_PRIMARY",
      rights: "ISSUER_PUBLIC",
      sourceDocumentId: "model-price-release-1",
      canonicalUrl: "https://example-ai-lab.test/model-release",
    });
    const earningsEvidence = officialEvidence({
      id: "evidence-issuer-earnings-1",
      provider: "ISSUER_IR",
      tier: "ISSUER_PRIMARY",
      rights: "ISSUER_PUBLIC",
      sourceDocumentId: "issuer-earnings-1",
      canonicalUrl: "https://issuer.example.test/investor-relations",
    });
    const aiEvent = event({
      id: "event-ai-release-1",
      provider: "AI_LAB_OFFICIAL",
      sourceEventId: "model-price-release-1",
      type: "AI_MODEL_OR_PRICING_RELEASE",
      titleOriginal: "New model pricing and benchmark release",
      affectedRoutes: [],
      evidenceIds: [aiEvidence.id],
      dedupeFingerprint: "b".repeat(64),
    });
    const qqq = observation({
      id: "observation-qqq-1",
      role: "NASDAQ_DIRECTION_PROXY",
      instrumentId: "NASDAQ:QQQ",
      representation: "ETF_PROXY",
      dataQuality: "PROXY_LIVE",
      returnPct: "-2.10",
      volumeChangePct: "81.25",
      turnoverChangePct: "90.50",
    });
    const semiconductors = observation({
      id: "observation-kr-semiconductor-1",
      role: "SEMICONDUCTOR",
      instrumentId: "BASKET:KR-SEMICONDUCTOR",
      representation: "EQUITY_BASKET",
      returnPct: "-3.20",
      turnoverChangePct: "110.00",
    });
    const aiAssessment = assessment({
      id: "assessment-ai-1",
      eventId: aiEvent.id,
      channels: [
        {
          role: "NASDAQ_DIRECTION_PROXY",
          observedDirection: "DOWN",
          observationIds: [qqq.id],
        },
        {
          role: "SEMICONDUCTOR",
          observedDirection: "DOWN",
          observationIds: [semiconductors.id],
        },
      ],
      observationIds: [qqq.id, semiconductors.id],
      claims: [
        {
          id: "claim-ai-fact",
          kind: "EVENT_FACT",
          textKo: "경쟁 AI 모델의 가격과 benchmark가 공식 발표됐습니다.",
          evidenceIds: [aiEvidence.id],
          observationIds: [],
        },
        {
          id: "claim-ai-market",
          kind: "MARKET_REACTION",
          textKo:
            "발표 후 QQQ와 국내 반도체 basket 하락·거래대금 증가가 관측됐습니다.",
          evidenceIds: [aiEvidence.id],
          observationIds: [qqq.id, semiconductors.id],
        },
        {
          id: "claim-ai-hypothesis",
          kind: "TRANSMISSION_HYPOTHESIS",
          textKo:
            "낮은 AI 가격이 기존 기업의 valuation 압력으로 전달됐다는 설명은 가설입니다.",
          evidenceIds: [aiEvidence.id],
          observationIds: [qqq.id, semiconductors.id],
        },
      ],
      counterEvidence: [
        {
          id: "counter-earnings",
          textKo:
            "동일 cutoff까지 발표된 기업 실적도 기술주 반응의 대안 설명입니다.",
          evidenceIds: [earningsEvidence.id],
          observationIds: [],
        },
      ],
    });

    expect(() =>
      assertPointInTimeGlobalEventAssessment({
        assessment: aiAssessment,
        event: aiEvent,
        evidence: [aiEvidence, earningsEvidence],
        observations: [qqq, semiconductors],
      }),
    ).not.toThrow();
  });

  it("allows an AI event to remain insufficient while market reaction is unavailable", () => {
    const aiEvidence = officialEvidence({
      id: "evidence-ai-pending-1",
      provider: "AI_LAB_OFFICIAL",
      tier: "ISSUER_PRIMARY",
      rights: "ISSUER_PUBLIC",
      sourceDocumentId: "model-pending-1",
    });
    const aiEvent = event({
      id: "event-ai-pending-1",
      provider: "AI_LAB_OFFICIAL",
      sourceEventId: "model-pending-1",
      type: "AI_MODEL_OR_PRICING_RELEASE",
      evidenceIds: [aiEvidence.id],
      dedupeFingerprint: "d".repeat(64),
    });
    const pending = assessment({
      id: "assessment-ai-pending-1",
      eventId: aiEvent.id,
      relationship: "INSUFFICIENT_EVIDENCE",
      direction: "NO_CLEAR_SIGNAL",
      confidence: "NONE",
      channels: [],
      observationIds: [],
      claims: [
        {
          id: "claim-ai-pending",
          kind: "EVENT_FACT",
          textKo: "AI 모델 발표는 확인됐지만 아직 시장 관측값이 없습니다.",
          evidenceIds: [aiEvidence.id],
          observationIds: [],
        },
      ],
      counterEvidence: [],
      freshness: "OFFLINE",
    });
    expect(() =>
      assertPointInTimeGlobalEventAssessment({
        assessment: pending,
        event: aiEvent,
        evidence: [aiEvidence],
        observations: [],
      }),
    ).not.toThrow();
  });
});

describe("macro coverage and surprise contracts", () => {
  it("requires actual, consensus, prior, revision and release provenance", () => {
    const blsEvidence = officialEvidence({
      id: "evidence-us-cpi-1",
      provider: "US_BLS",
      sourceDocumentId: "us-cpi-2026-06",
      canonicalUrl: "https://www.bls.gov/example-cpi-release",
    });
    const consensusEvidence = officialEvidence({
      id: "evidence-licensed-consensus-1",
      provider: "LICENSED_REUTERS",
      tier: "LICENSED_NEWS",
      rights: "LICENSED",
      licenseReference: "personal-terminal-license-1",
      sourceDocumentId: "consensus-us-cpi-2026-06",
      canonicalUrl: "https://licensed.example.test/consensus",
    });
    const macroEvent = event({
      id: "event-us-cpi-1",
      provider: "US_BLS",
      sourceEventId: "us-cpi-2026-06",
      type: "MACRO_DATA_RELEASE",
      titleOriginal: "Consumer Price Index release",
      evidenceIds: [blsEvidence.id, consensusEvidence.id],
      dedupeFingerprint: "c".repeat(64),
      macroSurprise: {
        indicator: "CPI",
        economy: "US",
        unit: "PERCENT_YOY",
        actual: "2.8",
        consensus: "2.6",
        prior: "2.5",
        revisedPrior: "2.4",
        surprise: "0.2",
        surpriseDirection: "ABOVE_CONSENSUS",
        releaseAt: "2026-07-20T00:00:00Z",
        sourceEvidenceId: blsEvidence.id,
        consensusEvidenceId: consensusEvidence.id,
      },
    });
    const macroAssessment = assessment({
      id: "assessment-cpi-1",
      eventId: macroEvent.id,
      claims: [
        {
          id: "claim-cpi-fact",
          kind: "EVENT_FACT",
          textKo: "미국 CPI actual이 consensus를 상회했습니다.",
          evidenceIds: [blsEvidence.id],
          observationIds: [],
        },
        {
          id: "claim-cpi-reaction",
          kind: "MARKET_REACTION",
          textKo: "같은 관측 구간에 KOSPI 하락이 확인됐습니다.",
          evidenceIds: [blsEvidence.id],
          observationIds: ["observation-kospi-1"],
        },
      ],
      counterEvidence: [
        {
          id: "counter-cpi",
          textKo: "기업 실적과 수급도 같은 구간에 영향을 줄 수 있습니다.",
          evidenceIds: [blsEvidence.id],
          observationIds: [],
        },
      ],
    });

    expect(() =>
      assertPointInTimeGlobalEventAssessment({
        assessment: macroAssessment,
        event: macroEvent,
        evidence: [blsEvidence, consensusEvidence],
        observations: [observation()],
      }),
    ).not.toThrow();

    expect(() =>
      assertPointInTimeGlobalEventAssessment({
        assessment: macroAssessment,
        event: {
          ...macroEvent,
          evidenceIds: [blsEvidence.id],
          macroSurprise: {
            ...macroEvent.macroSurprise!,
            consensusEvidenceId: blsEvidence.id,
          },
        },
        evidence: [blsEvidence],
        observations: [observation()],
      }),
    ).toThrow(/licensed rights/);
  });

  it("computes surprise exactly as actual minus consensus", () => {
    const base = {
      indicator: "CPI" as const,
      economy: "US",
      unit: "PERCENT_YOY",
      actual: "2.8",
      consensus: "2.6",
      prior: "2.5",
      revisedPrior: "2.4",
      surprise: "0.2",
      surpriseDirection: "ABOVE_CONSENSUS" as const,
      releaseAt: "2026-07-20T00:00:00Z",
      sourceEvidenceId: "evidence-us-cpi-1",
      consensusEvidenceId: "evidence-consensus-1",
    };
    expect(MacroSurpriseSchema.parse(base).surprise).toBe("0.2");
    expect(() =>
      MacroSurpriseSchema.parse({ ...base, surprise: "-0.2" }),
    ).toThrow(/actual minus consensus/);
    expect(() =>
      MacroSurpriseSchema.parse({
        ...base,
        actual: "2.60",
        consensus: "2.6",
        surprise: "0",
        surpriseDirection: "ABOVE_CONSENSUS",
      }),
    ).toThrow(/surpriseDirection/);
  });

  it("requires every coverage category to report unavailable states honestly", () => {
    const entries = GlobalEventCoverageCategorySchema.options.map(
      (category) => ({
        category,
        status: "UNSUPPORTED" as const,
        providers: [],
        cadence: "UNKNOWN" as const,
        observedLatencyMs: null,
        revisionPolicy: "UNKNOWN" as const,
        rights: "NOT_APPLICABLE" as const,
        lastSuccessAt: null,
        reasonCode: "NOT_CONFIGURED",
      }),
    );
    expect(
      GlobalEventCoverageRegistrySchema.parse({
        generatedAt: "2026-07-20T00:06:00Z",
        entries,
      }).entries,
    ).toHaveLength(GlobalEventCoverageCategorySchema.options.length);

    expect(() =>
      GlobalEventCoverageRegistrySchema.parse({
        generatedAt: "2026-07-20T00:06:00Z",
        entries: entries.slice(1),
      }),
    ).toThrow(/missing categories/);
  });

  it("keeps IWM and EWY as KIS ETF proxies", () => {
    for (const [role, instrumentId] of [
      ["RUSSELL_DIRECTION_PROXY", "NYSEARCA:IWM"],
      ["KOREA_EQUITY_PROXY", "NYSEARCA:EWY"],
    ] as const) {
      expect(
        KoreaMarketObservationSchema.parse({
          ...observation(),
          role,
          instrumentId,
          representation: "ETF_PROXY",
          dataQuality: "PROXY_LIVE",
        }).instrumentId,
      ).toBe(instrumentId);
    }
    expect(() =>
      KoreaMarketObservationSchema.parse({
        ...observation(),
        role: "RUSSELL_DIRECTION_PROXY",
        instrumentId: "RUSSELL:RUT",
        representation: "OFFICIAL_INDEX_OR_SPOT",
        dataQuality: "LIVE",
      }),
    ).toThrow(/ETF PROXY_LIVE/);
  });

  it("keeps free US rates and broad-dollar context delayed and official", () => {
    expect(
      KoreaMarketObservationSchema.parse({
        ...observation(),
        role: "US_10Y_YIELD",
        instrumentId: "UST:10Y",
        representation: "OFFICIAL_YIELD",
        source: "US_TREASURY_OFFICIAL",
        dataQuality: "DELAYED",
        returnPct: undefined,
        value: "4.25",
        changeBps: "8",
      }).dataQuality,
    ).toBe("DELAYED");

    expect(() =>
      KoreaMarketObservationSchema.parse({
        ...observation(),
        role: "USD_BROAD_OFFICIAL",
        instrumentId: "FED:DTWEXBGS",
        representation: "OFFICIAL_INDEX_OR_SPOT",
        source: "US_FEDERAL_RESERVE_OFFICIAL",
        dataQuality: "LIVE",
      }),
    ).toThrow(/delayed Federal Reserve/);
  });
});
