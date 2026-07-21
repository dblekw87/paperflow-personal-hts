import { ShieldAlert } from "lucide-react";

import { Badge } from "../atoms/index.js";

export type ShortSellingMarketScope = "KR" | "US";

export interface ShortSellingPanelProps {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly marketScope: ShortSellingMarketScope;
}

const unsupportedMetrics = [
  "공매도 거래대금",
  "공매도 거래비중",
  "공매도 잔고",
  "대차잔고",
] as const;

function sourceLabel(marketScope: ShortSellingMarketScope): string {
  return marketScope === "KR"
    ? "KRX 공매도 거래·잔고"
    : "FINRA/거래소 short interest";
}

function statusMessage(marketScope: ShortSellingMarketScope): string {
  return marketScope === "KR"
    ? "KRX 계정 명세서에서 공매도 거래·잔고 endpoint가 확인되기 전까지 수치를 표시하지 않습니다."
    : "미국 short interest/short-sale volume provider가 연결되기 전까지 수치를 표시하지 않습니다.";
}

export function ShortSellingPanel({
  instrumentId,
  symbol,
  marketScope,
}: ShortSellingPanelProps) {
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
        <Badge tone="warning">미연결</Badge>
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
        {unsupportedMetrics.map((metric) => (
          <div key={metric}>
            <dt>{metric}</dt>
            <dd>미제공</dd>
          </div>
        ))}
      </dl>
      <p className="pt-short-selling__status" role="status">
        {statusMessage(marketScope)}
      </p>
      <p className="pt-panel__footnote">
        공매도 데이터가 연결되어도 로컬 모의투자 엔진의 공매도 주문 금지는 유지합니다.
      </p>
    </section>
  );
}
