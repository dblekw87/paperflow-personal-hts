export function truncateUsPrice(value: string, fallback = "—"): string {
  const normalized = value.replaceAll(",", "").trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return fallback;
  const whole = BigInt(match[2] ?? "0").toLocaleString("en-US");
  const fraction = (match[3] ?? "").padEnd(2, "0").slice(0, 2);
  return `${match[1] ?? ""}${whole}.${fraction}`;
}

export function truncateUsPriceNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return truncateUsPrice(value.toFixed(8));
}
