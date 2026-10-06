// The page's calls to the playground Worker. Everything is same-origin.

export interface PlaygroundState {
  environment: "00";
  apiHost: string;
  visitor: { email: string; via: "access" | "dev-bypass" } | null;
  quota: { allowed: boolean; remainingHour: number; remainingDay: number } | null;
  supportedTypes: string[];
  catalog: boolean;
  demo: {
    customers: { id: string; label: string; contributor: boolean }[];
    products: { id: string; label: string; descripcion: string; precioUni: number }[];
  };
}

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
  const response = await fetch("/api/state", { headers: { accept: "application/json" } });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as PlaygroundState;
}

export interface SaleDescription {
  tipoDte: string;
  customerId?: string;
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
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-facta-ui": "1" },
    body: JSON.stringify(sale),
  });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as CreatedSession;
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
