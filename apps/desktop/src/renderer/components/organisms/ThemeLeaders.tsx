import { Badge, PriceText } from "../atoms";
import type { PriceDirection } from "../atoms";

export interface ThemeLeaderModel {
  rank: number;
  themeId: string;
  name: string;
  state: "LEADING" | "EMERGING" | "ROTATING" | "WEAK";
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
} as const;

export function ThemeLeaders({
  items,
  asOfLabel,
  onThemeSelect,
}: ThemeLeadersProps) {
  return (
    <section
      className="pt-panel pt-theme-leaders"
      aria-labelledby="theme-title"
    >
      <div className="pt-panel__header">
        <div>
          <p className="pt-eyebrow">TURNOVER LEADERSHIP</p>
          <h2 id="theme-title">오늘의 주도 테마</h2>
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
                  대장주 {item.leaderName}{" "}
                  <PriceText
                    value={item.leaderChangeRate}
                    direction={item.direction}
                    suffix="%"
                  />
                </span>
              </span>
              <span className="pt-theme-leaders__metrics">
                <span>거래대금 {item.turnover}</span>
                <span>가속 {item.acceleration}</span>
                <span>점유 {item.marketShare}</span>
                <span>상승 종목 {item.breadth}</span>
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
          실제 거래대금 순위·테마 분류 데이터 연결 준비 중
        </p>
      ) : null}
      <p className="pt-panel__footnote">
        거래대금 가속·시장 점유·상승 종목 폭을 결합한 분류이며 투자 조언이
        아닙니다.
      </p>
    </section>
  );
}
