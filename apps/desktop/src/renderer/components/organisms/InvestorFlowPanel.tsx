import { useId, useState, type KeyboardEvent } from "react";

import type {
  DesktopInvestorFlowParticipant,
  DesktopInvestorFlowProjection,
  DesktopInvestorFlowValueProjection,
  DesktopMarketInvestorFlowProjection,
} from "../../../shared/desktop-contracts.js";
import { Badge } from "../atoms/index.js";

export interface InvestorFlowPanelProps {
  readonly projection: DesktopInvestorFlowProjection | null;
}

type FlowView = "INSTRUMENT" | "MARKET";
type FlowMarket = "KOSPI" | "KOSDAQ";

const instrumentParticipants = [
  "INDIVIDUAL",
  "FOREIGN",
  "INSTITUTION",
  "PROGRAM",
] as const;
const marketParticipants = ["INDIVIDUAL", "FOREIGN", "INSTITUTION"] as const;

const participantLabel: Record<DesktopInvestorFlowParticipant, string> = {
  INDIVIDUAL: "개인",
  FOREIGN: "외국인",
  INSTITUTION: "기관",
  PROGRAM: "프로그램",
};

function toneOf(projection: DesktopInvestorFlowProjection | null) {
  if (projection === null || projection.state === "UNAVAILABLE") return "neutral";
  if (projection.state === "READY") return "success";
  if (projection.state === "PARTIAL") return "warning";
  if (projection.state === "ERROR") return "negative";
  return "info";
}

function stateLabel(projection: DesktopInvestorFlowProjection | null): string {
  if (projection === null || projection.state === "UNAVAILABLE") return "미수신";
  if (projection.state === "READY") return "실데이터";
  if (projection.state === "PARTIAL") return "일부 수신";
  if (projection.state === "ERROR") return "오류";
  return "조회 중";
}

function signedDirection(value: string): "positive" | "negative" | "flat" {
  const integer = BigInt(value);
  if (integer > 0n) return "positive";
  if (integer < 0n) return "negative";
  return "flat";
}

function formatInteger(value: string): string {
  const integer = BigInt(value);
  const formatted = new Intl.NumberFormat("ko-KR").format(
    integer < 0n ? -integer : integer,
  );
  if (integer > 0n) return `+${formatted}`;
  if (integer < 0n) return `-${formatted}`;
  return formatted;
}

function FlowValue({
  value,
  unit,
}: {
  readonly value: string | null;
  readonly unit: "KRW" | "SHARE";
}) {
  if (value === null) {
    return <span className="pt-investor-flow__missing">미수신</span>;
  }
  return (
    <span className={`pt-investor-flow__number ${signedDirection(value)}`}>
      {formatInteger(value)} <small>{unit === "KRW" ? "원" : "주"}</small>
    </span>
  );
}

