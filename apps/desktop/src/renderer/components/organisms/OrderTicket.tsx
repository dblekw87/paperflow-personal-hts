import type { FormEvent } from "react";

import { Badge, Button } from "../atoms";
import { Metric, Status } from "../molecules";

export interface OrderTicketDraft {
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  quantity: string;
  limitPrice: string;
}

export interface OrderTicketProps {
  instrumentName: string;
  currency: string;
  draft: OrderTicketDraft;
  availableCash: string;
  availableQuantity: string;
  estimatedAmount: string;
  quotedAtLabel: string;
  marketDataState: "live" | "delayed" | "stale" | "offline" | "closed";
  operationMode?: "PAPER_ORDER" | "PREVIEW";
  canSubmit: boolean;
  submitting?: boolean;
  errorMessage?: string;
  onDraftChange: (draft: OrderTicketDraft) => void;
  onSubmit: () => void;
}

export function OrderTicket({
  instrumentName,
  currency,
  draft,
  availableCash,
  availableQuantity,
  estimatedAmount,
  quotedAtLabel,
  marketDataState,
  operationMode = "PAPER_ORDER",
  canSubmit,
  submitting = false,
  errorMessage,
  onDraftChange,
  onSubmit,
}: OrderTicketProps) {
  const isPreview = operationMode === "PREVIEW";
  const submissionEnabled =
    canSubmit && (isPreview || marketDataState === "live");

  function update(patch: Partial<OrderTicketDraft>) {
    onDraftChange({ ...draft, ...patch });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionEnabled && !submitting) onSubmit();
  }

  const isBuy = draft.side === "BUY";

  return (
    <section
      className="pt-panel pt-order-ticket"
      aria-labelledby="paper-order-title"
    >
      <div className="pt-panel__header">
        <div>
          <p className="pt-eyebrow">LOCAL SIMULATION</p>
          <h2 id="paper-order-title">주문</h2>
        </div>
        <Badge tone="warning">실제 주문 아님</Badge>
      </div>

      <form onSubmit={submit} className="pt-order-ticket__form">
        <p className="pt-order-ticket__instrument">{instrumentName}</p>

        <div className="pt-segmented" role="group" aria-label="매수 또는 매도">
          <Button
            fullWidth
            tone={isBuy ? "danger" : "ghost"}
            onClick={() => update({ side: "BUY" })}
            aria-pressed={isBuy}
          >
            매수
          </Button>
          <Button
            fullWidth
            tone={!isBuy ? "primary" : "ghost"}
            onClick={() => update({ side: "SELL" })}
            aria-pressed={!isBuy}
          >
            매도
          </Button>
        </div>

        <div className="pt-field">
          <label htmlFor="paper-order-type">주문 유형</label>
          <select
            id="paper-order-type"
            value={draft.orderType}
            onChange={(event) =>
              update({ orderType: event.target.value as "LIMIT" | "MARKET" })
            }
          >
            <option value="LIMIT">지정가</option>
            <option value="MARKET">시장가</option>
          </select>
        </div>

        <div className="pt-field">
          <label htmlFor="paper-order-price">주문 가격 ({currency})</label>
          <input
            id="paper-order-price"
            inputMode="decimal"
            value={draft.orderType === "MARKET" ? "시장가" : draft.limitPrice}
            onChange={(event) => update({ limitPrice: event.target.value })}
            disabled={draft.orderType === "MARKET"}
            aria-describedby="paper-quote-time"
          />
          <small id="paper-quote-time">사용 시세 {quotedAtLabel}</small>
        </div>

        <div className="pt-field">
          <label htmlFor="paper-order-quantity">수량</label>
          <input
            id="paper-order-quantity"
            inputMode="numeric"
            pattern="[0-9]*"
            value={draft.quantity}
            onChange={(event) => update({ quantity: event.target.value })}
            aria-invalid={errorMessage ? "true" : undefined}
            aria-describedby={errorMessage ? "paper-order-error" : undefined}
          />
        </div>

        <div className="pt-order-ticket__summary">
          <Metric label="예상 주문금액" value={estimatedAmount} compact />
          <span>주문 가능 현금 {availableCash}</span>
          <span>매도 가능 {availableQuantity}주</span>
          <Status
            label="체결 기준 시세"
            state={marketDataState}
            detail={quotedAtLabel}
          />
        </div>

        {errorMessage ? (
          <p id="paper-order-error" role="alert" className="pt-form-error">
            {errorMessage}
          </p>
        ) : null}

        <Button
          type="submit"
          fullWidth
          tone={isBuy ? "danger" : "primary"}
          disabled={!submissionEnabled}
          busy={submitting}
        >
          {isPreview
            ? `${isBuy ? "매수" : "매도"} 마커 미리보기`
            : `${isBuy ? "매수" : "매도"} 주문 확인`}
        </Button>
        <p className="pt-order-ticket__notice">
          {isPreview
            ? "현재 화면은 fixture 미리보기입니다. 차트 마커만 추가하며 DB나 증권사에는 전송하지 않습니다."
            : "주문과 체결은 이 기기의 로컬 DB에만 기록되며 증권사로 전송되지 않습니다."}
        </p>
      </form>
    </section>
  );
}
