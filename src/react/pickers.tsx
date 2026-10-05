// Accessible comboboxes (ARIA APG «editable combobox with list autocomplete»)
// over the catalog. They return the catalog id; the host's server builds the
// session with it.

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { fill, formatMoney, type CustomerOption, type ProductOption } from "../browser/index.ts";
import { CloseIcon, Spinner } from "./icons.tsx";
import { useCfg, type FactaLook } from "./look.tsx";
import { DataRoot, SearchIcon, splitLook } from "./data-parts.tsx";
import { useFactaCustomers, useFactaProducts, type CatalogSearch, type UseCatalogSearchOptions } from "./data-hooks.ts";

/** Wrap the matching part of `text` in `<mark>`. Case-insensitive. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const at = q === "" ? -1 : text.toLowerCase().indexOf(q);
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark>{text.slice(at, at + q.length)}</mark>{text.slice(at + q.length)}</>;
}

interface ComboboxProps<T extends { id: string }> {
  label: string;
  placeholder: string;
  keysHint: string;
  search: CatalogSearch<T>;
  text: string;
  onText(text: string): void;
  onChoose(option: T): void;
  renderOption(option: T, query: string): ReactNode;
  disabled?: boolean | undefined;
  id?: string | undefined;
  name?: string | undefined;
}

function Combobox<T extends { id: string }>(p: ComboboxProps<T>) {
  const { sp, messages } = useCfg();
  const m = messages.data.picker;
  const uid = useId();
  const inputId = p.id ?? `${uid}-input`;
  const listId = `${uid}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { search } = p;
  const showPanel = open && p.text.trim().length > 0;
  const hint = !search.ready
    ? fill(m.typeMore, { n: search.minChars })
    : null;

  useEffect(() => setActive(0), [search.query, search.items.length]);

  function choose(option: T | undefined) {
    if (!option) return;
    p.onChoose(option);
    setOpen(false);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    const count = search.items.length;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) setOpen(true);
        else if (count > 0) setActive((a) => (a + 1) % count);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) setOpen(true);
        else if (count > 0) setActive((a) => (a - 1 + count) % count);
        break;
      case "Home":
        if (open && count > 0) { event.preventDefault(); setActive(0); }
        break;
      case "End":
        if (open && count > 0) { event.preventDefault(); setActive(count - 1); }
        break;
      case "Enter":
        if (open && count > 0) {
          event.preventDefault();
          choose(search.items[active]);
        }
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  const activeId = showPanel && search.items[active] ? `${uid}-opt-${active}` : undefined;
  return (
    <div className="facta-combo">
      <label className="facta-combo-label" htmlFor={inputId}>{p.label}</label>
      <div {...sp("field", "facta-input facta-input--tall facta-input--search")} data-active={open ? "" : undefined}>
        <SearchIcon size={16} />
        <input
          ref={inputRef}
          id={inputId}
          name={p.name}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          placeholder={p.placeholder}
          disabled={p.disabled}
          value={p.text}
          onChange={(e) => {
            p.onText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => { if (p.text.trim()) setOpen(true); }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {search.loading && <Spinner size={16} />}
      </div>
      <div id={listId} role="listbox" aria-label={p.label} hidden={!showPanel} {...sp("option", "facta-pop")}>
        {showPanel && (
          <>
            {hint && <div className="facta-pop-note">{hint}</div>}
            {search.ready && search.loading && search.items.length === 0 && (
              <div aria-hidden>{[0, 1, 2].map((i) => <div key={i} className="facta-opt"><span className="facta-sk" style={{ height: 13, width: 150 + i * 30 }} /></div>)}</div>
            )}
            {search.ready && !search.loading && search.error && <div className="facta-pop-note facta-pop-note--bad" role="alert">{m.error}</div>}
            {search.ready && !search.loading && !search.error && search.items.length === 0 && (
              <div className="facta-pop-empty"><b>{fill(m.empty, { query: search.query })}</b><span>{m.emptyHelp}</span></div>
            )}
            {search.items.map((option, i) => (
              <div
                key={option.id}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className="facta-opt"
                data-active={i === active ? "" : undefined}
                onMouseDown={(e) => { e.preventDefault(); choose(option); }}
                onMouseMove={() => setActive(i)}
              >
                {p.renderOption(option, search.query)}
              </div>
            ))}
            {search.items.length > 0 && <div className="facta-pop-keys" aria-hidden>{p.keysHint}</div>}
          </>
        )}
      </div>
      <span className="facta-sr" role="status" aria-live="polite">
        {showPanel && search.ready && !search.loading ? fill(m.results, { n: search.items.length }) : ""}
      </span>
    </div>
  );
}

function initials(name: string | null): string {
  const parts = (name ?? "?").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export interface FactaCustomerPickerProps extends FactaLook, UseCatalogSearchOptions {
  /** The chosen customer (controlled). `null` clears it. */
  value?: CustomerOption | null | undefined;
  /** Called with the catalog option, or `null` when the person removes the selection. */
  onChange?: ((customer: CustomerOption | null) => void) | undefined;
  label?: string | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  /** Form field name; the input's value is the chosen catalog id. */
  name?: string | undefined;
  className?: string | undefined;
}

