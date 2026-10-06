import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1";
import { createS3ArtifactDestination } from "../src/s3-artifact-destination.ts";
import { signS3Request } from "../src/s3-artifact-destination.ts";
import type { ArchiveArtifact } from "../src/archive.ts";

const bytes = new TextEncoder().encode("signed DTE bytes");

async function sha256(value: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        value.slice().buffer as ArrayBuffer,
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function artifact(): Promise<ArchiveArtifact> {
  return {
    codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
    kind: "json",
    filename: "invoice.json",
    contentType: "application/json",
    bytes,
    sha256: await sha256(bytes),
  };
}

const config = {
  bucket: "private-dtes",
  region: "auto",
  accessKeyId: "facta-test-key",
  secretAccessKey: "facta-test-secret-key-123456",
  endpoint: "http://127.0.0.1:9100",
  allowInsecureEndpoint: true,
  prefix: "tenant-a",
} as const;

Deno.test("SigV4 signer matches AWS's published GET Object vector", async () => {
  const headers = await signS3Request({
    method: "GET",
    path: "/test.txt",
    host: "examplebucket.s3.amazonaws.com",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    body: new Uint8Array(),
    extraHeaders: { range: "bytes=0-9" },
    now: new Date("2013-05-24T00:00:00Z"),
  });

  assertEquals(
    headers["x-amz-content-sha256"],
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assertEquals(
    headers.Authorization,
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
      "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
      "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  );
});

Deno.test("S3 artifact destination signs requests and conditionally writes then verifies bytes", async () => {
  const remote = new Map<string, Uint8Array>();
  const methods: string[] = [];
  const destination = createS3ArtifactDestination({
    id: "s3-test",
    label: "Local S3",
    config,
    clock: false, // this test counts every request
    fetch: async (input, init) => {
      const url = new URL(String(input));
      methods.push(init?.method ?? "GET");
      const headers = new Headers(init?.headers);
      assertStringIncludes(
        headers.get("authorization") ?? "",
        "AWS4-HMAC-SHA256",
      );
      const key = decodeURIComponent(
        url.pathname.split("/").slice(2).join("/"),
      );
      if (init?.method === "PUT") {
        assertEquals(headers.get("if-none-match"), "*");
        if (remote.has(key)) return new Response("exists", { status: 412 });
        remote.set(
          key,
          new Uint8Array(await new Response(init.body).arrayBuffer()),
        );
        return new Response(null, { status: 200 });
      }
      const value = remote.get(key);
      return value
        ? new Response(Uint8Array.from(value).buffer as ArrayBuffer)
        : new Response("missing", { status: 404 });
    },
  });

  const current = await artifact();
  assertEquals(await destination.write(current), "stored");
  assertEquals(await destination.write(current), "stored");
  assertEquals(methods, ["GET", "PUT", "GET", "GET"]);
  assertEquals(remote.size, 1);
});

Deno.test("S3 conditional conflict never overwrites a different remote artifact", async () => {
  const other = new TextEncoder().encode("other DTE bytes");
  let reads = 0;
  let puts = 0;
  const destination = createS3ArtifactDestination({
    id: "s3-race",
    label: "Racing S3",
    config,
    clock: false,
    fetch: async (_input, init) => {
      if (init?.method === "PUT") {
        puts += 1;
        return new Response("precondition failed", { status: 412 });
      }
      reads += 1;
      return reads === 1
        ? new Response("missing", { status: 404 })
        : new Response(Uint8Array.from(other).buffer as ArrayBuffer);
    },
  });

  assertEquals(await destination.write(await artifact()), "unknown");
  assertEquals(puts, 1);
  assertEquals(reads, 2);
});

Deno.test("S3 destination rejects insecure non-local endpoints before requests", async () => {
  assertThrows(() =>
    createS3ArtifactDestination({
      id: "s3-insecure",
      label: "Insecure",
      config: {
        ...config,
        endpoint: "http://storage.example.com",
        allowInsecureEndpoint: true,
      },
    })
  );
});

// ---- reference clock (batch K) ------------------------------------------

const wrongYear = new Date("2031-02-03T04:05:06.000Z"); // what a broken device says
const rightTime = new Date("2026-10-05T14:34:56.000Z");

Deno.test("S3 SigV4 date comes from the corrected clock, not the device", async () => {
  const seen: string[] = [];
  const realNow = Date.now;
  Date.now = () => wrongYear.getTime();
  try {
    const destination = createS3ArtifactDestination({
      id: "s3-clock",
      label: "Clocked S3",
      config,
      clock: { now: () => rightTime },
      fetch: async (_input, init) => {
        seen.push(new Headers(init?.headers).get("x-amz-date") ?? "");
        return new Response("missing", { status: init?.method === "PUT" ? 200 : 404 });
      },
    });
    await destination.write(await artifact());
  } finally {
    Date.now = realNow;
  }
  assertEquals(seen.length > 0, true);
  for (const stamp of seen) assertEquals(stamp, "20261005T143456Z");
});

Deno.test("S3 calibrates lazily on first use, and not at construction", async () => {
  let ensures = 0;
  const destination = createS3ArtifactDestination({
    id: "s3-lazy",
    label: "Lazy",
    config,
    clock: { now: () => rightTime, ensure: async () => { ensures += 1; } },
    fetch: async () => new Response("missing", { status: 404 }),
  });
  assertEquals(ensures, 0);
  await destination.write(await artifact()).catch(() => undefined);
  assertEquals(ensures > 0, true);
});

Deno.test("S3 RequestTimeTooSkewed recalibrates once and retries once", async () => {
  const stamps: string[] = [];
  let calibrations = 0;
  let now = new Date("2031-02-03T04:05:06.000Z");
  const destination = createS3ArtifactDestination({
    id: "s3-skew",
    label: "Skewed",
    config,
    clock: {
      now: () => now,
      calibrate: async () => {
        calibrations += 1;
        now = rightTime;
      },
    },
    fetch: async (_input, init) => {
      const stamp = new Headers(init?.headers).get("x-amz-date") ?? "";
      stamps.push(stamp);
      if (stamp.startsWith("2031")) {
        return new Response(
          "<Error><Code>RequestTimeTooSkewed</Code></Error>",
          { status: 403 },
        );
      }
      return new Response("missing", { status: 404 });
    },
  });
  const outcome = await destination.write(await artifact()).catch((e) => e);
  assertEquals(calibrations, 1);
  assertEquals(stamps[0], "20310203T040506Z");
  assertEquals(stamps[1], "20261005T143456Z");
  assertEquals(outcome instanceof Error || typeof outcome === "string", true);
});

Deno.test("S3 retries a skew refusal at most once", async () => {
  let calls = 0;
  let calibrations = 0;
  const destination = createS3ArtifactDestination({
    id: "s3-skew-twice",
    label: "Still skewed",
    config,
    clock: { now: () => wrongYear, calibrate: async () => { calibrations += 1; } },
    fetch: async () => {
      calls += 1;
      return new Response("<Code>RequestTimeTooSkewed</Code>", { status: 403 });
    },
  });
  await destination.write(await artifact()).catch(() => undefined);
  assertEquals(calibrations, 1);
  assertEquals(calls, 2); // one attempt + one retry, for the first request only
});

Deno.test("S3 does not retry other 403 answers", async () => {
  let calibrations = 0;
  let calls = 0;
  const destination = createS3ArtifactDestination({
    id: "s3-denied",
    label: "Denied",
    config,
    clock: { now: () => rightTime, calibrate: async () => { calibrations += 1; } },
    fetch: async () => {
      calls += 1;
      return new Response("<Code>AccessDenied</Code>", { status: 403 });
    },
  });
  await destination.write(await artifact()).catch(() => undefined);
  assertEquals(calibrations, 0);
  assertEquals(calls, 1);
});

Deno.test("S3 default clock calibrates against the public Worker through clockFetch", async () => {
  const clockUrls: string[] = [];
  const stamps: string[] = [];
  const destination = createS3ArtifactDestination({
    id: "s3-default-clock",
    label: "Default clock",
    config,
    clockFetch: async (input) => {
      const url = new URL(String(input));
      clockUrls.push(url.origin + url.pathname);
      const t0 = Number(url.searchParams.get("t0"));
      // the device is exactly one hour behind the Worker
      const t1 = t0 + 3_600_000;
      return Response.json({
        v: 1, id: url.searchParams.get("id"), t0, t1, t2: t1, precisionMs: 1,
        nextSyncAfterMs: 21_600_000, colo: "SJO",
      });
    },
    fetch: async (_input, init) => {
      stamps.push(new Headers(init?.headers).get("x-amz-date") ?? "");
      return new Response("missing", { status: 404 });
    },
  });
  const before = Date.now();
  await destination.write(await artifact()).catch(() => undefined);
  assertEquals(clockUrls[0], "https://clock.factadte.com/");
  const signed = Date.parse(
    stamps[0]!.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"),
  );
  // about one hour ahead of the device clock
  assertEquals(Math.abs(signed - (before + 3_600_000)) < 10_000, true);
});

Deno.test("S3 clock: false signs with the device clock and never calls the Worker", async () => {
  let clockCalls = 0;
  const destination = createS3ArtifactDestination({
    id: "s3-off",
    label: "Off",
    config,
    clock: false,
    clockFetch: async () => {
      clockCalls += 1;
      return new Response("no", { status: 500 });
    },
    fetch: async () => new Response("missing", { status: 404 }),
  });
  await destination.write(await artifact()).catch(() => undefined);
  assertEquals(clockCalls, 0);
});