function FlowTable({
  participants,
  values,
  label,
}: {
  readonly participants: readonly DesktopInvestorFlowParticipant[];
  readonly values: readonly DesktopInvestorFlowValueProjection[];
  readonly label: string;
}) {
  const byParticipant = new Map(values.map((value) => [value.participant, value]));
  return (
    <div className="pt-investor-flow__table-wrap">
      <table aria-label={label}>
        <thead>
          <tr>
            <th scope="col">주체</th>
            <th scope="col">매도 금액</th>
            <th scope="col">매수 금액</th>
            <th scope="col">순매수 금액</th>
            <th scope="col">순매수 수량</th>
          </tr>
        </thead>
        <tbody>
          {participants.map((participant) => {
            const value = byParticipant.get(participant) ?? null;
            return (
              <tr key={participant}>
                <th scope="row">{participantLabel[participant]}</th>
                <td>
                  {value ? (
                    <span className="pt-investor-flow__number">
                      {new Intl.NumberFormat("ko-KR").format(
                        BigInt(value.sellAmount),
                      )}{" "}
                      <small>원</small>
                    </span>
                  ) : (
                    <span className="pt-investor-flow__missing">미수신</span>
                  )}
                </td>
                <td>
                  {value ? (
                    <span className="pt-investor-flow__number">
                      {new Intl.NumberFormat("ko-KR").format(
                        BigInt(value.buyAmount),
                      )}{" "}
                      <small>원</small>
                    </span>
                  ) : (
                    <span className="pt-investor-flow__missing">미수신</span>
                  )}
                </td>
                <td><FlowValue value={value?.netBuyAmount ?? null} unit="KRW" /></td>
                <td><FlowValue value={value?.netBuyQuantity ?? null} unit="SHARE" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function selectNextTab<T extends string>(
  event: KeyboardEvent<HTMLButtonElement>,
  tabs: readonly T[],
  selected: T,
  select: (tab: T) => void,
) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const offset = event.key === "ArrowRight" ? 1 : -1;
  const next = tabs[(tabs.indexOf(selected) + offset + tabs.length) % tabs.length];
  if (next !== undefined) select(next);
}

function statusText(projection: DesktopInvestorFlowProjection | null): string {
  if (projection === null) return "실제 KIS 투자자 수급 데이터 미수신";
  if (projection.state === "LOADING") return "투자자 수급 데이터를 조회하는 중입니다.";
  return projection.statusMessage;
}

export function InvestorFlowPanel({ projection }: InvestorFlowPanelProps) {
  const id = useId();
  const [view, setView] = useState<FlowView>("INSTRUMENT");
  const [market, setMarket] = useState<FlowMarket>("KOSPI");
  const instrument = projection?.instrument ?? null;
  const marketProjection: DesktopMarketInvestorFlowProjection | null =
    projection?.markets.find((item) => item.market === market) ?? null;
  const instrumentValues = [
    ...(instrument?.investorSummary?.participants ?? []),
    ...(instrument?.programSummary ? [instrument.programSummary.participant] : []),
  ];

  return (
    <section className="pt-panel pt-investor-flow" aria-labelledby={`${id}-title`}>
      <div className="pt-panel__header">
        <div>
          <p className="pt-eyebrow">INVESTOR FLOW</p>
          <h2 id={`${id}-title`}>투자자 수급</h2>
        </div>
        <Badge tone={toneOf(projection)}>{stateLabel(projection)}</Badge>
      </div>

      <div className="pt-investor-flow__tabs" role="tablist" aria-label="수급 범위">
        {(["INSTRUMENT", "MARKET"] as const).map((tab) => (
          <button
            key={tab}
            id={`${id}-${tab.toLowerCase()}-tab`}
            type="button"
            role="tab"
            aria-selected={view === tab}
            aria-controls={`${id}-${tab.toLowerCase()}-panel`}
            tabIndex={view === tab ? 0 : -1}
            onClick={() => setView(tab)}
            onKeyDown={(event) =>
              selectNextTab(event, ["INSTRUMENT", "MARKET"], view, setView)
            }
          >
            {tab === "INSTRUMENT" ? "종목별" : "시장별"}
          </button>
        ))}
      </div>

      {view === "INSTRUMENT" ? (
        <div
          id={`${id}-instrument-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-instrument-tab`}
          className="pt-investor-flow__content"
        >
          <div className="pt-investor-flow__context">
            <strong>
              {instrument ? `${instrument.name} · ${instrument.symbol}` : "선택 종목"}
            </strong>
            <span>
              {instrument?.investorSummary
                ? `${instrument.investorSummary.businessDate} 장 마감 기준`
                : "개인·외국인·기관 미수신"}
              {instrument?.programSummary
                ? ` · 프로그램 ${instrument.programSummary.providerTime} 공급자 시각`
                : " · 프로그램 미수신"}
            </span>
          </div>
          <FlowTable
            participants={instrumentParticipants}
            values={instrumentValues}
            label="종목별 투자자 수급"
          />
        </div>
      ) : (
        <div
          id={`${id}-market-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-market-tab`}
          className="pt-investor-flow__content"
        >
          <div className="pt-investor-flow__market-tabs" role="tablist" aria-label="시장 선택">
            {(["KOSPI", "KOSDAQ"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={market === tab}
                tabIndex={market === tab ? 0 : -1}
                onClick={() => setMarket(tab)}
                onKeyDown={(event) =>
                  selectNextTab(event, ["KOSPI", "KOSDAQ"], market, setMarket)
                }
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="pt-investor-flow__context">
            <strong>{market}</strong>
            <span>
              {marketProjection
                ? "공급자 snapshot · 기준시각/최종성 미제공"
                : "개인·외국인·기관 수급 미수신"}
            </span>
          </div>
          <FlowTable
            participants={marketParticipants}
            values={marketProjection?.participants ?? []}
            label={`${market} 시장별 투자자 수급`}
          />
        </div>
      )}

      <p className="pt-investor-flow__status" role="status">
        {statusText(projection)}
      </p>
      <p className="pt-panel__footnote">
        KIS 읽기 전용 공급자 값만 표시합니다. 금액은 원, 수량은 주 단위이며 미수신 값을 0으로 채우지 않습니다.
      </p>
    </section>
  );
}
