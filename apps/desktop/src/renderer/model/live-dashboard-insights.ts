import type {
  DesktopInformationFeedProjection,
  DesktopInformationItemProjection,
  DesktopRankingItemProjection,
  DesktopRankingProjection,
} from "../../shared/desktop-contracts.js";
import { formatKrwTurnoverEok } from "../lib/market-format.js";

export interface ThemeLeaderModel {
  readonly rank: number;
  readonly themeId: string;
  readonly name: string;
  readonly mode?: "FULL_THEME" | "RANKING_SAMPLE";
  readonly state:
    | "LEADING"
    | "EMERGING"
    | "ROTATING"
    | "WEAK"
    | "CANDIDATE";
  readonly turnover: string;
  readonly acceleration: string;
  readonly marketShare: string;
  readonly breadth: string;
  readonly leaderName: string;
  readonly leaderChangeRate: string;
  readonly direction: "positive" | "negative" | "flat";
  readonly evidenceLabel: string;
}

export interface NewsItemModel {
  readonly id: string;
  readonly titleKo: string;
  readonly source: string;
  readonly publishedAtLabel: string;
  readonly category: "공시" | "기업" | "산업" | "거시" | "지정학";
  readonly impact: "positive" | "negative" | "mixed" | "neutral";
  readonly summaryKo: string;
  readonly evidenceCount: number;
  readonly relation?: "DIRECT" | "THEME";
  readonly relationLabel?: string;
}

export interface MarketContextModel {
  readonly id: string;
  readonly title: string;
  readonly status: "WATCH" | "CONFIRMED" | "COOLING";
  readonly observedReaction: string;
  readonly confidenceLabel: string;
}

interface DomesticThemeDefinition {
  readonly id: string;
  readonly label: string;
  readonly symbols: ReadonlySet<string>;
  readonly namePattern: RegExp;
  readonly newsPattern: RegExp;
}

