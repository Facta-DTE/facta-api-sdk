import { useState } from "react";
import { FactaInvoiceDrawer } from "../../../../../react.ts";
import type { WindowExampleProps } from "./types.ts";

// The same window as a side panel, for screens that keep the sale visible behind it.
export function DrawerExample({ session, run, autoCloseDelay, autoCloseOn, onIssued }: WindowExampleProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="pg-primary" disabled={session === null} onClick={() => setOpen(true)}>
        Abrir el panel lateral
      </button>
      {session !== null && (
        <FactaInvoiceDrawer
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
