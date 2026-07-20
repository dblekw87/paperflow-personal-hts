import { Badge } from "../atoms";

export interface StatusProps {
  label: string;
  state: "live" | "delayed" | "stale" | "offline" | "closed" | "partial";
  detail?: string;
}

const statusText = {
  live: "LIVE",
  delayed: "지연",
  stale: "STALE",
  offline: "오프라인",
  closed: "마감",
  partial: "일부 지원",
} as const;

export function Status({ label, state, detail }: StatusProps) {
  const tone =
    state === "live"
      ? "success"
      : state === "offline"
        ? "negative"
        : state === "delayed" || state === "stale"
          ? "warning"
          : "neutral";

  return (
    <span className={`pt-status pt-status--${state}`} title={detail}>
      <span
        className={`pt-status__dot pt-status__dot--${state}`}
        aria-hidden="true"
      />
      <span className="pt-status__label">{label}</span>
      <Badge tone={tone}>{statusText[state]}</Badge>
      {detail ? <span className="pt-visually-hidden">{detail}</span> : null}
    </span>
  );
}
