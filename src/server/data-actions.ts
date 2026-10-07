// The data actions of the handler (docs/react-signing-ui.md §11): reads behind
// `capabilities`, plus the session-bound invalidation. Everything returned is
// a projection (see capabilities.ts); nothing is forwarded as the API gave it.

import { FactaError } from "../errors.ts";
import type { Facta } from "../client.ts";
import type { InvalidationArchiveResult } from "../archive.ts";
import type {
  DocumentStatus,
  DteType,
  InvalidationResult,
  ListDocumentsFilters,
} from "../types.ts";
import {
  allowedDownloadKinds,
  type FactaCapabilities,
  type FactaDownloadKind,
  type FactaCatalogWriteAction,
  type FactaReadAction,
  type FactaServiceState,
  projectCopies,
  projectCustomer,
  projectDocument,
  projectHolding,
  projectPage,
  projectProduct,
  projectRetry,
  projectStorageStatus,
} from "./capabilities.ts";
import type { FactaInvalidationSession } from "./session.ts";

/** The slice of `Facta` the data actions use; every member is optional so a fake can stand in. */
export type FactaDataLike = Partial<
  & Pick<
    Facta,
    | "listDocuments"
    | "downloadDocument"
    | "getDocumentCopies"
    | "retryDocumentStorage"
    | "listHolding"
    | "searchCustomers"
    | "getCustomer"
    | "searchProducts"
    | "getProduct"
    | "createCustomer"
    | "updateCustomer"
    | "deactivateCustomer"
    | "createProduct"
    | "updateProduct"
    | "deactivateProduct"
    | "status"
    | "diagnose"
    | "getStorageStatus"
    | "getDocumentStatus"
    | "invalidate"
    | "invalidateAndArchive"
    | "invalidationArchiveConfigured"
  >
>;

export class DataActionError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

export interface DataActionOptions {
  facta: FactaDataLike;
  capabilities: FactaCapabilities;
  exposeRecipient: boolean;
  /** Largest file `documents.download` returns, in bytes. Default 8 MiB. */
  maxDownloadBytes: number;
  /** How long `service.status` is reused, in ms. Default 15 000. */
  statusTtlMs: number;
  now?: () => number;
}

const UUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
const DTE_TYPES = ["01", "03", "05", "06", "11", "14"];
const ESTADOS = ["contingencia", "firmado", "invalidado", "sellado"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONTENT_TYPES: Record<FactaDownloadKind, string> = {
  pdf: "application/pdf",
  json: "application/json",
  ticket: "application/pdf",
};

function bad(message: string): never {
  throw new DataActionError("bad_request", message, 400);
}

function need<K extends keyof FactaDataLike>(facta: FactaDataLike, key: K): NonNullable<FactaDataLike[K]> {
  const fn = facta[key];
  if (fn === undefined || fn === null) {
    throw new DataActionError("bad_request", "This Facta client cannot serve that action.", 400);
  }
  return fn as NonNullable<FactaDataLike[K]>;
}

function code(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) bad("codigoGeneracion must be a UUID.");
  return value.toUpperCase();
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    bad(`${label} is required (at most ${max} characters).`);
  }
  return value;
}

function limitOf(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) bad(`limit must be an integer from 1 to ${max}.`);
  return value;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function sanitizeFilename(name: string | null, fallback: string): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[^\w.\-]/g, "_").slice(0, 120);
  return clean !== "" ? clean : fallback;
}

