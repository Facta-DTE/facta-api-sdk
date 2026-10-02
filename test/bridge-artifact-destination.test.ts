import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  createBridgeArtifactDestination,
  type LocalBridgeArtifactConfig,
} from "../src/bridge-artifact-destination.ts";
import type { ArchiveArtifact } from "../src/archive.ts";

const config: LocalBridgeArtifactConfig = {
  port: 9494,
  apiKey: "bridge-secret",
  sessionId: "office-nas",
};

async function makeArtifact(text = "bridge invoice bytes"): Promise<ArchiveArtifact> {
  const bytes = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return {
    codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
    kind: "pdf",
    filename: "invoice.pdf",
    contentType: "application/pdf",
    bytes,
    sha256: Array.from(digest, (value) => value.toString(16).padStart(2, "0"))
      .join(""),
  };
}

Deno.test("bridge destination writes exact bytes to loopback and uses content-addressed paths", async () => {
  const remote = new Map<string, Uint8Array>();
  const requests: Array<{ url: string; auth: string | null; body: Record<string, unknown> }> = [];
  let writes = 0;
  const destination = createBridgeArtifactDestination({
    id: "bridge-office-nas",
    label: "Office NAS",
    config,
    fetch: async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const headers = new Headers(init?.headers);
      requests.push({ url, auth: headers.get("authorization"), body });
      const path = String(body.path);
      if (body.op === "put") {
        writes += 1;
        remote.set(path, decodeBase64(String(body.body)));
        return Response.json({ ok: true });
      }
      const bytes = remote.get(path);
      return bytes
        ? Response.json({ ok: true, data: encodeBase64(bytes) })
        : Response.json({ ok: false, code: "not_found", error: "missing" }, { status: 404 });
    },
  });
  const artifact = await makeArtifact();

  assertEquals(await destination.write(artifact), "stored");
  assertEquals(await destination.write(artifact), "stored");
  assertEquals(writes, 1);
  assertEquals(remote.size, 1);
  assertEquals(new TextDecoder().decode([...remote.values()][0]), "bridge invoice bytes");
  assertEquals(requests.every((request) => request.url === "http://127.0.0.1:9494/v1/storage"), true);
  assertEquals(requests.every((request) => request.auth === "Bearer bridge-secret"), true);
  assertEquals(String(requests.find((request) => request.body.op === "put")?.body.path).includes(artifact.sha256), true);
});

Deno.test("bridge destination keeps different artifact revisions at distinct immutable paths", async () => {
  const remote = new Map<string, Uint8Array>();
  const destination = createBridgeArtifactDestination({
    id: "bridge-revisions",
    label: "Bridge revisions",
    config,
    pathForArtifact: () => "invoices/same-document/pdf",
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const path = String(body.path);
      if (body.op === "put") {
        remote.set(path, decodeBase64(String(body.body)));
        return Response.json({ ok: true });
      }
      const bytes = remote.get(path);
      return bytes
        ? Response.json({ ok: true, data: encodeBase64(bytes) })
        : Response.json({ code: "not_found", error: "missing" }, { status: 404 });
    },
  });

  assertEquals(await destination.write(await makeArtifact("revision one")), "stored");
  assertEquals(await destination.write(await makeArtifact("revision two")), "stored");
  assertEquals(remote.size, 2);
  assertEquals([...remote.keys()].every((path) => path.includes("sha256-")), true);
});

Deno.test("bridge access failures are ambiguous, while bridge not-found is definitive", async () => {
  let response: Response = Response.json({ code: "not_found", error: "missing" }, { status: 404 });
  const destination = createBridgeArtifactDestination({
    id: "bridge-errors",
    label: "Bridge errors",
    config,
    fetch: async () => response,
  });
  const artifact = await makeArtifact();
  assertEquals(await destination.check!(artifact), "missing");
  response = Response.json({ code: "unauthorized", error: "secret detail" }, { status: 401 });
  assertEquals(await destination.check!(artifact), "unknown");
});

Deno.test("bridge destination validates loopback port and stable relative object paths", async () => {
  await assertRejects(async () => createBridgeArtifactDestination({
    id: "bad-port",
    label: "Bad port",
    config: { ...config, port: 70000 },
  }), TypeError);
  const destination = createBridgeArtifactDestination({
    id: "bad-path",
    label: "Bad path",
    config,
    pathForArtifact: () => "../outside",
    fetch: () => Promise.reject(new Error("should not connect")),
  });
  await assertRejects(async () => await destination.check!(await makeArtifact()));
});

Deno.test("bridge destination bounds timeout configuration", async () => {
  for (const timeoutMs of [0, -1, 300_001, 1.5]) {
    await assertRejects(async () => createBridgeArtifactDestination({
      id: "bridge-timeout",
      label: "Bridge timeout",
      config,
      timeoutMs,
    }), TypeError);
  }

});

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
