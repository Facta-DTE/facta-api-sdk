import { useEffect, useId, useRef, useState } from "react";
import { fill, formatMoney, type DocumentFilters, type DocumentRow, type DownloadKind } from "../browser/index.ts";
import { FactaClientError } from "../browser/index.ts";
import type { DteType } from "../types.ts";
import { AlertIcon, CloseIcon, Spinner } from "./icons.tsx";
import { useCfg, useMediaQuery, type FactaLook } from "./look.tsx";
import {
  Attribution,
  BanIcon,
  CalendarIcon,
  DataRoot,
  DotsIcon,
  ErrorCallout,
  EstadoBadge,
  EyeOffIcon,
  FilterIcon,
  JsonIcon,
  MenuList,
  PdfIcon,
  RefreshIcon,
  SearchIcon,
  TicketIcon,
  CopyGlyph,
  EyeGlyph,
  docTypeLabel,
  midTruncate,
  shortDate,
  shortTime,
  splitLook,
  type MenuEntry,
} from "./data-parts.tsx";
import { useFactaActions, useFactaDocuments } from "./data-hooks.ts";
import { FactaDocumentDetail } from "./document-detail.tsx";
import { FactaWindowError } from "./provider.tsx";

export interface FactaDocumentListProps extends FactaLook {
  /** Controlled filters. Omit for an uncontrolled list that starts from `defaultFilters`. */
  filters?: DocumentFilters | undefined;
  defaultFilters?: DocumentFilters | undefined;
  onFiltersChange?: ((filters: DocumentFilters) => void) | undefined;
  /** Rows per request (default 25). */
  pageSize?: number | undefined;
  /** `auto` (default): table above 640 px, cards below. */
  variant?: "auto" | "table" | "cards" | undefined;
  title?: string | undefined;
  /** Hide the title row. */
  hideHeader?: boolean | undefined;
  /** Show the filters row (default true). */
  showFilters?: boolean | undefined;
  /** Formats in the row menu. Default all three; pass `[]` to hide downloads. */
  downloads?: DownloadKind[] | undefined;
  /**
   * Ask the API for each row's document (`include: ["dte"]`) so the receiver cell
   * also shows the concept and, when the handler exposes recipients, the receiver
   * read from the legal document. Pages are 25 rows at most. Default false.
   */
  includeDte?: boolean | undefined;
  /** Open the built-in detail drawer on «Ver detalle» / row click (default true). */
  detail?: boolean | undefined;
  /** Called instead of (or besides) the built-in detail. */
  onOpen?: ((row: DocumentRow) => void) | undefined;
  /**
   * Gives «Anular documento» on sealed rows: return the token your server made
   * with `createFactaInvalidationSession`. Omit it to hide the action.
   */
  onInvalidate?: ((row: DocumentRow) => string | Promise<string>) | undefined;
  onInvalidated?: ((row: DocumentRow) => void) | undefined;
  className?: string | undefined;
}

type Period = "all" | "today" | "week" | "month" | "custom";

interface FilterState {
  period: Period;
  desde: string;
  hasta: string;
  tipoDte: "" | DteType;
  estado: "" | "sellado" | "contingencia" | "invalidado";
  buscar: string;
}

function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function periodRange(period: Period, today: Date = new Date()): { desde?: string; hasta?: string } {
  if (period === "today") return { desde: iso(today), hasta: iso(today) };
  if (period === "week") return { desde: iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)), hasta: iso(today) };
  if (period === "month") return { desde: iso(new Date(today.getFullYear(), today.getMonth(), 1)), hasta: iso(today) };
  return {};
}

function toState(f: DocumentFilters | undefined): FilterState {
  const custom = Boolean(f?.desde || f?.hasta);
  return {
    period: custom ? "custom" : "all",
    desde: f?.desde ?? "",
    hasta: f?.hasta ?? "",
    tipoDte: f?.tipoDte ?? "",
    estado: (f?.estado === "firmado" ? "" : f?.estado) ?? "",
    buscar: f?.buscar ?? "",
  };
}

function toFilters(s: FilterState): DocumentFilters {
  const out: DocumentFilters = {};
  if (s.desde) out.desde = s.desde;
  if (s.hasta) out.hasta = s.hasta;
  if (s.tipoDte) out.tipoDte = s.tipoDte;
  if (s.estado) out.estado = s.estado;
  if (s.buscar.trim()) out.buscar = s.buscar.trim();
  return out;
}

