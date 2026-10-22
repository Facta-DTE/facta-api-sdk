import { useState } from "react";
import { FactaIssueButton } from "../../../../../react.ts";
import type { WindowExampleProps } from "./types.ts";

// One button for a point of sale: it turns into a spinner and then a check, and a
// small popover carries the result. `auto` and `auto-close` start on mount.
export function IssueButtonExample({ session, run, autoCloseOn, onIssued }: WindowExampleProps) {
  const [mounted, setMounted] = useState(false);
  if (session === null) return <p className="pg-note">Prepare una venta arriba para ver el botón.</p>;
  if (!mounted) {
    return <button type="button" className="pg-primary" onClick={() => setMounted(true)}>Mostrar el botón</button>;
  }
  return (
    <FactaIssueButton
      key={`${session}-${run}`}
      session={session}
      run={run}
      autoCloseOn={autoCloseOn}
      label="Emitir factura"
      onIssued={onIssued}
    />
  );
}
