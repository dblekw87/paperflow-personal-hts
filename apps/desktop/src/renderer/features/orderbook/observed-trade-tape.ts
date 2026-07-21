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
  readonly price: bigint;
  readonly cumulativeVolume: bigint | null;
}

function unsignedInteger(value: string | null): bigint | null {
  return value !== null && /^\d+$/.test(value) ? BigInt(value) : null;
}

export class ObservedTradeTapeAccumulator {
  readonly #previous = new Map<string, PreviousTradeState>();

  public observe(input: {
    readonly instrumentId: string;
    readonly occurredAt: string | null;
    readonly price: string | null;
    readonly cumulativeVolume: string | null;
  }): ObservedTradeTapeItem | null {
    if (
      input.occurredAt === null ||
      !Number.isFinite(Date.parse(input.occurredAt)) ||
      input.price === null ||
      !/^\d+$/.test(input.price) ||
      BigInt(input.price) <= 0n
    ) {
      return null;
    }
    const price = BigInt(input.price);
    const cumulativeVolume = unsignedInteger(input.cumulativeVolume);
    const identity = `${input.occurredAt}:${cumulativeVolume?.toString() ?? "unknown"}`;
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
      previous?.cumulativeVolume !== null &&
      previous?.cumulativeVolume !== undefined &&
      cumulativeVolume !== null &&
      cumulativeVolume > previous.cumulativeVolume
        ? cumulativeVolume - previous.cumulativeVolume
        : null;
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
      price: input.price,
      quantity: quantity === null ? null : quantity.toString(),
      direction,
    };
  }
}