export function createDataActions(options: DataActionOptions) {
  const { facta, capabilities, exposeRecipient } = options;
  const now = options.now ?? Date.now;
  const view = { exposeRecipient };
  let statusCache: { at: number; value: Record<string, unknown> } | null = null;

  async function listDocuments(body: Record<string, unknown>, forced: Partial<ListDocumentsFilters>) {
    const filters: ListDocumentsFilters = {};
    for (const key of ["desde", "hasta"] as const) {
      const v = body[key];
      if (v === undefined) continue;
      if (typeof v !== "string" || !DATE.test(v)) bad(`${key} must be YYYY-MM-DD.`);
      filters[key] = v;
    }
    if (body.estado !== undefined) {
      if (typeof body.estado !== "string" || !ESTADOS.includes(body.estado)) bad("estado is not valid.");
      filters.estado = body.estado as NonNullable<ListDocumentsFilters["estado"]>;
    }
    if (body.tipoDte !== undefined) {
      if (typeof body.tipoDte !== "string" || !DTE_TYPES.includes(body.tipoDte)) bad("tipoDte is not valid.");
      filters.tipoDte = body.tipoDte as DteType;
    }
    filters.limit = limitOf(body.limit, 25, 100);
    if (body.cursor !== undefined) {
      if (typeof body.cursor !== "string" || body.cursor.length > 512) bad("cursor is not valid.");
      filters.cursor = body.cursor;
    }
    // The host's scope is forced last: the browser cannot widen it.
    for (const key of ["desde", "hasta", "estado", "tipoDte"] as const) {
      const value = forced[key];
      if (value !== undefined) (filters as Record<string, unknown>)[key] = value;
    }
    return projectPage(await need(facta, "listDocuments").call(facta, filters), view);
  }

  async function download(body: Record<string, unknown>) {
    const kind = body.kind;
    if (kind !== "pdf" && kind !== "json" && kind !== "ticket") bad("kind must be pdf, json or ticket.");
    if (!allowedDownloadKinds(capabilities).includes(kind)) {
      throw new DataActionError("action_not_allowed", "This kind of file is not available.", 403);
    }
    const cg = code(body.codigoGeneracion);
    const callOptions: { paperWidthMm?: number; raw?: boolean } = {};
    if (body.raw !== undefined) {
      if (kind !== "json" || typeof body.raw !== "boolean") bad("raw is only valid for json, as a boolean.");
      if (body.raw && capabilities.rawJson !== true) {
        throw new DataActionError("action_not_allowed", "The original JSON is not available.", 403);
      }
      if (body.raw) callOptions.raw = true;
    }
    if (body.paperWidthMm !== undefined) {
      if (kind !== "ticket" || typeof body.paperWidthMm !== "number" || !Number.isInteger(body.paperWidthMm) || body.paperWidthMm < 40 || body.paperWidthMm > 120) {
        bad("paperWidthMm is only valid for tickets, from 40 to 120.");
      }
      callOptions.paperWidthMm = body.paperWidthMm;
    }
    const file = await need(facta, "downloadDocument").call(facta, cg, kind, callOptions);
    if (file.bytes.length > options.maxDownloadBytes) {
      throw new DataActionError("payload_too_large", "The file is larger than this handler allows.", 413);
    }
    const ext = kind === "json" ? "json" : "pdf";
    return {
      file: {
        codigoGeneracion: cg,
        kind,
        filename: sanitizeFilename(file.filename, `${cg}${kind === "ticket" ? "-ticket" : ""}.${ext}`),
        contentType: CONTENT_TYPES[kind],
        bytes: file.bytes.length,
        base64: toBase64(file.bytes),
        ...(kind === "json" && file.jsonFormat !== undefined ? { jsonFormat: file.jsonFormat } : {}),
      },
    };
  }

  async function serviceStatus(): Promise<Record<string, unknown>> {
    if (statusCache !== null && now() - statusCache.at < options.statusTtlMs) return statusCache.value;
    let state: FactaServiceState;
    try {
      if (typeof facta.diagnose === "function") {
        const report = await facta.diagnose();
        const apiDown = report.checks.some((c) => c.id === "api" && c.state === "blocked");
        state = apiDown ? "offline" : report.overall === "ready" ? "online" : "degraded";
      } else {
        const status = await need(facta, "status").call(facta);
        state = status.ok === true ? "online" : "degraded";
      }
    } catch {
      state = "offline";
    }
    if ((state === "online" || state === "degraded") && typeof facta.listDocuments === "function" && capabilities.documents === "read") {
      try {
        const queued = await facta.listDocuments({ estado: "contingencia", limit: 1 });
        if (Array.isArray(queued.documentos) && queued.documentos.length > 0) state = "contingency";
      } catch {
        // The queue is a refinement; the verdict stands without it.
      }
    }
    const value = { state, checkedAt: new Date(now()).toISOString() };
    statusCache = { at: now(), value };
    return value;
  }

  const readers: Record<FactaReadAction, (body: Record<string, unknown>, forced: Partial<ListDocumentsFilters>) => Promise<Record<string, unknown>>> = {
    "documents.list": (body, forced) => listDocuments(body, forced),
    "documents.get": async (body) => ({
      document: projectDocument(await need(facta, "getDocumentStatus").call(facta, code(body.codigoGeneracion)) as DocumentStatus, view),
    }),
    "documents.download": (body) => download(body),
    "documents.copies": async (body) =>
      projectCopies(await need(facta, "getDocumentCopies").call(facta, { generationCode: code(body.codigoGeneracion) })),
    "documents.retryStorage": async (body) =>
      projectRetry(await need(facta, "retryDocumentStorage").call(facta, code(body.codigoGeneracion))),
    "documents.holding": async (body) => projectHolding(await need(facta, "listHolding").call(facta, limitOf(body.limit, 50, 100))),
    "catalog.customers.search": async (body) => {
      const found = await need(facta, "searchCustomers").call(facta, text(body.query, "query", 100), { limit: limitOf(body.limit, 10, 25) });
      return { items: found.map((c) => projectCustomer(c, view)) };
    },
    "catalog.customers.get": async (body) => {
      const c = await need(facta, "getCustomer").call(facta, text(body.id, "id", 100));
      if (c === null) throw new DataActionError("not_found", "Customer not found.", 404);
      return { item: projectCustomer(c, view) };
    },
    "catalog.products.search": async (body) => {
      const found = await need(facta, "searchProducts").call(facta, text(body.query, "query", 100), { limit: limitOf(body.limit, 10, 25) });
      return { items: found.filter((p) => p.active !== false).map(projectProduct) };
    },
    "catalog.products.get": async (body) => {
      const p = await need(facta, "getProduct").call(facta, text(body.id, "id", 100));
      if (p === null) throw new DataActionError("not_found", "Product not found.", 404);
      return { item: projectProduct(p) };
    },
    "service.status": () => serviceStatus(),
    "storage.status": async () => ({ storage: projectStorageStatus(await need(facta, "getStorageStatus").call(facta)) }),
  };

  const KEY = /^[\w.:-]{8,128}$/;

  /** An optional caller-chosen idempotency key for a create; anything else is rejected, not ignored. */
  function writeOptions(body: Record<string, unknown>, create: boolean): { idempotencyKey?: string } {
    if (body.idempotencyKey === undefined) return {};
    if (!create) bad("idempotencyKey only applies to create.");
    if (typeof body.idempotencyKey !== "string" || !KEY.test(body.idempotencyKey)) bad("idempotencyKey is not valid.");
    return { idempotencyKey: body.idempotencyKey };
  }

  function inputOf(body: Record<string, unknown>): Record<string, unknown> {
    const input = body.input;
    if (typeof input !== "object" || input === null || Array.isArray(input)) bad("input must be an object.");
    return input as Record<string, unknown>;
  }

  /** Errors the SDK throws on its own (bad data) are the browser's to fix; the rest pass through as FactaError. */
  const writers: Record<FactaCatalogWriteAction, (body: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
    "catalog.customers.create": async (body) => ({
      item: projectCustomer(await need(facta, "createCustomer").call(facta, inputOf(body), writeOptions(body, true)), view),
    }),
    "catalog.customers.update": async (body) => ({
      item: projectCustomer(await need(facta, "updateCustomer").call(facta, text(body.id, "id", 100), inputOf(body), writeOptions(body, false)), view),
    }),
    "catalog.customers.deactivate": async (body) => ({
      item: projectCustomer(await need(facta, "deactivateCustomer").call(facta, text(body.id, "id", 100), writeOptions(body, false)), view),
    }),
    "catalog.products.create": async (body) => ({
      item: projectProduct(await need(facta, "createProduct").call(facta, inputOf(body), writeOptions(body, true))),
    }),
    "catalog.products.update": async (body) => ({
      item: projectProduct(await need(facta, "updateProduct").call(facta, text(body.id, "id", 100), inputOf(body), writeOptions(body, false))),
    }),
    "catalog.products.deactivate": async (body) => ({
      item: projectProduct(await need(facta, "deactivateProduct").call(facta, text(body.id, "id", 100), writeOptions(body, false))),
    }),
  };

  return {
    write(action: FactaCatalogWriteAction, body: Record<string, unknown>) {
      return writers[action](body);
    },

    read(action: FactaReadAction, body: Record<string, unknown>, forced: Partial<ListDocumentsFilters> = {}) {
      return readers[action](body, forced);
    },

    /** What the invalidation dialog shows: the session's own data plus a summary of the target. */
    async describeInvalidation(session: FactaInvalidationSession, environment: string | null): Promise<Record<string, unknown>> {
      let document: Record<string, unknown> | null = null;
      if (typeof facta.getDocumentStatus === "function") {
        try {
          document = projectDocument(await facta.getDocumentStatus(session.generationCode), { exposeRecipient: false });
        } catch {
          document = null;
        }
      }
      const r = session.request;
      return {
        invalidation: {
          codigoGeneracion: session.generationCode,
          tipoAnulacion: r.tipoAnulacion,
          motivo: r.motivo ?? null,
          codigoGeneracionReemplazo: r.codigoGeneracionReemplazo ?? null,
          responsable: r.responsable,
          solicita: r.solicita,
        },
        document,
        environment,
        expiresAt: new Date(session.exp * 1000).toISOString(),
      };
    },

    async invalidate(session: FactaInvalidationSession): Promise<{ body: Record<string, unknown>; result: InvalidationResult }> {
      const key = session.idempotencyKey;
      let result: InvalidationResult;
      if (facta.invalidationArchiveConfigured === true && typeof facta.invalidateAndArchive === "function") {
        const archived: InvalidationArchiveResult = await facta.invalidateAndArchive(session.generationCode, session.request, {
          operationId: key,
          idempotencyKey: key,
        });
        if (archived.invalidation === undefined) {
          throw new FactaError("operation_outcome_unknown", "The invalidation was already journaled; verify its state.", 0);
        }
        result = archived.invalidation;
      } else {
        result = await need(facta, "invalidate").call(facta, session.generationCode, session.request, { idempotencyKey: key });
      }
      const evento = "evento" in result ? result.evento : undefined;
      return {
        result,
        body: {
          result: {
            estado: "invalidado",
            codigoGeneracion: result.codigoGeneracion,
            numeroControl: result.numeroControl,
            yaEstabaInvalidado: "yaEstabaInvalidado" in result && result.yaEstabaInvalidado === true,
            ...(evento
              ? {
                evento: {
                  codigoGeneracion: evento.codigoGeneracion,
                  selloRecibido: evento.selloRecibido,
                  fhProcesamiento: evento.fhProcesamiento ?? null,
                  tipoAnulacion: evento.tipoAnulacion,
                },
              }
              : {}),
          },
        },
      };
    },
  };
}
