import { describe, expect, it } from "vitest";

import { analyzeThemeLeadership } from "../src/analysis/theme-leadership.js";
import {
  InstrumentThemeMappingSchema,
  ThemeLeadershipInputSchema,
} from "../src/contracts/theme-leadership.js";

const asOf = "2026-07-20T02:00:00+00:00";

function evidence(id: string) {
  return [
    {
      id: `evidence-${id}`,
      source: "OPEN_DART_BUSINESS_REPORT" as const,
      sourceDocumentId: `dart-${id}`,
      canonicalUrl: `https://dart.fss.or.kr/${id}`,
      asOf: "2026-07-19T00:00:00+00:00",
    },
  ];
}

function mapping(instrumentId: string, nodeId: string, allocationWeight = "1") {
  return {
    instrumentId,
    nodeId,
    allocationWeight,
    confidence: "0.9",
    asOf: "2026-07-19T00:00:00+00:00",
    validFrom: "2026-01-01T00:00:00+00:00",
    validTo: null,
    evidence: evidence(`${instrumentId}-${nodeId}`),
  };
}

function snapshot(
  instrumentId: string,
  current: string,
  median: string | null,
  changePct = "3",
  observedAt = "2026-07-20T01:59:55+00:00",
) {
  return {
    instrumentId,
    sessionDate: "2026-07-20",
    observedAt,
    elapsedMinutes: 180,
    baselineElapsedMinutes: 180,
    cumulativeTurnoverKrw: current,
    median20TurnoverKrwSameElapsed: median,
    changePct,
    dataQuality: "LIVE" as const,
    source: "KIS_CANONICAL_MARKET_DATA" as const,
  };
}

function baseInput() {
  return {
    asOf,
    sessionDate: "2026-07-20",
    staleAfterSeconds: 30,
    marketTurnoverKrw: "10000000000",
    marketTurnoverObservedAt: "2026-07-20T01:59:55+00:00",
    marketDataQuality: "LIVE" as const,
    rankingSource: "KIS_CANONICAL_RANKING" as const,
    taxonomy: [
      {
        id: "semiconductor",
        labelKo: "반도체",
        kind: "INDUSTRY" as const,
        parentId: null,
      },
      {
        id: "semiconductor.equipment",
        labelKo: "장비",
        kind: "SUBTHEME" as const,
        parentId: "semiconductor",
      },
      {
        id: "power",
        labelKo: "전력",
        kind: "INDUSTRY" as const,
        parentId: null,
      },
    ],
    instruments: [
      {
        instrumentId: "KRX:000001",
        symbol: "000001",
        nameKo: "반도체장비A",
        venue: "KOSPI" as const,
        securityType: "COMMON" as const,
        isLargeCap: false,
      },
      {
        instrumentId: "KRX:000002",
        symbol: "000002",
        nameKo: "반도체장비B",
        venue: "KOSDAQ" as const,
        securityType: "COMMON" as const,
        isLargeCap: false,
      },
      {
        instrumentId: "KRX:000003",
        symbol: "000003",
        nameKo: "반도체장비C",
        venue: "KOSDAQ" as const,
        securityType: "COMMON" as const,
        isLargeCap: false,
      },
      {
        instrumentId: "KRX:000004",
        symbol: "000004",
        nameKo: "반도체ETF",
        venue: "KOSPI" as const,
        securityType: "ETF" as const,
        isLargeCap: false,
      },
    ],
    mappings: [
      mapping("KRX:000001", "semiconductor.equipment"),
      mapping("KRX:000001", "semiconductor"),
      mapping("KRX:000002", "semiconductor.equipment"),
      mapping("KRX:000003", "semiconductor.equipment"),
      mapping("KRX:000004", "semiconductor.equipment"),
    ],
    snapshots: [
      snapshot("KRX:000001", "400000000", "100000000"),
      snapshot("KRX:000002", "350000000", "100000000"),
      snapshot("KRX:000003", "250000000", "50000000"),
      snapshot("KRX:000004", "5000000000", "100000000"),
    ],
  };
}

