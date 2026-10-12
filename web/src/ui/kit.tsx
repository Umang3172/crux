// The component kit. Small, typed wrappers over the classes in styles/ui.css.

import { useEffect, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { ChevronRight, CircleAlert, Info, LoaderCircle, ShieldAlert, Sparkles, TriangleAlert, X } from "lucide-react";

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
    <Link to={to} viewTransition className={cx("btn", variant !== "default" && `btn-${variant}`, size !== "md" && `btn-${size}`, className)}>
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

/**
 * An explanation kept out of the way: a small mark that shows it on hover,
 * focus or tap. For what a first-time reader may want and a regular never does.
 */
export function Hint({ children, label = "More about this" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span className={cx("hint", open && "open")} ref={ref}>
      <button type="button" className="hint-btn" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Info size={13} aria-hidden />
      </button>
      <span className="hint-pop" role="tooltip">
        {children}
      </span>
    </span>
  );
}

/** Detail on demand: closed until someone wants it. */
export function Details({ summary, children, open }: { summary: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="more" open={open}>
      <summary>
        <ChevronRight size={13} aria-hidden />
        {summary}
      </summary>
      <div className="more-body">{children}</div>
    </details>
  );
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A number that moves to its new value instead of jumping, so a change is seen. */
export function CountUp({ value, format = (n) => String(Math.round(n)), ms = 500 }: { value: number; format?: (n: number) => string; ms?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || reducedMotion()) {
      from.current = value;
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const eased = 1 - (1 - k) ** 3;
      const v = start + (value - start) * eased;
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <span className="num">{format(shown)}</span>;
}

/** A share of a whole as a ring, with an optional mark for the bar it has to pass. */
export function Ring({ value, mark, size = 72, stroke = 6, tone = "accent", children }: { value: number; mark?: number; size?: number; stroke?: number; tone?: Tone; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const at = mark === undefined ? null : mark * 2 * Math.PI - Math.PI / 2;
  return (
    <span className={cx("ring", `tone-${tone}`)} style={{ width: size, height: size }} role="img" aria-label={`${Math.round(v * 100)} percent`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-fill" strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - v)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        {at !== null && <line x1={size / 2 + (r - stroke) * Math.cos(at)} y1={size / 2 + (r - stroke) * Math.sin(at)} x2={size / 2 + (r + stroke) * Math.cos(at)} y2={size / 2 + (r + stroke) * Math.sin(at)} className="ring-mark" />}
      </svg>
      {children !== undefined && <span className="ring-label">{children}</span>}
    </span>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode; count?: number; icon?: ReactNode }[]; label?: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value} className={cx("tab", t.id === value && "on")} onClick={() => onChange(t.id)}>
          {t.icon}
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// Toasts: a short confirmation that something a person did has happened.
type ToastItem = { id: number; message: ReactNode; tone: Tone };
let toasts: ToastItem[] = [];
let nextToast = 1;
const toastListeners = new Set<() => void>();
const toastEmit = () => toastListeners.forEach((l) => l());

export function toast(message: ReactNode, tone: Tone = "ok") {
  const id = nextToast++;
  toasts = [...toasts, { id, message, tone }];
  toastEmit();
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    toastEmit();
  }, 3800);
}

export function Toasts() {
  const list = useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toasts,
    () => toasts,
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={cx("toast", `tone-${t.tone}`)}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

/**
 * Names an element for a shared transition between two pages: the element with
 * the same name on the next page grows out of this one. One element per name
 * on a page.
 */
export const vt = (name: string): CSSProperties => ({ viewTransitionName: name.replace(/[^a-zA-Z0-9_-]/g, "-") });

