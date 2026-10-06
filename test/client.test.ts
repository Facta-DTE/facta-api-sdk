// The behaviours that are the SDK's own, tested against a fake transport.
//
// What is NOT tested here is anything the server owns: totals, schemas, the
// seal. Duplicating those assertions would only assert that the fake is a good
// fake.

import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { FactaError } from "../src/errors.ts";

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function fakeFetch(
  answers: Array<{ status: number; body: unknown }>,
): { fetch: typeof globalThis.fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  let index = 0;
  const fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : null,
    });
    const answer = answers[Math.min(index++, answers.length - 1)];
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const SEALED = {
  estado: "sellado",
  codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
  numeroControl: "DTE-03-M001P001-000000000000175",
  selloRecibido: "2026…M9UG",
  totales: { totalPagar: 28.25 },
};

const VENTA = {
  tipoDte: "03" as const,
  items: [{ descripcion: "x", cantidad: 1, precioUni: 25 }],
};

Deno.test("la llave viaja en X-Facta-Key y nunca en Authorization", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: SEALED }]);
  await new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch }).issue(VENTA);
  assertEquals(calls[0].headers["X-Facta-Key"], "facta_test_a.bbbbbbbbbbbbbbbb");
  assertEquals(calls[0].headers["Authorization"], undefined);
});

Deno.test("server error text redacts configured secrets and credential fields", async () => {
  const apiKey = "facta_test_a.redact-this-api-key";
  const signKey = "factask_redact-this-sign-key";
  const unlockKey = "factauk_redact-this-unlock-key";
  const { fetch } = fakeFetch([{
    status: 422,
    body: {
      error: {
        code: "validation_failed",
        message: `Rejected ${apiKey}; ${signKey}; ${unlockKey}`,
        details: {
          field: "receptor.nombre",
          authorization: `Bearer ${apiKey}`,
          nested: { refreshToken: "provider-token", explanation: `value ${signKey}` },
          codigoGeneracion: "A1",
        },
      },
    },
  }]);
  const error = await assertRejects(
    () => new Facta({ apiKey, signKey, unlockKey, fetch }).issue(VENTA),
    FactaError,
  );
  assertEquals(error.message.includes(apiKey), false);
  assertEquals(error.message.includes(signKey), false);
  assertEquals(error.message.includes(unlockKey), false);
  assertEquals(error.details, {
    field: "receptor.nombre",
    nested: { explanation: "value [REDACTED]" },
    codigoGeneracion: "A1",
  });
});

Deno.test("network errors do not expose runtime exception text", async () => {
  const secret = "transport-leaked-credential";
  const error = await assertRejects(
    () => new Facta({
      apiKey: "facta_test_a.bbbbbbbbbbbbbbbb",
      maxRetries: 0,
      fetch: (() => Promise.reject(new Error(`fetch failed for ${secret}`))) as typeof globalThis.fetch,
    }).status(),
    FactaError,
  );
  assertEquals(error.code, "network_error");
  assertEquals(error.message.includes(secret), false);
});

Deno.test("caller abort stops the request without retrying or exposing fetch errors", async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    calls++;
    controller.abort();
    if (init?.signal?.aborted) return Promise.reject(new Error("credential-in-runtime-error"));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof globalThis.fetch;
  const error = await assertRejects(
    () => new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch }).issue(VENTA, { signal: controller.signal }),
    DOMException,
  );
  assertEquals(error.name, "AbortError");
  assertEquals(error.message.includes("credential-in-runtime-error"), false);
  assertEquals(calls, 1);
});

Deno.test("a pre-aborted fiscal request never reaches fetch", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const error = await assertRejects(() => new Facta({
    apiKey: "facta_test_a.bbbbbbbbbbbbbbbb",
    fetch: (() => { calls += 1; return Promise.resolve(new Response("{}")); }) as typeof globalThis.fetch,
  }).issue(VENTA, { signal: controller.signal }), DOMException);
  assertEquals(error.name, "AbortError");
  assertEquals(calls, 0);
});