const domesticThemes: readonly DomesticThemeDefinition[] = [
  {
    id: "semiconductor",
    label: "반도체 · 소부장",
    symbols: new Set([
      "005930",
      "000660",
      "042700",
      "058470",
      "039030",
      "403870",
      "095340",
      "240810",
      "036930",
      "089030",
      "131290",
      "108320",
      "357780",
      "005290",
      "000990",
    ]),
    namePattern:
      /삼성전자|SK하이닉스|한미반도체|리노공업|HPSP|ISC|원익IPS|주성엔지니어링|테크윙|이오테크닉스|하나마이크론|DB하이텍|동진쎄미켐|솔브레인|피에스케이|유진테크|심텍|해성디에스/i,
    newsPattern:
      /반도체|메모리|HBM|D램|DRAM|낸드|NAND|파운드리|웨이퍼|패키징|후공정|팹리스|EUV|AI\s*칩|엔비디아|마이크론/i,
  },
  {
    id: "power-grid",
    label: "전력기기 · 전력망",
    symbols: new Set([
      "267260",
      "010120",
      "298040",
      "103590",
      "033100",
      "001440",
      "000500",
      "006260",
    ]),
    namePattern:
      /HD현대일렉트릭|LS ELECTRIC|효성중공업|일진전기|제룡전기|산일전기|대한전선|가온전선|두산에너빌리티/i,
    newsPattern:
      /전력기기|전력망|송전|배전|변압기|전선|전력 인프라|전력 수요|전력설비|스마트그리드/i,
  },
  {
    id: "automotive",
    label: "자동차 · 모빌리티",
    symbols: new Set([
      "005380",
      "000270",
      "012330",
      "204320",
      "018880",
      "005850",
      "012630",
      "011210",
    ]),
    namePattern:
      /현대차|기아|현대모비스|HL만도|한온시스템|에스엘|성우하이텍|현대위아|명신산업/i,
    newsPattern:
      /자동차|완성차|전기차|하이브리드|자율주행|모빌리티|차량용|자동차부품|현대차|기아/i,
  },
  {
    id: "secondary-battery",
    label: "2차전지 · 소재",
    symbols: new Set([
      "373220",
      "006400",
      "247540",
      "086520",
      "003670",
      "066970",
      "096770",
      "001570",
      "005070",
      "121600",
      "278280",
    ]),
    namePattern:
      /LG에너지솔루션|삼성SDI|에코프로|포스코퓨처엠|엘앤에프|SK이노베이션|금양|코스모신소재|대주전자재료|천보/i,
    newsPattern:
      /2차전지|이차전지|배터리|양극재|음극재|전해질|분리막|리튬|니켈|ESS/i,
  },
  {
    id: "bio-healthcare",
    label: "바이오 · 헬스케어",
    symbols: new Set([
      "207940",
      "068270",
      "196170",
      "028300",
      "000100",
      "141080",
      "298380",
      "000250",
      "087010",
    ]),
    namePattern:
      /삼성바이오로직스|셀트리온|알테오젠|HLB|유한양행|리가켐|에이비엘바이오|삼천당제약|펩트론/i,
    newsPattern:
      /바이오|제약|신약|임상|FDA|의약품|헬스케어|항체|비만치료제/i,
  },
  {
    id: "defense-aerospace",
    label: "방산 · 우주항공",
    symbols: new Set([
      "012450",
      "064350",
      "079550",
      "047810",
      "272210",
      "103140",
    ]),
    namePattern:
      /한화에어로스페이스|현대로템|LIG넥스원|한국항공우주|한화시스템|풍산/i,
    newsPattern:
      /방산|국방|무기|미사일|패트리엇|천궁|K9|전차|군수|우주항공|위성|방산.*수주|무기.*수주/i,
  },
  {
    id: "shipbuilding-shipping",
    label: "조선 · 해운",
    symbols: new Set([
      "009540",
      "329180",
      "042660",
      "010140",
      "010620",
      "011200",
    ]),
    namePattern:
      /HD한국조선해양|HD현대중공업|한화오션|삼성중공업|HD현대미포|HMM/i,
    newsPattern:
      /조선|선박|LNG선|컨테이너선|해운|운임|조선소|홍해|해상 운송|조선.*수주|선박.*수주/i,
  },
  {
    id: "ai-robotics",
    label: "AI · 로봇",
    symbols: new Set([
      "454910",
      "277810",
      "108490",
      "466100",
      "388720",
      "348340",
      "035420",
      "035720",
      "005930",
      "000660",
    ]),
    namePattern:
      /두산로보틱스|레인보우로보틱스|로보티즈|클로봇|유일로보틱스|뉴로메카|NAVER|카카오/i,
    newsPattern:
      /인공지능|\bAI\b|생성형 AI|LLM|로봇|휴머노이드|딥시크|DeepSeek|문샷|Moonshot|엔비디아/i,
  },
  {
    id: "nuclear-power",
    label: "원전 · SMR",
    symbols: new Set([
      "034020",
      "010140",
      "052690",
      "051600",
      "001440",
      "103590",
      "000720",
    ]),
    namePattern:
      /두산에너빌리티|한전기술|한전KPS|비에이치아이|우리기술|우진|보성파워텍|현대건설/i,
    newsPattern:
      /원전|원자력|SMR|소형모듈원자로|원자로|원전 수주|원전 생태계|핵연료/i,
  },
] as const;

const excludedSecurityPattern =
  /ETF|ETN|KODEX|TIGER|RISE|KBSTAR|KOSEF|HANARO|ARIRANG|TIMEFOLIO|SOL\s|PLUS\s|ACE\s|1Q\s|KIWOOM|인버스|레버리지|선물|스팩|SPAC|리츠|우선주/i;

function isEligibleCommonEquity(item: DesktopRankingItemProjection): boolean {
  if (excludedSecurityPattern.test(item.name)) return false;
  if (/우(?:B|C)?$/.test(item.name) || /\d우(?:B|C)?$/.test(item.name)) {
    return false;
  }
  return item.cumulativeTurnover !== null;
}

