export type UsEquitySession = "PRE" | "REGULAR" | "AFTER" | "CLOSED";

export function resolveUsEquitySession(now: Date): UsEquitySession {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = value("weekday");
  if (weekday === "Sat" || weekday === "Sun") return "CLOSED";
  const clock = `${value("hour")}${value("minute")}${value("second")}`;
  if (clock >= "040000" && clock < "093000") return "PRE";
  if (clock >= "093000" && clock < "160000") return "REGULAR";
  if (clock >= "160000" && clock < "200000") return "AFTER";
  return "CLOSED";
}
