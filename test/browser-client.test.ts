import { assertEquals, assertInstanceOf, assertRejects } from "jsr:@std/assert@1";
import { createFactaClient, FactaClientError } from "../src/browser/client.ts";

interface Seen {
  url: string;
  method?: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function fakeFetch(respond: (seen: Seen) => Response | Promise<Response>, log: Seen[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const seen: Seen = {
      url: String(input),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    };
    log.push(seen);
    return await respond(seen);
  }) as typeof fetch;
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

Deno.test("client: POSTs JSON with the x-facta-ui header and the action", async () => {
  const log: Seen[] = [];
  const client = createFactaClient({
    endpoint: "/api/facta",
    fetch: fakeFetch(() => json({ draft: { tipoDte: "01", items: [] } }), log),
    headers: { "x-csrf": "abc" },
  });
  await client.describe("tok");
  assertEquals(log[0]!.url, "/api/facta");
  assertEquals(log[0]!.method, "POST");
  assertEquals(log[0]!.headers.get("x-facta-ui"), "1");
  assertEquals(log[0]!.headers.get("content-type"), "application/json");
  assertEquals(log[0]!.headers.get("x-csrf"), "abc");
  assertEquals(log[0]!.body, { action: "session.describe", session: "tok" });
});

Deno.test("client: headers can be computed per call", async () => {
  const log: Seen[] = [];
  let n = 0;
  const client = createFactaClient({
    endpoint: "/x",
    fetch: fakeFetch(() => json({ result: { estado: "sellado" } }), log),
    headers: () => ({ "x-n": String(++n) }),
  });
  await client.issue("t");
  await client.issue("t");
  assertEquals(log.map((l) => l.headers.get("x-n")), ["1", "2"]);
});

Deno.test("client: issue and status speak the simplified bodies", async () => {
  const log: Seen[] = [];
  const client = createFactaClient({
    endpoint: "/x",
    fetch: fakeFetch((seen) =>
      seen.body.action === "status"
        ? json({ status: { estado: "sellado" } })
        : json({ result: { estado: "sellado", codigoGeneracion: "CG" } }), log),
  });
  const result = await client.issue("t");
  assertEquals(result.codigoGeneracion, "CG");
  const status = await client.status("t", "CG");
  assertEquals(status.estado, "sellado");
  assertEquals(log[0]!.body, { action: "issue", session: "t" });
  assertEquals(log[1]!.body, { action: "status", session: "t", codigoGeneracion: "CG" });
});

Deno.test("client: an error envelope becomes a FactaClientError, not a transport error", async () => {
  const client = createFactaClient({
    endpoint: "/x",
    fetch: fakeFetch(() =>
      json({
        error: {
          code: "mh_rejected",
          message: "rechazado",
          retryable: false,
          spent: { codigoGeneracion: "CG", numeroControl: "NC" },
          observaciones: ["[identificacion.codigoGeneracion] YA EXISTE"],
          fields: [{ path: "receptor.nrc", message: "no cumple el formato" }, { nope: 1 }],
        },
      }, 422)
    ),
  });
  const error = await assertRejects(() => client.issue("t"), FactaClientError);
  assertEquals(error.code, "mh_rejected");
  assertEquals(error.status, 422);
  assertEquals(error.transport, false);
  assertEquals(error.wasSpent, true);
  assertEquals(error.observaciones, ["[identificacion.codigoGeneracion] YA EXISTE"]);
  assertEquals(error.fields, [{ path: "receptor.nrc", message: "no cumple el formato" }]);
});

Deno.test("client: no connection, a non-JSON body and a bare 502 are transport errors", async () => {
  const offline = createFactaClient({
    endpoint: "/x",
    fetch: (() => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch,
  });
  const a = await assertRejects(() => offline.issue("t"), FactaClientError);
  assertEquals([a.transport, a.code, a.retryable], [true, "network_error", true]);

  const html = createFactaClient({
    endpoint: "/x",
    fetch: fakeFetch(() => new Response("<html>Bad gateway</html>", { status: 502 })),
  });
  const b = await assertRejects(() => html.issue("t"), FactaClientError);
  assertEquals([b.transport, b.status], [true, 502]);

  const empty = createFactaClient({ endpoint: "/x", fetch: fakeFetch(() => json({}, 500)) });
  const c = await assertRejects(() => empty.issue("t"), FactaClientError);
  assertInstanceOf(c, FactaClientError);
  assertEquals(c.transport, true);
});

Deno.test("client: a timeout aborts the request and counts as uncertain", async () => {
  const client = createFactaClient({
    endpoint: "/x",
    timeoutMs: 10,
    fetch: ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch,
  });
  const error = await assertRejects(() => client.issue("t"), FactaClientError);
  assertEquals(error.transport, true);
});
