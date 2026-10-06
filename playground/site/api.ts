// The page's calls to the playground Worker. Everything is same-origin.

import { turnstileHeaders } from "./turnstile.ts";

export interface PlaygroundState {
  environment: "00";
  apiHost: string;
  /** `label` is what the page shows («V-3FA9C2», or the e-mail in Access mode). */
  visitor: { label: string; email: string | null; via: "cookie" | "access" | "dev-bypass" } | null;
  /** How visitors are told apart on this deployment. */
  auth?: "turnstile" | "access";
  /** Public Turnstile site key; null when the deployment does not use Turnstile. */
  turnstileSiteKey?: string | null;
  quota: { allowed: boolean; remainingHour: number; remainingDay: number } | null;
  /** E-mail sends left (5 per hour, 20 per day). */
  mail?: { allowed: boolean; remainingHour: number; remainingDay: number } | null;
  /** Always false: the playground never delivers by WhatsApp. */
  whatsapp?: boolean;
  supportedTypes: string[];
  catalog: boolean;
  /** DTE types whose receiver can be a catalog customer (the API's `customerId`). */
  catalogReceiverTypes?: string[];
  demo: {
    /** `fits` lists the DTE types the customer's receiver can serve. */
    customers: { id: string; label: string; fits: string[]; contributor: boolean }[];
    products: { id: string; label: string; descripcion: string; precioUni: number }[];
    /** DTE types that have a built-in demo receiver, so no customer needs to be picked. */
    builtInReceivers: string[];
    /** False when the fixtures name nobody to sign an invalidation with. */
    canInvalidate: boolean;
  };
}

/** A document the visitor issued in the playground (the server's ledger). */
export interface IssuedDocument {
  codigoGeneracion: string;
  tipoDte: string;
  numeroControl: string;
  issuedAt: string;
  estado: string;
}

/**
 * Development-only stand-in for the Worker (`?mock=1` on the Vite dev server, see `mock.ts`).
 * It is never installed in a production build.
 */
export interface MockBackend {
  fetch: typeof fetch;
  state(): PlaygroundState;
  session(sale: SaleDescription): CreatedSession;
  issued(): IssuedDocument[];
  invalidation(code: string): string;
  /** Delivery demo: answers or throws an `ApiError` (limit states). */
  resend?(code: string): ResendOutcome;
}
let mock: MockBackend | null = null;
export const installMock = (backend: MockBackend) => { mock = backend; };
/** The fetch the SDK provider should use instead of the network, in mock mode only. */
export const mockFetch = (): typeof fetch | undefined => mock?.fetch;

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly field?: string) {
    super(message);
  }
}

async function readError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string; field?: string } } | null;
  return new ApiError(
    body?.error?.code ?? "request_failed",
    body?.error?.message ?? "No se pudo completar la solicitud.",
    response.status,
    body?.error?.field,
  );
}

export async function loadState(): Promise<PlaygroundState> {
  if (mock) return mock.state();
  const response = await fetch("/api/state", { headers: { accept: "application/json" } });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as PlaygroundState;
}

/** Where the receiver or a line comes from: the key's real catalog, the demo data or typed by the visitor. */
export type SaleSource = "catalog" | "demo" | "custom";

export interface SaleDescription {
  tipoDte: string;
  /** Absent: Factura without receiver. `catalog` and `demo` carry an id; `custom` the typed fields. */
  receptor?: { source: SaleSource; customerId?: string; custom?: Record<string, unknown> };
  /** Notes (05/06): a document this visitor issued here. */
  relatedCode?: string;
  lines: {
    /** Omitted: a typed line (or a demo product when only `productId` is given). */
    source?: SaleSource;
    productId?: string;
    descripcion?: string;
    cantidad: number;
    precioUni?: number;
    /** Custom lines: 1 = bien, 2 = servicio, chosen by the visitor. */
    tipoItem?: 1 | 2;
    codigo?: string;
  }[];
  sendEmail?: boolean;
  /** The address to e-mail the document to (any valid address; the server limits sends). */
  emailTo?: string;
}

export interface CreatedSession {
  session: string;
  total: number;
  title: string;
  emailTo: string | null;
}

export async function createSession(sale: SaleDescription): Promise<CreatedSession> {
  if (mock) return mock.session(sale);
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-facta-ui": "1", ...turnstileHeaders() },
    body: JSON.stringify(sale),
  });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as CreatedSession;
}

/** What this visitor issued here, newest first. */
export async function loadIssued(): Promise<IssuedDocument[]> {
  if (mock) return mock.issued();
  const response = await fetch("/api/issued", { headers: { accept: "application/json" } });
  if (!response.ok) throw await readError(response);
  return ((await response.json()) as { issued: IssuedDocument[] }).issued;
}

/**
 * Asks the server for an invalidation session token. The server refuses documents
 * the visitor did not issue here and picks the responsible people itself.
 */
export async function requestInvalidation(codigoGeneracion: string, options: { tipoAnulacion?: 2 | 3; motivo?: string } = {}): Promise<string> {
  if (mock) return mock.invalidation(codigoGeneracion);
  const response = await fetch("/api/invalidation", {
    method: "POST",
    headers: { "content-type": "application/json", "x-facta-ui": "1", ...turnstileHeaders() },
    body: JSON.stringify({ codigoGeneracion, ...options }),
  });
  if (!response.ok) throw await readError(response);
  return ((await response.json()) as { session: string }).session;
}

export interface RegistryDocument {
  codigoGeneracion: string;
  tipoDte: string;
  numeroControl: string;
  issuedAt: string;
  estado: string;
  /** The API's current view of the document, when the server could read it. */
  current: { estado: string; fecEmi?: string; horEmi?: string | null; selloRecibido?: string | null } | null;
}

/** The visitor's own documents, newest first (server/issued-codes.ts). */
export async function loadRegistry(): Promise<RegistryDocument[]> {
  const response = await fetch("/api/registro", { headers: { accept: "application/json" } });
  if (!response.ok) throw await readError(response);
  return ((await response.json()) as { documents: RegistryDocument[] }).documents;
}

export interface ResendOutcome {
  estado: string;
  /** Masked: «m•••@ejemplo.com». */
  destino: string;
  motivo?: string;
}

/**
 * One more e-mail attempt for a document this visitor issued (the address marked when it was issued;
 * a different one cannot be sent). The server limits it: one per document every 10 minutes, and the
 * hourly, daily and per-recipient e-mail caps; over a limit it answers 429.
 */
export async function resendEmail(codigoGeneracion: string): Promise<ResendOutcome> {
  if (mock?.resend) return mock.resend(codigoGeneracion);
  const response = await fetch("/api/delivery/resend", {
    method: "POST",
    headers: { "content-type": "application/json", "x-facta-ui": "1", ...turnstileHeaders() },
    body: JSON.stringify({ codigoGeneracion }),
  });
  if (!response.ok) throw await readError(response);
  return ((await response.json()) as { canal: ResendOutcome }).canal;
}