Deno.test("aborting during retry backoff prevents the next attempt", async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetch = (() => {
    calls += 1;
    return Promise.resolve(new Response(JSON.stringify({ error: { code: "idempotency_in_flight", message: "wait" } }), { status: 409 }));
  }) as typeof globalThis.fetch;
  const pending = new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch, maxRetries: 2 })
    .issue(VENTA, { signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  const error = await assertRejects(() => pending, DOMException);
  assertEquals(error.name, "AbortError");
  assertEquals(calls, 1);
});

Deno.test("toda emisión lleva Idempotency-Key aunque no se la pidan", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: SEALED }]);
  await new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch }).issue(VENTA);
  assertEquals(typeof calls[0].headers["Idempotency-Key"], "string");
  assertEquals(calls[0].headers["Idempotency-Key"].length > 8, true);
});

Deno.test("una consulta NO manda Idempotency-Key: no gasta nada", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: { estado: "sellado" } }]);
  await new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch }).getDocumentStatus("A1");
  assertEquals(calls[0].headers["Idempotency-Key"], undefined);
});

Deno.test("el reintento REUSA la misma Idempotency-Key", async () => {
  // Es la propiedad entera de esta cabecera: generar una nueva por intento
  // quemaría un segundo correlativo, que es justo lo que evita.
  const { fetch, calls } = fakeFetch([
    { status: 409, body: { error: { code: "idempotency_in_flight", message: "espera" } } },
    { status: 200, body: SEALED },
  ]);
  const facta = new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch, maxRetries: 2 });
  const dte = await facta.issue(VENTA);
  assertEquals(calls.length, 2);
  assertEquals(calls[0].headers["Idempotency-Key"], calls[1].headers["Idempotency-Key"]);
  assertEquals((dte as { numeroControl: string }).numeroControl, SEALED.numeroControl);
});

Deno.test("una Idempotency-Key propia gana sobre la generada", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: SEALED }]);
  await new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch })
    .issue(VENTA, { idempotencyKey: "ticket-00417" });
  assertEquals(calls[0].headers["Idempotency-Key"], "ticket-00417");
});

Deno.test("un rechazo del MH no se reintenta jamás y nombra el número gastado", async () => {
  const { fetch, calls } = fakeFetch([{
    status: 422,
    body: {
      error: {
        code: "mh_rejected",
        message: "[receptor.nit] NIT CONTRIBUYENTE NO EXISTE",
        details: {
          observaciones: ["algo"],
          codigoGeneracion: "E4311553-DADF-4168-829E-B6B7E50F1D41",
          numeroControl: "DTE-03-M001P001-000000000000177",
        },
      },
    },
  }]);
  const facta = new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch });
  const error = await assertRejects(() => facta.issue(VENTA), FactaError);
  assertEquals(calls.length, 1, "un rechazo reintentado quemaría otro correlativo");
  assertEquals(error.isRejection, true);
  assertEquals(error.spent?.numeroControl, "DTE-03-M001P001-000000000000177");
  assertEquals(error.mhObservations, ["algo"]);
});

Deno.test("un 4xx del cliente no se reintenta", async () => {
  const { fetch, calls } = fakeFetch([{
    status: 422,
    body: { error: { code: "validation_failed", message: "mal", details: { issues: [] } } },
  }]);
  const facta = new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch });
  const error = await assertRejects(() => facta.issue(VENTA), FactaError);
  assertEquals(calls.length, 1);
  assertEquals(error.code, "validation_failed");
  assertEquals(error.isRejection, false);
  assertEquals(error.spent, null);
});

