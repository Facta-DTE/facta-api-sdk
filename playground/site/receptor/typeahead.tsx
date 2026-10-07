import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { CatalogEntry, Hit } from "./catalogs.ts";

/** The text with the matched ranges underlined. */
export function Underlined({ text, ranges }: { text: string; ranges: Array<[number, number]> }) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([from, to], index) => {
    if (from > at) parts.push(text.slice(at, from));
    parts.push(<u key={index}>{text.slice(from, to)}</u>);
    at = to;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * A type-ahead over an official catalog (the board's activity picker): a code prefix or words, at most eight
 * results, ↑ ↓ Enter Esc, the matched text underlined. Picking calls `onPick`; typing again clears the pick.
 * ARIA: a combobox over a listbox, the active option announced through `aria-activedescendant`.
 */
export function Typeahead({ label, optional, value, onPick, search, placeholder, footer, invalid, disabledReason }: {
  label: string;
  optional?: boolean;
  /** The picked entry, or null while the visitor is still typing. */
  value: CatalogEntry | null;
  onPick(entry: CatalogEntry | null): void;
  search(query: string): Hit[];
  placeholder: string;
  footer: string;
  invalid?: boolean;
  /** Shown instead of results while the catalog is still downloading. */
  disabledReason?: string | null;
}) {
  const id = useId();
  const list = `${id}-list`;
  const [query, setQuery] = useState(value === null ? "" : `${value.code} — ${value.value}`);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  // A preset (or «Vaciar») changes the value from outside: the text follows it. Typing clears the value too,
  // and that must not wipe what was typed, so a clear only empties the box when it still shows the old pick.
  const shown = useRef(value === null ? "" : `${value.code} — ${value.value}`);
  useEffect(() => {
    const next = value === null ? null : `${value.code} — ${value.value}`;
    if (next !== null) { setQuery(next); shown.current = next; }
    else { setQuery((current) => (current === shown.current ? "" : current)); shown.current = ""; }
  }, [value?.code, value?.value]);

  const hits = useMemo(() => (open && value === null ? search(query) : []), [open, query, value, search]);
  useEffect(() => setActive(0), [query]);

  function choose(hit: Hit) {
    setQuery(`${hit.entry.code} — ${hit.entry.value}`);
    setOpen(false);
    onPick(hit.entry);
  }

  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (hits.length === 0) return;
      event.preventDefault();
      setActive((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length);
    } else if (event.key === "Enter" && open && hits[active] !== undefined) {
      event.preventDefault();
      choose(hits[active]!);
    } else if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
    }
  }

  const showList = open && value === null && query.trim() !== "";
  return (
    <div className="pg-field rcp-ta" ref={root} onBlur={(event) => { if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <label htmlFor={id}>{label}{optional && <span className="rcp-opt"> opcional</span>}</label>
      <div className={`rcp-ta-box${invalid ? " rcp-ta-box--invalid" : ""}${value !== null ? " rcp-ta-box--ok" : ""}`}>
        <span aria-hidden className="rcp-ta-icon">⌕</span>
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={list}
          aria-autocomplete="list"
          aria-activedescendant={showList && hits[active] !== undefined ? `${id}-${hits[active]!.entry.code}` : undefined}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); if (value !== null) onPick(null); }}
          onFocus={() => setOpen(true)}
          onKeyDown={keys}
        />
        {value !== null
          ? <button type="button" className="rcp-ta-clear" onClick={() => { setQuery(""); onPick(null); setOpen(true); }}>Cambiar</button>
          : <span className="rcp-ta-tag">código o palabra</span>}
      </div>
      {showList && (
        <div className="rcp-ta-pop">
          {disabledReason ? <p className="rcp-ta-empty">{disabledReason}</p> : (
            <>
              <ul role="listbox" id={list} aria-label={label}>
                {hits.map((hit, index) => (
                  <li
                    key={hit.entry.code}
                    id={`${id}-${hit.entry.code}`}
                    role="option"
                    aria-selected={index === active}
                    className={index === active ? "is-active" : undefined}
                    onMouseDown={(event) => { event.preventDefault(); choose(hit); }}
                    onMouseEnter={() => setActive(index)}
                  >
                    <b className="mono">{hit.entry.code}</b>
                    <span><Underlined text={hit.entry.value} ranges={hit.ranges} /></span>
                  </li>
                ))}
              </ul>
              {hits.length === 0 && <p className="rcp-ta-empty">Nada coincide con «{query.trim()}». Pruebe con otra palabra o con el código.</p>}
            </>
          )}
          <p className="rcp-ta-foot">{footer} · ↑ ↓ para moverse, Enter para elegir</p>
        </div>
      )}
    </div>
  );
}
