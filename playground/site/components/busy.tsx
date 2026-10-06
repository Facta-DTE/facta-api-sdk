import { useEffect, useState } from "react";

/** A small spinner for buttons and rows. Decorative: the words next to it carry the meaning. Static under reduced motion. */
export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="pg-spin" aria-hidden style={{ width: size, height: size }} />;
}

/** «Ejecutando…» with its spinner, the label of a button while its request is in flight. */
export function Busy({ children }: { children: string }) {
  return <><Spinner />{children}</>;
}

/** Milliseconds since `active` became true, refreshed every 100 ms; 0 while inactive. */
export function useElapsed(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Date.now() - started), 100);
    return () => clearInterval(timer);
  }, [active]);
  return elapsed;
}

/** Grey placeholder lines where a result is about to appear. */
export function Skeleton({ lines = 3, label = "Cargando…" }: { lines?: number; label?: string }) {
  return (
    <div className="pg-skeleton" role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => <span key={i} className="pg-skeleton-line" style={{ width: `${92 - i * 14}%` }} />)}
    </div>
  );
}
