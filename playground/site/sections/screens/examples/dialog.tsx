import { useState } from "react";
import { FactaInvoiceDialog } from "../../../../../react.ts";
import type { WindowExampleProps } from "./types.ts";

// A modal window: a centred dialog on desktop and a bottom sheet on a phone.
export function DialogExample({ session, run, autoCloseDelay, autoCloseOn, onIssued }: WindowExampleProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="pg-primary" disabled={session === null} onClick={() => setOpen(true)}>
        Abrir el diálogo
      </button>
      {session !== null && (
        <FactaInvoiceDialog
          session={session}
          run={run}
          autoCloseDelay={autoCloseDelay}
          autoCloseOn={autoCloseOn}
          open={open}
          onOpenChange={setOpen}
          onIssued={onIssued}
        />
      )}
    </>
  );
}
