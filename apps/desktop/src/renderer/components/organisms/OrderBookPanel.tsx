import type { CSSProperties } from "react";

import { Badge, PriceText } from "../atoms";
import type { PriceDirection } from "../atoms";
import { Status } from "../molecules";
import { truncateUsPrice } from "../../model/price-display.js";

export interface OrderBookLevelModel {
  price: string;
  quantity: string;
  changeRate: string;
  direction: PriceDirection;
  depthBand: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  referenceOnly?: boolean;
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
  upperLimitPrice?: string | null;
  lowerLimitPrice?: string | null;
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
  onPendingOrderCancel: (clientOrderId: string) => void;
  pendingOrders?: readonly {
    readonly clientOrderId: string;
    readonly side: "BUY" | "SELL";
    readonly limitPrice: string;
    readonly remainingQuantity: string;
  }[];
}

interface LevelRowsProps {
  levels: readonly OrderBookLevelModel[];
  side: "ASK" | "BID";
  currentPrice: string;
  canOrder: boolean;
  disabledReason: string;
  onLevelOrder: OrderBookPanelProps["onLevelOrder"];
  onPendingOrderCancel: OrderBookPanelProps["onPendingOrderCancel"];
  executionStrength: string | null;
  recentTrades: readonly RecentTradeModel[];
  referenceStats: readonly OrderBookReferenceStat[];
  pendingOrders: NonNullable<OrderBookPanelProps["pendingOrders"]>;
  isUsPriceDisplay: boolean;
}

function normalizedPrice(value: string): string {
  const digits = value.replaceAll(",", "").replace(/[^0-9]/g, "");
  return digits.replace(/^0+(?=\d)/, "");
}

function pendingOrderGroup(
  orders: NonNullable<OrderBookPanelProps["pendingOrders"]>,
  side: "BUY" | "SELL",
  price: string,
): { readonly label: string; readonly clientOrderId: string } | null {
  const matches = orders.filter(
    (order) =>
      order.side === side &&
      normalizedPrice(order.limitPrice) === normalizedPrice(price),
  );
  if (matches.length === 0) return null;
  const first = matches[0];
  if (first === undefined) return null;
  const quantities = matches.map((order) => order.remainingQuantity);
  const quantity = quantities.every((value) => value === quantities[0])
    ? (quantities[0] ?? "0")
    : quantities.reduce((sum, value) => sum + BigInt(value), 0n).toString();
  return {
    label: matches.length === 1 ? quantity : `${quantity} (${matches.length})`,
    clientOrderId: first.clientOrderId,
  };
}

