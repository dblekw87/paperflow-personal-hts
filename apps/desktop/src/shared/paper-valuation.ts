const PRICE_SCALE_DIGITS = 4;
const PRICE_SCALE = 10_000n;
const RATE_SCALE = 10_000n;

export interface PaperValuationFill {
  readonly side: "BUY" | "SELL";
  readonly price: string;
  readonly quantity: string;
}

export interface PaperPositionValuation {
  readonly averagePrice: string | null;
  readonly marketValueMinor: string | null;
  readonly unrealizedPnlMinor: string | null;
  readonly unrealizedReturnRate: string | null;
}

function scaledDecimal(value: string): bigint {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error("Invalid decimal value");
  const fraction = (match[3] ?? "")
    .slice(0, PRICE_SCALE_DIGITS)
    .padEnd(PRICE_SCALE_DIGITS, "0");
  const absolute = BigInt(match[2]!) * PRICE_SCALE + BigInt(fraction);
  return match[1] === "-" ? -absolute : absolute;
}

function formatScaled(value: bigint, scaleDigits = PRICE_SCALE_DIGITS): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(scaleDigits);
  const whole = absolute / scale;
  const fraction = (absolute % scale)
    .toString()
    .padStart(scaleDigits, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${
    fraction.length > 0 ? `.${fraction}` : ""
  }`;
}

export function averagePaperPositionPrice(
  fills: readonly PaperValuationFill[],
  expectedQuantity: string,
): string | null {
  let quantity = 0n;
  let averageScaled = 0n;
  for (const fill of fills) {
    const fillQuantity = BigInt(fill.quantity);
    if (fillQuantity <= 0n) throw new Error("Invalid paper fill quantity");
    if (fill.side === "BUY") {
      const nextQuantity = quantity + fillQuantity;
      averageScaled =
        (averageScaled * quantity +
          scaledDecimal(fill.price) * fillQuantity) /
        nextQuantity;
      quantity = nextQuantity;
    } else {
      quantity -= fillQuantity;
      if (quantity < 0n) {
        throw new Error("Paper fills produce a negative position");
      }
      if (quantity === 0n) averageScaled = 0n;
    }
  }
  if (quantity !== BigInt(expectedQuantity)) {
    throw new Error("Paper fills and stored position quantity do not match");
  }
  return quantity === 0n ? null : formatScaled(averageScaled);
}

export function valuePaperPosition(input: {
  readonly quantity: string;
  readonly averagePrice: string | null;
  readonly marketPrice: string | null;
}): PaperPositionValuation {
  const quantity = BigInt(input.quantity);
  if (
    quantity <= 0n ||
    input.averagePrice === null ||
    input.marketPrice === null
  ) {
    return {
      averagePrice: input.averagePrice,
      marketValueMinor: null,
      unrealizedPnlMinor: null,
      unrealizedReturnRate: null,
    };
  }
  const average = scaledDecimal(input.averagePrice);
  const market = scaledDecimal(input.marketPrice);
  if (average <= 0n || market <= 0n) {
    throw new Error("Paper valuation prices must be positive");
  }
  const marketValue = (market * quantity) / PRICE_SCALE;
  const unrealizedPnl = ((market - average) * quantity) / PRICE_SCALE;
  const rateScaled =
    ((market - average) * 100n * RATE_SCALE) / average;
  return {
    averagePrice: input.averagePrice,
    marketValueMinor: marketValue.toString(),
    unrealizedPnlMinor: unrealizedPnl.toString(),
    unrealizedReturnRate: formatScaled(rateScaled),
  };
}
