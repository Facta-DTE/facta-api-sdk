import { Fragment, type ReactNode } from "react";

/**
 * The guides' tiny inline markup: `**bold**` and `` `code` ``. It builds React nodes, never HTML, so nothing
 * in a guide's text can inject markup.
 */
export function Inline({ text }: { text: string }): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <b key={index}>{part.slice(2, -2)}</b>;
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={index}>{part.slice(1, -1)}</code>;
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}
