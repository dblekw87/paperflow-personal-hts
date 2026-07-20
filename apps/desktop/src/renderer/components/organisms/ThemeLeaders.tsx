import { Badge, PriceText } from "../atoms";
import type { PriceDirection } from "../atoms";

export interface ThemeLeaderModel {
  rank: number;
  themeId: string;
  name: string;
  mode?: "FULL_THEME" | "RANKING_SAMPLE";
  state: "LEADING" | "EMERGING" | "ROTATING" | "WEAK" | "CANDIDATE";
  turnover: string;
  acceleration: string;
  marketShare: string;
  breadth: string;
  leaderName: string;
  leaderChangeRate: string;
  direction: PriceDirection;
  evidenceLabel: string;
}

export interface ThemeLeadersProps {
  items: readonly ThemeLeaderModel[];
  asOfLabel: string;
  onThemeSelect?: (themeId: string) => void;
}

const stateLabel = {
  LEADING: "주도",
  EMERGING: "부상",
  ROTATING: "순환",
  WEAK: "약세",
  CANDIDATE: "후보",
} as const;

export function ThemeLeaders({
  items,
  asOfLabel,
  onThemeSelect,
}: ThemeLeadersProps) {
  const isRankingSample =
    items.length > 0 &&
    items.every((item) => item.mode === "RANKING_SAMPLE");
  return (
    <section
      className="pt-panel pt-theme-leaders"
      aria-labelledby="theme-title"
    >
      <div className="pt-panel__header">
        <div>
          <p className="pt-eyebrow">TURNOVER LEADERSHIP</p>
          <h2 id="theme-title">
            {isRankingSample ? "최근 거래일 테마 후보" : "오늘의 주도 테마"}
          </h2>
        </div>
        <span className="pt-panel__timestamp">{asOfLabel}</span>
      </div>
      <ol className="pt-theme-leaders__list">
        {items.map((item) => (
          <li key={item.themeId}>
            <button
              type="button"
              onClick={() => onThemeSelect?.(item.themeId)}
              disabled={onThemeSelect === undefined}
              aria-label={`${item.rank}위 ${item.name} 상세 보기`}
            >
              <span className="pt-theme-leaders__rank">{item.rank}</span>
              <span className="pt-theme-leaders__identity">
                <strong>{item.name}</strong>
                <span>
                  {item.mode === "RANKING_SAMPLE" ? "표본 상위" : "대장주"}{" "}
                  {item.leaderName}{" "}
                  <PriceText
                    value={item.leaderChangeRate}
                    direction={item.direction}
                    suffix="%"
                  />
                </span>
              </span>
              <span className="pt-theme-leaders__metrics">
                <span>
                  {item.mode === "RANKING_SAMPLE" ? "표본 거래대금" : "거래대금"}{" "}
                  {item.turnover}
                </span>
                {item.mode === "RANKING_SAMPLE" ? null : (
                  <span>가속 {item.acceleration}</span>
                )}
                <span>
                  {item.mode === "RANKING_SAMPLE" ? "표본 점유" : "점유"}{" "}
                  {item.marketShare}
                </span>
                <span>
                  {item.mode === "RANKING_SAMPLE" ? "표본 상승" : "상승 종목"}{" "}
                  {item.breadth}
                </span>
              </span>
              <Badge
                tone={
                  item.state === "LEADING"
                    ? "positive"
                    : item.state === "EMERGING"
                      ? "warning"
                      : "neutral"
                }
                title={item.evidenceLabel}
              >
                {stateLabel[item.state]}
              </Badge>
            </button>
          </li>
        ))}
      </ol>
      {items.length === 0 ? (
        <p className="pt-panel__empty" role="status">
          KIS 최근 거래일 거래대금 순위와 테마 분류를 기다리는 중
        </p>
      ) : null}
      <p className="pt-panel__footnote">
        {isRankingSample
          ? "KIS 거래대금 상위 표본과 로컬 taxonomy의 분류 후보입니다. 전체 시장 점유·정식 주도 상태·동시간 가속도를 뜻하지 않습니다."
          : "거래대금 가속·시장 점유·상승 종목 폭을 결합한 분류이며 투자 조언이 아닙니다."}
      </p>
    </section>
  );
}
