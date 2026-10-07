// The recipe registry: for each fixed recipe file, how a validated form becomes
// its input. Visitors send parameters (a type, a code, a JSON order), never code;
// everything below validates them and builds the input from the demo data.

import type { DteRequest, InvalidationRequest, PreparedDte, Recipient } from "../../../mod.ts";
import type { PlaygroundFixtures } from "../fixtures.ts";
import { buildSale, customerFits, MAX_LINES, MAX_TOTAL, SaleError } from "../sale.ts";
import { parseAddress, recipientKey, maskAddress, DeliveryError } from "../delivery.ts";
import type { StashedToken } from "../mail-quota.ts";
import type { ExecOutcome } from "./runner.ts";
import { openJson, sealJson } from "./seal.ts";
import type { Facta } from "../../../src/client.ts";
import * as issueIdempotent from "./issue-idempotent.ts";
import * as prepareSign from "./prepare-sign.ts";
import * as statusRecovery from "./status-recovery.ts";
import * as invalidate from "./invalidate.ts";
import * as documentsStorage from "./documents-storage.ts";
import * as catalogRefs from "./catalog-refs.ts";
import { maskCustomer, maskProduct } from "../catalog-mask.ts";
import * as orderWebhook from "./order-webhook.ts";
import * as deliverEmail from "./deliver-email.ts";
import * as archivoDte from "./archivo-dte.ts";
import * as regionTimings from "./region-timings.ts";
import * as diagnose from "./diagnose.ts";
import * as deliveryStatus from "./delivery-status.ts";
import * as registerReturn from "./register-return.ts";
import * as referenceClock from "./reference-clock.ts";
import * as serviceInfo from "./service-info.ts";
import * as emergencyStore from "./emergency-store.ts";