const TYPE_ORDER: DteType[] = ["01", "03", "05", "06", "11", "14"];

function Select({ label, value, onChange, children }: { label: string; value: string; onChange(v: string): void; children: React.ReactNode }) {
  const { sp } = useCfg();
  return (
    <label className="facta-input-wrap">
      <span className="facta-sr">{label}</span>
      <select {...sp("field", "facta-input facta-select")} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}

function Toolbar({ state, setState, phone }: { state: FilterState; setState(s: FilterState): void; phone: boolean }) {
  const { messages, cx, sp } = useCfg();
  const m = messages.data.list;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const active = [state.period !== "all", state.tipoDte !== "", state.estado !== ""].filter(Boolean).length;
  const set = (patch: Partial<FilterState>) => setState({ ...state, ...patch });
  const setPeriod = (period: Period) => {
    const range = periodRange(period);
    set(period === "custom" ? { period } : { period, desde: range.desde ?? "", hasta: range.hasta ?? "" });
  };
  const periodLabels: Record<Period, string> = {
    all: m.period,
    today: "Hoy",
    week: "Últimos 7 días",
    month: "Este mes",
    custom: "Personalizado…",
  };
  const controls = (
    <>
      <Select label={m.period} value={state.period} onChange={(v) => setPeriod(v as Period)}>
        {(Object.keys(periodLabels) as Period[]).map((p) => <option key={p} value={p}>{p === "all" ? "Todo el historial" : periodLabels[p]}</option>)}
      </Select>
      {state.period === "custom" && (
        <>
          <label className="facta-input-wrap"><span className="facta-sr">{m.from}</span><input type="date" {...sp("field", "facta-input")} aria-label={m.from} value={state.desde} max={state.hasta || undefined} onChange={(e) => set({ desde: e.target.value })} /></label>
          <label className="facta-input-wrap"><span className="facta-sr">{m.to}</span><input type="date" {...sp("field", "facta-input")} aria-label={m.to} value={state.hasta} min={state.desde || undefined} onChange={(e) => set({ hasta: e.target.value })} /></label>
        </>
      )}
      <Select label={m.columns.type} value={state.tipoDte} onChange={(v) => set({ tipoDte: v as FilterState["tipoDte"] })}>
        <option value="">{m.allTypes}</option>
        {TYPE_ORDER.map((t) => <option key={t} value={t}>{docTypeLabel(t, messages)}</option>)}
      </Select>
      <Select label={m.columns.status} value={state.estado} onChange={(v) => set({ estado: v as FilterState["estado"] })}>
        <option value="">{m.allStates}</option>
        {(["sellado", "contingencia", "invalidado"] as const).map((e) => <option key={e} value={e}>{messages.status[e]}</option>)}
      </Select>
    </>
  );
  return (
    <div className="facta-toolbar" role="search">
      <label className="facta-input-wrap facta-input-wrap--grow">
        <span className="facta-sr">{m.searchPlaceholder}</span>
        <span {...sp("field", "facta-input facta-input--search")}>
          <SearchIcon size={16} />
          <input
            type="search"
            inputMode="search"
            placeholder={m.searchPlaceholder}
            aria-label={m.searchPlaceholder}
            aria-describedby={`${panelId}-note`}
            value={state.buscar}
            onChange={(e) => set({ buscar: e.target.value })}
          />
        </span>
      </label>
      {phone ? (
        <>
          <button type="button" className={cx("facta-btn facta-btn--icon facta-btn--filter")} aria-label={m.filters} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
            <FilterIcon size={18} />
            {active > 0 && <span className="facta-count" aria-hidden>{active}</span>}
          </button>
          {open && <div id={panelId} className="facta-filter-panel">{controls}</div>}
        </>
      ) : controls}
      <span id={`${panelId}-note`} className="facta-sr">{m.searchLoadedNote}</span>
    </div>
  );
}

function ConceptLine({ row }: { row: DocumentRow }) {
  const concept = row.resumen?.primeraDescripcion;
  if (!concept) return null;
  const extra = (row.resumen?.lineas ?? 1) - 1;
  return <small className="facta-muted facta-subline">{concept}{extra > 0 ? ` +${extra}` : ""}</small>;
}

function ReceiverCell({ row }: { row: DocumentRow }) {
  const { messages } = useCfg();
  // The legal document's receiver stands in for the index's, which is empty when the catalog is private.
  const legal = row.resumen?.receptor;
  if (legal && (!row.receptor || (!row.receptor.nombre && !row.receptor.numDocumento))) {
    return (
      <span>
        {legal.nombre ?? messages.data.list.finalConsumer}
        {legal.numDocumento && <small className="facta-muted facta-subline">{legal.numDocumento}</small>}
        <ConceptLine row={row} />
      </span>
    );
  }
  if (row.receptor === undefined) {
    return <span className="facta-hidden-r"><EyeOffIcon size={14} />{messages.data.list.receiverHidden}</span>;
  }
  if (row.receptor === null || (!row.receptor.nombre && !row.receptor.numDocumento)) {
    return <span className="facta-muted">{messages.data.list.finalConsumer}</span>;
  }
  return (
    <span>
      {row.receptor.nombre ?? messages.data.list.finalConsumer}
      {row.receptor.numDocumento && <small className="facta-muted facta-subline">{row.receptor.numDocumento}</small>}
      <ConceptLine row={row} />
    </span>
  );
}

function Skeleton({ cards }: { cards: boolean }) {
  return (
    <div className={cards ? "facta-cards" : "facta-table"} aria-busy="true" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <div className={cards ? "facta-card-row" : "facta-tr facta-row"} key={i}>
          <span className="facta-sk" style={{ height: 12, width: 60 + ((i * 17) % 50) }} />
          <span className="facta-sk" style={{ height: 12, width: 100 }} />
          <span className="facta-sk" style={{ height: 12, width: 150 }} />
        </div>
      ))}
    </div>
  );
}

