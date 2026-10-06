// The page's calls to the playground Worker. Everything is same-origin.

export interface PlaygroundState {
  environment: "00";
  apiHost: string;
  visitor: { email: string; via: "access" | "dev-bypass" } | null;
  quota: { allowed: boolean; remainingHour: number; remainingDay: number } | null;
  supportedTypes: string[];
  catalog: boolean;
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
}
let mock: MockBackend | null = null;
export const installMock = (backend: MockBackend) => { mock = backend; };
/** The fetch the SDK provider should use instead of the network, in mock mode only. */
export const mockFetch = (): typeof fetch | undefined => mock?.fetch;

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

async function readError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  return new ApiError(
    body?.error?.code ?? "request_failed",
    body?.error?.message ?? "No se pudo completar la solicitud.",
    response.status,
  );
}

export async function loadState(): Promise<PlaygroundState> {
  if (mock) return mock.state();
  const response = await fetch("/api/state", { headers: { accept: "application/json" } });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as PlaygroundState;
}

export interface SaleDescription {
  tipoDte: string;
  customerId?: string;
  /** Factura (01) only: a typed receiver name. Nothing else about the receiver can be typed. */
  receptorNombre?: string;
  /** Notes (05/06): a document this visitor issued here. */
  relatedCode?: string;
  lines: { productId?: string; descripcion?: string; cantidad: number; precioUni?: number }[];
  sendEmail?: boolean;
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
    headers: { "content-type": "application/json", "x-facta-ui": "1" },
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
    headers: { "content-type": "application/json", "x-facta-ui": "1" },
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
