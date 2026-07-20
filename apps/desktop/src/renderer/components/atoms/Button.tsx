import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  children: ReactNode;
  tone?: "primary" | "secondary" | "danger" | "ghost";
  size?: "compact" | "regular";
  fullWidth?: boolean;
  busy?: boolean;
}

export function Button({
  children,
  tone = "secondary",
  size = "regular",
  fullWidth = false,
  busy = false,
  className = "",
  disabled,
  type = "button",
  ...buttonProps
}: ButtonProps) {
  const classes = [
    "pt-button",
    `pt-button--${tone}`,
    `pt-button--${size}`,
    fullWidth ? "pt-button--full" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...buttonProps}
      className={classes}
      disabled={disabled === true || busy}
      type={type}
      aria-busy={busy || undefined}
    >
      {busy ? <span className="pt-button__spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}
