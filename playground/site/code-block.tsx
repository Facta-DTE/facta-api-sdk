import { useState, type ReactNode } from "react";
import { highlight } from "./components/highlight.tsx";
import { githubFileUrl } from "./source-links.ts";

/** «Ver en GitHub»: the exact file shown, in the public repository. Opens in a new tab. */
export function GithubLink({ path }: { path: string }) {
  return <a className="pg-code-gh" href={githubFileUrl(path)} target="_blank" rel="noopener">Ver en GitHub</a>;
}

/** Copies text and reports «Copiado» for a moment. */
export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (label: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(label);
      window.setTimeout(() => setCopied((current) => (current === label ? null : current)), 1500);
    }, () => undefined);
  };
  return { copied, copy };
}

/**
 * Shows source text. Callers pass a file imported with `?raw`, so the code on
 * the page is the code that runs and cannot drift from it.
 */
export function CodeBlock({ title, code, path, actions, className }: { title: string; code: string; /** Repository path of the file shown; adds «Ver en GitHub». */ path?: string; actions?: ReactNode; className?: string }) {
  const { copied, copy } = useCopy();
  return (
    <figure className={`pg-code${className ? ` ${className}` : ""}`}>
      <figcaption className="pg-code-bar">
        <span className="pg-code-title">{title}</span>
        {actions}
        {path !== undefined && <GithubLink path={path} />}
        <button type="button" className="pg-code-copy" onClick={() => copy("code", code.trim())}>{copied === "code" ? "Copiado" : "Copiar"}</button>
      </figcaption>
      <pre tabIndex={0}><code>{highlight(code.trim())}</code></pre>
    </figure>
  );
}

export interface CodeTab { id: string; label: string; code: string; /** Repository path of the file shown. */ path?: string; /** Shown under the code. */ note?: string }

/** The workbench's code panel: tabs over executed files, with «Copiar». */
export function CodePanel({ tabs, selected, onSelect, footer, className }: {
  tabs: CodeTab[];
  selected: string;
  onSelect(id: string): void;
  footer?: ReactNode;
  className?: string;
}) {
  const { copied, copy } = useCopy();
  const tab = tabs.find((t) => t.id === selected) ?? tabs[0]!;
  return (
    <section className={`pg-code${className ? ` ${className}` : ""}`} aria-label="Código">
      <div className="pg-code-bar">
        <div role="tablist" aria-label="Archivos" style={{ display: "flex", gap: 18 }}>
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" id={`code-tab-${t.id}`} aria-selected={t.id === tab.id} aria-controls="code-panel" className="pg-code-tab" onClick={() => onSelect(t.id)}>{t.label}</button>
          ))}
        </div>
        {tab.path !== undefined && <GithubLink path={tab.path} />}
        <button type="button" className="pg-code-copy" onClick={() => copy(tab.id, tab.code.trim())}>{copied === tab.id ? "Copiado" : "Copiar"}</button>
      </div>
      <pre id="code-panel" role="tabpanel" aria-labelledby={`code-tab-${tab.id}`} tabIndex={0}><code>{highlight(tab.code.trim())}</code></pre>
      {(tab.note !== undefined || footer !== undefined) && <div className="pg-code-foot">{tab.note ?? footer}</div>}
    </section>
  );
}