Deno.test("un 202 de contingencia es un resultado, no un error", async () => {
  // El documento está FIRMADO y se le debe a Hacienda. Tratarlo como fallo
  // llevaría al integrador a reintentar y a sign un segundo documento.
  const { fetch } = fakeFetch([{
    status: 202,
    body: { estado: "contingencia", numeroControl: "DTE-03-M001P001-000000000000180" },
  }]);
  const facta = new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch });
  const result = await facta.issue(VENTA);
  assertEquals(result.estado, "contingencia");
});

Deno.test("sign manda el documento tal cual lo devolvió prepare", async () => {
  const documento = { identificacion: { tipoDte: "03" }, resumen: { totalPagar: 45.2 } };
  const { fetch, calls } = fakeFetch([{ status: 200, body: SEALED }]);
  const facta = new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch });
  await facta.sign({
    estado: "preparado",
    codigoGeneracion: "A1",
    numeroControl: "DTE-03-M001P001-000000000000176",
    tipoDte: "03",
    ambiente: "00",
    // deno-lint-ignore no-explicit-any
    totales: {} as any,
    documento,
    prepareToken: "tok",
  });
  const sent = JSON.parse(calls[0].body!);
  assertEquals(sent.prepareToken, "tok");
  assertEquals(sent.documento, documento);
});

Deno.test("una llave vacía falla al construir, antes de gastar una petición", () => {
  let threw = false;
  try {
    new Facta({ apiKey: "" });
  } catch (error) {
    threw = error instanceof FactaError;
  }
  assertEquals(threw, true);
});

// ── El segundo factor (api-publica.md §6) ─────────────────────────────

const SIGN_KEY = `factask_${"A".repeat(43)}`;
const UNLOCK_KEY = `factauk_${"B".repeat(43)}`;

Deno.test("la contraseña de firma viaja SOLO en las rutas que firman", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: SEALED }]);
  const facta = new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", signKey: SIGN_KEY, fetch });

  await facta.issue(VENTA);
  assertEquals(calls[0].headers["X-Facta-Sign-Key"], SIGN_KEY);

  // `prepare` reserva un correlativo y arma el documento: ninguna de las dos
  // cosas abre un vault, así que la contraseña no tiene por qué pasar por ahí
  // — ni por los registros de los proxys que haya en medio.
  await facta.prepare(VENTA);
  assertEquals(calls[1].headers["X-Facta-Sign-Key"], undefined);

  await facta.status();
  assertEquals(calls[2].headers["X-Facta-Sign-Key"], undefined);

  await facta.getDocumentStatus("7875BC7A-9580-441D-94E4-FA455E9D8BD0");
  assertEquals(calls[3].headers["X-Facta-Sign-Key"], undefined);
});

Deno.test("sin contraseña de firma el cliente sigue sirviendo para getDocumentStatus", async () => {
  // §6.2: el token solo reserva y consulta. Un SDK que exigiera la contraseña
  // en el constructor haría imposible el caso «solo lectura», que es el que
  // debería usar la mitad de los integradores.
  const { fetch, calls } = fakeFetch([{ status: 200, body: { ok: true } }]);
  await new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch }).status();
  assertEquals(calls[0].headers["X-Facta-Sign-Key"], undefined);
});

Deno.test("mandar la llave de apertura como contraseña de firma se rechaza al construir", () => {
  // El único error del SDK que no se puede deshacer arreglando el código
  // después: para cuando el servidor lo dijera, la llave que abre los buckets
  // del cliente ya habría viajado.
  let refused = false;
  try {
    new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", signKey: UNLOCK_KEY });
  } catch (cause) {
    refused = cause instanceof FactaError;
  }
  assertEquals(refused, true);
});

Deno.test("las operaciones de consulta construyen las rutas y filtros del contrato", async () => {
  const { fetch, calls } = fakeFetch([
    { status: 200, body: { documentos: [], siguiente: null } },
    { status: 200, body: { documentos: [] } },
    { status: 200, body: { ok: true } },
  ]);
  const facta = new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", signKey: SIGN_KEY, fetch });
  await facta.listDocuments({ estado: "sellado", limit: 10, cursor: "next value" });
  await facta.listHolding(10);
  await facta.getContract();
  assertEquals(calls[0].url.includes("estado=sellado"), true);
  assertEquals(calls[0].url.includes("cursor=next+value"), true);
  assertEquals(calls[1].url, `${factaBase(facta)}/v1/dte/holding?limit=10`);
});

