// An in-browser fake of the handler's §5 wire, for design review and tests.
// It answers `session.describe`, `issue`, `status` and `delivery.status` like the real handler.

export type Outcome =
  | "sealed"
  | "sealed-copies-pending"
  | "sealed-delivered"
  | "sealed-delivering"
  | "contingency"
  | "rejected"
  | "uncertain-then-sealed"
  | "failed-retryable"
  | "expired";

export type ServiceMode = "online" | "contingency" | "degraded" | "offline";
export type StorageMode = "normal" | "near" | "full" | "none";
export type ListMode = "ok" | "empty" | "error";

export interface MockConfig {
  outcome: Outcome;
  environment: "00" | "01";
  latencyMs?: number;
  /** Data components (docs/react-signing-ui.md §11). */
  service?: ServiceMode;
  storage?: StorageMode;
  list?: ListMode;
  /** The handler's `exposeRecipient`. */
  exposeRecipient?: boolean;
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

const MASK_EMAIL = "m•••@ejemplo.com";
const MASK_PHONE = "+503 •••• 0000";

/** What the browser gets first; `sealed-delivering` then turns `enviado` on the third poll. */
function initialDelivery(outcome: Outcome) {
  if (outcome === "sealed-delivered") {
    return {
      correo: { estado: "enviado", destino: MASK_EMAIL },
      whatsapp: { estado: "sin_credito", destino: MASK_PHONE, motivo: "wallet_empty" },
    };
  }
  return { correo: { estado: "pendiente", destino: MASK_EMAIL }, whatsapp: { estado: "pendiente", destino: MASK_PHONE } };
}

// --- Fictional dataset for the data components --------------------------------

interface MockDoc {
  estado: "sellado" | "contingencia" | "invalidado";
  codigoGeneracion: string;
  numeroControl: string;
  tipoDte: string;
  fecEmi: string;
  horEmi: string;
  selloRecibido: string | null;
  total: number;
  receptor: { nombre: string; numDocumento: string } | null;
}

const BUYERS: Array<[string, string] | null> = [
  ["María José Hernández", "0000 ••••• 1"],
  ["Ferretería San Miguel", "0614 ••••• 4"],
  null,
  ["Café Las Brumas, S.A. de C.V.", "0614 ••••• 9"],
  ["José Luis Ferrer Menjívar", "0482 ••••• 5"],
  ["Brumas Coffee Imports LLC", "Pasaporte"],
  ["Rosa Elena Campos", "0129 ••••• 2"],
];
const TYPES = ["01", "01", "03", "01", "05", "01", "03", "11", "01", "14"];

function hex(n: number, len: number) {
  return (n * 2654435761 >>> 0).toString(16).toUpperCase().padStart(8, "0").repeat(4).slice(0, len);
}

function buildDocs(): MockDoc[] {
  const docs: MockDoc[] = [];
  for (let i = 0; i < 38; i++) {
    const day = 5 - Math.floor(i / 4);
    const tipoDte = TYPES[i % TYPES.length]!;
    const buyer = BUYERS[i % BUYERS.length] ?? null;
    const estado: MockDoc["estado"] = i === 1 ? "contingencia" : i === 5 || i === 17 ? "invalidado" : "sellado";
    const n = 42 - i;
    const g = hex(i + 11, 32);
    docs.push({
      estado,
      codigoGeneracion: i === 0
        ? "7C1E4B6A-92D3-4F08-A1B7-5E30C9D2F614"
        : `${g.slice(0, 8)}-${g.slice(8, 12)}-4${g.slice(13, 16)}-A${g.slice(17, 20)}-${g.slice(20, 32)}`,
      numeroControl: `DTE-${tipoDte}-M001P001-${String(n).padStart(15, "0")}`,
      tipoDte,
      fecEmi: new Date(Date.UTC(2026, 9, day)).toISOString().slice(0, 10),
      horEmi: `${String(17 - (i % 9)).padStart(2, "0")}:${String((i * 13) % 60).padStart(2, "0")}:00`,
      selloRecibido: estado === "contingencia" ? null : `2026${hex(i + 3, 36)}`,
      total: [113, 1234.56, 24.8, 226, 3850, 56.5, 180][i % 7]!,
      receptor: buyer ? { nombre: buyer[0], numDocumento: buyer[1] } : null,
    });
  }
  return docs;
}

const CATALOG_CUSTOMERS = [
  { id: "c1", name: "Ferretería San Miguel", docType: "NIT", docNumber: "0614-210389-102-4", nrc: "123456-7" },
  { id: "c2", name: "Ferretería El Tornillo, S.A. de C.V.", docType: "NIT", docNumber: "0614-150795-101-2", nrc: "287401-3" },
  { id: "c3", name: "Ferrer Menjívar, José Luis", docType: "DUI", docNumber: "00000001-9", nrc: null },
  { id: "c4", name: "Café Las Brumas, S.A. de C.V.", docType: "NIT", docNumber: "0614-111111-101-0", nrc: "100001-1" },
  { id: "c5", name: "María José Hernández", docType: "DUI", docNumber: "00000002-7", nrc: null },
];
const CATALOG_PRODUCTS = [
  { id: "p1", code: "DIS-114", description: 'Disco de corte ferretero 4½"', price: 2.85, vatIncluded: true },
  { id: "p2", code: "CAN-040", description: "Candado ferretero 40 mm", price: 6.5, vatIncluded: true },
  { id: "p3", code: "CIN-005", description: "Cinta métrica ferretera 5 m", price: 4.1, vatIncluded: false },
  { id: "p4", code: "CAF-001", description: "Café de altura, bolsa 1 lb", price: 8.5, vatIncluded: true },
];

const GB = 1_000_000_000;
const STORAGE: Record<StorageMode, Record<string, unknown>> = {
  normal: { configured: true, ready: true, state: "ready", quotaBytes: 5 * GB, usedBytes: 1.2 * GB, reservedBytes: 0, coveredUntil: null, byosReady: false },
  near: { configured: true, ready: true, state: "ready", quotaBytes: 5 * GB, usedBytes: 4.4 * GB, reservedBytes: 0, coveredUntil: null, byosReady: false },
  full: { configured: true, ready: true, state: "ready", quotaBytes: 5 * GB, usedBytes: 5 * GB, reservedBytes: 0, coveredUntil: null, byosReady: false },
  none: { configured: false, ready: false, state: "not_configured", quotaBytes: null, usedBytes: null, reservedBytes: null, coveredUntil: null, byosReady: true },
};

const match = (text: string | null, q: string) => (text ?? "").toLowerCase().includes(q.toLowerCase());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function createMockFetch(config: MockConfig): typeof fetch {
  let issueCalls = 0;
  let deliveryReads = 0;
  const docs = buildDocs();
  const reads = new Map<string, number>();
  let copiesFixed = false;
  const asRow = (d: MockDoc) => ({
    estado: d.estado,
    codigoGeneracion: d.codigoGeneracion,
    numeroControl: d.numeroControl,
    tipoDte: d.tipoDte,
    fecEmi: d.fecEmi,
    horEmi: d.horEmi,
    selloRecibido: d.selloRecibido,
    totales: { totalGravada: Math.round(d.total / 1.13 * 100) / 100, totalIva: Math.round((d.total - d.total / 1.13) * 100) / 100, totalPagar: d.total },
    ...(config.exposeRecipient ? { receptor: d.receptor } : {}),
  });
  const dataLatency = () => new Promise((r) => setTimeout(r, Math.min(config.latencyMs ?? 900, 500)));
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
          case "sealed-delivered":
          case "sealed-delivering":
            deliveryReads = 0;
            return json({
              result: sealedResult(config),
              storage: { managed: "stored", archive: "complete" },
              statusToken: "st",
              deliveryHandle: "mock-handle.mac",
              delivery: { canales: initialDelivery(config.outcome) },
            });
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
      case "delivery.status": {
        await new Promise((r) => setTimeout(r, 300));
        deliveryReads++;
        if (config.outcome === "sealed-delivering") {
          const sent = deliveryReads >= 3;
          return json({
            delivery: {
              canales: {
                correo: { estado: sent ? "enviado" : "en_proceso", destino: MASK_EMAIL },
                whatsapp: { estado: deliveryReads >= 4 ? "enviado" : "en_proceso", destino: MASK_PHONE },
              },
            },
          });
        }
        return json({ delivery: { canales: initialDelivery(config.outcome) } });
      }
      case "documents.list": {
        await dataLatency();
        const b = body as unknown as { desde?: string; hasta?: string; estado?: string; tipoDte?: string; limit?: number; cursor?: string };
        if (config.list === "error") return json({ error: { code: "service_unavailable", message: "x", retryable: true } }, 503);
        if (config.list === "empty") return json({ documentos: [], siguiente: null });
        const list = docs.filter((d) => (!b.desde || d.fecEmi >= b.desde) && (!b.hasta || d.fecEmi <= b.hasta) && (!b.estado || d.estado === b.estado) && (!b.tipoDte || d.tipoDte === b.tipoDte));
        const start = b.cursor ? Number(b.cursor) : 0;
        const limit = b.limit ?? 25;
        const slice = list.slice(start, start + limit);
        return json({ documentos: slice.map(asRow), siguiente: start + limit < list.length ? String(start + limit) : null });
      }
      case "documents.get": {
        await dataLatency();
        const d = docs.find((x) => x.codigoGeneracion === (body as unknown as { codigoGeneracion: string }).codigoGeneracion);
        if (!d) return json({ error: { code: "not_found", message: "x", retryable: false } }, 404);
        const n = (reads.get(d.codigoGeneracion) ?? 0) + 1;
        reads.set(d.codigoGeneracion, n);
        // The contingency document is sealed by Hacienda on its third read, so the polling can be watched.
        const doc = d.estado === "contingencia" && n >= 3 ? { ...d, estado: "sellado" as const, selloRecibido: `2026${hex(99, 36)}` } : d;
        return json({ document: { ...asRow(doc), ambiente: config.environment, observaciones: [] } });
      }
      case "documents.copies": {
        await dataLatency();
        const state = copiesFixed ? "stored" : "pending";
        const code = (body as unknown as { codigoGeneracion: string }).codigoGeneracion;
        const failing = code === docs[2]!.codigoGeneracion && !copiesFixed;
        return json({ copies: [
          { kind: "json", state: "stored", bytes: 8400, storedAt: "2026-10-05T10:00:00Z", environment: config.environment },
          { kind: "pdf", state: failing ? state : "stored", bytes: 52000, storedAt: null, environment: config.environment },
        ] });
      }
      case "documents.retryStorage":
        await dataLatency();
        copiesFixed = true;
        return json({ storage: { json: "stored", pdf: "stored" } });
      case "documents.download": {
        await dataLatency();
        const b = body as unknown as { codigoGeneracion: string; kind: string };
        return json({ file: { codigoGeneracion: b.codigoGeneracion, kind: b.kind, filename: `${b.codigoGeneracion}.${b.kind === "json" ? "json" : "pdf"}`, contentType: b.kind === "json" ? "application/json" : "application/pdf", bytes: 20, base64: "JVBERi0xLjQKJSBtdWVzdHJhCg==" } });
      }
      case "catalog.customers.search": {
        await new Promise((r) => setTimeout(r, 350));
        const q = (body as unknown as { query: string }).query;
        return json({ items: CATALOG_CUSTOMERS.filter((c) => match(c.name, q) || match(c.docNumber, q)).map((c) => (config.exposeRecipient ? c : { ...c, docNumber: c.docNumber.replace(/^(\d{4}).*(\d)$/, "$1 ••••• $2"), nrc: c.nrc ? c.nrc.replace(/^(\d{4}).*(\d)$/, "$1 ••••• $2") : null })) });
      }
      case "catalog.products.search": {
        await new Promise((r) => setTimeout(r, 350));
        const q = (body as unknown as { query: string }).query;
        return json({ items: CATALOG_PRODUCTS.filter((p) => match(p.description, q) || match(p.code, q)) });
      }
      case "service.status":
        await dataLatency();
        return json({ state: config.service ?? "online", checkedAt: new Date().toISOString() });
      case "storage.status":
        await dataLatency();
        return json({ storage: STORAGE[config.storage ?? "normal"] });
      case "invalidate.describe": {
        await dataLatency();
        const session = (body as unknown as { session: string }).session;
        if (session === "inv-expired") return json({ error: { code: "session_expired", message: "x", retryable: false } }, 401);
        const target = docs[0]!;
        return json({
          invalidation: {
            codigoGeneracion: target.codigoGeneracion,
            tipoAnulacion: 1,
            motivo: "Precio incorrecto en la línea 2",
            codigoGeneracionReemplazo: "9A3F2C71-5B80-4D16-A2E9-0C47D81B35F6",
            responsable: { nombre: "Laura Beatriz Ortiz", tipoDocumento: "13", numDocumento: "00000003-5" },
            solicita: { nombre: "María José Hernández", tipoDocumento: "13", numDocumento: "00000001-9" },
          },
          document: { ...asRow(target), ambiente: config.environment, observaciones: [] },
          environment: config.environment,
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        });
      }
      case "invalidate": {
        await new Promise((r) => setTimeout(r, 1500));
        const session = (body as unknown as { session: string }).session;
        if (session === "inv-reject") {
          const msg = "[095] El documento no se encuentra dentro del plazo de anulación";
          return json({ error: { code: "mh_rejected", message: msg, retryable: false, observaciones: [msg] } }, 422);
        }
        const target = docs[0]!;
        target.estado = "invalidado";
        return json({ result: { estado: "invalidado", codigoGeneracion: target.codigoGeneracion, numeroControl: target.numeroControl, yaEstabaInvalidado: false, evento: { codigoGeneracion: "5E7D1A90-3C4B-4F26-9D81-6A0B2C3D4E5F", selloRecibido: "2026D81C07A4E5B93F62A1D08C74B5E3F9A026C1", fhProcesamiento: null, tipoAnulacion: 1 } } });
      }
      case "status":
        return json({ status: { estado: "sellado", codigoGeneracion: CG, numeroControl: "DTE-01-M001P001-000000000000042", tipoDte: "01", ambiente: config.environment, fecEmi: "2026-10-05" } });
      default:
        return json({ error: { code: "bad_request", message: "unknown action", retryable: false } }, 400);
    }
  }) as typeof fetch;
}
