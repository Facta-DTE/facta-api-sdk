import type { ReactNode } from "react";

/** What a section shows until its batch lands. */
export function Placeholder({ title, children, batch }: { title: string; children: ReactNode; batch: string }) {
  return (
    <section className="pg-page">
      <h1>{title}</h1>
      <div className="pg-card pg-placeholder">
        <p className="pg-badge">Próximamente · {batch}</p>
        {children}
      </div>
    </section>
  );
}
