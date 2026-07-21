import type { CSSProperties } from "react";

import { Badge, PriceText } from "../atoms";
import type { PriceDirection } from "../atoms";
import { Status } from "../molecules";

export interface OrderBookLevelModel {
  price: string;
  quantity: string;
  changeRate: string;
  direction: PriceDirection;
  depthBand: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
}

export interface RecentTradeModel {
  readonly id: string;
  readonly occurredAt: string;
  readonly price: string;
  readonly quantity: string | null;
  readonly direction: PriceDirection;
}

export interface OrderBookReferenceStat {
  readonly label: string;
  readonly value: string;
  readonly direction?: PriceDirection;
  readonly dividerBefore?: boolean;
}

export interface OrderBookPanelProps {
  instrumentId: string;
  asks: readonly OrderBookLevelModel[];
  bids: readonly OrderBookLevelModel[];
  totalAskQuantity: string;
  totalBidQuantity: string;
  currentPrice: string;
  currentPriceLabel?: string;
  executionStrength: string | null;
  recentTrades: readonly RecentTradeModel[];
  referenceStats: readonly OrderBookReferenceStat[];
  currentDirection: PriceDirection;
  freshness: "live" | "delayed" | "stale" | "offline" | "closed" | "partial";
  dataMode?: "REAL" | "FIXTURE";
  referenceOnly?: boolean;
  depthLabel: string;
  asOfLabel: string;
  orderQuantity: string;
  canOrderFromLevel: boolean;
  levelOrderDisabledReason: string;
  onOrderQuantityChange: (quantity: string) => void;
  onLevelOrder: (side: "BUY" | "SELL", price: string) => void;
}

interface LevelRowsProps {
  levels: readonly OrderBookLevelModel[];
  side: "ASK" | "BID";
  canOrder: boolean;
  disabledReason: string;
  onLevelOrder: OrderBookPanelProps["onLevelOrder"];
  executionStrength: string | null;
  recentTrades: readonly RecentTradeModel[];
  referenceStats: readonly OrderBookReferenceStat[];
}

