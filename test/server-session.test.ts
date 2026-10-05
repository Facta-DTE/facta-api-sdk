import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  createFactaSession,
  FactaSessionError,
  verifyFactaSession,
} from "../server.ts";

const SECRET = "s".repeat(40);
const REQUEST = {
  tipoDte: "01" as const,
  items: [{ descripcion: "Plan", cantidad: 1, precioUni: 10 }],
};
const INPUT = { request: REQUEST, idempotencyKey: "order-1" };

Deno.test("a session round-trips with its payload", async () => {
  const token = await createFactaSession({
    ...INPUT,
    download: false,
    display: { total: 11.3, reference: "Pedido 1", title: "Plan anual" },
  }, SECRET, 1_000_000);
  const s = await verifyFactaSession(token, SECRET, 1_000_000);
  assertEquals(s.idempotencyKey, "order-1");
  assertEquals(s.download, false);
  assertEquals(s.display, { total: 11.3, reference: "Pedido 1", title: "Plan anual" });
  assertEquals(s.exp, 1_000 + 900);
  assertEquals(s.request, REQUEST);
});

Deno.test("each session carries a fresh nonce", async () => {
  const a = await verifyFactaSession(await createFactaSession(INPUT, SECRET), SECRET);
  const b = await verifyFactaSession(await createFactaSession(INPUT, SECRET), SECRET);
  assertEquals(a.nonce === b.nonce, false);
});

Deno.test("a tampered payload or MAC is session_invalid", async () => {
  const token = await createFactaSession(INPUT, SECRET);
  const [body, mac] = token.split(".");
  const forgedBody = btoa(JSON.stringify({ ...JSON.parse(atob(body)), idempotencyKey: "other" }))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const flipped = mac.slice(0, -2) + (mac.endsWith("AA") ? "BB" : "AA");
  for (const bad of [`${forgedBody}.${mac}`, `${body}.${flipped}`, body, `${body}.`, "", "a.b.c"]) {
    const error = await assertRejects(() => verifyFactaSession(bad, SECRET), FactaSessionError);
    assertEquals(error.code, "session_invalid");
  }
  await assertRejects(() => verifyFactaSession(undefined, SECRET), FactaSessionError);
});

Deno.test("a different secret does not verify", async () => {
  const token = await createFactaSession(INPUT, SECRET);
  const error = await assertRejects(() => verifyFactaSession(token, "t".repeat(40)), FactaSessionError);
  assertEquals(error.code, "session_invalid");
});

Deno.test("an expired session is session_expired", async () => {
  const token = await createFactaSession({ ...INPUT, expiresIn: 60 }, SECRET, 0);
  await verifyFactaSession(token, SECRET, 59_000);
  const error = await assertRejects(() => verifyFactaSession(token, SECRET, 60_000), FactaSessionError);
  assertEquals(error.code, "session_expired");
});

Deno.test("a secret under 32 bytes throws", async () => {
  await assertRejects(() => createFactaSession(INPUT, "short"), TypeError, "32 bytes");
  await assertRejects(() => verifyFactaSession("a.b", new Uint8Array(31)), TypeError);
});

Deno.test("invalid session input is refused", async () => {
  const bad: Array<Record<string, unknown>> = [
    { idempotencyKey: "" },
    { expiresIn: 0 },
    { expiresIn: 999_999 },
    { display: { title: "t".repeat(200) } },
    { request: { items: [] } },
    { display: { total: -1 } },
  ];
  for (const patch of bad) {
    await assertRejects(() => createFactaSession({ ...INPUT, ...patch } as never, SECRET), TypeError);
  }
});
