import type { ReactNode } from "react";
import { CodeBlock } from "../code-block.tsx";
import "./example-card.css";

/**
 * One example: what it does, the live demo, and the code that runs it.
 * Callers pass the example's own file imported with `?raw`, so the code on
 * the page is the executed code. Shared by every section that shows examples.
 */
export function ExampleCard({ id, title, children, intro, code, codeTitle, note }: {
  id?: string;
  title: ReactNode;
  intro?: ReactNode;
  children: ReactNode;
  code: string;
  codeTitle: string;
  note?: ReactNode;
}) {
  return (
    <article className="pg-example" id={id}>
      <header>
        <h3>{title}</h3>
        {intro !== undefined && <p className="pg-example-intro">{intro}</p>}
      </header>
      <div className="pg-example-body">
        <div className="pg-example-demo">
          {children}
          {note !== undefined && <p className="pg-note">{note}</p>}
        </div>
        <div className="pg-example-code">
          <CodeBlock title={codeTitle} code={code} />
        </div>
      </div>
    </article>
  );
}
