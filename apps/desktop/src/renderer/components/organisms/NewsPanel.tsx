import { Badge } from "../atoms";

export interface NewsItemModel {
  id: string;
  titleKo: string;
  source: string;
  publishedAtLabel: string;
  category: "공시" | "기업" | "산업" | "거시" | "지정학";
  impact: "positive" | "negative" | "mixed" | "neutral";
  summaryKo: string;
  evidenceCount: number;
}

export interface MarketContextModel {
  id: string;
  title: string;
  status: "WATCH" | "CONFIRMED" | "COOLING";
  observedReaction: string;
  confidenceLabel: string;
}

export interface NewsPanelProps {
  news: readonly NewsItemModel[];
  contexts: readonly MarketContextModel[];
  onNewsSelect: (id: string) => void;
  onContextSelect?: (id: string) => void;
}

const impactTone = {
  positive: "positive",
  negative: "negative",
  mixed: "warning",
  neutral: "neutral",
} as const;

const contextLabel = {
  WATCH: "관찰",
  CONFIRMED: "사건 확인",
  COOLING: "완화 중",
} as const;

export function NewsPanel({
  news,
  contexts,
  onNewsSelect,
  onContextSelect,
}: NewsPanelProps) {
  return (
    <section className="pt-panel pt-news" aria-labelledby="news-title">
      <div className="pt-panel__header">
        <div>
          <p className="pt-eyebrow">EVIDENCE FEED</p>
          <h2 id="news-title">뉴스 · 공시 · 시장 맥락</h2>
        </div>
        <Badge tone="info">한국어 요약</Badge>
      </div>

      <div className="pt-news__context" aria-label="주요 시장 맥락">
        {contexts.map((context) => (
          <button
            type="button"
            key={context.id}
            onClick={() => onContextSelect?.(context.id)}
            disabled={onContextSelect === undefined}
          >
            <Badge
              tone={
                context.status === "CONFIRMED"
                  ? "warning"
                  : context.status === "COOLING"
                    ? "success"
                    : "neutral"
              }
            >
              {contextLabel[context.status]}
            </Badge>
            <strong>{context.title}</strong>
            <span>{context.observedReaction}</span>
            <small>{context.confidenceLabel}</small>
          </button>
        ))}
      </div>

      <ul className="pt-news__list">
        {news.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onNewsSelect(item.id)}>
              <span className="pt-news__meta">
                <Badge tone={impactTone[item.impact]}>{item.category}</Badge>
                <span>{item.source}</span>
                <time>{item.publishedAtLabel}</time>
              </span>
              <strong>{item.titleKo}</strong>
              <span className="pt-news__summary">{item.summaryKo}</span>
              <small>연결된 근거 {item.evidenceCount}개</small>
            </button>
          </li>
        ))}
      </ul>
      {news.length === 0 && contexts.length === 0 ? (
        <p className="pt-panel__empty" role="status">
          실제 뉴스·공시·시장 맥락 provider 연결 준비 중
        </p>
      ) : null}
      <p className="pt-panel__footnote">
        기사·공시와 가격 반응의 시간적 연관을 표시하며 확정 인과로 단정하지
        않습니다.
      </p>
    </section>
  );
}
