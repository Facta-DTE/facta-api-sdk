// Development-only backend for looking at the screens without keys (`?mock=1` on the Vite dev
// server). It reuses the SDK preview's in-browser handler. `main.tsx` imports this file only
// behind `import.meta.env.DEV`, so it is never part of a production build.

import { createMockFetch, type Outcome } from "../../examples/react-preview/src/mock-handler.ts";
import { ApiError, installMock, type CreatedSession, type IssuedDocument, type PlaygroundState } from "./api.ts";

const OUTCOMES: Outcome[] = ["sealed", "sealed-copies-pending", "sealed-delivered", "sealed-delivering", "contingency", "rejected", "uncertain-then-sealed", "failed-retryable", "expired"];

export function installDevMock(search: string): void {
  const params = new URLSearchParams(search);
  const asked = params.get("outcome") as Outcome | null;
  const outcome: Outcome = asked !== null && OUTCOMES.includes(asked) ? asked : "sealed";
  const issued: IssuedDocument[] = [{ codigoGeneracion: "7C1E4B6A-92D3-4F08-A1B7-5E30C9D2F614", tipoDte: "01", numeroControl: "DTE-01-M001P001-000000000000042", issuedAt: new Date().toISOString(), estado: "sellado" }];
  const state: PlaygroundState = {
    environment: "00",
    apiHost: "eobxzotnqzgtpuqvmpkc.supabase.co",
    visitor: { label: "V-3FA9C2", email: null, via: "cookie" },
    auth: "turnstile",
    turnstileSiteKey: null,
    mail: { allowed: true, remainingHour: 3, remainingDay: 17 },
    whatsapp: false,
    quota: { allowed: true, remainingHour: 20, remainingDay: 100 },
    supportedTypes: ["01", "03", "05", "06", "11", "14"],
    catalog: params.get("catalog") !== "0",
    catalogReceiverTypes: ["01", "03", "05", "06"],
    demo: {
      customers: [
        { id: "c-biz", label: "Ferretería San Miguel (contribuyente)", fits: ["01", "03", "05", "06"], contributor: true },
        { id: "c-abroad", label: "Brumas Coffee Imports LLC (extranjero)", fits: ["01", "11"], contributor: false },
        { id: "c-excl", label: "Rosa Elena Campos (sujeto excluido)", fits: ["01", "14"], contributor: false },
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
    session: (sale): CreatedSession => ({ session: `tok-${++n}`, total: sale.lines.reduce((sum, l) => sum + l.cantidad * (l.precioUni ?? 8.5), 0), title: "Venta de prueba", emailTo: sale.sendEmail && sale.emailTo ? `${sale.emailTo.slice(0, 1)}•••@${sale.emailTo.split("@")[1] ?? ""}` : null }),
    issued: () => issued,
    invalidation: () => "inv-ok",
    // `&resend=limit` shows the limit state; `&resend=closed` the closed five-minute window.
    resend: () => {
      if (params.get("resend") === "limit") throw new ApiError("mail_quota_exceeded", "Se alcanzó el límite de envíos: este documento ya se envió hace poco (uno cada 10 minutos). Podrá reenviarlo en 9 min.", 429);
      if (params.get("resend") === "closed") throw new ApiError("delivery_window_closed", "El plazo para reenviar este documento venció. Emita uno nuevo.", 410);
      return { estado: "enviado", destino: "c•••@example.com" };
    },
  });
  mockRegistry();
}

// /api/registro is read with a plain fetch (not the SDK's), so the dev mock answers it here.
function mockRegistry(): void {
  const real = window.fetch.bind(window);
  const hours = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const row = (n: number, tipoDte: string, estado: string, h: number, total: number, observaciones: string[] = []) => ({
    codigoGeneracion: `7C1E4B6A-92D3-4F08-A1B7-5E30C9D2F${String(600 + n).padStart(3, "0")}`,
    tipoDte, estado, issuedAt: hours(h),
    numeroControl: `DTE-${tipoDte}-M001P001-${String(n).padStart(15, "0")}`,
    current: { estado, fecEmi: "2026-10-06", horEmi: "10:42:00", selloRecibido: estado === "rechazado" ? null : "2026A1F3C9E0B7D4", observaciones, totales: { montoTotalOperacion: total } },
  });
  const documents = [
    row(214, "01", "sellado", 0.3, 12.5),
    row(88, "03", "rechazado", 0.5, 113, ["Campo #/receptor/nrc no cumple el formato requerido"]),
    row(213, "01", "invalidado", 1, 8.5),
    row(12, "05", "contingencia", 17, 4),
  ];
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url, window.location.href).pathname === "/api/registro") {
      return Promise.resolve(new Response(JSON.stringify({ documents, enriched: documents.length }), { headers: { "content-type": "application/json" } }));
    }
    return real(input, init);
  };
}
