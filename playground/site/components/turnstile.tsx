import { useEffect, useRef, useState } from "react";
import { usePlayground } from "../state.tsx";
import { onTurnstileReset, setTurnstileRequired, setTurnstileToken, useTurnstileReady } from "../turnstile.ts";

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;

/** Loads Cloudflare's script once. The CSP allows exactly this origin for scripts and frames. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
    script.onerror = () => { loading = null; reject(new Error("turnstile")); };
    document.head.append(script);
  });
  return loading;
}

/**
 * The managed Turnstile widget, in Spanish, rendered beside the button it protects. Renders nothing
 * when the deployment does not use Turnstile (Access mode, or the local mock).
 */
export function TurnstileBox({ className }: { className?: string }) {
  const { view } = usePlayground();
  const siteKey = view.status === "ready" ? view.state.turnstileSiteKey ?? null : null;
  const holder = useRef<HTMLDivElement>(null);
  const ready = useTurnstileReady();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setTurnstileRequired(view.status === "ready" && view.state.turnstileSiteKey != null);
  }, [view]);

  useEffect(() => {
    if (siteKey === null || holder.current === null) return;
    let id: string | null = null;
    let gone = false;
    const element = holder.current;
    loadTurnstile().then((api) => {
      if (gone) return;
      id = api.render(element, {
        sitekey: siteKey,
        language: "es",
        theme: "light",
        appearance: "always",
        callback: (value: string) => setTurnstileToken(value),
        "expired-callback": () => setTurnstileToken(null),
        "error-callback": () => { setTurnstileToken(null); setFailed(true); },
      });
    }, () => setFailed(true));
    const stop = onTurnstileReset(() => { if (id !== null) window.turnstile?.reset(id); });
    return () => {
      gone = true;
      stop();
      if (id !== null) window.turnstile?.remove(id);
    };
  }, [siteKey]);

  if (siteKey === null) return null;
  return (
    <div className={`pg-turnstile${className ? ` ${className}` : ""}`}>
      <div ref={holder} />
      {!ready && !failed && <small className="pg-hint" role="status">Complete la verificación para continuar.</small>}
      {failed && <small className="pg-error" role="alert">No se pudo cargar la verificación. Recargue la página.</small>}
    </div>
  );
}
