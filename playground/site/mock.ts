// Development-only backend for looking at the screens without keys (`?mock=1` on the Vite dev
// server). It reuses the SDK preview's in-browser handler. `main.tsx` imports this file only
// behind `import.meta.env.DEV`, so it is never part of a production build.

import { createMockFetch, type Outcome } from "../../examples/react-preview/src/mock-handler.ts";
import { installMock, type CreatedSession, type IssuedDocument, type PlaygroundState } from "./api.ts";

const OUTCOMES: Outcome[] = ["sealed", "sealed-copies-pending", "sealed-delivered", "sealed-delivering", "contingency", "rejected", "uncertain-then-sealed", "failed-retryable", "expired"];

export function installDevMock(search: string): void {
  const params = new URLSearchParams(search);
  const asked = params.get("outcome") as Outcome | null;
  const outcome: Outcome = asked !== null && OUTCOMES.includes(asked) ? asked : "sealed";
  const issued: IssuedDocument[] = [{ codigoGeneracion: "7C1E4B6A-92D3-4F08-A1B7-5E30C9D2F614", tipoDte: "01", numeroControl: "DTE-01-M001P001-000000000000042", at: Date.now() }];
  const state: PlaygroundState = {
    environment: "00",
    apiHost: "eobxzotnqzgtpuqvmpkc.supabase.co",
    visitor: { email: "visitante@example.com", via: "dev-bypass" },
    quota: { allowed: true, remainingHour: 20, remainingDay: 100 },
    supportedTypes: ["01", "03", "05", "06", "11", "14"],
    catalog: true,
    demo: {
      customers: [
        { id: "c-biz", label: "Ferretería San Miguel (contribuyente)", fits: ["01", "03", "05", "06"] },
        { id: "c-abroad", label: "Brumas Coffee Imports LLC (extranjero)", fits: ["01", "11"] },
        { id: "c-excl", label: "Rosa Elena Campos (sujeto excluido)", fits: ["01", "14"] },
      ],
      products: [
        { id: "p-cafe", label: "Café de altura", descripcion: "Café de altura, bolsa de 1 lb", precioUni: 8.5 },
        { id: "p-pupusa", label: "Pupusa revuelta", descripcion: "Pupusa revuelta", precioUni: 1.25 },
      ],
      builtInReceivers: [],
      canInvalidate: true,
    },
  };
  let n = 0;
  installMock({
    fetch: createMockFetch({ outcome, environment: "00" }),
    state: () => state,
    session: (sale): CreatedSession => ({ session: `tok-${++n}`, total: sale.lines.reduce((sum, l) => sum + l.cantidad * (l.precioUni ?? 8.5), 0), title: "Venta de prueba", emailTo: sale.sendEmail ? state.visitor!.email : null }),
    issued: () => issued,
    invalidation: () => "inv-ok",
  });
}
