export type PriceDirection = "positive" | "negative" | "flat";

export interface PriceTextProps {
  value: string;
  direction?: PriceDirection;
  prefix?: string;
  suffix?: string;
  emphasis?: "normal" | "strong";
  accessibleLabel?: string;
  hideDirectionIcon?: boolean;
}

export function PriceText({
  value,
  direction = "flat",
  prefix,
  suffix,
  emphasis = "normal",
  accessibleLabel,
  hideDirectionIcon = false,
}: PriceTextProps) {
  const directionLabel =
    direction === "positive"
      ? "상승"
      : direction === "negative"
        ? "하락"
        : "보합";
  const visualDirection =
    direction === "positive"
      ? "up"
      : direction === "negative"
        ? "down"
        : "flat";

  return (
    <span
      className={`pt-price pt-price--${direction} pt-price--${visualDirection} pt-price--${emphasis}`}
      aria-label={
        accessibleLabel ??
        `${directionLabel} ${prefix ?? ""}${value}${suffix ?? ""}`
      }
    >
      {prefix}
      <span className="pt-price__value">{value}</span>
      {suffix}
      {hideDirectionIcon ? null : (
        <span className="pt-price__direction" aria-hidden="true">
          {direction === "positive"
            ? " ▲"
            : direction === "negative"
              ? " ▼"
              : " —"}
        </span>
      )}
    </span>
  );
}
