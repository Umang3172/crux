import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import s from "./Button.module.css";

type Kind = "primary" | "secondary" | "quiet" | "danger";
type Size = "m" | "l";

const cls = (kind: Kind, size: Size, extra?: string) => [s.button, s[kind], s[size], extra].filter(Boolean).join(" ");

export function Button({
  kind = "secondary",
  size = "m",
  busy = false,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: Kind; size?: Size; busy?: boolean; children: ReactNode }) {
  return (
    <button type="button" className={cls(kind, size, className)} aria-busy={busy || undefined} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({ kind = "secondary", size = "m", className, ...rest }: LinkProps & { kind?: Kind; size?: Size }) {
  return <Link className={cls(kind, size, className)} {...rest} />;
}
