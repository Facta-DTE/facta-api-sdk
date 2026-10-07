import { useState } from "react";
import { Link } from "../../router.tsx";
import { Inline } from "./inline.tsx";
import { PAGE_GUIDES } from "./page-guides.ts";
import { readPageGuideOpen, writePageGuideOpen } from "./storage.ts";
import "./guides.css";

/**
 * «Cómo funciona esta pantalla»: a collapsible card at the top of a page. It starts open on the visitor's
 * first visit to that page and collapsed afterwards; whatever they choose is remembered. Keyed by page, so
 * moving between components in the same section remembers each one on its own.
 */
export function PageGuideCard({ id }: { id: string }) {
  const guide = PAGE_GUIDES[id];
  const [open, setOpen] = useState(() => readPageGuideOpen(id));
  if (guide === undefined) return null;
  return (
    <details
      className="gd-page"
      open={open}
      onToggle={(event) => {
        const next = (event.currentTarget as HTMLDetailsElement).open;
        if (next === open) return;
        setOpen(next);
        writePageGuideOpen(id, next);
      }}
    >
      <summary>Cómo funciona esta pantalla</summary>
      <div className="gd-page-body">
        <div>
          <h2 className="gd-cap">El problema</h2>
          <p><Inline text={guide.problem} /></p>
        </div>
        <div>
          <h2 className="gd-cap">Qué hace</h2>
          <p><Inline text={guide.what} /></p>
        </div>
        <div>
          <h2 className="gd-cap">Qué mirar</h2>
          <ul className="gd-list gd-list--dot">
            {guide.look.map((line) => <li key={line}><Inline text={line} /></li>)}
          </ul>
        </div>
        <div>
          <h2 className="gd-cap">Más</h2>
          <ul className="gd-list gd-links">
            {guide.more.map((link) => (
              <li key={link.label}>
                {link.to !== undefined ? <Link to={link.to}>{link.label}</Link> : <a href={link.href} target="_blank" rel="noopener">{link.label}</a>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}
