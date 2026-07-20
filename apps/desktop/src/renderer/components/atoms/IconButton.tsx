import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children" | "title"
> {
  label: string;
  icon: ReactNode;
  title?: string;
  pressed?: boolean;
}

export function IconButton({
  label,
  icon,
  title,
  pressed,
  className = "",
  type = "button",
  ...buttonProps
}: IconButtonProps) {
  return (
    <button
      {...buttonProps}
      type={type}
      className={["pt-icon-button", className].filter(Boolean).join(" ")}
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}