Deno.test("descargar ticket transmite el ancho y no vuelve a issue", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: { bytes: [] } }]);
  const facta = new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch });
  await facta.downloadDocument("ABC-123", "ticket", { paperWidthMm: 58 });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].method, "GET");
  assertEquals(calls[0].url.endsWith("/v1/dte/ABC-123/file?kind=ticket&paperWidthMm=58"), true);
  assertEquals(calls[0].headers["Idempotency-Key"], undefined);
});

Deno.test("ticket width validation happens before any request", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: {} }]);
  const facta = new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch });
  await assertRejects(() => facta.downloadDocument("ABC-123", "ticket", { paperWidthMm: 58.5 }), TypeError);
  await assertRejects(() => facta.downloadDocument("ABC-123", "pdf", { paperWidthMm: 80 }), TypeError);
  assertEquals(calls.length, 0);
});

Deno.test("storage capability, copy status, and repair use additive API routes", async () => {
  const generationCode = "33333333-3333-4333-8333-333333333333";
  const receipt = {
    destination: "managed",
    environment: "00",
    operationId: generationCode,
    json: { state: "stored", sha256: "a".repeat(64), bytes: 82, storedAt: "2026-10-03T12:00:00Z", errorCode: null, retryable: false },
    pdf: { state: "pending", sha256: "b".repeat(64), bytes: 512, storedAt: null, errorCode: "worker_unavailable", retryable: true },
  } as const;
  const status = {
    capabilityVersion: 1,
    managed: {
      configured: true, ready: true, state: "ready", integration: "ready",
      quotaBytes: 1000, usedBytes: 82, reservedBytes: 512, usedBytesTotal: 82,
      reservedBytesTotal: 512, coveredUntil: null, accessUntil: null,
      bucketState: "ready", backupState: "not_required",
    },
    byos: { ready: false }, supportedKinds: ["json", "pdf"], unsupportedKinds: ["ticket", "invalidation"],
  };
  const copies: import("../src/types.ts").ManagedDocumentCopy[] = [{ generationCode, kind: "pdf", environment: "00", state: "pending", bytes: 512, sha256: "b".repeat(64), issuedDate: "2026-10-03", storedAt: null }];
  const { fetch, calls } = fakeFetch([
    { status: 200, body: status },
    { status: 200, body: { capabilityVersion: 1, copies } },
    { status: 200, body: { codigoGeneracion: generationCode, storage: receipt } },
  ]);
  const facta = new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch });
  assertEquals((await facta.getStorageStatus()).managed.ready, true);
  assertEquals(await facta.getDocumentCopies({ generationCode }), copies);
  assertEquals(await facta.retryDocumentStorage(generationCode), receipt);
  assertEquals(calls.map((call) => `${call.method} ${new URL(call.url).pathname.replace("/functions/v1/api-v1", "")}`), [
    "GET /v1/storage/status",
    "GET /v1/storage/copies",
    "POST /v1/storage/copies/33333333-3333-4333-8333-333333333333/repair",
  ]);
  assertEquals(calls[1].url.endsWith(`?generationCode=${generationCode}`), true);
});

Deno.test("older storage routes report unsupported instead of malformed success", async () => {
  const { fetch } = fakeFetch([{
    status: 404,
    body: { error: { code: "not_found", message: "route not found" } },
  }]);
  const facta = new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch });
  const error = await assertRejects(() => facta.getStorageStatus(), FactaError);
  assertEquals(error.code, "storage_unsupported");
});

