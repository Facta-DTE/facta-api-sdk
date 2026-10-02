import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createOneDriveArtifactDestination } from "../src/onedrive-artifact-destination.ts";
import type { ArchiveArtifact } from "../src/archive.ts";

const bytes = new TextEncoder().encode("OneDrive exact invoice bytes");

async function makeArtifact(): Promise<ArchiveArtifact> {
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

Deno.test("OneDrive destination uses app-folder scope, create-only upload, and verifies bytes", async () => {
  let stored: Uint8Array | undefined;
  let folderCount = 0;
  const requests: Array<{ url: string; method: string; headers: Headers }> = [];
  const destination = createOneDriveArtifactDestination({
    id: "onedrive-test",
    label: "OneDrive",
    accessToken: "test-access-token",
    prefix: "facta-private",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      requests.push({ url: url.toString(), method, headers });
      if (url.hostname === "upload.example.test") {
        assertEquals(method, "PUT");
        assertEquals(headers.get("authorization"), null);
        assertEquals(headers.get("content-range"), `bytes 0-${bytes.length - 1}/${bytes.length}`);
        stored = new Uint8Array(await new Response(init?.body).arrayBuffer());
        return new Response(null, { status: 201 });
      }
      if (method === "POST" && url.pathname.endsWith("/children")) {
        const expectedPath = folderCount === 0
          ? "/v1.0/me/drive/special/approot/children"
          : `/v1.0/me/drive/items/folder-${folderCount}/children`;
        assertEquals(url.pathname, expectedPath);
        folderCount += 1;
        return new Response(JSON.stringify({ id: `folder-${folderCount}` }), { status: 201 });
      }
      if (url.pathname.endsWith("/pdf:/createUploadSession")) {
        const requestBody = JSON.parse(String(init?.body));
        assertEquals(requestBody.item["@microsoft.graph.conflictBehavior"], "fail");
        return Response.json({ uploadUrl: "https://upload.example.test/session-secret" });
      }
      if (url.pathname.endsWith("/pdf:/content")) {
        return stored
          ? new Response(Uint8Array.from(stored).buffer as ArrayBuffer)
          : new Response("missing", { status: 404 });
      }
      throw new Error(`Unexpected mocked Graph request ${method} ${url.pathname}`);
    },
  });

  const artifact = await makeArtifact();
  assertEquals(await destination.write(artifact), "stored");
  assertEquals(await destination.write(artifact), "stored");
  assertEquals(new TextDecoder().decode(stored), "OneDrive exact invoice bytes");
  assertEquals(requests.some(({ headers }) => headers.get("authorization") === "Bearer test-access-token"), true);
  assertEquals(requests.filter(({ url }) => url.includes("upload.example.test")).length, 1);
});

Deno.test("OneDrive retries Graph authorization once with caller-refreshed token", async () => {
  let refreshed = 0;
  let requests = 0;
  const destination = createOneDriveArtifactDestination({
    id: "onedrive-refresh",
    label: "OneDrive refresh",
    accessToken: "expired",
    refreshAccessToken: async () => {
      refreshed += 1;
      return "fresh-token";
    },
    fetch: async (_input, init) => {
      requests += 1;
      const auth = new Headers(init?.headers).get("authorization");
      if (auth === "Bearer expired") return new Response("unauthorized", { status: 401 });
      return new Response("missing", { status: 404 });
    },
  });
  const result = await destination.check!(await makeArtifact());
  assertEquals(result, "missing");
  assertEquals(refreshed, 1);
  assertEquals(requests, 2);
});

Deno.test("OneDrive sends large artifacts in aligned sequential chunks", async () => {
  const largeBytes = new Uint8Array(10 * 1024 * 1024 + 1);
  largeBytes[0] = 1;
  largeBytes[largeBytes.length - 1] = 2;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", largeBytes));
  const largeArtifact: ArchiveArtifact = {
    ...(await makeArtifact()),
    bytes: largeBytes,
    sha256: Array.from(digest, (value) => value.toString(16).padStart(2, "0"))
      .join(""),
  };
  const ranges: string[] = [];
  let stored: Uint8Array | undefined;
  let folderCount = 0;
  const destination = createOneDriveArtifactDestination({
    id: "onedrive-large",
    label: "OneDrive large file",
    accessToken: "token",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "upload.example.test") {
        ranges.push(new Headers(init?.headers).get("content-range")!);
        const chunk = new Uint8Array(await new Response(init?.body).arrayBuffer());
        const current = stored ?? new Uint8Array();
        const combined = new Uint8Array(current.length + chunk.length);
        combined.set(current);
        combined.set(chunk, current.length);
        stored = combined;
        return new Response(null, { status: ranges.length === 1 ? 202 : 201 });
      }
      if (init?.method === "POST" && url.pathname.endsWith("/children")) {
        assertEquals(url.pathname, folderCount === 0
          ? "/v1.0/me/drive/special/approot/children"
          : `/v1.0/me/drive/items/folder-${folderCount}/children`);
        folderCount += 1;
        return Response.json({ id: `folder-${folderCount}` }, { status: 201 });
      }
      if (url.pathname.endsWith("/pdf:/createUploadSession")) {
        return Response.json({ uploadUrl: "https://upload.example.test/session" });
      }
      if (url.pathname.endsWith("/pdf:/content")) {
        return stored
          ? new Response(Uint8Array.from(stored).buffer as ArrayBuffer)
          : new Response("missing", { status: 404 });
      }
      throw new Error(`Unexpected mocked Graph request ${init?.method} ${url.pathname}`);
    },
  });

  assertEquals(await destination.write(largeArtifact), "stored");
  assertEquals(ranges, [
    `bytes 0-${10 * 1024 * 1024 - 1}/${largeBytes.length}`,
    `bytes ${10 * 1024 * 1024}-${largeBytes.length - 1}/${largeBytes.length}`,
  ]);
  assertEquals(stored?.length, largeBytes.length);
});

Deno.test("OneDrive rejects unsafe paths before requesting the provider", async () => {
  const destination = createOneDriveArtifactDestination({
    id: "onedrive-path",
    label: "OneDrive path",
    accessToken: "token",
    pathForArtifact: () => "../outside.pdf",
    fetch: () => Promise.reject(new Error("should not fetch")),
  });
  await assertRejects(async () => await destination.check!(await makeArtifact()));
});
