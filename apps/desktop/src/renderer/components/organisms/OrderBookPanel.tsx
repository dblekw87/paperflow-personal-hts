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

export interface OrderBookPanelProps {
  instrumentId: string;
  asks: readonly OrderBookLevelModel[];
  bids: readonly OrderBookLevelModel[];
  totalAskQuantity: string;
  totalBidQuantity: string;
  currentPrice: string;
  currentPriceLabel?: string;
  executionStrength: string | null;
  currentDirection: PriceDirection;
  freshness: "live" | "delayed" | "stale" | "offline" | "closed" | "partial";
  dataMode?: "REAL" | "FIXTURE";
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
}

function LevelRows({
  levels,
  side,
  canOrder,
  disabledReason,
  onLevelOrder,
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
          title={canOrder ? `${level.price}원에 매도` : disabledReason}
          aria-label={`${level.price}원 입력 수량 매도`}
          onClick={() => onLevelOrder("SELL", level.price)}
        />
      </td>
      <td className="pt-order-book__level">{index + 1}</td>
      <td className="pt-order-book__quantity">{level.quantity}</td>
      <td className="pt-order-book__price">
        <PriceText value={level.price} direction={level.direction} />
      </td>
      <td className="pt-order-book__change">
        <PriceText
          value={level.changeRate}
          direction={level.direction}
          suffix="%"
        />
      </td>
      <td className="pt-order-book__action-cell pt-order-book__action-cell--buy">
        <button
          type="button"
          disabled={!canOrder}
          title={canOrder ? `${level.price}원에 매수` : disabledReason}
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
  currentDirection,
  freshness,
  dataMode = "REAL",
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
              : "REAL ORDER BOOK"}
          </p>
          <h2 id="order-book-title">
            {dataMode === "FIXTURE" ? "호가 화면 미리보기" : "실시간 호가"}
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
        <span className="pt-order-book__strength">
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
                : "실제 시장 호가"}
              . 수량 입력 후 왼쪽 매도 또는 오른쪽 매수 박스를 누르면 해당 가격으로 로컬 주문합니다.
            </caption>
            <thead>
              <tr>
                <th scope="col">매도</th>
                <th scope="col">단계</th>
                <th scope="col">잔량</th>
                <th scope="col">가격</th>
                <th scope="col">등락률</th>
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
              />
              <LevelRows
                levels={bids}
                side="BID"
                canOrder={canOrderFromLevel}
                disabledReason={levelOrderDisabledReason}
                onLevelOrder={onLevelOrder}
              />
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  매도잔량 {totalAskQuantity}
                </th>
                <td colSpan={3}>매수잔량 {totalBidQuantity}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <p className="pt-panel__footnote">
        {dataMode === "FIXTURE"
          ? "합성 호가 fixture입니다. 호가 행 클릭은 차트 미리보기에만 사용됩니다."
          : "수량 입력 후 왼쪽 매도·오른쪽 매수 박스를 클릭하면 로컬 계좌에만 주문하며 증권사에는 전송하지 않습니다."}
      </p>
    </section>
  );
}
