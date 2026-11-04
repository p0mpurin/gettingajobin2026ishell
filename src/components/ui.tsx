import { createContext, useCallback, useContext, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Check, Info, TriangleAlert } from "lucide-react";
import { scoreTone } from "../lib/match";

type Variant = "chrome" | "ghost" | "outline" | "danger";

export function Button({
  variant = "outline",
  size = "md",
  icon,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; icon?: ReactNode }) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-[background,color,transform,box-shadow] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40";
  const sizes = size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8.5 px-3.5 text-[13px]";
  const variants: Record<Variant, string> = {
    chrome: "chrome-face font-semibold",
    ghost: "text-chrome-300 hover:bg-hover hover:text-chrome-50",
    outline: "chrome-border bg-raised text-chrome-200 hover:bg-hover hover:text-chrome-50",
    danger: "chrome-border bg-raised text-rose hover:bg-rose/10",
  };
  return (
    <button className={`${base} ${sizes} ${variants[variant]} ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-chrome-400 transition hover:bg-hover hover:text-chrome-50 active:scale-95 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

const TONES = {
  neutral: "border-line-strong bg-white/[0.03] text-chrome-300",
  mint: "border-mint/30 bg-mint/10 text-mint",
  sky: "border-sky/30 bg-sky/10 text-sky",
  amber: "border-amber/30 bg-amber/10 text-amber",
  violet: "border-violet/30 bg-violet/10 text-violet",
  rose: "border-rose/30 bg-rose/10 text-rose",
} as const;
export type Tone = keyof typeof TONES;

export function Chip({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-elevated px-1 font-mono text-[10px] text-chrome-300 shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)]">
      {children}
    </kbd>
  );
}

/** Circular match score. `tone` overrides the score colouring (e.g. for progress rings). */
export function ScoreRing({ score, size = 44, tone, label }: { score: number | null; size?: number; tone?: string; label?: string }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const pct = score ?? 0;
  return (
    <div className={`relative shrink-0 ${tone ?? scoreTone(score)}`} style={{ width: size, height: size }} title={score === null ? "No known technologies in this posting" : `Skill match ${score}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.07)" strokeWidth={3} />
        {score !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct / 100)}
            style={{ transition: "stroke-dashoffset 0.5s cubic-bezier(0.2,0.8,0.2,1)" }}
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums">
        {label ?? (score === null ? "–" : score)}
      </span>
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-chrome-500">{children}</h3>
      <div className="ml-auto">{right}</div>
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`chrome-border sheen rounded-xl bg-raised ${className}`}>{children}</div>;
}

/* ---------- toasts ---------- */

type ToastKind = "ok" | "info" | "warn";
/** Optional button on a toast, e.g. Undo. */
export interface ToastAction {
  label: string;
  run: () => void;
}
interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
  action?: ToastAction;
}
type Push = (text: string, kind?: ToastKind, action?: ToastAction) => void;
const ToastCtx = createContext<Push>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback<Push>(
    (text, kind = "ok", action) => {
      const id = Date.now() + Math.random();
      setItems((t) => [...t.slice(-3), { id, kind, text, action }]);
      // Toasts with an action stay longer, so there's time to click it.
      setTimeout(() => dismiss(id), action ? 6000 : 2800);
    },
    [dismiss],
  );
  const icon = { ok: <Check size={14} className="text-mint" />, info: <Info size={14} className="text-sky" />, warn: <TriangleAlert size={14} className="text-amber" /> };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {items.map((t) => (
          <div key={t.id} className="chrome-border animate-rise flex items-center gap-2 rounded-full bg-elevated/95 px-4 py-2 text-[13px] text-chrome-100 shadow-2xl shadow-black backdrop-blur">
            {icon[t.kind]}
            {t.text}
            {t.action && (
              <button
                className="pointer-events-auto ml-1 rounded-full border border-line-strong px-2.5 py-0.5 text-[12px] font-semibold text-chrome-50 transition hover:bg-hover"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Modal({ title, onClose, children, width = "max-w-lg" }: { title: string; onClose: () => void; children: ReactNode; width?: string }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm" onMouseDown={onClose}>
      <div className={`chrome-border sheen animate-rise w-full ${width} rounded-2xl bg-raised shadow-2xl`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="border-b border-line px-5 py-3.5 text-[14px] font-semibold chrome-text">{title}</div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
