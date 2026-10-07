import { useState } from "react";
import { FactaInvoiceInline } from "../../../../../react.ts";
import type { WindowExampleProps } from "./types.ts";

// The window embedded in your own page, no overlay. With `run="auto"` it starts as
// soon as it mounts, so this example mounts it only when you ask.
export function InlineExample({ session, run, autoCloseDelay, autoCloseOn, onIssued }: WindowExampleProps) {
  const [mounted, setMounted] = useState(false);
  if (session === null) return <p className="pg-note">Prepare una venta arriba para ver la ventana.</p>;
  if (!mounted) {
    return <button type="button" className="pg-primary" onClick={() => setMounted(true)}>Mostrar la ventana en línea</button>;
  }
  return (
    <div style={{ width: "100%", maxWidth: 520 }}>
      <FactaInvoiceInline
        key={`${session}-${run}`}
        session={session}
        run={run}
        autoCloseDelay={autoCloseDelay}
        autoCloseOn={autoCloseOn}
        onIssued={onIssued}
      />
    </div>
  );
}
