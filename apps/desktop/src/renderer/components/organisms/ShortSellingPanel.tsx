import { ShieldAlert } from "lucide-react";

import type { DesktopShortSellingProjection } from "../../../shared/desktop-contracts.js";
import { Badge } from "../atoms/index.js";

export type ShortSellingMarketScope = "KR" | "US";

export interface ShortSellingPanelProps {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly marketScope: ShortSellingMarketScope;
  readonly projection: DesktopShortSellingProjection | null;
  readonly onRefresh: () => void;
}

function sourceLabel(marketScope: ShortSellingMarketScope): string {
  return marketScope === "KR"
    ? "KRX 공매도 거래·잔고"
    : "FINRA/거래소 short interest";
}

function badgeLabel(projection: DesktopShortSellingProjection | null): string {
  if (projection?.state === "READY" || projection?.state === "PARTIAL") {
    return projection.source === "KRX_DATA_PRODUCT" ? "KRX CSV" : "미연결";
  }
  if (projection?.state === "LOADING") return "조회중";
  return "미연결";
}

function metric(value: string | null, suffix = ""): string {
  if (value === null) return "미제공";
  return `${Number(value).toLocaleString("ko-KR")}${suffix}`;
}

export function ShortSellingPanel({
  instrumentId,
  symbol,
  marketScope,
  projection,
  onRefresh,
}: ShortSellingPanelProps) {
  const trade = projection?.instrumentId === instrumentId ? projection.trade : null;
  const balance = projection?.instrumentId === instrumentId ? projection.balance : null;
  const loading = projection?.state === "LOADING";
  return (
    <section
      className="pt-panel pt-short-selling"
      aria-labelledby="short-selling-title"
    >
      <div className="pt-panel__header">
        <div>
          <p className="pt-eyebrow">SHORT SELLING</p>
          <h2 id="short-selling-title">공매도</h2>
        </div>
        <div className="pt-short-selling__actions">
          <Badge tone={trade !== null ? "info" : "warning"}>{badgeLabel(projection)}</Badge>
          <button type="button" onClick={onRefresh} disabled={loading}>
            갱신
          </button>
        </div>
      </div>
      <div className="pt-short-selling__context">
        <ShieldAlert aria-hidden="true" />
        <div>
          <strong>{symbol}</strong>
          <span>
            {instrumentId} · {sourceLabel(marketScope)}
          </span>
        </div>
      </div>
      <dl className="pt-short-selling__metrics">
        <div>
          <dt>공매도 거래대금</dt>
          <dd>{metric(trade?.shortSellTurnover ?? null, "원")}</dd>
        </div>
        <div>
          <dt>공매도 거래비중</dt>
          <dd>{metric(trade?.shortSellRatio ?? null, "%")}</dd>
        </div>
        <div>
          <dt>공매도 잔고</dt>
          <dd>{metric(balance?.shortBalanceTurnover ?? null, "원")}</dd>
        </div>
        <div>
          <dt>대차잔고</dt>
          <dd>미제공</dd>
        </div>
      </dl>
      <p className="pt-short-selling__status" role="status">
        {projection?.statusMessage ??
          (marketScope === "KR"
            ? "KRX 공매도 거래 CSV 수신 전입니다."
            : "미국 short interest/short-sale volume provider가 연결되기 전까지 수치를 표시하지 않습니다.")}
      </p>
      <p className="pt-panel__footnote">
        공매도 데이터가 연결되어도 로컬 모의투자 엔진의 공매도 주문 금지는 유지합니다.
      </p>
    </section>
  );
}
