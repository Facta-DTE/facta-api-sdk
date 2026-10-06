import { useState } from "react";

/**
 * Shows source text. Callers pass a file imported with `?raw`, so the code on
 * the page is the code that runs and cannot drift from it.
 */
export function CodeBlock({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }, () => undefined);
  };
  return (
    <figure className="pg-code">
      <figcaption>
        <span>{title}</span>
        <button type="button" onClick={copy}>{copied ? "Copiado" : "Copiar código"}</button>
      </figcaption>
      <pre tabIndex={0}><code>{code.trim()}</code></pre>
    </figure>
  );
}
