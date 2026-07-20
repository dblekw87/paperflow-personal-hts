import { RefreshCw } from "lucide-react";

import type {
  DesktopMarketContextItemProjection,
  DesktopMarketContextProjection,
} from "../../../shared/desktop-contracts.js";
import { Badge, PriceText, type PriceDirection } from "../atoms/index.js";

export interface MarketContextStripProps {
  readonly projection: DesktopMarketContextProjection | null;
  readonly onRefresh: () => void;
}

function directionOf(
  item: DesktopMarketContextItemProjection,
): PriceDirection {
  if (item.changeRate === null) return "flat";
  if (item.changeRate.startsWith("-")) return "negative";
  if (/^0(?:\.0+)?$/.test(item.changeRate.replace(/^\+/, ""))) return "flat";
  return "positive";
}

function formatDecimal(value: string | null, currency: "KRW" | "USD"): string {
  if (value === null) return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: currency === "USD" ? 2 : 0,
    maximumFractionDigits: currency === "USD" ? 2 : 2,
  }).format(parsed);
}

function qualityLabel(item: DesktopMarketContextItemProjection): string {
  if (item.freshness === "UNAVAILABLE") {
    return item.entitlement === "REQUIRED" ? "권한 필요" : "연결 예정";
  }
  return item.representation === "ETF_PROXY"
    ? "ETF PROXY · REST"
    : "공식 지수 · REST";
}

function MarketContextItem({
  item,
}: {
  readonly item: DesktopMarketContextItemProjection;
}) {
  const direction = directionOf(item);
  const qualityTone =
    item.freshness === "UNAVAILABLE"
      ? item.entitlement === "REQUIRED"
        ? "warning"
        : "neutral"
      : item.representation === "ETF_PROXY"
        ? "info"
        : "success";
  return (
    <article
      className={`pt-market-context-item pt-market-context-item--${item.freshness.toLowerCase()}`}
      title={item.proxyDisclosure ?? item.statusMessage}
    >
      <header>
        <div>
          <strong>{item.label}</strong>
          <span>{item.instrumentId}</span>
        </div>
        <Badge tone={qualityTone}>{qualityLabel(item)}</Badge>
      </header>
      <div className="pt-market-context-item__quote">
        <span className="pt-market-context-item__price">
          {formatDecimal(item.price, item.currency)}
        </span>
        {item.changeRate !== null ? (
          <PriceText
            value={item.changeRate.replace(/^\+/, "")}
            {...(direction === "positive" ? { prefix: "+" } : {})}
            suffix="%"
            direction={direction}
            accessibleLabel={`${item.label} ${item.changeRate}%`}
          />
        ) : (
          <span className="pt-market-context-item__empty">N/A</span>
        )}
      </div>
      <footer>
        <span>{item.currency}</span>
        <span>
          {item.receivedAt
            ? `${new Intl.DateTimeFormat("ko-KR", {
                timeZone: "Asia/Seoul",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              }).format(new Date(item.receivedAt))} KST`
            : item.entitlement === "REQUIRED"
              ? "시세 신청 필요"
              : "adapter pending"}
        </span>
      </footer>
    </article>
  );
}

export function MarketContextStrip({
  projection,
  onRefresh,
}: MarketContextStripProps) {
  const isLoading = projection === null || projection.state === "LOADING";
  return (
    <section className="pt-market-context" aria-label="글로벌 시장 현황">
      <div className="pt-market-context__heading">
        <div>
          <strong>글로벌 시장</strong>
          <span>
            {projection?.statusMessage ??
              "KIS 지수·ETF 스냅샷을 불러오는 중입니다."}
          </span>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label="글로벌 시장 새로고침"
          title="글로벌 시장 새로고침"
        >
          <RefreshCw aria-hidden="true" />
          {isLoading ? "갱신 중" : "새로고침"}
        </button>
      </div>
      <div className="pt-market-context__rail">
        {projection?.items.length ? (
          projection.items.map((item) => (
            <MarketContextItem key={item.id} item={item} />
          ))
        ) : (
          <div className="pt-market-context__loading">
            국내 지수와 미국 시장 proxy를 준비하고 있습니다.
          </div>
        )}
      </div>
    </section>
  );
}
