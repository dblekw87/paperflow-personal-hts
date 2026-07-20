import { Badge, PriceText } from "../atoms";
import type { PriceDirection } from "../atoms";

export interface PortfolioValueModel {
  label: string;
  value: string;
  subValue?: string;
  direction?: PriceDirection;
}

export interface PortfolioStripProps {
  accountName: string;
  valuationQuality: "complete" | "partial" | "stale";
  values: readonly PortfolioValueModel[];
  paperOnly?: boolean;
}

const qualityLabel = {
  complete: "평가 완료",
  partial: "일부 평가",
  stale: "시세 오래됨",
} as const;

export function PortfolioStrip({
  accountName,
  valuationQuality,
  values,
  paperOnly = true,
}: PortfolioStripProps) {
  return (
    <section
      className="pt-portfolio-strip"
      aria-label={`${accountName} 모의 포트폴리오`}
    >
      <div className="pt-portfolio-strip__identity">
        <span>{accountName}</span>
        {paperOnly ? <Badge tone="warning">모의투자</Badge> : null}
        <Badge tone={valuationQuality === "complete" ? "success" : "warning"}>
          {qualityLabel[valuationQuality]}
        </Badge>
      </div>
      <dl className="pt-portfolio-strip__values">
        {values.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>
              <PriceText
                value={item.value}
                direction={item.direction ?? "flat"}
                emphasis="strong"
              />
              {item.subValue ? <small>{item.subValue}</small> : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
