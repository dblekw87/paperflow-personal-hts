export type ObservedTradeDirection = "positive" | "negative" | "flat";

export interface ObservedTradeTapeItem {
  readonly id: string;
  readonly instrumentId: string;
  readonly occurredAt: string;
  readonly price: string;
  readonly quantity: string | null;
  readonly direction: ObservedTradeDirection;
}

interface PreviousTradeState {
  readonly identity: string;
  readonly price: string;
  readonly cumulativeVolume: bigint | null;
}

function unsignedInteger(value: string | null): bigint | null {
  return value !== null && /^\d+$/.test(value) ? BigInt(value) : null;
}

function positiveDecimal(value: string | null): string | null {
  if (value === null || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  return /^0(?:\.0+)?$/.test(value) ? null : value;
}

export class ObservedTradeTapeAccumulator {
  readonly #previous = new Map<string, PreviousTradeState>();

  public observe(input: {
    readonly instrumentId: string;
    readonly occurredAt: string | null;
    readonly price: string | null;
    readonly quantity: string | null;
    readonly cumulativeVolume: string | null;
  }): ObservedTradeTapeItem | null {
    const price = positiveDecimal(input.price);
    if (
      input.occurredAt === null ||
      !Number.isFinite(Date.parse(input.occurredAt)) ||
      price === null
    ) {
      return null;
    }
    const tradeQuantity = unsignedInteger(input.quantity);
    const cumulativeVolume = unsignedInteger(input.cumulativeVolume);
    const identity = `${input.occurredAt}:${price}:${tradeQuantity?.toString() ?? cumulativeVolume?.toString() ?? "unknown"}`;
    const previous = this.#previous.get(input.instrumentId);
    if (previous?.identity === identity) return null;
    if (
      previous?.cumulativeVolume !== null &&
      previous?.cumulativeVolume !== undefined &&
      cumulativeVolume !== null &&
      cumulativeVolume === previous.cumulativeVolume
    ) {
      return null;
    }

    const quantity =
      tradeQuantity ??
      (previous?.cumulativeVolume !== null &&
      previous?.cumulativeVolume !== undefined &&
      cumulativeVolume !== null &&
      cumulativeVolume > previous.cumulativeVolume
        ? cumulativeVolume - previous.cumulativeVolume
        : null);
    const direction: ObservedTradeDirection =
      previous === undefined || price === previous.price
        ? "flat"
        : price > previous.price
          ? "positive"
          : "negative";

    this.#previous.set(input.instrumentId, {
      identity,
      price,
      cumulativeVolume,
    });
    return {
      id: `${input.instrumentId}:${identity}`,
      instrumentId: input.instrumentId,
      occurredAt: input.occurredAt,
      price,
      quantity: quantity === null ? null : quantity.toString(),
      direction,
    };
  }
}
