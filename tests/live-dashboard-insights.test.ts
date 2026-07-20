import { describe, expect, it } from "vitest";

import type {
  DesktopInformationFeedProjection,
  DesktopRankingItemProjection,
  DesktopRankingProjection,
} from "../apps/desktop/src/shared/desktop-contracts.js";
import {
  buildLiveInformationInsights,
  buildLiveThemeLeaders,
} from "../apps/desktop/src/renderer/model/live-dashboard-insights.js";

function rankingItem(
  overrides: Partial<DesktopRankingItemProjection>,
): DesktopRankingItemProjection {
  return {
    rank: "1",
    instrumentId: "KRX:005930",
    symbol: "005930",
    name: "삼성전자",
    price: "244000",
    change: "-11000",
    changeRate: "-4.31",
    cumulativeVolume: "26804038",
    previousVolume: "25000000",
    averageVolume: null,
    volumeIncreaseRate: "7.21",
    volumeTurnoverRate: null,
    averageTurnover: null,
    turnoverTurnoverRate: null,
    cumulativeTurnover: "6614607186368",
    ...overrides,
  };
}

function ranking(
  items: readonly DesktopRankingItemProjection[],
): DesktopRankingProjection {
  return {
    schemaVersion: 1,
    market: "KRX",
    sort: "TURNOVER",
    state: "READY",
    source: "KIS_REST",
    fetchedAt: "2026-07-20T15:20:00.000Z",
    statusMessage: "KIS 최근 조회 거래일",
    items,
  };
}

function informationFeed(): DesktopInformationFeedProjection {
  return {
    schemaVersion: 1,
    state: "PARTIAL",
    fetchedAt: "2026-07-20T15:20:00.000Z",
    statusMessage: "2개 provider 연결",
    sources: [
      {
        provider: "KIS_DOMESTIC_NEWS",
        state: "READY",
        itemCount: 2,
        message: "정상",
      },
      {
        provider: "OPEN_DART",
        state: "READY",
        itemCount: 1,
        message: "정상",
      },
    ],
    items: [
      {
        id: "kis-related",
        provider: "KIS_DOMESTIC_NEWS",
        kind: "NEWS",
        titleOriginal: "삼성전자 HBM 공급 계획 재확인",
        titleKorean: null,
        summaryKorean: null,
        sourceName: "연합뉴스",
        sourceLanguage: "ko",
        publishedAt: "2026-07-20T15:10:00.000Z",
        publishedAtPrecision: "SECOND",
        obtainedAt: "2026-07-20T15:11:00.000Z",
        canonicalUrl: null,
        rights: "KIS_HEADLINE_ONLY",
        relatedInstrumentIds: ["KRX:005930"],
      },
      {
        id: "kis-macro",
        provider: "KIS_DOMESTIC_NEWS",
        kind: "NEWS",
        titleOriginal: "미 연준 금리 경로와 달러 환율 주목",
        titleKorean: null,
        summaryKorean: null,
        sourceName: "경제신문",
        sourceLanguage: "ko",
        publishedAt: "2026-07-20T15:15:00.000Z",
        publishedAtPrecision: "SECOND",
        obtainedAt: "2026-07-20T15:16:00.000Z",
        canonicalUrl: null,
        rights: "KIS_HEADLINE_ONLY",
        relatedInstrumentIds: [],
      },
      {
        id: "dart-date-only",
        provider: "OPEN_DART",
        kind: "DISCLOSURE",
        titleOriginal: "단일판매·공급계약 · 예시기업",
        titleKorean: null,
        summaryKorean: null,
        sourceName: "OpenDART",
        sourceLanguage: "ko",
        publishedAt: "2026-07-19T15:00:00.000Z",
        publishedAtPrecision: "DATE",
        obtainedAt: "2026-07-20T15:17:00.000Z",
        canonicalUrl:
          "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260720000001",
        rights: "PUBLIC_FILING",
        relatedInstrumentIds: ["KRX:005930"],
      },
    ],
  };
}