function factaBase(_client: Facta): string {
  return "https://hcnvknpsbadplnfcflxx.supabase.co/functions/v1/api-v1";
}


Deno.test("versioned client config supplies base URL and ticket width defaults", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: { bytes: [] } }]);
  const facta = new Facta({
    apiKey: "facta_test_a.bbbbbbbbbbbbbbbb",
    fetch,
    config: { version: 1, baseUrl: "https://api.example.test/api-v1", ticketPaperWidthMm: 58 },
  });
  await facta.downloadDocument("ABC-123", "ticket");
  assertEquals(calls[0].url, "https://api.example.test/api-v1/v1/dte/ABC-123/file?kind=ticket&paperWidthMm=58");
  assertThrows(() => new Facta({ apiKey: "key", config: { version: 2 } as never }), TypeError);
});


Deno.test("legacy flat options override matching versioned config values", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: { ok: true } }]);
  const facta = new Facta({
    apiKey: "facta_test_a.bbbbbbbbbbbbbbbb",
    fetch,
    baseUrl: "https://legacy.example.test/api-v1",
    config: { version: 1, baseUrl: "https://profile.example.test/api-v1" },
  });
  await facta.status();
  assertEquals(calls[0].url, "https://legacy.example.test/api-v1/v1/status");
});

Deno.test("flat network options use the same validation as versioned config", () => {
  assertThrows(
    () => new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", baseUrl: "javascript:alert(1)" }),
    TypeError,
  );
  assertThrows(
    () => new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", timeoutMs: 0 }),
    TypeError,
  );
});

Deno.test("query and listing preserve unavailable historical receiver metadata without catalog requests", async () => {
  const document = { ...SEALED, receptor: { nombre: null, numDocumento: null } };
  const { fetch, calls } = fakeFetch([
    { status: 200, body: document },
    { status: 200, body: { documentos: [document, { ...document, receptor: null }], siguiente: null } },
  ]);
  const facta = new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch });
  assertEquals((await facta.getDocumentStatus(document.codigoGeneracion)).receptor, { nombre: null, numDocumento: null });
  const listed = await facta.listDocuments();
  assertEquals(listed.documentos[0].receptor, { nombre: null, numDocumento: null });
  assertEquals(listed.documentos[1].receptor, null);
  assertEquals(calls.length, 2);
  assertEquals(calls.every((call) => call.method === "GET" && !call.url.includes("/vault/")), true);
});

Deno.test("malformed attached receipt preserves fiscal success with a typed storage error and no retry", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: { ...SEALED, storage: { destination: "managed" } } }]);
  const result = await new Facta({ apiKey: "facta_test_a.secret", fetch }).issue(VENTA, { idempotencyKey: "stable-order" });
  assertEquals(result.estado, "sellado");
  assertEquals(result.storage, undefined);
  assertEquals(result.storageErrorCode, "storage_contract_invalid");
  assertEquals(calls.length, 1);
});

Deno.test("copies reject malformed hashes, negative bytes, wrong environment and wrong document", async () => {
  const generationCode = "33333333-3333-4333-8333-333333333333";
  const copy = { generationCode, kind: "json", environment: "00", state: "stored", bytes: 12, sha256: "a".repeat(64), issuedDate: "2026-10-03", storedAt: "2026-10-03T12:00:00Z" };
  for (const override of [{ sha256: "bad" }, { bytes: -1 }, { environment: "01" }, { generationCode: "44444444-4444-4444-8444-444444444444" }, { storedAt: null }]) {
    const { fetch } = fakeFetch([{ status: 200, body: { capabilityVersion: 1, copies: [{ ...copy, ...override }] } }]);
    const error = await assertRejects(() => new Facta({ apiKey: "facta_test_a.secret", fetch }).getDocumentCopies({ generationCode }), FactaError);
    assertEquals(error.code, "storage_contract_invalid");
  }
});

