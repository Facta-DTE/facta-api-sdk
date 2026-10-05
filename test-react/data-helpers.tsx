import { vi } from "vitest";
import {
  FactaClientError,
  type CopyRow,
  type CustomerOption,
  type DocumentDetail,
  type DocumentPage,
  type DocumentRow,
  type FactaDataClient,
  type InvalidationInfo,
  type ProductOption,
  type StorageView,
} from "../src/browser/index.ts";
import type { FactaClient } from "../src/browser/index.ts";
import { makeClient } from "./helpers.tsx";

export const CG1 = "7C1E4B6A-92D3-4F08-A1B7-5E30C9D2F614";
export const CG2 = "9A3F2C71-5B80-4D16-A2E9-0C47D81B35F6";
export const CG3 = "3B2A1C0D-4E5F-4A6B-8C7D-9E0F1A2B3C4D";

export function row(patch: Partial<DocumentRow> = {}): DocumentRow {
  return {
    estado: "sellado",
    codigoGeneracion: CG1,
    numeroControl: "DTE-01-M001P001-000000000000042",
    tipoDte: "01",
    fecEmi: "2026-10-05",
    horEmi: "09:52:00",
    selloRecibido: "2026A7F3B9C14D2E8A06F5B3C1D7E9A04B2C6F81",
    totales: { totalGravada: 100, totalIva: 13, totalPagar: 113 },
    ...patch,
  };
}

export function detail(patch: Partial<DocumentDetail> = {}): DocumentDetail {
  return { ...row(), ambiente: "00", observaciones: [], ...patch } as DocumentDetail;
}

export const page = (rows: DocumentRow[], siguiente: string | null = null): DocumentPage => ({ documentos: rows, siguiente });

export const customer = (patch: Partial<CustomerOption> = {}): CustomerOption => ({
  id: "c1",
  name: "Ferretería San Miguel",
  docType: "NIT",
  docNumber: "0614 ••••• 4",
  nrc: null,
  ...patch,
});

export const product = (patch: Partial<ProductOption> = {}): ProductOption => ({
  id: "p1",
  code: "DIS-114",
  description: "Disco de corte ferretero",
  price: 2.85,
  vatIncluded: true,
  ...patch,
});

export const storageView = (patch: Partial<StorageView> = {}): StorageView => ({
  configured: true,
  ready: true,
  state: "ready",
  quotaBytes: 5_000_000_000,
  usedBytes: 1_200_000_000,
  reservedBytes: 0,
  coveredUntil: null,
  byosReady: false,
  ...patch,
});

export const invInfo = (patch: Partial<InvalidationInfo> = {}): InvalidationInfo => ({
  invalidation: {
    codigoGeneracion: CG1,
    tipoAnulacion: 1,
    motivo: "Precio incorrecto en la línea 2",
    codigoGeneracionReemplazo: CG2,
    responsable: { nombre: "Laura Beatriz Ortiz", tipoDocumento: "13", numDocumento: "000000019" },
    solicita: { nombre: "María José Hernández", tipoDocumento: "13", numDocumento: "000000027" },
  },
  document: detail(),
  environment: "00",
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  ...patch,
});

export const copies = (state: CopyRow["state"] = "stored"): CopyRow[] => [
  { kind: "json", state, bytes: 2048, storedAt: null, environment: "00" },
  { kind: "pdf", state, bytes: 8192, storedAt: null, environment: "00" },
];

export const notAllowed = () =>
  new FactaClientError({ code: "action_not_allowed", message: "no", status: 403, retryable: false, transport: false });

/** A full client whose data methods are spies with sensible defaults. */
export function makeDataClient(overrides: Partial<FactaDataClient> = {}) {
  const base = makeClient({}).client;
  const data: { [K in keyof FactaDataClient]: ReturnType<typeof vi.fn> } = {
    listDocuments: vi.fn(async () => page([row()])),
    getDocument: vi.fn(async () => detail()),
    downloadDocument: vi.fn(async (code: string, kind: string) => ({
      codigoGeneracion: code,
      kind,
      filename: `${code}.${kind === "json" ? "json" : "pdf"}`,
      contentType: kind === "json" ? "application/json" : "application/pdf",
      bytes: 4,
      base64: "JVBERg==",
    })),
    getDocumentCopies: vi.fn(async () => copies()),
    retryDocumentStorage: vi.fn(async () => ({ json: "stored", pdf: "stored" })),
    listHolding: vi.fn(async () => []),
    searchCustomers: vi.fn(async () => [customer()]),
    getCustomer: vi.fn(async () => customer()),
    searchProducts: vi.fn(async () => [product()]),
    getProduct: vi.fn(async () => product()),
    getServiceStatus: vi.fn(async () => ({ state: "online" as const, checkedAt: "2026-10-05T10:00:00Z" })),
    getStorageStatus: vi.fn(async () => storageView()),
    describeInvalidation: vi.fn(async () => invInfo()),
    invalidate: vi.fn(async () => ({
      estado: "invalidado" as const,
      codigoGeneracion: CG1,
      numeroControl: "DTE-01-M001P001-000000000000042",
      yaEstabaInvalidado: false,
      evento: { codigoGeneracion: CG2, selloRecibido: "2026D81C07A4E5B93F62A1D08C74B5E3F9A026C1", fhProcesamiento: null, tipoAnulacion: 1 },
    })),
  };
  Object.assign(data, overrides);
  const client = { ...base, ...data } as unknown as FactaClient & FactaDataClient;
  return { client, data };
}

export function stubMatchMedia(matches: (query: string) => boolean) {
  window.matchMedia = ((query: string) => ({
    matches: matches(query),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

export function phone() {
  stubMatchMedia((q) => q.includes("max-width: 640px"));
}
