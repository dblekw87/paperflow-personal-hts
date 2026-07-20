import type { ReactNode } from "react";

export interface BadgeProps {
  children: ReactNode;
  tone?: "neutral" | "positive" | "negative" | "warning" | "success" | "info";
  title?: string;
}

export function Badge({ children, tone = "neutral", title }: BadgeProps) {
  return (
    <span className={`pt-badge pt-badge--${tone}`} title={title}>
      {children}
    </span>
  );
}