/** Documents of the company: table on desktop, cards on phones. Reads through `documents: "read"`. */
export function FactaDocumentList(props: FactaDocumentListProps) {
  const [look, rest] = splitLook(props);
  return (
    <DataRoot look={look} variant="list" className={rest.className}>
      <ListInner {...rest} />
    </DataRoot>
  );
}

function ListInner(props: Omit<FactaDocumentListProps, keyof FactaLook>) {
  const { cx, sp, messages } = useCfg();
  const m = messages.data.list;
  const phoneQuery = useMediaQuery("(max-width: 640px)");
  const cards = props.variant === "cards" || (props.variant !== "table" && phoneQuery);
  const [internal, setInternal] = useState<FilterState>(() => toState(props.filters ?? props.defaultFilters));
  const controlled = props.filters !== undefined;
  const state = controlled ? toState(props.filters) : internal;
  // Keep the period label of a controlled list in step with the preset the person picked.
  const [presetFor, setPresetFor] = useState<Period>(state.period);
  const shown: FilterState = controlled ? { ...state, period: presetFor === "custom" || state.desde || state.hasta ? (presetFor === "all" ? "custom" : presetFor) : "all" } : state;
  const filters = toFilters(shown);
  const setState = (next: FilterState) => {
    setPresetFor(next.period);
    if (!controlled) setInternal(next);
    props.onFiltersChange?.(toFilters(next));
  };
  const list = useFactaDocuments(props.includeDte ? { ...filters, include: ["dte"] } : filters, { pageSize: props.pageSize ?? 25 });
  const actions = useFactaActions();
  const [menu, setMenu] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  const say = (tone: "ok" | "bad", text: string) => {
    setNotice({ tone, text });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3500);
  };

  const kinds = props.downloads ?? (["pdf", "json", "ticket"] as DownloadKind[]);
  const showDetail = props.detail !== false;
  const open = (row: DocumentRow) => {
    props.onOpen?.(row);
    if (showDetail) setDetail(row.codigoGeneracion);
  };
  const entriesFor = (row: DocumentRow): MenuEntry[] => {
    const out: MenuEntry[] = [];
    const dl = (kind: DownloadKind, label: string, icon: React.ReactNode): MenuEntry => ({
      id: kind,
      label,
      icon,
      onSelect: () => void actions.download(row.codigoGeneracion, kind).catch(() => say("bad", messages.data.download.failed)),
    });
    if (kinds.includes("pdf")) out.push(dl("pdf", messages.data.menu.pdf, <PdfIcon size={16} />));
    if (kinds.includes("json")) out.push(dl("json", messages.data.menu.json, <JsonIcon size={16} />));
    if (kinds.includes("ticket")) out.push(dl("ticket", messages.data.menu.ticket, <TicketIcon size={16} />));
    out.push({
      id: "copy",
      label: messages.data.menu.copyCode,
      icon: <CopyGlyph size={16} />,
      separatorBefore: out.length > 0,
      onSelect: () => void actions.copyCode(row.codigoGeneracion).then(() => say("ok", messages.data.menu.codeCopied)),
    });
    if (showDetail || props.onOpen) out.push({ id: "detail", label: messages.data.menu.detail, icon: <EyeGlyph size={16} />, onSelect: () => open(row) });
    if (props.onInvalidate && row.estado === "sellado") {
      out.push({
        id: "invalidate",
        label: messages.data.menu.invalidate,
        icon: <BanIcon size={16} />,
        danger: true,
        separatorBefore: true,
        onSelect: () => {
          void (async () => {
            try {
              const token = await props.onInvalidate!(row);
              await actions.invalidate(token);
              props.onInvalidated?.(row);
              await list.refresh();
            } catch (error) {
              if (!(error instanceof FactaWindowError)) say("bad", error instanceof Error ? error.message : String(error));
            }
          })();
        },
      });
    }
    return out;
  };

  const kebab = (row: DocumentRow) => (
    <div className="facta-row-menu">
      <button
        type="button"
        ref={(el) => { if (el) triggers.current.set(row.codigoGeneracion, el); else triggers.current.delete(row.codigoGeneracion); }}
        className="facta-kebab"
        aria-label={`${m.actions}: ${row.numeroControl}`}
        aria-haspopup="menu"
        aria-expanded={menu === row.codigoGeneracion}
        data-open={menu === row.codigoGeneracion ? "" : undefined}
        onClick={() => setMenu(menu === row.codigoGeneracion ? null : row.codigoGeneracion)}
      >
        <DotsIcon size={18} />
      </button>
      {menu === row.codigoGeneracion && (
        <MenuList
          entries={entriesFor(row)}
          label={m.actions}
          onClose={(restore) => {
            setMenu(null);
            if (restore) triggers.current.get(row.codigoGeneracion)?.focus();
          }}
        />
      )}
    </div>
  );

  const hasFilters = Object.keys(filters).length > 0;
  const loadedButEmpty = list.items.length === 0 && list.loaded > 0;
  const errorCode = list.error instanceof FactaClientError ? list.error.code : undefined;
  const reset = () => setState({ period: "all", desde: "", hasta: "", tipoDte: "", estado: "", buscar: "" });

  let content: React.ReactNode;
  if (list.loading) content = <Skeleton cards={cards} />;
  else if (list.error && list.items.length === 0 && list.loaded === 0) {
    content = <ErrorCallout title={m.error.title} body={m.error.body} code={errorCode} onRetry={() => void list.refresh()} retryLabel={m.error.retry} />;
  } else if (list.items.length === 0) {
    const none = loadedButEmpty;
    content = (
      <div className="facta-empty" role="status">
        <span className="facta-empty-ring" aria-hidden><CalendarIcon size={22} /></span>
        <h3>{none ? m.noMatches.title : m.empty.title}</h3>
        <p>{none ? m.noMatches.body : m.empty.body}</p>
        {(hasFilters || none) && <button type="button" className="facta-btn facta-btn--sm" onClick={reset}>{m.clearFilters}</button>}
      </div>
    );
  } else if (cards) {
    content = (
      <ul className="facta-cards" aria-label={m.title}>
        {list.items.map((row) => (
          <li key={row.codigoGeneracion} {...sp("row", "facta-card-row")} data-estado={row.estado}>
            <button type="button" className="facta-card-hit" onClick={() => open(row)} aria-label={`${docTypeLabel(row.tipoDte, messages)} ${row.numeroControl}`}>
              <span className="facta-card-t">{docTypeLabel(row.tipoDte, messages)}</span>
              <span className="facta-card-when">{shortDate(row.fecEmi)} · {shortTime(row.horEmi)}</span>
              <span className="facta-card-ctl facta-mono" title={row.numeroControl}>{midTruncate(row.numeroControl)}</span>
              <span className="facta-card-rc"><ReceiverCell row={row} /></span>
              <span className="facta-card-bt"><b className="facta-amount">{formatMoney(row.totales?.totalPagar)}</b><EstadoBadge estado={row.estado} /></span>
            </button>
            {kebab(row)}
          </li>
        ))}
      </ul>
    );
  } else {
    content = (
      <div className="facta-table" role="table" aria-label={m.title} aria-busy={list.refreshing || undefined}>
        <div className="facta-tr facta-th" role="row">
          {[m.columns.date, m.columns.type, m.columns.control, m.columns.receiver, m.columns.total, m.columns.status].map((c, i) => (
            <div key={c} role="columnheader" className={i === 4 ? "facta-num" : undefined}>{c}</div>
          ))}
          <div role="columnheader"><span className="facta-sr">{m.actions}</span></div>
        </div>
        {list.items.map((row) => (
          <div key={row.codigoGeneracion} {...sp("row", "facta-tr facta-row")} role="row" data-estado={row.estado} data-menu-open={menu === row.codigoGeneracion ? "" : undefined}>
            <div role="cell" className="facta-date"><b>{shortDate(row.fecEmi)}</b><small>{shortTime(row.horEmi)}</small></div>
            <div role="cell">{docTypeLabel(row.tipoDte, messages)}</div>
            <div role="cell" className="facta-mono"><button type="button" className="facta-linkbtn" title={row.numeroControl} onClick={() => open(row)}>{midTruncate(row.numeroControl)}</button></div>
            <div role="cell"><ReceiverCell row={row} /></div>
            <div role="cell" className="facta-num facta-tot facta-amount">{formatMoney(row.totales?.totalPagar)}</div>
            <div role="cell"><EstadoBadge estado={row.estado} /></div>
            <div role="cell" className="facta-kebab-cell">{kebab(row)}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div {...sp("list", "facta-list")} data-phone={cards ? "" : undefined}>
      {!props.hideHeader && (
        <div className="facta-list-head">
          <h2 className="facta-list-title">{props.title ?? m.title}</h2>
          <button type="button" className={cx("facta-btn facta-btn--icon facta-btn--ghost")} aria-label={m.refresh} disabled={list.refreshing} onClick={() => void list.refresh()}>
            {list.refreshing ? <Spinner size={16} /> : <RefreshIcon size={18} />}
          </button>
        </div>
      )}
      {props.showFilters !== false && <Toolbar state={shown} setState={setState} phone={phoneQuery} />}
      {hasFilters && (
        <div className="facta-chips">
          <button type="button" className="facta-link" onClick={reset}>{m.clearFilters}</button>
        </div>
      )}
      {notice && <div className={`facta-notice facta-notice--${notice.tone}`} role={notice.tone === "bad" ? "alert" : "status"}>{notice.tone === "bad" && <AlertIcon size={16} />}{notice.text}</div>}
      {content}
      {list.error && list.loaded > 0 && (
        <ErrorCallout title={m.error.title} body={m.error.body} code={errorCode} onRetry={() => void list.loadMore()} retryLabel={m.error.retry} />
      )}
      {!list.loading && list.loaded > 0 && (
        <div className="facta-list-foot">
          <span role="status" aria-live="polite">{fill(m.showing, { shown: list.items.length })}{list.items.length !== list.loaded ? ` / ${list.loaded}` : ""}</span>
          <Attribution />
        </div>
      )}
      {list.hasMore && !list.loading && (
        <div className="facta-more">
          <button type="button" className={cx("facta-btn")} disabled={list.loadingMore} onClick={() => void list.loadMore()}>
            {list.loadingMore ? <><Spinner size={16} />{m.loadingMore}</> : m.loadMore}
          </button>
        </div>
      )}
      {showDetail && (
        <FactaDocumentDetail
          codigoGeneracion={detail}
          open={detail !== null}
          onOpenChange={(v) => { if (!v) setDetail(null); }}
          kinds={kinds.length > 0 ? kinds : undefined}
          {...(props.onInvalidate
            ? {
              onInvalidate: (doc: { codigoGeneracion: string }) => props.onInvalidate!(list.items.find((r) => r.codigoGeneracion === doc.codigoGeneracion) ?? ({ codigoGeneracion: doc.codigoGeneracion } as DocumentRow)),
              onInvalidated: () => void list.refresh(),
            }
            : {})}
        />
      )}
    </div>
  );
}

void CloseIcon;