export function FactaCustomerPicker(props: FactaCustomerPickerProps) {
  const [look, rest] = splitLook(props);
  return (
    <DataRoot look={look} variant="picker" className={rest.className}>
      <CustomerInner {...rest} />
    </DataRoot>
  );
}

function CustomerInner(props: Omit<FactaCustomerPickerProps, keyof FactaLook>) {
  const { messages } = useCfg();
  const m = messages.data.picker;
  const [internal, setInternal] = useState<CustomerOption | null>(null);
  const value = props.value !== undefined ? props.value : internal;
  const [text, setText] = useState("");
  const search = useFactaCustomers(text, props);
  const set = (c: CustomerOption | null) => {
    setInternal(c);
    setText("");
    props.onChange?.(c);
  };
  if (value) {
    return (
      <div className="facta-combo">
        <span className="facta-combo-label">{props.label ?? m.customerLabel}</span>
        <div className="facta-sel">
          <span className="facta-av" aria-hidden>{initials(value.name)}</span>
          <div className="facta-sel-tx">
            <b>{value.name ?? "—"}</b>
            <span className="facta-mono">{[value.docType && value.docNumber ? `${value.docType} ${value.docNumber}` : value.docNumber, value.nrc ? `NRC ${value.nrc}` : null].filter(Boolean).join(" · ")}</span>
          </div>
          <button type="button" className="facta-btn facta-btn--icon facta-btn--ghost" aria-label={m.remove} disabled={props.disabled} onClick={() => set(null)}>
            <CloseIcon size={18} />
          </button>
        </div>
        {props.name && <input type="hidden" name={props.name} value={value.id} />}
      </div>
    );
  }
  return (
    <Combobox<CustomerOption>
      label={props.label ?? m.customerLabel}
      placeholder={props.placeholder ?? m.customerPlaceholder}
      keysHint={`${m.keys.navigate} · ${m.keys.chooseCustomer} · ${m.keys.close}`}
      search={search}
      text={text}
      onText={setText}
      onChoose={set}
      disabled={props.disabled}
      id={props.id}
      name={undefined}
      renderOption={(c, q) => (
        <>
          <span className="facta-opt-n"><Highlight text={c.name ?? "—"} query={q} /></span>
          <span className="facta-opt-s">
            {c.docNumber && <span className="facta-mono">{c.docType ? `${c.docType} ` : ""}{c.docNumber}</span>}
            {c.nrc && <span className="facta-mono">NRC {c.nrc}</span>}
          </span>
        </>
      )}
    />
  );
}

export interface FactaProductPickerProps extends FactaLook, UseCatalogSearchOptions {
  /** Called with the catalog option each time the person picks one; the field then clears so more can be added. */
  onSelect?: ((product: ProductOption) => void) | undefined;
  label?: string | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  className?: string | undefined;
}

export function FactaProductPicker(props: FactaProductPickerProps) {
  const [look, rest] = splitLook(props);
  return (
    <DataRoot look={look} variant="picker" className={rest.className}>
      <ProductInner {...rest} />
    </DataRoot>
  );
}

function ProductInner(props: Omit<FactaProductPickerProps, keyof FactaLook>) {
  const { messages } = useCfg();
  const m = messages.data.picker;
  const [text, setText] = useState("");
  const search = useFactaProducts(text, props);
  return (
    <Combobox<ProductOption>
      label={props.label ?? m.productLabel}
      placeholder={props.placeholder ?? m.productPlaceholder}
      keysHint={`${m.keys.navigate} · ${m.keys.chooseProduct} · ${m.keys.close}`}
      search={search}
      text={text}
      onText={setText}
      onChoose={(p) => {
        setText("");
        props.onSelect?.(p);
      }}
      disabled={props.disabled}
      id={props.id}
      renderOption={(p, q) => (
        <>
          <span className="facta-opt-n"><Highlight text={p.description ?? "—"} query={q} /></span>
          <span className="facta-opt-s">{p.code && <span className="facta-mono"><Highlight text={p.code} query={q} /></span>}</span>
          <span className="facta-opt-r">
            <b className="facta-amount">{formatMoney(p.price)}</b>
            {p.vatIncluded !== null && <span className="facta-tag">{p.vatIncluded ? m.vatIncluded : m.vatExcluded}</span>}
          </span>
        </>
      )}
    />
  );
}
