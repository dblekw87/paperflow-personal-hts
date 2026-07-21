import { RefreshCw } from "lucide-react";
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
  readonly onRefresh: () => void;
  readonly scope?: "BOTH" | "INSTRUMENT" | "MARKET";
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
  if (projection === null) return "대기";
  if (projection.state === "UNAVAILABLE") return "미연결";
  if (projection.state === "READY") return "실데이터";
  if (projection.state === "PARTIAL") return "일부 수신";
  if (projection.state === "ERROR") return "오류";
  return "조회 중";
}

function sourceLabel(projection: DesktopInvestorFlowProjection | null): string {
  if (projection?.source === "KRX_OPENAPI") return "KRX OpenAPI";
  if (projection?.source === "KRX_DATA_PRODUCT") return "KRX Data";
  return "KIS fallback";
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
    return <span className="pt-investor-flow__missing" aria-label="데이터 없음">미제공</span>;
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
  emptyMessage,
}: {
  readonly participants: readonly DesktopInvestorFlowParticipant[];
  readonly values: readonly DesktopInvestorFlowValueProjection[];
  readonly label: string;
  readonly emptyMessage: string;
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
          {values.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <span className="pt-investor-flow__missing">{emptyMessage}</span>
              </td>
            </tr>
          ) : null}
          {values.length > 0 ? participants.map((participant) => {
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
                    <span className="pt-investor-flow__missing" aria-label="데이터 없음">미제공</span>
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
                    <span className="pt-investor-flow__missing" aria-label="데이터 없음">미제공</span>
                  )}
                </td>
                <td><FlowValue value={value?.netBuyAmount ?? null} unit="KRW" /></td>
                <td><FlowValue value={value?.netBuyQuantity ?? null} unit="SHARE" /></td>
              </tr>
            );
          }) : null}
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
  if (projection === null) return "투자자 수급 조회를 아직 시작하지 못했습니다.";
  if (projection.state === "LOADING") return "투자자 수급 데이터를 조회하는 중입니다.";
  return projection.statusMessage;
}

function lastSuccessLabel(projection: DesktopInvestorFlowProjection | null): string {
  if (projection?.fetchedAt === null || projection?.fetchedAt === undefined) {
    return "마지막 성공 시각 없음";
  }
  return `마지막 성공 ${new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(projection.fetchedAt))}`;
}

export function InvestorFlowPanel({
  projection,
  onRefresh,
  scope = "BOTH",
}: InvestorFlowPanelProps) {
  const id = useId();
  const [selectedView, setView] = useState<FlowView>("INSTRUMENT");
  const view: FlowView =
    scope === "MARKET"
      ? "MARKET"
      : scope === "INSTRUMENT"
        ? "INSTRUMENT"
        : selectedView;
  const [market, setMarket] = useState<FlowMarket>("KOSPI");
  const instrument = projection?.instrument ?? null;
  const marketProjection: DesktopMarketInvestorFlowProjection | null =
    projection?.markets.find((item) => item.market === market) ?? null;
  const instrumentValues = [
    ...(instrument?.investorSummary?.participants ?? []),
    ...(instrument?.programSummary ? [instrument.programSummary.participant] : []),
  ];
  const isLoading = projection?.state === "LOADING";

  return (
    <section className="pt-panel pt-investor-flow" aria-labelledby={`${id}-title`}>
      <div className="pt-panel__header">
        <div>
          <p className="pt-eyebrow">INVESTOR FLOW</p>
          <h2 id={`${id}-title`}>투자자 수급</h2>
        </div>
        <div className="pt-investor-flow__actions">
          <span>{lastSuccessLabel(projection)}</span>
          <Badge tone={projection?.source === "KIS_REST" ? "warning" : "info"}>
            {sourceLabel(projection)}
          </Badge>
          <Badge tone={toneOf(projection)}>{stateLabel(projection)}</Badge>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label="투자자 수급 새로고침"
          >
            <RefreshCw aria-hidden="true" />
            {isLoading ? "조회 중" : "새로고침"}
          </button>
        </div>
      </div>

      {scope === "BOTH" ? <div className="pt-investor-flow__tabs" role="tablist" aria-label="수급 범위">
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
      </div> : null}

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
                : ""}
              {instrument?.programSummary
                ? ` · 프로그램 ${instrument.programSummary.providerTime} 공급자 시각`
                : ""}
            </span>
          </div>
          <FlowTable
            participants={instrumentParticipants}
            values={instrumentValues}
            label="종목별 투자자 수급"
            emptyMessage={
              projection?.state === "ERROR" || projection?.state === "UNAVAILABLE"
                ? statusText(projection)
                : "선택 종목의 투자자 수급 데이터가 아직 수신되지 않았습니다."
            }
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
                : ""}
            </span>
          </div>
          <FlowTable
            participants={marketParticipants}
            values={marketProjection?.participants ?? []}
            label={`${market} 시장별 투자자 수급`}
            emptyMessage={
              projection?.state === "ERROR" || projection?.state === "UNAVAILABLE"
                ? statusText(projection)
                : `${market} 시장별 투자자 수급 데이터가 아직 수신되지 않았습니다.`
            }
          />
        </div>
      )}

      {statusText(projection) ? (
        <p className="pt-investor-flow__status" role="status">
          {statusText(projection)}
        </p>
      ) : null}
      <p className="pt-panel__footnote">
        거래소 원천 수급을 우선하고 미연결 항목은 KIS 읽기 전용 fallback으로 표시합니다. 금액은 원, 수량은 주 단위이며 없는 값을 0으로 채우지 않습니다.
      </p>
    </section>
  );
}
