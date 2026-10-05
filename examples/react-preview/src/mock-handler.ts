// An in-browser fake of the handler's §5 wire, for design review and tests.
// It answers `session.describe`, `issue` and `status` like the real handler.

export type Outcome =
  | "sealed"
  | "sealed-copies-pending"
  | "contingency"
  | "rejected"
  | "uncertain-then-sealed"
  | "failed-retryable"
  | "expired";

export interface MockConfig {
  outcome: Outcome;
  environment: "00" | "01";
  latencyMs?: number;
}

const CG = "7C2F1E5A-9B3D-4A6E-8F10-2D5B7C9E1A34";

const draft = {
  tipoDte: "01",
  receptor: { nombre: "María Fernanda López", numDocumento: "037155821", correo: "maria@example.com" },
  items: [
    { descripcion: "Café de altura, bolsa 1 lb", cantidad: 2, precioUni: 8.5 },
    { descripcion: "Pupusas revueltas", cantidad: 4, precioUni: 1.25 },
    { descripcion: "Horchata grande", cantidad: 1, precioUni: 2.75 },
  ],
};

function sealedResult(config: MockConfig) {
  return {
    estado: "sellado",
    codigoGeneracion: CG,
    numeroControl: "DTE-01-M001P001-000000000000042",
    tipoDte: "01",
    ambiente: config.environment,
    fecEmi: "2026-10-05",
    horEmi: "14:32:10",
    selloRecibido: "20267C2F1E5A9B3D4A6E8F102D5B7C9E1A34ABCD",
    observaciones: [],
    totales: { totalPagar: 22.25, totalLetras: "VEINTIDOS 25/100 DOLARES" },
    archivoJson: JSON.stringify({ ejemplo: true }, null, 2),
    representacionGrafica: "JVBERi0xLjQKJSBtdWVzdHJhCg==",
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function createMockFetch(config: MockConfig): typeof fetch {
  let issueCalls = 0;
  const wait = () => new Promise((r) => setTimeout(r, config.latencyMs ?? 900));
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { action: string };
    switch (body.action) {
      case "session.describe": {
        await new Promise((r) => setTimeout(r, 450));
        if (config.outcome === "expired") {
          return json({ error: { code: "session_expired", message: "expired", retryable: false } }, 401);
        }
        return json({
          draft,
          download: true,
          environment: config.environment,
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          display: { total: 22.25, reference: "#1042", title: "Pedido #1042 · Café del Volcán" },
        });
      }
      case "issue": {
        issueCalls++;
        await wait();
        switch (config.outcome) {
          case "sealed":
            return json({ result: sealedResult(config), storage: { managed: "stored", archive: "complete" }, statusToken: "st" });
          case "sealed-copies-pending":
            return json({
              result: sealedResult(config),
              storage: { managed: "pending", archive: "partial", copies: { complete: 1, pending: 1, failed: 0 } },
              statusToken: "st",
            });
          case "contingency": {
            const { observaciones: _o, selloRecibido: _s, representacionGrafica: _p, totales: _t, ...rest } = sealedResult(config);
            return json({
              result: { ...rest, estado: "contingencia", detalle: "El servicio de Hacienda no respondió. Se transmitirá automáticamente." },
              storage: { managed: null, archive: "off" },
              statusToken: "st",
            });
          }
          case "rejected":
            return json({
              error: {
                code: "mh_rejected",
                message: "Hacienda rechazó el documento",
                retryable: false,
                spent: { codigoGeneracion: CG, numeroControl: "DTE-01-M001P001-000000000000043" },
                statusToken: "st",
                observaciones: ["[receptor.nrc] El valor del campo no cumple el formato requerido", "[cuerpoDocumento[2].precioUni] El valor debe ser mayor que 0"],
                fields: [
                  { path: "receptor.nrc", message: "no cumple el formato requerido" },
                  { path: "items[2].precioUni", message: "debe ser mayor que 0" },
                ],
              },
            }, 422);
          case "failed-retryable":
            if (issueCalls === 1) {
              return json({ error: { code: "rate_limited", message: "slow down", retryable: true } }, 429);
            }
            return json({ result: sealedResult(config), storage: { managed: "stored", archive: "complete" }, statusToken: "st" });
          case "uncertain-then-sealed":
            if (issueCalls === 1) throw new TypeError("Failed to fetch");
            return json({ result: sealedResult(config), storage: { managed: "stored", archive: "complete" }, statusToken: "st" });
          default:
            return json({ error: { code: "internal_error", message: "x", retryable: false } }, 500);
        }
      }
      case "status":
        return json({ status: { estado: "sellado", codigoGeneracion: CG, numeroControl: "DTE-01-M001P001-000000000000042", tipoDte: "01", ambiente: config.environment, fecEmi: "2026-10-05" } });
      default:
        return json({ error: { code: "bad_request", message: "unknown action", retryable: false } }, 400);
    }
  }) as typeof fetch;
}
