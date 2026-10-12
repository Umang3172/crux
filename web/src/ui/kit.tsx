// The component kit. Small, typed wrappers over the classes in styles/ui.css.

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";
import { CircleAlert, Info, LoaderCircle, ShieldAlert, Sparkles, TriangleAlert, X } from "lucide-react";

export type Tone = "neutral" | "accent" | "model" | "sim" | "ok" | "warn" | "danger";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  busy?: boolean;
  block?: boolean;
};

export function Button({ variant = "default", size = "md", icon, busy, block, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      className={cx(
        "btn",
        variant !== "default" && `btn-${variant}`,
        size !== "md" && `btn-${size}`,
        !children && "btn-icon",
        block && "btn-block",
        className,
      )}
    >
      {busy ? <LoaderCircle size={14} className="spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function LinkButton({
  to,
  variant = "default",
  size = "md",
  icon,
  children,
  className,
}: {
  to: string;
  variant?: "default" | "primary" | "ghost";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Link to={to} className={cx("btn", variant !== "default" && `btn-${variant}`, size !== "md" && `btn-${size}`, className)}>
      {icon}
      {children}
    </Link>
  );
}

export function Badge({
  tone = "neutral",
  dot,
  pulse,
  plain,
  children,
  title,
}: {
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
  plain?: boolean;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={cx("badge", tone !== "neutral" && `badge-${tone}`, pulse && "pulse", plain && "badge-plain")} title={title}>
      {dot && <span className="dot" aria-hidden />}
      {children}
    </span>
  );
}

export function Card({
  title,
  icon,
  sub,
  actions,
  tone,
  flush,
  foot,
  children,
  className,
  id,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  tone?: Tone;
  flush?: boolean;
  foot?: ReactNode;
  children?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cx("card", tone && tone !== "neutral" && `tone-${tone}`, className)}>
      {(title || actions) && (
        <header className="card-head">
          <h2>
            {icon}
            {title}
          </h2>
          {sub && <span className="card-sub truncate">{sub}</span>}
          {actions && <div className="row push">{actions}</div>}
        </header>
      )}
      {children !== undefined && <div className={cx("card-body", flush && "flush")}>{children}</div>}
      {foot && <footer className="card-foot">{foot}</footer>}
    </section>
  );
}

export function Stat({ label, value, unit, sub, icon }: { label: ReactNode; value: ReactNode; unit?: ReactNode; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/** A belief (0 to 1) against the bar it has to pass. */
export function Meter({ value, mark, tone = "neutral", large }: { value: number; mark?: number; tone?: Tone; large?: boolean }) {
  const w = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={cx("meter", large && "lg")} role="img" aria-label={`${Math.round(w)} percent`}>
      <div className={cx("meter-fill", tone !== "neutral" && `tone-${tone}`)} style={{ width: `${w}%` }} />
      {mark !== undefined && <div className="meter-mark" style={{ left: `${mark * 100}%` }} title={`The bar: ${Math.round(mark * 100)}%`} />}
    </div>
  );
}

export function Seg<T extends string>({
  value,
  onChange,
  options,
  block,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: ReactNode; title?: string }[];
  block?: boolean;
  label?: string;
}) {
  return (
    <div className={cx("seg", block && "block")} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" title={o.title} className={o.id === value ? "on" : undefined} aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const CALLOUT_ICON: Record<string, ReactNode> = {
  accent: <Info size={15} aria-hidden />,
  model: <Sparkles size={15} aria-hidden />,
  warn: <TriangleAlert size={15} aria-hidden />,
  danger: <ShieldAlert size={15} aria-hidden />,
  ok: <Info size={15} aria-hidden />,
  neutral: <Info size={15} aria-hidden />,
};

export function Callout({ tone = "neutral", children, icon }: { tone?: Tone; children: ReactNode; icon?: ReactNode }) {
  return (
    <div className={cx("callout", tone !== "neutral" && `tone-${tone}`)}>
      {icon ?? CALLOUT_ICON[tone]}
      <div className="grow">{children}</div>
    </div>
  );
}

export function Empty({ icon, title, children, action, left }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; left?: boolean }) {
  return (
    <div className={cx("empty", left && "left")}>
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <Empty icon={<CircleAlert size={18} />} title="This could not be loaded" action={onRetry && <Button onClick={onRetry}>Try again</Button>}>
      {error.message}
    </Empty>
  );
}

export function Skeleton({ h = 14, w = "100%" }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w }} aria-hidden />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="col gap-3" style={{ padding: 16 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} w={`${92 - i * 11}%`} />
      ))}
    </div>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  sub,
  children,
  foot,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx("dialog", wide && "wide")} role="dialog" aria-modal="true" tabIndex={-1} ref={ref}>
        <header className="dialog-head">
          <div className="col gap-1 grow">
            <h2 style={{ fontSize: "var(--fs-16)" }}>{title}</h2>
            {sub && <span className="muted small">{sub}</span>}
          </div>
          <Button variant="ghost" icon={<X size={16} />} onClick={onClose} aria-label="Close" />
        </header>
        <div className="dialog-body">{children}</div>
        {foot && <footer className="dialog-foot">{foot}</footer>}
      </div>
    </div>
  );
}

/** Where a number came from. Shown wherever a figure is not a live measurement. */
export function SourceTag({ source }: { source: string }) {
  const s = source.toLowerCase();
  const tone: Tone = s.includes("synthetic") || s.includes("simulat") || s.includes("model") ? "sim" : s.includes("live") ? "ok" : "neutral";
  return (
    <Badge tone={tone} plain>
      {source}
    </Badge>
  );
}

export function PageHead({
  title,
  sub,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="col gap-1 grow">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <p className="muted balance page-sub">{sub}</p>}
      </div>
      {actions && <div className="row row-wrap">{actions}</div>}
    </header>
  );
}