Deno.test("repair rejects contradictory receipts and mismatched environments without issuance", async () => {
  const generationCode = "33333333-3333-4333-8333-333333333333";
  const artifact = { state: "stored", sha256: "a".repeat(64), bytes: 12, storedAt: "2026-10-03T12:00:00Z", errorCode: null, retryable: false };
  const receipt = { operationId: generationCode, environment: "00", destination: "managed", json: artifact, pdf: artifact };
  for (const invalid of [{ ...receipt, destination: "none" }, { ...receipt, environment: "01" }, { ...receipt, json: { ...artifact, sha256: null } }, { ...receipt, pdf: { ...artifact, bytes: -1 } }]) {
    const { fetch, calls } = fakeFetch([{ status: 200, body: { storage: invalid } }]);
    const error = await assertRejects(() => new Facta({ apiKey: "facta_test_a.secret", fetch }).retryDocumentStorage(generationCode), FactaError);
    assertEquals(error.code, "storage_contract_invalid");
    assertEquals(calls.every((call) => call.url.endsWith('/repair')), true);
  }
});

Deno.test("explicit managed downloads demand source proof and never accept holding fallback", async () => {
  for (const source of ["managed", "holding", undefined]) {
    const calls: string[] = [];
    const fetch = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return new Response("%PDF-exact", { headers: { "content-type": "application/pdf", ...(source ? { "x-facta-storage-source": source } : {}) } });
    }) as typeof globalThis.fetch;
    const facta = new Facta({ apiKey: "facta_test_a.secret", fetch });
    if (source === "managed") {
      assertEquals((await facta.downloadDocument("existing", "pdf", { source: "managed" })).storageSource, "managed");
    } else {
      const error = await assertRejects(() => facta.downloadDocument("existing", "pdf", { source: "managed" }), FactaError);
      assertEquals(error.code, source ? "storage_contract_invalid" : "storage_unsupported");
    }
    assertEquals(calls[0].endsWith('?kind=pdf&source=managed'), true);
    const count = calls.length;
    await assertRejects(() => facta.downloadDocument("existing", "ticket", { source: "managed" }), TypeError);
    assertEquals(calls.length, count);
  }
});

Deno.test("downloadDocument json sends raw only when asked and reports the format from the header", async () => {
  const calls: string[] = [];
  const formats = ["archivo-dte", "raw", null];
  const fetch = ((url: string | URL | Request) => {
    calls.push(String(url));
    const format = formats[calls.length - 1];
    return Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json", ...(format ? { "X-Facta-Json-Format": format } : {}) } }));
  }) as unknown as typeof globalThis.fetch;
  const facta = new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch });
  const archivo = await facta.downloadDocument("ABC-123", "json");
  const raw = await facta.downloadDocument("ABC-123", "json", { raw: true });
  const old = await facta.downloadDocument("ABC-123", "json", { raw: true });
  assertEquals(calls[0].endsWith("/v1/dte/ABC-123/file?kind=json"), true);
  assertEquals(calls[1].endsWith("/v1/dte/ABC-123/file?kind=json&raw=true"), true);
  assertEquals(archivo.jsonFormat, "archivo-dte");
  assertEquals(raw.jsonFormat, "raw");
  assertEquals("jsonFormat" in old, false);
});

Deno.test("raw is local-only valid for JSON and not_sealed surfaces as its own error code", async () => {
  const { fetch, calls } = fakeFetch([{ status: 409, body: { error: { code: "not_sealed", message: "sin sello" } } }]);
  const facta = new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch });
  await assertRejects(() => facta.downloadDocument("ABC-123", "pdf", { raw: true }), TypeError);
  await assertRejects(() => facta.downloadDocument("ABC-123", "ticket", { raw: false }), TypeError);
  assertEquals(calls.length, 0);
  const error = await assertRejects(() => facta.downloadDocument("ABC-123", "json")) as FactaError;
  assertEquals(error.code, "not_sealed");
  assertEquals(error.status, 409);
});
