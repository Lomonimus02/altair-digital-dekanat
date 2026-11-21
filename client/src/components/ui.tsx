import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

export function Mark({ size = 40 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7dface" />
          <stop offset="1" stopColor="#02BF7A" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill={`url(#${id})`} />
      <path d="M32 9l4 15.2L53 32l-17 7.8L32 55l-4-15.2L11 32l17-7.8L32 9z" fill="white" />
    </svg>
  );
}

export function BackLink({ to }: { to: string }) {
  return (
    <Link to={to} className="btn btn-quiet mb-3 inline-flex h-11 px-3">
      <ChevronLeft className="h-4 w-4" /> Назад
    </Link>
  );
}

export function ContestNote({ className = "" }: { className?: string }) {
  return (
    <div className={className}>
      <p className="text-xs leading-relaxed text-[var(--muted)]">Учебный концепт «Цифровой деканат».</p>
      <p className="text-xs leading-relaxed text-[var(--muted)]">«Альтаир» вымышлен, это не вуз.</p>
    </div>
  );
}

export function Glass({ className = "", children, target }: { className?: string; children: ReactNode; target?: string }) {
  return (
    <section className={`liquid-glass ${className}`} data-agent-target={target}>
      <div className="glass-pad p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "glass" | "quiet" }) {
  return <button className={`btn btn-${variant} ${className}`} {...props} />;
}

export function ButtonLink({ to, children, variant = "primary" }: { to: string; children: ReactNode; variant?: "primary" | "glass" }) {
  return (
    <Link to={to} className={`btn btn-${variant}`}>
      {children}
    </Link>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function LoadingBlock() {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <div data-ui="notification"><div data-ui-part="title" className="t-title">Загрузка</div></div>
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <Glass>
      <div data-ui="notification"><div data-ui-part="title" className="t-title" title={title}>{title}</div></div>
      <p className="mt-2 text-sm text-[var(--muted)]">{text}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </Glass>
  );
}

export function ErrorState({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <Glass>
      <div data-ui="notification"><div data-ui-part="title" className="t-title">Не загрузилось</div></div>
      <p className="mt-2 text-sm text-[var(--muted)]">{text}</p>
      {onRetry ? (
        <Button className="mt-4" onClick={onRetry}>
          Повторить
        </Button>
      ) : null}
    </Glass>
  );
}

export function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`min-h-11 rounded-full px-4 text-sm font-semibold transition active:scale-95 ${active ? "bg-[var(--primary)] text-[var(--primary-ink)]" : "border border-white/40 bg-white/40"}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Pill({ children, tone = "low" }: { children: ReactNode; tone?: "low" | "mid" | "high" | "brand" }) {
  const style =
    tone === "high"
      ? { background: "var(--risk-high-bg)", color: "var(--risk-high-fg)" }
      : tone === "mid"
        ? { background: "var(--risk-mid-bg)", color: "var(--risk-mid-fg)" }
        : tone === "brand"
          ? { background: "color-mix(in srgb, var(--brand) 22%, white)", color: "var(--ink)" }
          : { background: "var(--risk-low-bg)", color: "var(--risk-low-fg)" };
  return (
    <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold" style={style}>
      {children}
    </span>
  );
}
