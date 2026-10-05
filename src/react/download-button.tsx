import { useEffect, useRef, useState } from "react";
import { fill, type DownloadedFile, type DownloadKind } from "../browser/index.ts";
import { CheckIcon, ChevronIcon, DownloadIcon, Spinner } from "./icons.tsx";
import { useCfg, type FactaLook } from "./look.tsx";
import { JsonIcon, MenuList, PdfIcon, splitLook, TicketIcon, type MenuEntry } from "./data-parts.tsx";
import { useFactaActions } from "./data-hooks.ts";
import { FactaRoot } from "./look.tsx";

export interface FactaDownloadButtonProps extends FactaLook {
  codigoGeneracion: string;
  /** Formats offered. Default `["pdf", "json", "ticket"]`; the first one is the main action. */
  kinds?: DownloadKind[] | undefined;
  /** `solid` (accent), `outline` (tables) or `icon` (one square button, main format only). */
  variant?: "solid" | "outline" | "icon" | undefined;
  size?: "md" | "sm" | undefined;
  /** Ticket roll width in mm (40–120). */
  paperWidthMm?: number | undefined;
  onDownloaded?: ((file: DownloadedFile) => void) | undefined;
  onError?: ((error: Error) => void) | undefined;
  className?: string | undefined;
}

const KIND_ICON = { pdf: PdfIcon, json: JsonIcon, ticket: TicketIcon } as const;

/** The split button, to be used inside an existing Facta root (the detail drawer, a menu). */
export function DownloadSplit(props: Omit<FactaDownloadButtonProps, keyof FactaLook | "className">) {
  const { cx, sp, messages } = useCfg();
  const actions = useFactaActions();
  const kinds = props.kinds && props.kinds.length > 0 ? props.kinds : (["pdf", "json", "ticket"] as DownloadKind[]);
  const variant = props.variant ?? "solid";
  const size = props.size ?? "md";
  const [kind, setKind] = useState<DownloadKind>(kinds[0]!);
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "failed">("idle");
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const names: Record<DownloadKind, string> = {
    pdf: messages.data.download.pdf,
    json: messages.data.download.json,
    ticket: messages.data.download.ticket,
  };
  const shortNames: Record<DownloadKind, string> = { pdf: "PDF", json: "JSON", ticket: "ticket" };
  const hints: Record<DownloadKind, string> = {
    pdf: messages.data.download.pdfHint,
    json: messages.data.download.jsonHint,
    ticket: messages.data.download.ticketHint,
  };

  async function run(chosen: DownloadKind) {
    setKind(chosen);
    setPhase("loading");
    try {
      const file = await actions.download(props.codigoGeneracion, chosen, chosen === "ticket" && props.paperWidthMm ? { paperWidthMm: props.paperWidthMm } : undefined);
      setPhase("done");
      props.onDownloaded?.(file);
      timer.current = setTimeout(() => setPhase("idle"), 2000);
    } catch (error) {
      setPhase("failed");
      props.onError?.(error instanceof Error ? error : new Error(String(error)));
      timer.current = setTimeout(() => setPhase("idle"), 3500);
    }
  }

  const Glyph = KIND_ICON[kind];
  const label = phase === "loading"
    ? fill(messages.data.download.preparing, { kind: shortNames[kind] })
    : phase === "done"
    ? fill(messages.data.download.done, { kind: shortNames[kind] })
    : phase === "failed"
    ? messages.data.download.failed
    : names[kind];
  const compactLabel = size === "sm" && phase === "idle" ? shortNames[kind] : label;
  const lead = phase === "loading" ? <Spinner size={16} /> : phase === "done" ? <CheckIcon size={16} /> : <Glyph size={size === "sm" ? 14 : 16} />;
  const tone = variant === "outline" ? "" : " facta-btn--primary";
  const entries: MenuEntry[] = kinds.map((k) => {
    const KIcon = KIND_ICON[k];
    return { id: k, label: k === "pdf" ? "PDF" : k === "json" ? "JSON" : names.ticket, icon: <KIcon size={16} />, hint: hints[k], onSelect: () => void run(k) };
  });
  const busy = phase === "loading";
  const split = kinds.length > 1 && variant !== "icon";

  if (variant === "icon") {
    return (
      <button
        type="button"
        {...sp("downloadButton", `facta-btn facta-btn--icon facta-dl-icon${size === "sm" ? " facta-btn--sm" : ""}`)}
        aria-label={names[kinds[0]!]}
        disabled={busy}
        data-state={phase}
        onClick={() => void run(kinds[0]!)}
      >
        {lead}
      </button>
    );
  }
  return (
    <span className={cx("facta-split", undefined, `facta-split--${variant}${size === "sm" ? " facta-split--sm" : ""}`)} data-state={phase}>
      <button
        type="button"
        {...sp("downloadButton", `facta-btn${tone}${size === "sm" ? " facta-btn--sm" : ""} facta-split-main`)}
        disabled={busy}
        data-state={phase}
        aria-label={compactLabel !== label ? label : undefined}
        onClick={() => void run(kind)}
      >
        <span className="facta-split-label" key={phase}>{lead}{compactLabel}</span>
      </button>
      {split && (
        <button
          ref={moreRef}
          type="button"
          className={cx(`facta-btn${tone}${size === "sm" ? " facta-btn--sm" : ""} facta-split-more`)}
          aria-label={messages.data.download.more}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={busy}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronIcon size={16} />
        </button>
      )}
      {open && (
        <MenuList
          entries={entries}
          label={messages.data.download.formats}
          align="start"
          onClose={(restore) => {
            setOpen(false);
            if (restore) moreRef.current?.focus();
          }}
        />
      )}
      <span className="facta-sr" role="status" aria-live="polite">{phase === "done" || phase === "failed" ? label : ""}</span>
    </span>
  );
}

/** One button, PDF by default, with a menu for JSON and the thermal ticket. */
export function FactaDownloadButton({ className, ...rest }: FactaDownloadButtonProps) {
  const [look, props] = splitLook(rest);
  return (
    <FactaRoot look={look} variant="download" className={`facta-data facta-data--inline ${className ?? ""}`.trim()}>
      <DownloadSplit {...props} />
    </FactaRoot>
  );
}
