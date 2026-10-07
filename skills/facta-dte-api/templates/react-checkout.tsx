// React checkout with the SDK's own components: the page asks YOUR server for a session token, then the
// dialog reviews and issues it. No Facta credential is ever in this file or in the browser.
//
// Based on playground/site/sections/screens/examples/dialog.tsx and window-hook.tsx. UI copy is Spanish
// (es-SV, usted), as the components' own messages are. Pair it with express-server.ts or nextjs-route.ts.
import { useState } from "react";
import { FactaInvoiceDialog, FactaProvider, FactaReceipt, useFactaWindow } from "@facta-dte/api/react";
import "@facta-dte/api/react/styles.css";
import type { IssueResult } from "@facta-dte/api/react";

async function requestSession(orderId: string): Promise<string> {
  const response = await fetch("/api/checkout/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
  const body = (await response.json()) as { session?: string; error?: string };
  if (!response.ok || body.session === undefined) throw new Error(body.error ?? "No se pudo preparar la factura.");
  return body.session;
}

/** Variant 1: a dialog you open and close. The window shows the result and the downloads. */
function InvoiceDialogButton({ orderId }: { orderId: string }) {
  const [session, setSession] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssueResult | null>(null);

  async function start() {
    setProblem(null);
    try {
      setSession(await requestSession(orderId)); // the same order always yields the same idempotency key
      setOpen(true);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "No se pudo preparar la factura.");
    }
  }

  return (
    <>
      <button type="button" onClick={start}>Facturar este pedido</button>
      {problem !== null && <p role="alert">{problem}</p>}
      {session !== null && (
        <FactaInvoiceDialog
          session={session}
          open={open}
          onOpenChange={setOpen}
          onIssued={(result) => setIssued(result)} // sealed or contingency: both are issued documents
        />
      )}
      {issued !== null && <p role="status">Documento emitido: {issued.numeroControl}</p>}
    </>
  );
}

/** Variant 2: no component in your JSX; `open()` resolves with the result, or rejects if the person closes it. */
function InvoiceWithHook({ orderId }: { orderId: string }) {
  const { open } = useFactaWindow();
  const [log, setLog] = useState("");
  async function issue() {
    try {
      const result = await open(await requestSession(orderId), { variant: "drawer" });
      setLog(`Emitida: ${result.numeroControl}`);
    } catch (error) {
      setLog(`Sin documento: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return (
    <>
      <button type="button" onClick={issue}>Facturar (panel lateral)</button>
      {log !== "" && <p role="status">{log}</p>}
    </>
  );
}

export function Checkout({ orderId }: { orderId: string }) {
  return (
    <FactaProvider endpoint="/api/facta">
      <InvoiceDialogButton orderId={orderId} />
      <InvoiceWithHook orderId={orderId} />
    </FactaProvider>
  );
}

export { FactaReceipt }; // re-exported so a thank-you page can render <FactaReceipt …/> with the same provider
