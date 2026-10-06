import { describe, expect, it } from "vitest";
import { verifyFactaInvalidationSession } from "../../src/server/session.ts";
import type { FactaLike } from "../../src/server/handler.ts";
import { handleApi } from "../server/router.ts";
import { accessClaims, fakeQuotaNamespace, goodEnv, makeKeys } from "./helpers.ts";

const NOW = 1_800_000_000_000;
const seconds = Math.floor(NOW / 1000);
const CODE = "7C2F1E5A-9B3D-4A6E-8F10-2D5B7C9E1A34";
const FOREIGN = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
const PEOPLE = {
  responsable: { nombre: "Responsable Demo", tipoDocumento: "13", numDocumento: "000000035" },
  solicita: { nombre: "Solicitante Demo", tipoDocumento: "13", numDocumento: "000000019" },
};

const facta = {
  environment: "00",
  issue: (async () => ({
    estado: "sellado", codigoGeneracion: CODE, numeroControl: "DTE-01-M001P001-000000000000001", tipoDte: "01",
    ambiente: "00", fecEmi: "2026-10-06", horEmi: "10:00:00", selloRecibido: "SELLO", totales: { totalPagar: 1 }, observaciones: [],
  })) as unknown as FactaLike["issue"],
  listDocuments: (async () => ({
    documentos: [CODE, FOREIGN].map((codigoGeneracion) => ({ estado: "sellado", codigoGeneracion, numeroControl: "N", tipoDte: "01", fecEmi: "2026-10-06" })),
    siguiente: "cursor-1",
  })) as unknown as FactaLike["listDocuments"],
  getDocumentStatus: (async () => { throw new Error("unused"); }) as unknown as FactaLike["getDocumentStatus"],
} as FactaLike;

async function world(fixtures: unknown = { invalidation: PEOPLE }) {
  const keys = await makeKeys();
  const env = goodEnv({ QUOTA: fakeQuotaNamespace(() => NOW), FACTA_DTE_FIXTURES_JSON: JSON.stringify(fixtures) });
  const deps = { keys: async () => [keys.jwk], now: () => NOW, facta };
  const post = async (path: string, body: unknown, as?: string) => {
    const headers = new Headers({ "content-type": "application/json", "x-facta-ui": "1" });
    if (as) headers.set("cf-access-jwt-assertion", await keys.sign(accessClaims(seconds, { email: as })));
    return handleApi(new Request(`https://playground.factadte.com${path}`, { method: "POST", body: JSON.stringify(body), headers }), env, deps);
  };
  const get = async (path: string, as?: string) => {
    const headers = new Headers();
    if (as) headers.set("cf-access-jwt-assertion", await keys.sign(accessClaims(seconds, { email: as })));
    return handleApi(new Request(`https://playground.factadte.com${path}`, { headers }), env, deps);
  };
  /** Ana issues one Factura through the handler, which records it in the ledger. */
  const issueAs = async (email: string) => {
    const created = await (await post("/api/session", { tipoDte: "01", lines: [{ descripcion: "a", cantidad: 1, precioUni: 1 }] }, email)).json() as { session: string };
    expect((await post("/api/facta", { action: "issue", session: created.session }, email)).status).toBe(200);
  };
  return { env, post, get, issueAs };
}

describe("issued ledger over the API", () => {
  it("records what the handler issued, per visitor", async () => {
    const { get, issueAs } = await world();
    await issueAs("ana@example.com");
    const ana = await (await get("/api/issued", "ana@example.com")).json() as { issued: { codigoGeneracion: string; tipoDte: string }[] };
    expect(ana.issued).toMatchObject([{ codigoGeneracion: CODE, tipoDte: "01" }]);
    const beto = await (await get("/api/issued", "beto@example.com")).json() as { issued: unknown[] };
    expect(beto.issued).toEqual([]);
    expect((await get("/api/issued")).status).toBe(401);
  });
});

