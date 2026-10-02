import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { createSupabaseArtifactDestination } from "../src/supabase-artifact-destination.ts";
import type { ArchiveArtifact } from "../src/archive.ts";

const bytes = new TextEncoder().encode("supabase signed document bytes");

async function sha256(value: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        Uint8Array.from(value).buffer as ArrayBuffer,
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function artifact(): Promise<ArchiveArtifact> {
  return {
    codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
    kind: "pdf",
    filename: "invoice.pdf",
    contentType: "application/pdf",
    bytes,
    sha256: await sha256(bytes),
  };
}

const config = {
  url: "https://project.example.test",
  serviceKey: "service-secret-key",
  bucket: "private-dtes",
  prefix: "tenant-a",
};

Deno.test("Supabase destination uploads privately, creates once, and verifies exact bytes", async () => {
  const remote = new Map<string, Uint8Array>();
  const methods: string[] = [];
  const destination = createSupabaseArtifactDestination({
    id: "supabase-test",
    label: "Supabase Storage",
    config,
    pathForArtifact: () => "invoices/A Buyer/invoice.pdf",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      methods.push(init?.method ?? "GET");
      assertEquals(
        url.pathname,
        "/storage/v1/object/private-dtes/tenant-a/invoices/A%20Buyer/invoice.pdf",
      );
      const headers = new Headers(init?.headers);
      assertEquals(headers.get("apikey"), config.serviceKey);
      assertEquals(headers.get("authorization"), `Bearer ${config.serviceKey}`);
      if (init?.method === "POST") {
        assertEquals(headers.get("x-upsert"), "false");
        const key = url.pathname;
        if (remote.has(key)) {
          return new Response('{"statusCode":"409","error":"Duplicate"}', {
            status: 409,
          });
        }
        remote.set(
          key,
          new Uint8Array(await new Response(init.body).arrayBuffer()),
        );
        return new Response("{}", { status: 200 });
      }
      const value = remote.get(url.pathname);
      return value
        ? new Response(Uint8Array.from(value).buffer as ArrayBuffer)
        : new Response('{"message":"Not found"}', { status: 404 });
    },
  });

  const current = await artifact();
  assertEquals(await destination.write(current), "stored");
  assertEquals(await destination.write(current), "stored");
  assertEquals(methods, ["GET", "POST", "GET", "GET"]);
  assertEquals(remote.size, 1);
});

Deno.test("Supabase duplicate conflict preserves different bytes as unknown", async () => {
  const other = new TextEncoder().encode("another invoice");
  let reads = 0;
  let posts = 0;
  const destination = createSupabaseArtifactDestination({
    id: "supabase-race",
    label: "Supabase race",
    config,
    fetch: async (_input, init) => {
      if (init?.method === "POST") {
        posts += 1;
        return new Response('{"code":"ResourceAlreadyExists"}', {
          status: 409,
        });
      }
      reads += 1;
      return reads === 1
        ? new Response("missing", { status: 404 })
        : new Response(Uint8Array.from(other).buffer as ArrayBuffer);
    },
  });

  assertEquals(await destination.write(await artifact()), "unknown");
  assertEquals(reads, 2);
  assertEquals(posts, 1);
});

Deno.test("Supabase authorization failures are unknown and do not upload", async () => {
  let posts = 0;
  const destination = createSupabaseArtifactDestination({
    id: "supabase-auth",
    label: "Supabase auth failure",
    config,
    fetch: async (_input, init) => {
      if (init?.method === "POST") posts += 1;
      return new Response("denied", { status: 403 });
    },
  });
  assertEquals(await destination.check!(await artifact()), "unknown");
  assertEquals(await destination.write(await artifact()), "unknown");
  assertEquals(posts, 0);
});

Deno.test("Supabase requires HTTPS, a root project URL, and safe prefixes", () => {
  assertThrows(() =>
    createSupabaseArtifactDestination({
      id: "bad-http",
      label: "Bad HTTP",
      config: {
        ...config,
        url: "http://storage.example.test",
        allowInsecureLocalhost: true,
      },
    })
  );
  assertThrows(() =>
    createSupabaseArtifactDestination({
      id: "bad-path",
      label: "Dashboard URL",
      config: { ...config, url: "https://project.example.test/dashboard" },
    })
  );
  assertThrows(() =>
    createSupabaseArtifactDestination({
      id: "bad-prefix",
      label: "Unsafe prefix",
      config: { ...config, prefix: "tenant/../other" },
    })
  );
  const local = createSupabaseArtifactDestination({
    id: "local",
    label: "Local Supabase",
    config: {
      ...config,
      url: "http://127.0.0.1:54321",
      allowInsecureLocalhost: true,
    },
  });
  assertEquals(local.kind, "supabase");
});

Deno.test("Supabase Storage's 400 envelope for missing objects is a definitive miss", async () => {
  const remote = new Map<string, Uint8Array>();
  const destination = createSupabaseArtifactDestination({
    id: "supabase-real-error-shape",
    label: "Supabase missing-object envelope",
    config,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (init?.method === "POST") {
        remote.set(
          url.pathname,
          new Uint8Array(await new Response(init.body).arrayBuffer()),
        );
        return new Response("{}", { status: 200 });
      }
      const value = remote.get(url.pathname);
      return value
        ? new Response(Uint8Array.from(value).buffer as ArrayBuffer)
        : new Response(
          JSON.stringify({
            statusCode: "404",
            error: "not_found",
            message: "Object not found",
            code: "NoSuchKey",
          }),
          { status: 400 },
        );
    },
  });
  assertEquals(await destination.write(await artifact()), "stored");
});
