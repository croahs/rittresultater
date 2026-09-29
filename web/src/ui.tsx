import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
export const Icon = {
  overview: () => <svg viewBox="0 0 24 24" aria-hidden="true" {...s}><circle cx="12" cy="12" r="8" /><path d="M12 12l4-3" /><path d="M12 4v2M20 12h-2M12 20v-2M4 12h2" /></svg>,
  trend: () => <svg viewBox="0 0 24 24" aria-hidden="true" {...s}><path d="M3 17l5-5 4 3 8-8" /><path d="M15 7h5v5" /></svg>,
  rivals: () => <svg viewBox="0 0 24 24" aria-hidden="true" {...s}><circle cx="8" cy="8" r="3" /><circle cx="16" cy="8" r="3" /><path d="M3 19c.5-3 2.5-5 5-5s4.5 2 5 5M11 19c.5-3 2.5-5 5-5s4.5 2 5 5" /></svg>,
  races: () => <svg viewBox="0 0 24 24" aria-hidden="true" {...s}><path d="M5 4v16M5 5h11l-2 3 2 3H5" /><path d="M9 20h10" /></svg>,
  clip: () => <svg viewBox="0 0 24 24" aria-hidden="true" {...s}><path d="M4 18c3-1 3-7 6-8s3 5 6 4 3-7 4-8" /><circle cx="4" cy="18" r="1.5" /><circle cx="20" cy="6" r="1.5" /></svg>,
  search: () => <svg viewBox="0 0 24 24" aria-hidden="true" {...s}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>,
  sun: () => <svg viewBox="0 0 24 24" aria-hidden="true" {...s}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></svg>,
  moon: () => <svg viewBox="0 0 24 24" aria-hidden="true" {...s}><path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z" /></svg>,
  play: () => <svg viewBox="0 0 24 24" aria-hidden="true" {...s}><rect x="2.5" y="5" width="19" height="14" rx="4" /><path d="M10 9v6l5-3z" fill="currentColor" /></svg>,
  // YouTube's own mark: red rounded rectangle, white play triangle (brand colours, not the theme's).
  youtube: () => <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1.5" y="4.5" width="21" height="15" rx="4.5" fill="#FF0000" /><path d="M10 8.8v6.4l5.6-3.2z" fill="#fff" /></svg>,
  bolt: () => <svg viewBox="0 0 24 24" aria-hidden="true" {...s}><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>,
};

export const BrandMark = () => (
  <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
    <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--accent)" />
    <circle cx="16" cy="16" r="9" fill="none" stroke="var(--accent-ink)" strokeWidth="2.4" strokeDasharray="2.4 2.2" />
    <path d="M16 16l5-4" stroke="var(--accent-ink)" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

/* One shared tooltip for every chart. */
type TipFn = (e: { clientX: number; clientY: number } | null, content?: ReactNode) => void;
const TipCtx = createContext<TipFn>(() => {});
export const useTip = () => useContext(TipCtx);
export function TipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<{ x: number; y: number; c: ReactNode } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const show: TipFn = useCallback((e, c) => {
    if (!e) return setTip(null);
    const w = ref.current?.offsetWidth ?? 220, h = ref.current?.offsetHeight ?? 60;
    setTip({ x: Math.max(8, Math.min(e.clientX + 14, window.innerWidth - w - 8)), y: Math.max(8, Math.min(e.clientY + 14, window.innerHeight - h - 8)), c });
  }, []);
  return (
    <TipCtx.Provider value={show}>
      {children}
      {tip && <div ref={ref} className="tip" style={{ left: tip.x, top: tip.y }} role="status">{tip.c}</div>}
    </TipCtx.Provider>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><b>{title}</b>{children}</div>;
}