function quantityNumber(value: string): number {
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function depthStyle(
  levels: readonly OrderBookLevelModel[],
  quantity: string,
): CSSProperties {
  const maximum = Math.max(0, ...levels.map((level) => quantityNumber(level.quantity)));
  const current = quantityNumber(quantity);
  return {
    "--depth-percent": `${maximum > 0 ? Math.max(3, (current / maximum) * 100) : 0}%`,
  } as CSSProperties;
}

function ReferenceStats({ stats }: { stats: readonly OrderBookReferenceStat[] }) {
  return (
    <dl className="pt-order-book__reference-stats">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={stat.dividerBefore ? "has-divider" : undefined}
        >
          <dt>{stat.label}</dt>
          <dd className={stat.direction ?? "flat"}>{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatTradeTime(value: string): string {
  if (!Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function TradeTape({
  executionStrength,
  recentTrades,
}: Pick<LevelRowsProps, "executionStrength" | "recentTrades">) {
  return (
    <div className="pt-order-book__trade-tape">
      <div className="pt-order-book__trade-strength">
        <span>체결강도</span>
        <strong
          className={
            executionStrength === null
              ? "flat"
              : Number(executionStrength) >= 100
                ? "positive"
                : "negative"
          }
        >
          {executionStrength === null ? "—" : `${executionStrength}%`}
        </strong>
      </div>
      <div className="pt-order-book__trade-head">
        <span>시간</span>
        <span>체결가</span>
        <span>체결량</span>
      </div>
      <ol>
        {recentTrades.length > 0 ? (
          recentTrades.slice(0, 8).map((trade) => (
            <li key={trade.id} className={trade.direction}>
              <time dateTime={trade.occurredAt}>
                {formatTradeTime(trade.occurredAt)}
              </time>
              <strong>{trade.price}</strong>
              <span>{trade.quantity ?? "—"}</span>
            </li>
          ))
        ) : (
          <li className="flat pt-order-book__trade-empty">
            실제 체결 수신 대기
          </li>
        )}
      </ol>
    </div>
  );
}

function LevelRows({
  levels,
  side,
  canOrder,
  disabledReason,
  onLevelOrder,
  executionStrength,
  recentTrades,
  referenceStats,
}: LevelRowsProps) {
  return levels.map((level, index) => (
    <tr
      className={`pt-order-book__row pt-order-book__row--${side.toLowerCase()} pt-depth--${level.depthBand}`}
      key={`${side}:${level.price}`}
      aria-disabled={!canOrder}
    >
      <td className="pt-order-book__action-cell pt-order-book__action-cell--sell">
        <button
          type="button"
          disabled={!canOrder}
          title={canOrder ? `${level.price}원에 매도 · ${side === "BID" ? "즉시체결 예상" : "체결 대기 예상"}` : disabledReason}
          aria-label={`${level.price}원 입력 수량 매도`}
          onClick={() => onLevelOrder("SELL", level.price)}
        />
      </td>
      {side === "ASK" ? (
        <td
          className="pt-order-book__quantity pt-order-book__quantity--ask"
          style={depthStyle(levels, level.quantity)}
        >
          <span aria-hidden="true" />
          <strong>{level.quantity}</strong>
        </td>
      ) : index === 0 ? (
        <td className="pt-order-book__tape-cell" rowSpan={levels.length}>
          <TradeTape
            executionStrength={executionStrength}
            recentTrades={recentTrades}
          />
        </td>
      ) : null}
      <td className="pt-order-book__price">
        <PriceText value={level.price} direction={level.direction} />{" "}
        <span className={`pt-order-book__rate ${level.direction}`}>
          ({level.changeRate === "—" ? "—" : `${level.changeRate}%`})
        </span>
      </td>
      {side === "ASK" ? (
        index === 0 ? (
          <td className="pt-order-book__stats-cell" rowSpan={levels.length}>
            <ReferenceStats stats={referenceStats} />
          </td>
        ) : null
      ) : (
        <td
          className="pt-order-book__quantity pt-order-book__quantity--bid"
          style={depthStyle(levels, level.quantity)}
        >
          <span aria-hidden="true" />
          <strong>{level.quantity}</strong>
        </td>
      )}
      <td className="pt-order-book__action-cell pt-order-book__action-cell--buy">
        <button
          type="button"
          disabled={!canOrder}
          title={canOrder ? `${level.price}원에 매수 · ${side === "ASK" ? "즉시체결 예상" : "체결 대기 예상"}` : disabledReason}
          aria-label={`${level.price}원 입력 수량 매수`}
          onClick={() => onLevelOrder("BUY", level.price)}
        />
      </td>
    </tr>
  ));
}

export function OrderBookPanel({
  instrumentId,
  asks,
  bids,
  totalAskQuantity,
  totalBidQuantity,
  currentPrice,
  currentPriceLabel = "현재가",
  executionStrength,
  recentTrades,
  referenceStats,
  currentDirection,
  freshness,
  dataMode = "REAL",
  referenceOnly = false,
  depthLabel,
  asOfLabel,
  orderQuantity,
  canOrderFromLevel,
  levelOrderDisabledReason,
  onOrderQuantityChange,
  onLevelOrder,
}: OrderBookPanelProps) {
  return (
    <section
      className="pt-panel pt-order-book"
      aria-labelledby="order-book-title"
      data-instrument-id={instrumentId}
    >
      <div className="pt-panel__header">
        <div>
          <p className="pt-eyebrow">
            {dataMode === "FIXTURE"
              ? "SYNTHETIC ORDER BOOK"
              : referenceOnly
                ? "REFERENCE PRICE LEVELS"
              : "REAL ORDER BOOK"}
          </p>
          <h2 id="order-book-title">
            {dataMode === "FIXTURE"
              ? "호가 화면 미리보기"
              : referenceOnly
                ? "가격 호가 단위"
              : freshness === "closed"
                ? "장마감 호가 스냅샷"
                : freshness === "live"
                  ? "실시간 호가"
                  : "마지막 수신 호가"}
          </h2>
        </div>
        <div className="pt-panel__actions">
          <Badge tone="info">{depthLabel}</Badge>
          <Status label="시세" state={freshness} detail={asOfLabel} />
        </div>
      </div>

      <div className="pt-order-book__current">
        <span className="pt-order-book__current-price">
          <span>{currentPriceLabel}</span>
          <PriceText
            value={currentPrice}
            direction={currentDirection}
            emphasis="strong"
          />
        </span>
        <label className="pt-order-book__direct-quantity">
          <span>수량</span>
          <input
            value={orderQuantity}
            inputMode="numeric"
            pattern="[0-9,]*"
            aria-label="호가 클릭 주문 수량"
            onChange={(event) => onOrderQuantityChange(event.target.value)}
          />
        </label>
      </div>

      <div className="pt-order-book__dealing-layout">
        <div className="pt-order-book__table-wrap">
          <table className="pt-order-book__table">
            <caption className="pt-visually-hidden">
              {instrumentId}{" "}
              {dataMode === "FIXTURE"
                ? "합성 호가 미리보기"
                : referenceOnly
                  ? "실제 현재가 기준 가격 단계 안내"
                  : "실제 시장 호가"}
              .{" "}
              {referenceOnly
                ? "실제 잔량 미수신으로 주문할 수 없습니다."
                : "수량 입력 후 왼쪽 매도 또는 오른쪽 매수 박스를 누르면 해당 가격으로 로컬 주문합니다."}
            </caption>
            <thead>
              <tr>
                <th scope="col">매도</th>
                <th scope="col">매도 잔량·체결</th>
                <th scope="col">가격 (등락률)</th>
                <th scope="col">매수 잔량</th>
                <th scope="col">매수</th>
              </tr>
            </thead>
            <tbody>
              <LevelRows
                levels={asks}
                side="ASK"
                canOrder={canOrderFromLevel}
                disabledReason={levelOrderDisabledReason}
                onLevelOrder={onLevelOrder}
                executionStrength={executionStrength}
                recentTrades={recentTrades}
                referenceStats={referenceStats}
              />
              <LevelRows
                levels={bids}
                side="BID"
                canOrder={canOrderFromLevel}
                disabledReason={levelOrderDisabledReason}
                onLevelOrder={onLevelOrder}
                executionStrength={executionStrength}
                recentTrades={recentTrades}
                referenceStats={referenceStats}
              />
            </tbody>
            <tfoot>
              <tr className="pt-order-book__totals">
                <th scope="row" colSpan={2}>
                  매도잔량 {totalAskQuantity}
                </th>
                <td />
                <td colSpan={2}>매수잔량 {totalBidQuantity}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <p className="pt-panel__footnote">
        {dataMode === "FIXTURE"
          ? "합성 호가 fixture입니다. 호가 행 클릭은 차트 미리보기에만 사용됩니다."
          : referenceOnly
            ? "KIS가 장전 잔량을 제공하지 않아 실제 현재가 기준 가격 단위만 표시합니다. 잔량은 미수신이며 주문·체결에는 사용하지 않습니다."
          : "수량 입력 후 왼쪽 매도·오른쪽 매수 박스를 클릭하면 로컬 계좌에만 주문하며 증권사에는 전송하지 않습니다."}
      </p>
    </section>
  );
}