describe("POST /api/invalidation", () => {
  it("seals a session with fixture people for a document the visitor issued", async () => {
    const { post, env, issueAs } = await world();
    await issueAs("ana@example.com");
    const response = await post("/api/invalidation", { codigoGeneracion: CODE.toLowerCase() }, "ana@example.com");
    expect(response.status).toBe(200);
    const { session } = await response.json() as { session: string };
    const inv = await verifyFactaInvalidationSession(session, env.FACTA_SESSION_SECRET!, NOW);
    expect(inv.generationCode).toBe(CODE);
    expect(inv.request).toMatchObject({ tipoAnulacion: 2, ...PEOPLE });
    expect(inv.idempotencyKey).toMatch(/^[0-9a-f]{16}\.invalidate-/);
  });

  it("never takes the people, the type 1 or a replacement code from the browser", async () => {
    const { post, env, issueAs } = await world();
    await issueAs("ana@example.com");
    const { session } = await (await post("/api/invalidation", {
      codigoGeneracion: CODE, tipoAnulacion: 1, codigoGeneracionReemplazo: FOREIGN,
      responsable: { nombre: "Intruso", tipoDocumento: "13", numDocumento: "1" },
    }, "ana@example.com")).json() as { session: string };
    const inv = await verifyFactaInvalidationSession(session, env.FACTA_SESSION_SECRET!, NOW);
    expect(inv.request.tipoAnulacion).toBe(2);
    expect(inv.request.codigoGeneracionReemplazo).toBeNull();
    expect(inv.request.responsable.nombre).toBe("Responsable Demo");
  });

  it("requires a motivo for type 3", async () => {
    const { post, issueAs } = await world();
    await issueAs("ana@example.com");
    expect((await post("/api/invalidation", { codigoGeneracion: CODE, tipoAnulacion: 3 }, "ana@example.com")).status).toBe(400);
    expect((await post("/api/invalidation", { codigoGeneracion: CODE, tipoAnulacion: 3, motivo: "Error de captura" }, "ana@example.com")).status).toBe(200);
  });

  it("refuses a document another visitor issued, an unknown one and a malformed code", async () => {
    const { post, issueAs } = await world();
    await issueAs("ana@example.com");
    const beto = await post("/api/invalidation", { codigoGeneracion: CODE }, "beto@example.com");
    expect(beto.status).toBe(403);
    expect(((await beto.json()) as { error: { code: string } }).error.code).toBe("not_issued_here");
    expect((await post("/api/invalidation", { codigoGeneracion: FOREIGN }, "ana@example.com")).status).toBe(403);
    expect((await post("/api/invalidation", { codigoGeneracion: "nope" }, "ana@example.com")).status).toBe(400);
  });

  it("needs a signed-in visitor and the browser headers", async () => {
    const { post } = await world();
    expect((await post("/api/invalidation", { codigoGeneracion: CODE })).status).toBe(401);
  });

  it("answers 503 when the fixtures name nobody to sign with", async () => {
    const { post, issueAs } = await world({});
    await issueAs("ana@example.com");
    const response = await post("/api/invalidation", { codigoGeneracion: CODE }, "ana@example.com");
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("invalidation_unavailable");
  });

  it("an invalidation token only works for the visitor it was made for", async () => {
    const { post, issueAs } = await world();
    await issueAs("ana@example.com");
    const { session } = await (await post("/api/invalidation", { codigoGeneracion: CODE }, "ana@example.com")).json() as { session: string };
    expect((await post("/api/facta", { action: "invalidate.describe", session }, "beto@example.com")).status).toBe(403);
    expect((await post("/api/facta", { action: "invalidate.describe", session })).status).toBe(403);
    expect([401, 403]).not.toContain((await post("/api/facta", { action: "invalidate.describe", session }, "ana@example.com")).status);
  });
});

describe("what the shared key can see", () => {
  it("lists only the documents the visitor issued and keeps the cursor", async () => {
    const { post, issueAs } = await world();
    await issueAs("ana@example.com");
    const ana = await (await post("/api/facta", { action: "documents.list" }, "ana@example.com")).json() as { documentos: { codigoGeneracion: string }[]; siguiente: string | null };
    expect(ana.documentos.map((d) => d.codigoGeneracion)).toEqual([CODE]);
    expect(ana.siguiente).toBe("cursor-1");
    const beto = await (await post("/api/facta", { action: "documents.list" }, "beto@example.com")).json() as { documentos: unknown[] };
    expect(beto.documentos).toEqual([]);
    expect((await post("/api/facta", { action: "documents.list" })).status).toBe(401);
  });

  it("refuses documents.holding for everyone", async () => {
    const { post, issueAs } = await world();
    await issueAs("ana@example.com");
    const response = await post("/api/facta", { action: "documents.holding" }, "ana@example.com");
    expect(response.status).toBe(403);
  });
});