export class RecipeError extends Error {
  override readonly name = "RecipeError";
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

export interface BindContext {
  stage: string;
  params: Record<string, unknown>;
  fixtures: PlaygroundFixtures;
  email: string;
  /** `<visitorTag>.<runId>`: a retry of the same run reuses it, a new run gets a new one. */
  baseKey: string;
  /** `<visitorTag>`: for keys that must survive across runs (a webhook's order id). */
  tag: string;
  secret: string;
  hasCatalog: boolean;
  /** True when this visitor issued the code (issued-codes.ts `ownsDocument`). */
  owns(code: string): Promise<boolean>;
  /** Codes this visitor issued, newest first. */
  mine(): Promise<string[]>;
  /** The same documents with their types (a note may only relate a Crédito fiscal). */
  ownedDocs(): Promise<Array<{ codigoGeneracion: string; tipoDte: string }>>;
  /** The delivery token the Worker kept for a document this visitor issued (valid five minutes), or null. */
  stash(code: string): Promise<StashedToken | null>;
  now: number;
}

export interface Bound {
  /**
   * Idempotency keys that count against the visitor's quota, ONCE the run issued or invalidated something
   * (a failure counts nothing). A key already counted is free.
   */
  quotaKeys: string[];
  /** Keys that are only CHECKED against the quota before the run (a stage that will count later, like `prepare`). */
  gateKeys?: string[];
  /** Set when the run sends an e-mail: counted on the visitor, IP and recipient (gates.ts). */
  mail?: { key: string; /** `recipientKey(...)`, never the address. */ recipient: string; doc?: string; /** False: only check the limits now, count later (the stage that issues; the stage that sends counts). */ commit?: boolean };
  exec(facta: Facta): Promise<ExecOutcome>;
}

export interface RecipeDef {
  stages: readonly string[];
  bind(ctx: BindContext): Promise<Bound>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(params: Record<string, unknown>, name: string, max: number, required = false): string | undefined {
  const value = params[name];
  if (value === undefined || value === null || value === "") {
    if (required) throw new RecipeError("param_invalid", `Falta el campo «${name}».`);
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length > max) throw new RecipeError("param_invalid", `El campo «${name}» no es válido.`);
  return value.trim();
}

/** Letters, digits, dot, dash, underscore; up to 64. The visitor's order number in a recipe (the SDK's `idempotencyKey` identity). */
export const RECIPE_ORDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * The idempotency key of a recipe run. With the visitor's order number it is `<visitor tag>.r-<recipe>.<order>.<type>`:
 * the same order sent again is the same key (the API answers with the original document), the tag keeps two visitors
 * who type the same number apart, and the recipe id keeps two recipes apart. Without one the key follows the run id,
 * the old behaviour («Reintentar igual» reuses it, a new run gets a new one).
 */
function recipeKey(ctx: BindContext, recipe: string, suffix: string): string {
  const given = ctx.params.orderNumber;
  if (given === undefined || given === null || given === "") return `${ctx.baseKey}.${suffix}`;
  const order = typeof given === "string" ? given.trim() : "";
  if (!RECIPE_ORDER.test(order)) throw new RecipeError("order_number_invalid", "El número de orden admite letras, números, punto, guion y guion bajo (hasta 64).");
  return `${ctx.tag}.r-${recipe}.${order}.${suffix}`;
}

function oneOf<T extends string>(params: Record<string, unknown>, name: string, allowed: readonly T[]): T {
  const value = params[name];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw new RecipeError("param_invalid", `El campo «${name}» no es válido.`);
  return value as T;
}

function codeOf(result: unknown): Array<{ codigoGeneracion: string; tipoDte: string; numeroControl: string; estado: string; total?: number }> {
  if (!isRecord(result)) return [];
  const { codigoGeneracion, tipoDte, numeroControl, estado } = result;
  if ((estado !== "sellado" && estado !== "contingencia") || typeof codigoGeneracion !== "string" || typeof tipoDte !== "string" || typeof numeroControl !== "string") return [];
  const total = isRecord(result.totales) && typeof result.totales.totalPagar === "number" ? result.totales.totalPagar
    : isRecord(result.totales) && typeof result.totales.montoTotalOperacion === "number" ? result.totales.montoTotalOperacion : undefined;
  return [{ codigoGeneracion, tipoDte, numeroControl, estado, ...(total === undefined ? {} : { total }) }];
}

export const RECIPE_TYPES = ["01", "03", "05", "06", "11", "14"] as const;
export type RecipeType = (typeof RECIPE_TYPES)[number];

/**
 * A request for any of the six types: the fixture's complete request when there is one, otherwise the
 * sale builder over a demo customer that fits. Notes (05/06) always relate a document this visitor issued.
 */
async function requestFor(type: RecipeType, ctx: BindContext): Promise<DteRequest> {
  const note = type === "05" || type === "06";
  const fixture = note ? undefined : ctx.fixtures.requests[type];
  if (fixture !== undefined) return fixture;
  if (note && text(ctx.params, "related", 36) === undefined) {
    throw new RecipeError("related_required", "Elija el documento que corrige: la nota debe relacionar uno que usted emitió en este playground.");
  }
  const relatedCode = note ? await ownedCode(ctx, true, "related") : undefined;
  const customer = type === "01" ? undefined : ctx.fixtures.customers.find((c) => customerFits(c.receptor as Record<string, unknown>).includes(type));
  try {
    return buildSale({
      tipoDte: type,
      lines: [{ source: "custom", descripcion: "Servicio de prueba", cantidad: 1, precioUni: 1, tipoItem: type === "11" ? 1 : 2 }],
      ...(customer === undefined ? {} : { receptor: { source: "demo", customerId: customer.id } }),
      ...(relatedCode === undefined ? {} : { relatedCode }),
    }, ctx.fixtures, { owned: await ctx.ownedDocs() }).sale.request;
  } catch (error) {
    if (error instanceof SaleError) {
      throw new RecipeError(error.code, note && error.code !== "related_not_ccf" ? "Elija el documento que corrige: la nota debe relacionar uno que usted emitió en este playground." : error.message);
    }
    throw error;
  }
}

async function ownedCode(ctx: BindContext, required: boolean, name = "code"): Promise<string | undefined> {
  const code = text(ctx.params, name, 36, required);
  if (code === undefined) return undefined;
  if (!UUID.test(code)) throw new RecipeError("param_invalid", "El código de generación no es válido.");
  if (!(await ctx.owns(code))) {
    throw new RecipeError("not_owned", "Solo puede usar documentos emitidos desde su sesión del playground.", 403);
  }
  return code;
}

const issueDef: RecipeDef = {
  stages: ["run"],
  async bind(ctx) {
    const type = oneOf(ctx.params, "type", RECIPE_TYPES);
    const input: issueIdempotent.Input = { request: await requestFor(type, ctx), idempotencyKey: recipeKey(ctx, "issue-idempotent", type) };
    return {
      quotaKeys: [input.idempotencyKey],
      async exec(facta) {
        const out = await issueIdempotent.run(facta, input);
        return { result: out.result, issued: codeOf(out.result) };
      },
    };
  },
};

const prepareSignDef: RecipeDef = {
  stages: ["prepare", "sign"],
  async bind(ctx) {
    if (ctx.stage === "prepare") {
      const type = oneOf(ctx.params, "type", RECIPE_TYPES);
      const input: prepareSign.Input = { request: await requestFor(type, ctx), idempotencyKey: recipeKey(ctx, "prepare-sign", type) };
      return {
        // Preparing reserves a number but issues nothing: the count happens when the document is signed.
        quotaKeys: [],
        gateKeys: [input.idempotencyKey],
        async exec(facta) {
          const prepared = await prepareSign.prepare(facta, input);
          const continuation = await sealJson(ctx.secret, "prepare-sign", ctx.email, { prepared, key: input.idempotencyKey }, 10 * 60_000, ctx.now);
          return { result: prepared, keep: ["documento"], continuation };
        },
      };
    }
    const held = await openJson<{ prepared: PreparedDte; key: string }>(ctx.secret, "prepare-sign", ctx.email, ctx.params.continuation, ctx.now);
    if (held === null) throw new RecipeError("continuation_invalid", "El documento preparado venció o no es suyo. Vuelva a prepararlo.", 410);
    const input: prepareSign.Input = { request: { tipoDte: "01", items: [] }, idempotencyKey: held.key };
    return {
      quotaKeys: [held.key],
      async exec(facta) {
        const result = await prepareSign.sign(facta, held.prepared, input);
        return { result, issued: codeOf(result) };
      },
    };
  },
};

const statusRecoveryDef: RecipeDef = {
  stages: ["run"],
  async bind(ctx) {
    const type = oneOf(ctx.params, "type", RECIPE_TYPES);
    const input: statusRecovery.Input = {
      request: await requestFor(type, ctx),
      idempotencyKey: recipeKey(ctx, "status-recovery", type),
      ...(ctx.params.simulateTimeout === true ? { simulateTimeoutMs: 250 } : {}),
    };
    return {
      quotaKeys: [input.idempotencyKey],
      async exec(facta) {
        const out = await statusRecovery.run(facta, input);
        return { result: out, issued: codeOf(out.result) };
      },
    };
  },
};

const digits = (type: string) => (type === "13" ? /^\d{9}$/ : type === "36" ? /^\d{14}$/ : /^[A-Za-z0-9-]{1,20}$/);

const invalidateDef: RecipeDef = {
  stages: ["run"],
  async bind(ctx) {
    const code = (await ownedCode(ctx, true))!;
    const tipoAnulacion = Number(oneOf(ctx.params, "tipoAnulacion", ["1", "2", "3"] as const)) as 1 | 2 | 3;
    const motivo = text(ctx.params, "motivo", 200);
    const replacement = text(ctx.params, "replacement", 36);
    if (tipoAnulacion === 3 && motivo === undefined) throw new RecipeError("param_invalid", "El tipo 3 requiere un motivo.");
    if (tipoAnulacion === 1 && (replacement === undefined || !UUID.test(replacement))) {
      throw new RecipeError("param_invalid", "El tipo 1 requiere el código de generación del documento de reemplazo.");
    }
    const nombre = text(ctx.params, "responsableNombre", 100, true)!;
    const tipoDocumento = oneOf(ctx.params, "responsableTipo", ["13", "36", "37"] as const);
    const numDocumento = text(ctx.params, "responsableNumero", 20, true)!;
    if (!digits(tipoDocumento).test(numDocumento)) {
      throw new RecipeError("param_invalid", tipoDocumento === "13" ? "El DUI lleva 9 dígitos, sin guion." : tipoDocumento === "36" ? "El NIT lleva 14 dígitos, sin guiones." : "El número de documento no es válido.");
    }
    const person = { nombre, tipoDocumento, numDocumento };
    const request: InvalidationRequest = {
      tipoAnulacion,
      ...(motivo === undefined ? {} : { motivo }),
      ...(tipoAnulacion === 1 ? { codigoGeneracionReemplazo: replacement! } : {}),
      responsable: person,
      solicita: person,
    };
    const input: invalidate.Input = { codigoGeneracion: code, request, idempotencyKey: `${ctx.tag}.void.${code}` };
    return {
      quotaKeys: [input.idempotencyKey],
      async exec(facta) {
        const out = await invalidate.run(facta, input);
        return { result: out.result, invalidated: [code] };
      },
    };
  },
};

const documentsDef: RecipeDef = {
  stages: ["run"],
  async bind(ctx) {
    const code = await ownedCode(ctx, false);
    const kind = oneOf(ctx.params, "kind", ["pdf", "json", "ticket"] as const);
    const limit = Number(oneOf(ctx.params, "limit", ["5", "10", "25"] as const));
    // The roll width is only read for a ticket, and only as an integer the API accepts (40 through 120).
    const rawWidth = ctx.params.paperWidthMm;
    let paperWidthMm: number | undefined;
    if (kind === "ticket" && rawWidth !== undefined && rawWidth !== "") {
      paperWidthMm = typeof rawWidth === "number" ? rawWidth : /^\d{2,3}$/.test(String(rawWidth).trim()) ? Number(String(rawWidth).trim()) : Number.NaN;
      if (!Number.isInteger(paperWidthMm) || paperWidthMm < 40 || paperWidthMm > 120) throw new RecipeError("param_invalid", "El ancho del rollo debe ser un entero de 40 a 120 mm.");
    }
    // The key's issuer holds every visitor's documents: list only the codes this visitor issued.
    const input: documentsStorage.Input = { kind, limit, onlyCodes: await ctx.mine(), ...(code === undefined ? {} : { codigoGeneracion: code }), ...(paperWidthMm === undefined ? {} : { paperWidthMm }) };
    return {
      quotaKeys: [],
      async exec(facta) {
        return { result: await documentsStorage.run(facta, input) };
      },
    };
  },
};

const catalogDef: RecipeDef = {
  stages: ["run"],
  async bind(ctx) {
    if (!ctx.hasCatalog) throw new RecipeError("catalog_unavailable", "El catálogo no está habilitado en este playground (falta la llave de desbloqueo).", 503);
    const customerId = text(ctx.params, "customerId", 80);
    const productId = text(ctx.params, "productId", 80);
    const cantidad = ctx.params.cantidad === undefined || ctx.params.cantidad === "" ? 1 : Number(ctx.params.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10) throw new RecipeError("param_invalid", "La cantidad debe ser un entero entre 1 y 10.");
    if (customerId !== undefined && productId === undefined) throw new RecipeError("param_invalid", "Elija también un producto para emitir.");
    const key = `${ctx.baseKey}.catalog`;
    const input: catalogRefs.Input = {
      cantidad,
      idempotencyKey: key,
      ...(customerId === undefined ? {} : { customerId }),
      ...(productId === undefined ? {} : { productId }),
    };
    return {
      quotaKeys: productId === undefined ? [] : [key],
      async exec(facta) {
        const out = await catalogRefs.run(facta, input);
        // The catalog is the real one: customers leave the Worker masked, with every key kept.
        const shown = {
          ...out,
          customers: out.customers.map((c) => maskCustomer(c as unknown as Record<string, unknown>)),
          products: out.products.map((p) => maskProduct(p as unknown as Record<string, unknown>)),
        };
        return { result: shown, issued: codeOf(out.result) };
      },
    };
  },
};

const orderDef: RecipeDef = {
  stages: ["run"],
  async bind(ctx) {
    const raw = ctx.params.order;
    if (typeof raw !== "string" || raw.length > 2_000) throw new RecipeError("order_invalid", "El pedido debe ser un JSON de hasta 2,000 caracteres.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new RecipeError("order_invalid", "El pedido no es un JSON válido.");
    }
    if (!isRecord(parsed) || typeof parsed.orderId !== "string" || !RECIPE_ORDER.test(parsed.orderId)) {
      throw new RecipeError("order_invalid", "El pedido necesita un orderId de letras, números, punto, guion y guion bajo (hasta 64).");
    }
    if (!Array.isArray(parsed.lines) || parsed.lines.length < 1 || parsed.lines.length > MAX_LINES) {
      throw new RecipeError("order_invalid", `El pedido necesita entre 1 y ${MAX_LINES} líneas.`);
    }
    const lines: orderWebhook.Order["lines"] = [];
    for (const line of parsed.lines) {
      const sku = isRecord(line) ? line.sku : undefined;
      const qty = isRecord(line) ? line.qty : undefined;
      if (typeof sku !== "string") throw new RecipeError("order_invalid", "Cada línea necesita un sku, por ejemplo CAF-250.");
      if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 1000) throw new RecipeError("order_invalid", "Cada qty debe ser un entero entre 1 y 1000.");
      lines.push({ sku, qty });
    }
    if (parsed.customerRef !== undefined && typeof parsed.customerRef !== "string") throw new RecipeError("order_invalid", "customerRef debe ser el código de un cliente, por ejemplo CLI-01.");
    const order: orderWebhook.Order = { orderId: parsed.orderId, ...(parsed.customerRef === undefined ? {} : { customerRef: parsed.customerRef }), lines };
    // The translation is the integration's own code: its messages name the valid SKUs and customers.
    let total = 0;
    try {
      const request = orderWebhook.orderToRequest(order);
      total = (request.items as Array<{ cantidad: number; precioUni: number }>).reduce((sum, item) => Math.round((sum + item.cantidad * item.precioUni) * 100) / 100, 0);
    } catch (error) {
      if (error instanceof orderWebhook.OrderError) throw new RecipeError("order_invalid", error.message);
      throw error;
    }
    if (total > MAX_TOTAL) throw new RecipeError("order_invalid", `El total de un pedido de prueba no puede pasar de $${MAX_TOTAL}.`);
    // The order id IS the key, scoped to the visitor: the same order delivered twice issues once, and two visitors
    // who both type «ORD-1042» never meet.
    const input = { order, idempotencyKey: `${ctx.tag}.${orderWebhook.keyOf(order)}` };
    return {
      quotaKeys: [input.idempotencyKey],
      async exec(facta) {
        const out = await orderWebhook.run(facta, input);
        return { result: out, issued: codeOf(out.result) };
      },
    };
  },
};

/** What the second stage needs, sealed for the browser to carry: the token never reaches the page. */
interface HeldDelivery {
  code: string;
  token: string;
  masked: string;
  rcpt: string;
}

const deliverEmailDef: RecipeDef = {
  stages: ["issue", "send"],
  async bind(ctx) {
    if (ctx.stage === "issue") {
      let address: string;
      try {
        address = parseAddress(ctx.params.email);
      } catch (error) {
        if (error instanceof DeliveryError) throw new RecipeError(error.code, error.message);
        throw error;
      }
      const input: deliverEmail.IssueInput = { request: await requestFor("01", ctx), idempotencyKey: recipeKey(ctx, "deliver-email", "deliver"), email: address };
      const rcpt = await recipientKey(ctx.secret, address);
      return {
        quotaKeys: [input.idempotencyKey],
        // Marking the e-mail sends nothing yet: the limits are only checked here and counted by the stage that sends.
        mail: { key: `${ctx.baseKey}.mail-check`, recipient: rcpt, commit: false },
        async exec(facta) {
          const out = await deliverEmail.issueWithDelivery(facta, input);
          const offer = out.result.entrega;
          // The token stays on the server. The page gets proof that it exists and when it dies.
          const result = {
            issued: out.result,
            entrega: { tokenRecibido: out.token !== undefined, venceEn: offer?.venceEn ?? null, canales: offer?.canales ?? {} },
          };
          const continuation = out.token === undefined ? undefined
            : await sealJson(ctx.secret, "deliver-email", ctx.email, { code: out.code, token: out.token, masked: maskAddress(address), rcpt }, 10 * 60_000, ctx.now);
          return { result, issued: codeOf(out.result), ...(continuation === undefined ? {} : { continuation }) };
        },
      };
    }
    // Stage «send»: with the sealed hand-over from stage 1, or with a document issued in «Pantallas React»
    // whose five-minute token the Worker kept.
    let held = await openJson<HeldDelivery>(ctx.secret, "deliver-email", ctx.email, ctx.params.continuation, ctx.now);
    if (held === null) {
      const code = await ownedCode(ctx, false);
      if (code === undefined) throw new RecipeError("continuation_invalid", "Primero emita el documento con el correo marcado (paso 1), o elija uno suyo emitido hace menos de cinco minutos.", 410);
      const kept = await ctx.stash(code);
      if (kept === null) {
        throw new RecipeError("delivery_window_closed", "El plazo para entregar ese documento venció (cinco minutos desde que se emitió) o no se marcó el correo. Emita uno nuevo.", 410);
      }
      held = { code, token: kept.token, masked: kept.masked, rcpt: kept.rcpt };
    }
    const input: deliverEmail.SendInput = { code: held.code, token: held.token };
    const { masked } = held;
    return {
      quotaKeys: [],
      // One send per document every ten minutes, and the hourly, daily and per-recipient limits: counted here.
      mail: { key: `${ctx.baseKey}.mail`, recipient: held.rcpt, doc: held.code },
      async exec(facta) {
        const out = await deliverEmail.sendEmail(facta, input);
        return { result: { codigoGeneracion: held.code, destino: masked, ...out } };
      },
    };
  },
};

const archivoDteDef: RecipeDef = {
  stages: ["run"],
  async bind(ctx) {
    const code = (await ownedCode(ctx, true))!;
    const input: archivoDte.Input = { codigoGeneracion: code };
    return { quotaKeys: [], async exec(facta) { return { result: await archivoDte.run(facta, input) }; } };
  },
};

/** A recipe that reads the API and needs no parameter: nothing is counted and nothing is recorded. */
const readOnlyDef = (run: (facta: Facta) => Promise<unknown>): RecipeDef => ({
  stages: ["run"],
  async bind() {
    return { quotaKeys: [], async exec(facta) { return { result: await run(facta) }; } };
  },
});

const deliveryStatusDef: RecipeDef = {
  stages: ["run"],
  async bind(ctx) {
    const code = (await ownedCode(ctx, true))!;
    const input: deliveryStatus.Input = { codigoGeneracion: code };
    return { quotaKeys: [], async exec(facta) { return { result: await deliveryStatus.run(facta, input) }; } };
  },
};

function positiveInteger(params: Record<string, unknown>, name: string, max: number): number {
  const value = params[name] === undefined || params[name] === "" ? 1 : Number(params[name]);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new RecipeError("param_invalid", `El campo «${name}» debe ser un entero entre 1 y ${max}.`);
  return value;
}

const returnDef: RecipeDef = {
  stages: ["run"],
  async bind(ctx) {
    const code = (await ownedCode(ctx, true))!;
    // The API applies a return to a Factura (01), an Exportación (11) or a Sujeto excluido (14), never to anything else.
    const doc = (await ctx.ownedDocs()).find((d) => d.codigoGeneracion.toUpperCase() === code.toUpperCase());
    if (doc === undefined || !["01", "11", "14"].includes(doc.tipoDte)) {
      throw new RecipeError("return_type_not_allowed", "El retorno solo se aplica a una Factura (01), una Exportación (11) o un Sujeto excluido (14) que usted emitió aquí.");
    }
    const linea = positiveInteger(ctx.params, "linea", 50);
    const cantidad = positiveInteger(ctx.params, "cantidad", 1000);
    const input: registerReturn.Input = {
      codigoGeneracion: code,
      request: { items: [{ linea, cantidad }] },
      // A retry of the same run reuses the key: the API answers with the same event instead of returning the units twice.
      idempotencyKey: `${ctx.baseKey}.return`,
    };
    return {
      // It costs a call to Hacienda's test service, so it counts like an issue, once, when the event is sealed.
      quotaKeys: [input.idempotencyKey],
      async exec(facta) {
        const result = await registerReturn.run(facta, input);
        return { result, ...(result.estado === "sellado" ? { returned: [code] } : {}) };
      },
    };
  },
};

const SCENARIOS = ["sin_almacenamiento_duradero", "copia_solo_temporal", "sin_copia_en_servidor"] as const;

const emergencyDef: RecipeDef = {
  stages: ["run"],
  async bind(ctx) {
    const input: emergencyStore.Input = {
      scenario: oneOf(ctx.params, "scenario", SCENARIOS),
      storeFails: ctx.params.storeFails === true,
      notConfigured: ctx.params.notConfigured === true,
    };
    // Nothing leaves the Worker: the «API» is an in-memory function inside the recipe.
    return { quotaKeys: [], async exec(facta) { return { result: await emergencyStore.run(facta, input) }; } };
  },
};

export const RECIPES: Readonly<Record<string, RecipeDef>> = {
  "issue-idempotent": issueDef,
  "prepare-sign": prepareSignDef,
  "status-recovery": statusRecoveryDef,
  "invalidate": invalidateDef,
  "documents-storage": documentsDef,
  "catalog-refs": catalogDef,
  "order-webhook": orderDef,
  "deliver-email": deliverEmailDef,
  "archivo-dte": archivoDteDef,
  "region-timings": readOnlyDef(regionTimings.run),
  "diagnose": readOnlyDef(diagnose.run),
  "delivery-status": deliveryStatusDef,
  "register-return": returnDef,
  "reference-clock": readOnlyDef(referenceClock.run),
  "service-info": readOnlyDef(serviceInfo.run),
  "emergency-store": emergencyDef,
};