describe("live dashboard insight projections", () => {
  it("builds only ranking-sample theme candidates without claiming leadership or acceleration", () => {
    const projection = buildLiveThemeLeaders(
      ranking([
        rankingItem({}),
        rankingItem({
          rank: "2",
          instrumentId: "KRX:000660",
          symbol: "000660",
          name: "SK하이닉스",
          changeRate: "3.20",
          cumulativeTurnover: "398800000000",
        }),
        rankingItem({
          rank: "3",
          instrumentId: "KRX:069500",
          symbol: "069500",
          name: "KODEX 200",
          cumulativeTurnover: "9000000000000",
        }),
      ]),
    );

    expect(projection.items).toHaveLength(1);
    expect(projection.items[0]).toMatchObject({
      name: "반도체 · 소부장",
      mode: "RANKING_SAMPLE",
      state: "CANDIDATE",
      acceleration: "N/A",
      leaderName: "삼성전자",
      breadth: "1/2",
    });
    expect(projection.items[0]?.evidenceLabel).toContain("상위 표본");
    expect(projection.items.some((item) => item.state === "LEADING")).toBe(
      false,
    );
  });

  it("does not reinterpret a non-turnover ranking as theme leadership", () => {
    expect(
      buildLiveThemeLeaders({
        ...ranking([]),
        sort: "VOLUME_INCREASE",
      }).items,
    ).toEqual([]);
  });

  it("prioritizes exact instrument news while keeping impact neutral and rights honest", () => {
    const projection = buildLiveInformationInsights(
      informationFeed(),
      "KRX:005930",
    );

    expect(projection.news[0]).toMatchObject({
      id: "kis-related",
      impact: "neutral",
      evidenceCount: 1,
    });
    expect(projection.news[0]?.summaryKo).toContain("본문과 요약은 수집하지");
    expect(
      projection.news.some((item) => item.id === "kis-macro"),
    ).toBe(false);
    expect(
      projection.news.find((item) => item.id === "dart-date-only")
        ?.publishedAtLabel,
    ).toBe("2026. 07. 20. · 시각 미제공");
  });

  it("creates WATCH-only market context candidates without a price reaction claim", () => {
    const projection = buildLiveInformationInsights(
      informationFeed(),
      "KRX:005930",
    );

    expect(projection.contexts).toHaveLength(1);
    expect(projection.contexts[0]).toMatchObject({
      id: "macro",
      status: "WATCH",
      title: "금리 · 환율 · 경기",
    });
    expect(projection.contexts[0]?.observedReaction).toContain(
      "가격 반응 미연결",
    );
    expect(projection.contexts[0]?.confidenceLabel).toContain("인과 미확정");
  });

  it("excludes stale, date-only and failed-provider items from intraday context", () => {
    const base = informationFeed();
    const projection = buildLiveInformationInsights(
      {
        ...base,
        sources: [
          ...base.sources,
          {
            provider: "KIS_OVERSEAS_NEWS",
            state: "ERROR",
            itemCount: 1,
            message: "실패",
          },
        ],
        items: [
          ...base.items,
          {
            ...base.items[1]!,
            id: "stale-ready-news",
            titleOriginal: "연준 금리 과거 기사",
            publishedAt: "2026-07-18T15:15:00.000Z",
          },
          {
            ...base.items[1]!,
            id: "failed-provider-news",
            provider: "KIS_OVERSEAS_NEWS",
            titleOriginal: "전쟁 제재 과거 캐시",
          },
        ],
      },
      "KRX:005930",
    );

    expect(projection.contexts).toHaveLength(1);
    expect(projection.contexts[0]?.id).toBe("macro");
    expect(projection.contexts[0]?.observedReaction).toContain("1건");
    expect(projection.contexts[0]?.confidenceLabel).toContain("최근 24시간");
  });

  it("uses the original SEC title until completed translation provenance is available", () => {
    const base = informationFeed();
    const projection = buildLiveInformationInsights(
      {
        ...base,
        items: [
          {
            ...base.items[2]!,
            id: "sec-partial",
            provider: "SEC_EDGAR",
            titleOriginal: "8-K Current report",
            titleKorean: "8-K 주요 보고서",
            sourceName: "SEC EDGAR",
            sourceLanguage: "en",
            relatedInstrumentIds: ["NASDAQ:NVDA"],
          },
        ],
      },
      "NASDAQ:NVDA",
    );

    expect(projection.news[0]?.titleKo).toBe("8-K Current report");
    expect(projection.news[0]?.summaryKo).toContain("원문 제목");
  });

  it("routes theme news to matching instruments without leaking defense news into Samsung Electronics", () => {
    const base = informationFeed();
    const themeFeed: DesktopInformationFeedProjection = {
      ...base,
      state: "READY",
      items: [
        {
          ...base.items[1]!,
          id: "semiconductor-theme",
          titleOriginal: "HBM 메모리 공급 확대와 반도체 후공정 투자",
          relatedInstrumentIds: [],
        },
        {
          ...base.items[1]!,
          id: "ai-theme",
          titleOriginal: "생성형 AI 칩 수요 확대",
          relatedInstrumentIds: [],
        },
        {
          ...base.items[1]!,
          id: "patriot-defense-theme",
          titleOriginal: "패트리엇 미사일 추가 도입 검토",
          relatedInstrumentIds: ["KRX:079550"],
        },
        {
          ...base.items[1]!,
          id: "nuclear-theme",
          titleOriginal: "SMR 원전 수주 협력 확대",
          relatedInstrumentIds: ["KRX:034020"],
        },
        {
          ...base.items[1]!,
          id: "power-grid-theme",
          titleOriginal: "변압기와 송전 전력망 투자 확대",
          relatedInstrumentIds: [],
        },
      ],
    };

    const samsung = buildLiveInformationInsights(
      themeFeed,
      "KRX:005930",
      "삼성전자",
    );
    expect(samsung.news.map((item) => item.id)).toEqual([
      "semiconductor-theme",
      "ai-theme",
    ]);
    expect(samsung.news.every((item) => item.relation === "THEME")).toBe(
      true,
    );
    expect(samsung.news[0]?.relationLabel).toContain("반도체");
    expect(
      samsung.news.some((item) => item.id === "patriot-defense-theme"),
    ).toBe(false);

    const defense = buildLiveInformationInsights(
      themeFeed,
      "KRX:012450",
      "한화에어로스페이스",
    );
    expect(
      defense.news.find((item) => item.id === "patriot-defense-theme"),
    ).toMatchObject({
      relation: "THEME",
      relationLabel: "방산 · 우주항공 테마",
    });

    const nuclear = buildLiveInformationInsights(
      themeFeed,
      "KRX:052690",
      "한전기술",
    );
    expect(
      nuclear.news.find((item) => item.id === "nuclear-theme"),
    ).toMatchObject({
      relation: "THEME",
      relationLabel: "원전 · SMR 테마",
    });

    const powerGrid = buildLiveInformationInsights(
      themeFeed,
      "KRX:267260",
      "HD현대일렉트릭",
    );
    expect(
      powerGrid.news.find((item) => item.id === "power-grid-theme"),
    ).toMatchObject({
      relation: "THEME",
      relationLabel: "전력기기 · 전력망 테마",
    });
  });
});