function parseTurnover(value: string | null): bigint {
  return value !== null && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function parseChangeRate(value: string): number {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatFetchedAt(value: string | null): string {
  if (value === null) return "KIS 최근 거래일 · 수신 시각 없음";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "KIS 최근 거래일";
  return `KIS 최근 거래일 · ${new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp))}`;
}

export interface LiveThemeProjection {
  readonly items: readonly ThemeLeaderModel[];
  readonly asOfLabel: string;
}

export function buildLiveThemeLeaders(
  ranking: DesktopRankingProjection | null,
): LiveThemeProjection {
  if (
    ranking === null ||
    ranking.state !== "READY" ||
    ranking.sort !== "TURNOVER"
  ) {
    return {
      items: [],
      asOfLabel: "KIS 거래대금 순위 대기",
    };
  }

  const eligible = ranking.items.slice(0, 100).filter(isEligibleCommonEquity);
  const candidateTurnover = eligible.reduce(
    (total, item) => total + parseTurnover(item.cumulativeTurnover),
    0n,
  );
  const buckets = new Map<
    string,
    {
      definition: DomesticThemeDefinition;
      items: DesktopRankingItemProjection[];
      turnover: bigint;
    }
  >();

  for (const item of eligible) {
    const definition = domesticThemes.find(
      (theme) =>
        theme.symbols.has(item.symbol) || theme.namePattern.test(item.name),
    );
    if (definition === undefined) continue;
    const bucket = buckets.get(definition.id) ?? {
      definition,
      items: [],
      turnover: 0n,
    };
    bucket.items.push(item);
    bucket.turnover += parseTurnover(item.cumulativeTurnover);
    buckets.set(definition.id, bucket);
  }

  const items = [...buckets.values()]
    .filter((bucket) => bucket.turnover > 0n)
    .sort((left, right) =>
      left.turnover === right.turnover
        ? 0
        : left.turnover > right.turnover
          ? -1
          : 1,
    )
    .slice(0, 5)
    .map((bucket, index): ThemeLeaderModel => {
      const leader = [...bucket.items].sort((left, right) => {
        const leftTurnover = parseTurnover(left.cumulativeTurnover);
        const rightTurnover = parseTurnover(right.cumulativeTurnover);
        return leftTurnover === rightTurnover
          ? 0
          : leftTurnover > rightTurnover
            ? -1
            : 1;
      })[0]!;
      const advancingCount = bucket.items.filter(
        (item) => parseChangeRate(item.changeRate) > 0,
      ).length;
      const share =
        candidateTurnover > 0n
          ? Number((bucket.turnover * 10_000n) / candidateTurnover) / 100
          : 0;
      const leaderChangeRate = parseChangeRate(leader.changeRate);

      return {
        rank: index + 1,
        themeId: bucket.definition.id,
        name: bucket.definition.label,
        mode: "RANKING_SAMPLE",
        state: "CANDIDATE",
        turnover: formatKrwTurnoverEok(bucket.turnover.toString()),
        acceleration: "N/A",
        marketShare: formatPercent(share),
        breadth: `${advancingCount}/${bucket.items.length}`,
        leaderName: leader.name,
        leaderChangeRate:
          leaderChangeRate > 0
            ? `+${leaderChangeRate.toFixed(2)}`
            : leaderChangeRate.toFixed(2),
        direction:
          leaderChangeRate > 0
            ? "positive"
            : leaderChangeRate < 0
              ? "negative"
              : "flat",
        evidenceLabel:
          "KIS 최근 조회 거래대금 상위 표본 + 로컬 종목명·심볼 taxonomy v1 · 종목 유형·시장 전체 분모·동시간 baseline 미확인",
      };
    });

  return {
    items,
    asOfLabel: formatFetchedAt(ranking.fetchedAt),
  };
}

const macroPattern =
  /금리|연준|\bFED\b|FOMC|CPI|물가|GDP|고용|실업|환율|달러|경기선행|경제성장/i;
const geopoliticalPattern =
  /전쟁|공격|제재|관세|중동|이란|이스라엘|우크라|러시아|미중|수출통제|분쟁/i;
const energyShippingPattern =
  /호르무즈|유가|원유|석유|OPEC|에너지|해협|해상|운임|홍해|천연가스/i;
const aiCompetitionPattern =
  /인공지능|\bAI\b|딥시크|DeepSeek|문샷|Moonshot|반도체.*규제|기술주|엔비디아/i;
const industryPattern =
  /반도체|자동차|배터리|바이오|조선|방산|로봇|전력|철강|화학|건설|통신/i;

function informationTitle(item: DesktopInformationItemProjection): string {
  if (item.sourceLanguage.toLowerCase() !== "ko") {
    return item.titleOriginal.trim();
  }
  return item.titleKorean?.trim() || item.titleOriginal.trim();
}

function domesticSymbolFromInstrumentId(
  instrumentId: string,
): string | null {
  const match = /^KRX:([0-9A-Z]{6,7})$/.exec(instrumentId);
  return match?.[1] ?? null;
}

function themesForInstrument(
  instrumentId: string,
  instrumentName: string | null,
): readonly DomesticThemeDefinition[] {
  const symbol = domesticSymbolFromInstrumentId(instrumentId);
  return domesticThemes.filter(
    (theme) =>
      (symbol !== null && theme.symbols.has(symbol)) ||
      (instrumentName !== null && theme.namePattern.test(instrumentName)),
  );
}

function relatedThemeForItem(
  item: DesktopInformationItemProjection,
  title: string,
  activeThemes: readonly DomesticThemeDefinition[],
): DomesticThemeDefinition | null {
  for (const theme of activeThemes) {
    if (theme.newsPattern.test(title)) return theme;
    const hasRelatedThemeInstrument = item.relatedInstrumentIds.some(
      (instrumentId) => {
        const symbol = domesticSymbolFromInstrumentId(instrumentId);
        return symbol !== null && theme.symbols.has(symbol);
      },
    );
    if (hasRelatedThemeInstrument) return theme;
  }
  return null;
}

function newsCategory(
  item: DesktopInformationItemProjection,
): NewsItemModel["category"] {
  if (item.kind === "DISCLOSURE") return "공시";
  const title = informationTitle(item);
  if (geopoliticalPattern.test(title) || energyShippingPattern.test(title)) {
    return "지정학";
  }
  if (macroPattern.test(title)) return "거시";
  if (industryPattern.test(title) || aiCompetitionPattern.test(title)) {
    return "산업";
  }
  return "기업";
}

function formatPublishedAt(
  value: string,
  precision: DesktopInformationItemProjection["publishedAtPrecision"],
): string {
  if (precision === "DATE") {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return "날짜 미상 · 시각 미제공";
    return `${new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(timestamp))} · 시각 미제공`;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "시각 미상";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function contextIdForTitle(
  title: string,
): "macro" | "geopolitical" | "energy" | "ai-competition" | null {
  if (energyShippingPattern.test(title)) return "energy";
  if (geopoliticalPattern.test(title)) return "geopolitical";
  if (macroPattern.test(title)) return "macro";
  if (aiCompetitionPattern.test(title)) return "ai-competition";
  return null;
}

const contextLabels = {
  macro: "금리 · 환율 · 경기",
  geopolitical: "전쟁 · 제재 · 무역 갈등",
  energy: "에너지 · 해상 운송",
  "ai-competition": "AI · 기술 경쟁",
} as const;

export interface LiveInformationProjection {
  readonly news: readonly NewsItemModel[];
  readonly contexts: readonly MarketContextModel[];
}

export function buildLiveInformationInsights(
  feed: DesktopInformationFeedProjection | null,
  activeInstrumentId: string,
  activeInstrumentName: string | null = null,
): LiveInformationProjection {
  if (
    feed === null ||
    !["READY", "PARTIAL"].includes(feed.state) ||
    feed.items.length === 0
  ) {
    return { news: [], contexts: [] };
  }

  const activeThemes = themesForInstrument(
    activeInstrumentId,
    activeInstrumentName,
  );
  const sorted = feed.items
    .flatMap((item) => {
      const direct =
        item.relatedInstrumentIds.includes(activeInstrumentId);
      const relatedTheme = direct
        ? null
        : relatedThemeForItem(
            item,
            informationTitle(item),
            activeThemes,
          );
      return direct || relatedTheme !== null
        ? [{ item, direct, relatedTheme }]
        : [];
    })
    .sort((left, right) => {
      if (left.direct !== right.direct) return left.direct ? -1 : 1;
      return (
        Date.parse(right.item.publishedAt) -
        Date.parse(left.item.publishedAt)
      );
    });

  const news = sorted.slice(0, 5).map((candidate): NewsItemModel => {
    const { item, direct, relatedTheme } = candidate;
    const category = newsCategory(item);
    const rightsSummary =
      item.rights === "KIS_HEADLINE_ONLY"
        ? "KIS 제공 제목입니다. 라이선스 없는 기사 본문과 요약은 수집하지 않습니다."
        : item.sourceLanguage.toLowerCase() === "ko" &&
            item.summaryKorean !== null
          ? item.summaryKorean
          : item.sourceLanguage.toLowerCase() === "ko"
            ? "공식 공시 메타데이터입니다. 본문 분석 전이며 세부 내용은 연결된 원문에서 확인합니다."
            : "원문 제목을 표시합니다. 번역 완료 상태를 확인할 수 없어 부분 번역은 단독 표시하지 않습니다.";
    return {
      id: item.id,
      titleKo: informationTitle(item),
      source: item.sourceName,
      publishedAtLabel: formatPublishedAt(
        item.publishedAt,
        item.publishedAtPrecision,
      ),
      category,
      impact: "neutral",
      summaryKo:
        direct || relatedTheme === null
          ? rightsSummary
          : `${relatedTheme.label} 테마 연관 후보입니다. 현재 종목의 직접 뉴스로 확정하지 않습니다. ${rightsSummary}`,
      evidenceCount: 1,
      relation: direct ? "DIRECT" : "THEME",
      relationLabel:
        direct || relatedTheme === null
          ? "종목 직접"
          : `${relatedTheme.label} 테마`,
    };
  });

  const readyProviders = new Set(
    feed.sources
      .filter((source) => source.state === "READY")
      .map((source) => source.provider),
  );
  const referenceAt = Date.parse(feed.fetchedAt ?? "");
  const contextAsOf = Number.isFinite(referenceAt) ? referenceAt : Date.now();
  const contextWindowStart = contextAsOf - 24 * 60 * 60 * 1_000;
  const grouped = new Map<
    NonNullable<ReturnType<typeof contextIdForTitle>>,
    { count: number; latestAt: number }
  >();
  for (const item of feed.items) {
    if (
      item.kind !== "NEWS" ||
      item.publishedAtPrecision !== "SECOND" ||
      !readyProviders.has(item.provider)
    ) {
      continue;
    }
    const publishedAt = Date.parse(item.publishedAt);
    if (
      !Number.isFinite(publishedAt) ||
      publishedAt < contextWindowStart ||
      publishedAt > contextAsOf
    ) {
      continue;
    }
    const contextId = contextIdForTitle(informationTitle(item));
    if (contextId === null) continue;
    const current = grouped.get(contextId);
    grouped.set(contextId, {
      count: (current?.count ?? 0) + 1,
      latestAt: Math.max(current?.latestAt ?? 0, publishedAt),
    });
  }

  const contexts = [...grouped.entries()]
    .sort(
      ([, left], [, right]) =>
        right.latestAt - left.latestAt || right.count - left.count,
    )
    .slice(0, 3)
    .map(
      ([id, group]): MarketContextModel => ({
        id,
        title: contextLabels[id],
        status: "WATCH",
        observedReaction: `관련 근거 ${group.count}건 · 가격 반응 미연결`,
        confidenceLabel: `${formatPublishedAt(
          new Date(group.latestAt).toISOString(),
          "SECOND",
        )} 최신 · 최근 24시간 제목 분류 · 인과 미확정`,
      }),
    );

  return { news, contexts };
}
