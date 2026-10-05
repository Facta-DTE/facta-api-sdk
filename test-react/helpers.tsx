import { vi } from "vitest";
import {
  FactaClientError,
  type FactaClient,
  type IssueSummary,
  type SessionInfo,
  type StatusSummary,
} from "../src/browser/index.ts";

export const FUTURE = new Date(Date.now() + 15 * 60_000).toISOString();

export function sessionInfo(patch: Partial<SessionInfo> = {}): SessionInfo {
  return {
    draft: {
      tipoDte: "01",
      receptor: { nombre: "María López", numDocumento: "053085465", correo: "maria@example.com" },
      items: [
        { descripcion: "Café de altura 1 lb", cantidad: 2, precioUni: 8.5 },
        { descripcion: "Pupusas revueltas", cantidad: 4, precioUni: 1.25 },
      ],
    },
    environment: "00",
    expiresAt: FUTURE,
    display: { total: 22, reference: "#1042", title: "Pedido #1042 · Café del Volcán" },
    ...patch,
  };
}

export const sealed: IssueSummary = {
  estado: "sellado",
  codigoGeneracion: "7C2F1E5A-9B3D-4A6E-8F10-2D5B7C9E1A34",
  numeroControl: "DTE-01-M001P001-000000000000042",
  tipoDte: "01",
  ambiente: "00",
  fecEmi: "2026-10-05",
  horEmi: "14:32:10",
  selloRecibido: "20267C2F1E5A9B3D4A6E8F102D5B7C9E1A34ABCD",
  totales: { totalPagar: 1234.56 },
  archivoJson: '{"ok":true}',
  representacionGrafica: "JVBERi0=",
  storage: { managed: "stored", archive: "complete" },
};

export type Step<T> = T | Error | Promise<T>;

export function makeClient(script: {
  describe?: SessionInfo | Error;
  issue?: Array<Step<IssueSummary>>;
  status?: Array<Step<StatusSummary>>;
}) {
  const calls: string[] = [];
  const issue = vi.fn(async () => {
    calls.push("issue");
    const item = script.issue?.shift();
    if (item === undefined) throw new Error("issue script exhausted");
    if (item instanceof Error) throw item;
    return await item;
  });
  const client: FactaClient = {
    async describe() {
      calls.push("describe");
      if (script.describe instanceof Error) throw script.describe;
      return script.describe ?? sessionInfo();
    },
    issue,
    async status() {
      calls.push("status");
      const item = script.status?.shift();
      if (item === undefined) throw new Error("status script exhausted");
      if (item instanceof Error) throw item;
      return await item;
    },
  };
  return { client, calls, issue };
}

export const envelope = (
  code: string,
  init: Partial<ConstructorParameters<typeof FactaClientError>[0]> = {},
) => new FactaClientError({ code, message: code, status: 422, retryable: false, transport: false, ...init });

export const netError = () =>
  new FactaClientError({ code: "network_error", message: "offline", status: 0, retryable: true, transport: true });

export const FAST = { verifyDelayMs: 0, sleep: () => Promise.resolve(), phaseDelaysMs: [60_000, 120_000] as [number, number] };
export const NO_MOTION = { motion: "none" as const };