function quantityNumber(value: string): number {
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function editableQuantity(value: string): string {
  const digits = value.replace(/[^0-9]/g, "");
  return digits.replace(/^0+(?=\d)/, "");
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
        <span>체결가</span>
        <span>체결량</span>
      </div>
      <ol>
        {recentTrades.length > 0 ? (
          recentTrades.slice(0, 8).map((trade) => (
            <li key={trade.id} className={trade.direction}>
              <strong title={formatTradeTime(trade.occurredAt)}>{trade.price}</strong>
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

function PriceLimitRow({
  label,
  price,
  direction,
  isUsPriceDisplay,
}: {
  readonly label: string;
  readonly price: string | null | undefined;
  readonly direction: PriceDirection;
  readonly isUsPriceDisplay: boolean;
}) {
  if (price === null || price === undefined) return null;
  return (
    <tr className="pt-order-book__limit-row">
      <td />
      <td className="pt-order-book__limit-label">{label}</td>
      <td className="pt-order-book__price pt-order-book__limit-price">
        <PriceText
          value={isUsPriceDisplay ? truncateUsPrice(price) : price}
          direction={direction}
          hideDirectionIcon
        />
      </td>
      <td />
      <td />
    </tr>
  );
}

function LevelRows({
  levels,
  side,
  currentPrice,
  canOrder,
  disabledReason,
  onLevelOrder,
  onPendingOrderCancel,
  executionStrength,
  recentTrades,
  referenceStats,
  pendingOrders,
  isUsPriceDisplay,
}: LevelRowsProps) {
  return levels.map((level, index) => {
    const canOrderAtLevel = canOrder && level.referenceOnly !== true;
    const canSellAtLevel = canOrderAtLevel;
    const canBuyAtLevel = canOrderAtLevel;
    const sellExecutionHint =
      side === "BID" ? "즉시체결 예상" : "매도 대기 예상";
    const buyExecutionHint =
      side === "ASK" ? "즉시체결 예상" : "매수 대기 예상";
    const isCurrentPrice =
      normalizedPrice(level.price) !== "" &&
      normalizedPrice(level.price) === normalizedPrice(currentPrice);
    const sellPending = pendingOrderGroup(pendingOrders, "SELL", level.price);
    const buyPending = pendingOrderGroup(pendingOrders, "BUY", level.price);
    return (
    <tr
      className={`pt-order-book__row pt-order-book__row--${side.toLowerCase()} pt-depth--${level.depthBand}${isCurrentPrice ? " pt-order-book__row--current" : ""}`}
      key={`${side}:${level.price}`}
      aria-disabled={!canOrderAtLevel}
      aria-current={isCurrentPrice ? "true" : undefined}
      data-current-price={isCurrentPrice ? "true" : undefined}
    >
      <td className="pt-order-book__action-cell pt-order-book__action-cell--sell">
        <button
          type="button"
          disabled={sellPending === null && !canSellAtLevel}
          title={
            sellPending !== null
              ? `${level.price} 매도 대기 ${sellPending.label}주 취소`
              : canSellAtLevel
              ? `${level.price}에 매도 · ${sellExecutionHint}`
              : canOrderAtLevel
                ? `${level.price}에 매도 주문을 준비합니다.`
              : level.referenceOnly
                ? "참고 가격대는 실제 잔량이 없어 주문 근거로 사용하지 않습니다."
                : disabledReason
          }
          aria-label={
            sellPending !== null
              ? `${level.price}${isUsPriceDisplay ? "달러" : "원"} 매도 대기 주문 취소`
              : `${level.price}${isUsPriceDisplay ? "달러" : "원"} 입력 수량 매도`
          }
        onClick={() => {
          if (sellPending !== null) {
            onPendingOrderCancel(sellPending.clientOrderId);
            return;
          }
          onLevelOrder("SELL", level.price);
        }}
        className={sellPending ? "has-pending-order" : undefined}
        >{sellPending?.label}</button>
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
        <PriceText
          value={isUsPriceDisplay ? truncateUsPrice(level.price) : level.price}
          direction={level.direction}
          hideDirectionIcon
        />{" "}
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
          disabled={buyPending === null && !canBuyAtLevel}
          title={
            buyPending !== null
              ? `${level.price} 매수 대기 ${buyPending.label}주 취소`
              : canBuyAtLevel
              ? `${level.price}에 매수 · ${buyExecutionHint}`
              : canOrderAtLevel
                ? `${level.price}에 매수 주문을 준비합니다.`
              : level.referenceOnly
                ? "참고 가격대는 실제 잔량이 없어 주문 근거로 사용하지 않습니다."
                : disabledReason
          }
          aria-label={
            buyPending !== null
              ? `${level.price}${isUsPriceDisplay ? "달러" : "원"} 매수 대기 주문 취소`
              : `${level.price}${isUsPriceDisplay ? "달러" : "원"} 입력 수량 매수`
          }
          onClick={() => {
            if (buyPending !== null) {
              onPendingOrderCancel(buyPending.clientOrderId);
              return;
            }
            onLevelOrder("BUY", level.price);
          }}
          className={buyPending ? "has-pending-order" : undefined}
        >{buyPending?.label}</button>
      </td>
    </tr>
    );
  });
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
  upperLimitPrice,
  lowerLimitPrice,
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
  onPendingOrderCancel,
  pendingOrders = [],
}: OrderBookPanelProps) {
  const isUsPriceDisplay = /^(NASDAQ|NYSE|AMEX):/.test(instrumentId);
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
            hideDirectionIcon
          />
        </span>
        <label className="pt-order-book__direct-quantity">
          <span>수량</span>
          <input
            value={editableQuantity(orderQuantity)}
            inputMode="numeric"
            pattern="[0-9,]*"
            aria-label="호가 클릭 주문 수량"
            onFocus={(event) => {
              if (editableQuantity(event.currentTarget.value) === "0") {
                onOrderQuantityChange("");
              }
            }}
            onChange={(event) =>
              onOrderQuantityChange(editableQuantity(event.target.value))
            }
          />
        </label>
      </div>

      <div className="pt-order-book__dealing-layout">
        <div className="pt-order-book__table-wrap">
          <table className="pt-order-book__table">
            <colgroup>
              <col className="pt-order-book__col-action" />
              <col className="pt-order-book__col-auxiliary" />
              <col className="pt-order-book__col-price" />
              <col className="pt-order-book__col-auxiliary" />
              <col className="pt-order-book__col-action" />
            </colgroup>
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
                <th scope="col"><span className="pt-visually-hidden">매도 주문</span></th>
                <th scope="col">매도잔량</th>
                <th scope="col">가격 (등락률)</th>
                <th scope="col">매수잔량</th>
                <th scope="col"><span className="pt-visually-hidden">매수 주문</span></th>
              </tr>
            </thead>
            <tbody>
              <PriceLimitRow
                label="상한가"
                price={upperLimitPrice}
                direction="positive"
                isUsPriceDisplay={isUsPriceDisplay}
              />
              <LevelRows
                levels={asks}
                side="ASK"
                currentPrice={currentPrice}
                canOrder={canOrderFromLevel}
                disabledReason={levelOrderDisabledReason}
                onLevelOrder={onLevelOrder}
                onPendingOrderCancel={onPendingOrderCancel}
                executionStrength={executionStrength}
                recentTrades={recentTrades}
                referenceStats={referenceStats}
                pendingOrders={pendingOrders}
                isUsPriceDisplay={isUsPriceDisplay}
              />
              <LevelRows
                levels={bids}
                side="BID"
                currentPrice={currentPrice}
                canOrder={canOrderFromLevel}
                disabledReason={levelOrderDisabledReason}
                onLevelOrder={onLevelOrder}
                onPendingOrderCancel={onPendingOrderCancel}
                executionStrength={executionStrength}
                recentTrades={recentTrades}
                referenceStats={referenceStats}
                pendingOrders={pendingOrders}
                isUsPriceDisplay={isUsPriceDisplay}
              />
              <PriceLimitRow
                label="하한가"
                price={lowerLimitPrice}
                direction="negative"
                isUsPriceDisplay={isUsPriceDisplay}
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
          : "수량 입력 후 왼쪽 매도·오른쪽 매수 박스를 클릭하면 로컬 계좌에만 주문하며, 숫자가 표시된 대기 주문 박스는 클릭 시 취소됩니다."}
      </p>
    </section>
  );
}
