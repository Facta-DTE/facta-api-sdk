import type { ReactNode } from "react";

// A small highlighter for the code panels: comments, strings and keywords only, no dependency.
// It maps text to spans and never touches the text itself, so what is copied is what is shown.
const KEYWORDS = new Set("import export from const let var function async await return if else for of in new type interface extends as try catch throw typeof void null undefined true false default class".split(" "));
const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|([A-Za-z_$][\w$]*)(\s*\()?|(\s+|[^\sA-Za-z_$"'`/]+|[\s\S])/g;

export function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let index = 0;
  for (const match of code.matchAll(TOKEN)) {
    const [text, comment, string, word, call, other] = match;
    const key = index++;
    if (comment !== undefined) out.push(<span key={key} className="tk-c">{comment}</span>);
    else if (string !== undefined) out.push(<span key={key} className="tk-s">{string}</span>);
    else if (word !== undefined) {
      if (KEYWORDS.has(word)) out.push(<span key={key} className="tk-k">{word}</span>, call ?? "");
      else if (call !== undefined) out.push(<span key={key} className="tk-f">{word}</span>, call);
      else if (/^[A-Z]/.test(word)) out.push(<span key={key} className="tk-t">{word}</span>);
      else out.push(word);
    } else out.push(other ?? text);
  }
  return out;
}
