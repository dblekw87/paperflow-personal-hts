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
  relation?: "DIRECT" | "THEME";
  relationLabel?: string;
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
          <h2 id="news-title">선택 종목 뉴스·공시 / 전체 시장 관찰</h2>
        </div>
        <Badge tone="info">실제 근거 피드</Badge>
      </div>

      {contexts.length > 0 ? (
        <div className="pt-news__section-heading">
          <strong>전체 시장 관찰</strong>
          <span>직접·테마 뉴스 아님 · 선택 종목 간접 영향 후보</span>
        </div>
      ) : null}
      <div className="pt-news__context" aria-label="전체 시장 관찰">
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
              전체시장 · {contextLabel[context.status]}
            </Badge>
            <strong>{context.title}</strong>
            <span>{context.observedReaction}</span>
            <small>{context.confidenceLabel}</small>
          </button>
        ))}
      </div>

      <div className="pt-news__section-heading">
        <strong>선택 종목 관련 뉴스·공시</strong>
        <span>종목 직접 또는 taxonomy 테마 후보</span>
      </div>
      <ul className="pt-news__list">
        {news.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onNewsSelect(item.id)}>
              <span className="pt-news__meta">
                <Badge tone={impactTone[item.impact]}>{item.category}</Badge>
                {item.relationLabel ? (
                  <Badge
                    tone={item.relation === "DIRECT" ? "info" : "neutral"}
                  >
                    {item.relationLabel}
                  </Badge>
                ) : null}
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
      {news.length === 0 ? (
        <p className="pt-news__selection-empty" role="status">
          선택 종목에 직접 또는 테마로 연결된 뉴스·공시가 없습니다.
        </p>
      ) : null}
      {news.length === 0 && contexts.length === 0 ? (
        <p className="pt-panel__empty" role="status">
          실제 뉴스·공시 provider 응답을 기다리는 중
        </p>
      ) : null}
      <p className="pt-panel__footnote">
        사건 분류는 제목·공시 메타데이터 기반입니다. 가격 반응이 연결되기
        전에는 확정 인과나 호재·악재로 단정하지 않습니다. `종목 직접`은
        공급자 종목 코드가 일치한 항목이며, `테마`는 로컬 taxonomy와 제목·연결
        종목 근거가 일치한 후보로 직접 인과를 뜻하지 않습니다. 전체 시장 관찰은
        직접 관련성이 아니라 거시 환경의 간접 영향 후보를 별도로 보여줍니다.
      </p>
    </section>
  );
}
