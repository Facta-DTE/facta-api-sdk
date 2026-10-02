import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  createGoogleDriveArtifactDestination,
} from "../src/gdrive-artifact-destination.ts";
import type { ArchiveArtifact } from "../src/archive.ts";

const artifactBytes = new TextEncoder().encode("Google Drive exact invoice bytes");
const artifactPath = "folder/sub/invoice.pdf";

async function makeArtifact(): Promise<ArchiveArtifact> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", artifactBytes));
  return {
    codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
    kind: "pdf",
    filename: "invoice.pdf",
    contentType: "application/pdf",
    bytes: artifactBytes,
    sha256: Array.from(digest, (value) => value.toString(16).padStart(2, "0"))
      .join(""),
  };
}

interface RemoteFile {
  id: string;
  bytes: Uint8Array;
  appProperties: Record<string, string>;
}

function destination(
  files: Map<string, RemoteFile>,
  opts: { accessToken?: string; refreshAccessToken?: () => Promise<string> } = {},
) {
  const folders = new Map<string, string>();
  return createGoogleDriveArtifactDestination({
    id: "gdrive-test",
    label: "Google Drive",
    config: {
      folderId: "root-folder",
      accessToken: opts.accessToken ?? "drive-access-token",
    },
    ...(opts.refreshAccessToken ? { refreshAccessToken: opts.refreshAccessToken } : {}),
    pathForArtifact: () => artifactPath,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      if (url.hostname === "www.googleapis.com" && method === "GET" && url.pathname.endsWith("/files")) {
        if (headers.get("authorization") !== "Bearer drive-access-token" && headers.get("authorization") !== "Bearer refreshed-token") {
          return new Response("denied", { status: 401 });
        }
        const query = url.searchParams.get("q") ?? "";
        if (query.includes("appProperties has")) {
          const match = query.match(/value='([0-9a-f]+)'/);
          const key = match?.[1];
          const matched = [...files.values()].filter((file) => file.appProperties.factaArtifactPath === key);
          return Response.json({ files: matched.map(({ id, appProperties }) => ({ id, appProperties })) });
        }
        const folderMatch = query.match(/name = '((?:\\.|[^'])*)' and '([^']+)' in parents/);
        if (folderMatch) {
          const name = folderMatch[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
          const id = folders.get(`${folderMatch[2]}\0${name}`);
          return Response.json({ files: id ? [{ id, name, mimeType: "application/vnd.google-apps.folder" }] : [] });
        }
        throw new Error(`Unexpected Google Drive query: ${query}`);
      }
      if (url.hostname === "www.googleapis.com" && method === "POST" && url.pathname.endsWith("/upload/drive/v3/files")) {
        const body = new Uint8Array(await new Response(init?.body).arrayBuffer());
        assertEquals(containsBytes(body, artifactBytes), true);
        const text = new TextDecoder().decode(body.slice(0, 1000));
        const match = text.match(/\r\n\r\n(\{.*?\})\r\n--/s);
        if (!match) throw new Error("Multipart metadata missing");
        const metadata = JSON.parse(match[1]) as { appProperties: Record<string, string> };
        const id = `file-${files.size + 1}`;
        files.set(id, { id, bytes: artifactBytes.slice(), appProperties: metadata.appProperties });
        return Response.json({ id }, { status: 200 });
      }
      if (url.hostname === "www.googleapis.com" && method === "POST" && url.pathname.endsWith("/files")) {
        const body = JSON.parse(String(init?.body)) as { name: string; parents: string[]; mimeType: string };
        const id = `folder-${folders.size + 1}`;
        folders.set(`${body.parents[0]}\0${body.name}`, id);
        return Response.json({ id }, { status: 200 });
      }
      if (url.hostname === "www.googleapis.com" && method === "GET" && url.searchParams.get("alt") === "media") {
        const file = files.get(url.pathname.split("/").at(-1)!);
        return file ? new Response(Uint8Array.from(file.bytes).buffer as ArrayBuffer) : new Response("missing", { status: 404 });
      }
      throw new Error(`Unexpected mocked Google Drive request ${method} ${url.pathname}`);
    },
  });
}

Deno.test("Google Drive destination writes into the selected folder and verifies private app metadata", async () => {
  const files = new Map<string, RemoteFile>();
  const remote = destination(files);
  const artifact = await makeArtifact();

  assertEquals(await remote.write(artifact), "stored");
  assertEquals(await remote.write(artifact), "stored");
  assertEquals(files.size, 1);
  assertEquals(new TextDecoder().decode([...files.values()][0].bytes), "Google Drive exact invoice bytes");
  assertEquals([...files.values()][0].appProperties.factaArtifactPath.length, 64);
});

Deno.test("Google Drive treats divergent concurrent copies as unknown without replacing either", async () => {
  const pathKey = await googleArtifactPathKey();
  const files = new Map<string, RemoteFile>([
    ["one", { id: "one", bytes: artifactBytes.slice(), appProperties: { factaArtifactPath: pathKey } }],
    ["two", { id: "two", bytes: new TextEncoder().encode("different bytes"), appProperties: { factaArtifactPath: pathKey } }],
  ]);
  const remote = destination(files);
  assertEquals(await remote.check!(await makeArtifact()), "unknown");
  assertEquals(await remote.write(await makeArtifact()), "unknown");
  assertEquals(files.size, 2);
});

Deno.test("Google Drive serializes same-path uploads through one destination instance", async () => {
  const files = new Map<string, RemoteFile>();
  const remote = destination(files);
  const artifact = await makeArtifact();
  const outcomes = await Promise.all([
    remote.write(artifact),
    remote.write(artifact),
  ]);
  assertEquals(outcomes, ["stored", "stored"]);
  assertEquals(files.size, 1);
});

async function googleArtifactPathKey(): Promise<string> {
  const input = new TextEncoder().encode(`root-folder\0${artifactPath}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.test("Google Drive refresh callback runs once after authorization expiry", async () => {
  let refreshes = 0;
  const files = new Map<string, RemoteFile>();
  const remote = createGoogleDriveArtifactDestination({
    id: "gdrive-refresh",
    label: "Drive refresh",
    config: { folderId: "root", accessToken: "expired" },
    refreshAccessToken: async () => {
      refreshes += 1;
      return "refreshed-token";
    },
    pathForArtifact: () => artifactPath,
    fetch: async (_input, init) => {
      const auth = new Headers(init?.headers).get("authorization");
      if (auth === "Bearer expired") return new Response("expired", { status: 401 });
      return Response.json({ files: [] });
    },
  });
  assertEquals(await remote.check!(await makeArtifact()), "missing");
  assertEquals(refreshes, 1);
  assertEquals(files.size, 0);
});

Deno.test("Google Drive rejects unsafe artifact paths before a provider call", async () => {
  let calls = 0;
  const remote = createGoogleDriveArtifactDestination({
    id: "gdrive-path",
    label: "Drive path",
    config: { folderId: "root", accessToken: "token" },
    pathForArtifact: () => "../outside.pdf",
    fetch: async () => {
      calls += 1;
      return new Response("unexpected", { status: 500 });
    },
  });
  await assertRejects(async () => await remote.check!(await makeArtifact()), TypeError);
  assertEquals(calls, 0);
});

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[start + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}