describe("theme leadership analysis", () => {
  it("finds a broad leading semiconductor equipment theme without double counting", () => {
    const report = analyzeThemeLeadership(
      ThemeLeadershipInputSchema.parse(baseInput()),
    );
    const parent = report.themes.find(
      (theme) => theme.nodeId === "semiconductor",
    );
    const equipment = report.themes.find(
      (theme) => theme.nodeId === "semiconductor.equipment",
    );

    expect(parent?.turnoverKrw).toBe("1000000000");
    expect(equipment?.turnoverKrw).toBe("1000000000");
    expect(equipment?.turnoverAcceleration).toBe("4");
    expect(equipment?.marketTurnoverSharePct).toBe("10");
    expect(equipment?.advancingBreadthPct).toBe("100");
    expect(equipment?.top1ConcentrationPct).toBe("40");
    expect(equipment?.top3ConcentrationPct).toBe("100");
    expect(equipment?.structure).toBe("BROAD");
    expect(equipment?.status).toBe("LEADING");
    expect(equipment?.pathLabelsKo).toEqual(["반도체", "장비"]);
    expect(report.excludedInstrumentIds).toEqual(["KRX:000004"]);
    expect(
      report.stockLeaders.map((stock) => stock.instrumentId),
    ).not.toContain("KRX:000004");
  });

  it("rejects overlapping multi-theme allocation above one", () => {
    const input = baseInput();
    input.mappings = [
      mapping("KRX:000001", "semiconductor.equipment", "0.7"),
      mapping("KRX:000001", "power", "0.5"),
    ];

    expect(() =>
      analyzeThemeLeadership(ThemeLeadershipInputSchema.parse(input)),
    ).toThrow(/allocation exceeds 1/);
  });

  it("returns N_A for zero denominators and STALE for expired observations", () => {
    const zero = baseInput();
    zero.marketTurnoverKrw = "0";
    zero.snapshots = [
      snapshot("KRX:000001", "0", "0"),
      snapshot("KRX:000002", "0", null),
      snapshot("KRX:000003", "0", "0"),
    ];
    const zeroReport = analyzeThemeLeadership(
      ThemeLeadershipInputSchema.parse(zero),
    );
    const zeroTheme = zeroReport.themes.find(
      (theme) => theme.nodeId === "semiconductor.equipment",
    );
    expect(zeroTheme?.availability).toBe("N_A");
    expect(zeroTheme?.leadershipScore).toBeNull();
    expect(zeroTheme?.marketTurnoverSharePct).toBeNull();
    expect(zeroTheme?.turnoverAcceleration).toBeNull();
    expect(zeroReport.warnings).toContain("MARKET_TURNOVER_UNAVAILABLE");

    const stale = baseInput();
    stale.snapshots = stale.snapshots.map((item) => ({
      ...item,
      observedAt: "2026-07-20T01:00:00+00:00",
    }));
    const staleReport = analyzeThemeLeadership(
      ThemeLeadershipInputSchema.parse(stale),
    );
    const staleTheme = staleReport.themes.find(
      (theme) => theme.nodeId === "semiconductor.equipment",
    );
    expect(staleTheme?.availability).toBe("STALE");
    expect(staleTheme?.status).toBeNull();
  });

  it("marks a large-cap single-name surge as rotation rather than broad leadership", () => {
    const input = baseInput();
    const largeCap = input.instruments[0];
    if (!largeCap) throw new Error("Missing large-cap fixture");
    input.instruments[0] = {
      ...largeCap,
      isLargeCap: true,
    };
    input.snapshots = [
      snapshot("KRX:000001", "800000000", "100000000"),
      snapshot("KRX:000002", "100000000", "50000000"),
      snapshot("KRX:000003", "100000000", "50000000"),
    ];
    const report = analyzeThemeLeadership(
      ThemeLeadershipInputSchema.parse(input),
    );
    const equipment = report.themes.find(
      (theme) => theme.nodeId === "semiconductor.equipment",
    );

    expect(equipment?.top1ConcentrationPct).toBe("80");
    expect(equipment?.structure).toBe("LARGE_CAP_SINGLE_NAME");
    expect(equipment?.status).toBe("ROTATING");
  });

  it("enforces exact decimal and validity boundaries in the mapping contract", () => {
    expect(() =>
      InstrumentThemeMappingSchema.parse({
        ...mapping("KRX:000001", "semiconductor.equipment"),
        allocationWeight: "0.1e1",
      }),
    ).toThrow();
    expect(() =>
      InstrumentThemeMappingSchema.parse({
        ...mapping("KRX:000001", "semiconductor.equipment"),
        allocationWeight: "0.00",
      }),
    ).toThrow(/greater than zero/);
    expect(() =>
      InstrumentThemeMappingSchema.parse({
        ...mapping("KRX:000001", "semiconductor.equipment"),
        validTo: "2025-12-31T00:00:00+00:00",
      }),
    ).toThrow(/validTo/);
  });

  it("rejects a baseline measured at a different elapsed session time", () => {
    const input = baseInput();
    const firstSnapshot = input.snapshots[0];
    if (!firstSnapshot) throw new Error("Missing snapshot fixture");
    input.snapshots[0] = {
      ...firstSnapshot,
      baselineElapsedMinutes: 179,
    };

    expect(() =>
      analyzeThemeLeadership(ThemeLeadershipInputSchema.parse(input)),
    ).toThrow(/not aligned/);
  });

  it("rejects future observations and a mismatched Korean session date", () => {
    const futureSnapshot = baseInput();
    futureSnapshot.snapshots = [
      snapshot(
        "KRX:000001",
        "400000000",
        "100000000",
        "3",
        "2026-07-20T03:00:00+00:00",
      ),
    ];
    expect(() => ThemeLeadershipInputSchema.parse(futureSnapshot)).toThrow(
      /after asOf/,
    );

    const futureMarket = baseInput();
    futureMarket.marketTurnoverObservedAt = "2026-07-20T03:00:00+00:00";
    expect(() => ThemeLeadershipInputSchema.parse(futureMarket)).toThrow(
      /after asOf/,
    );

    const wrongDate = baseInput();
    wrongDate.sessionDate = "2026-07-19";
    expect(() => ThemeLeadershipInputSchema.parse(wrongDate)).toThrow(
      /Asia\/Seoul/,
    );
  });

  it("rejects instrument or aggregate turnover above market turnover", () => {
    const impossible = baseInput();
    impossible.marketTurnoverKrw = "1";
    impossible.snapshots = [snapshot("KRX:000001", "1000000", "1")];
    expect(() => ThemeLeadershipInputSchema.parse(impossible)).toThrow(
      /exceeds market turnover/,
    );
  });

  it("rejects duplicate taxonomy and instrument identities", () => {
    const duplicateTaxonomy = baseInput();
    const firstNode = duplicateTaxonomy.taxonomy[0];
    if (!firstNode) throw new Error("Missing taxonomy fixture");
    duplicateTaxonomy.taxonomy.push({ ...firstNode });
    expect(() => ThemeLeadershipInputSchema.parse(duplicateTaxonomy)).toThrow(
      /Duplicate taxonomy node id/,
    );

    const duplicateInstrument = baseInput();
    const firstInstrument = duplicateInstrument.instruments[0];
    if (!firstInstrument) throw new Error("Missing instrument fixture");
    duplicateInstrument.instruments.push({ ...firstInstrument });
    expect(() => ThemeLeadershipInputSchema.parse(duplicateInstrument)).toThrow(
      /Duplicate instrument id/,
    );
  });

  it("uses the latest mapping when decimal confidence is numerically equal", () => {
    const input = baseInput();
    input.mappings.push({
      ...mapping("KRX:000001", "semiconductor.equipment", "0.5"),
      confidence: "0.90",
      asOf: "2026-07-19T01:00:00+00:00",
    });

    const report = analyzeThemeLeadership(
      ThemeLeadershipInputSchema.parse(input),
    );
    expect(
      report.themes.find((theme) => theme.nodeId === "semiconductor.equipment")
        ?.turnoverKrw,
    ).toBe("800000000");
  });
});
