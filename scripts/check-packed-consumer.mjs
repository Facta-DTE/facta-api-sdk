import { execFileSync, spawn } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "facta-api-consumer-"));
const packageFile = resolve(root, "package.json");
const packageInfo = JSON.parse(readFileSync(packageFile, "utf8"));
const tsc = require.resolve("typescript/bin/tsc");
const portableBundle = readFileSync(resolve(root, "dist/index.js"), "utf8");
if (/from\s+["']node:(?:fs|path)(?:\/|["'])|import\(["']node:(?:fs|path)/.test(portableBundle)) {
  throw new Error("The portable package root must not eagerly include Node filesystem modules.");
}

try {
  execFileSync("pnpm", ["pack", "--pack-destination", temp], {
    cwd: root,
    stdio: "inherit",
  });
  const tarball = join(
    temp,
    readdirSync(temp).find((name) => name.endsWith(".tgz")),
  );
  writeFileSync(
    join(temp, "package.json"),
    JSON.stringify({
      name: "facta-sdk-clean-consumer",
      private: true,
      type: "module",
    }),
  );
  writeFileSync(
    join(temp, "consumer.mts"),
    `
import { Facta, createBridgeArtifactDestination, createGoogleDriveArtifactDestination, createOneDriveArtifactDestination, createS3ArtifactDestination, createSupabaseArtifactDestination, type InvalidationResult, type FactaInvalidationArchiveOptions, type InvalidationRequest, type DteRequest } from "${packageInfo.name}";
import { Facta as NodeFacta, FileInvoiceArchive as NodeFileInvoiceArchive, createFactaFromConfigFile } from "${packageInfo.name}/node";
const request: DteRequest = {
  tipoDte: "11",
  receptor: {
    nombre: "Buyer", numDocumento: "TAX-1", codPais: "US", nombrePais: "United States",
    complemento: "Miami", tipoPersona: 2, descActividad: "Import", correo: "buyer@example.com",
  },
  exportacion: { tipoItemExpor: 1 },
  items: [{ descripcion: "Product", cantidad: 1, precioUni: 2 }],
};
const invalidationOptions: FactaInvalidationArchiveOptions = { operationId: 'typed-invalidation', idempotencyKey: 'typed-invalidation' };
const completeInvalidation: InvalidationResult = { estado: 'invalidado', codigoGeneracion: '7875BC7A-9580-441D-94E4-FA455E9D8BD0', numeroControl: 'DTE-03-M001P001-000000000000175', tipoDte: '03', ambiente: '00', evento: { codigoGeneracion: 'BEB08A1C-1722-4E35-AEA6-52AB1234CDEF', selloRecibido: 'event-seal', tipoAnulacion: 1 }, documento: {}, jws: 'signed-event-jws', anotadoEnElIndice: true };
const sparseInvalidation: InvalidationResult = { estado: 'invalidado', codigoGeneracion: '7875BC7A-9580-441D-94E4-FA455E9D8BD0', numeroControl: 'DTE-03-M001P001-000000000000175', yaEstabaInvalidado: true };
declare const typedFacta: Facta;
declare const invalidationRequest: InvalidationRequest;
declare const typedInvalidationOptions: FactaInvalidationArchiveOptions;
void typedFacta.invalidateAndArchive('7875BC7A-9580-441D-94E4-FA455E9D8BD0', invalidationRequest, typedInvalidationOptions);
void typedFacta.recoverInvalidation('typed-invalidation');
void typedFacta.listPendingInvalidations();
void [completeInvalidation, sparseInvalidation];
void invalidationOptions;
if (typeof Facta !== "function" || typeof NodeFacta !== "function" || typeof NodeFacta.prototype.recoverOperation !== "function" || typeof NodeFacta.prototype.listPendingOperations !== "function" || typeof NodeFileInvoiceArchive.open !== "function" || typeof createFactaFromConfigFile !== "function" || typeof createBridgeArtifactDestination !== "function" || typeof createGoogleDriveArtifactDestination !== "function" || typeof createOneDriveArtifactDestination !== "function" || typeof createS3ArtifactDestination !== "function" || typeof createSupabaseArtifactDestination !== "function" || request.tipoDte !== "11") throw new Error("SDK import failed");
const typedS3 = createS3ArtifactDestination({ id: 'typed-s3', label: 'Typed S3', config: { bucket: 'bucket', region: 'auto', accessKeyId: 'test-key', secretAccessKey: 'test-secret-key-123456', endpoint: 'http://127.0.0.1:9100', allowInsecureEndpoint: true } });
if (typeof typedS3.write !== 'function') throw new Error('S3 adapter type contract failed');
const typedOneDrive = createOneDriveArtifactDestination({ id: 'typed-onedrive', label: 'Typed OneDrive', accessToken: 'token', refreshAccessToken: async () => 'new-token' });
if (typeof typedOneDrive.write !== 'function') throw new Error('OneDrive adapter type contract failed');
const typedDrive = createGoogleDriveArtifactDestination({ id: 'typed-gdrive', label: 'Typed Google Drive', config: { accessToken: 'token', folderId: 'folder' }, refreshAccessToken: async () => 'new-token' });
if (typeof typedDrive.write !== 'function') throw new Error('Google Drive adapter type contract failed');
const typedBridge = createBridgeArtifactDestination({ id: 'typed-bridge', label: 'Typed bridge', config: { port: 9494, apiKey: 'bridge-token', sessionId: 'nas' } });
if (typeof typedBridge.write !== 'function') throw new Error('Bridge adapter type contract failed');
void createFactaFromConfigFile({ configFile: '/tmp/facta-config.json', apiKey: 'facta_test_a.bbbbbbbbbbbbbbbb', config: { version: 1, timeoutMs: 60_000 } });
`,
  );
  writeFileSync(
    join(temp, "consumer.mjs"),
    `
import { Facta, createBridgeArtifactDestination, createGoogleDriveArtifactDestination, createOneDriveArtifactDestination, createS3ArtifactDestination, createSupabaseArtifactDestination } from "${packageInfo.name}";
import { FileInvoiceArchive } from "${packageInfo.name}/file-archive";
import { Facta as NodeFacta, FileInvoiceArchive as NodeFileInvoiceArchive, createFactaFromConfigFile } from "${packageInfo.name}/node";
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
if (typeof Facta !== "function" || typeof NodeFacta !== "function" || typeof NodeFacta.prototype.recoverOperation !== "function" || typeof NodeFacta.prototype.listPendingOperations !== "function" || typeof NodeFileInvoiceArchive.open !== "function" || typeof createFactaFromConfigFile !== "function" || typeof FileInvoiceArchive.open !== "function" || typeof createBridgeArtifactDestination !== "function" || typeof createGoogleDriveArtifactDestination !== "function" || typeof createOneDriveArtifactDestination !== "function" || typeof createS3ArtifactDestination !== "function" || typeof createSupabaseArtifactDestination !== "function") throw new Error("SDK runtime import failed");
const s3Objects = new Map();
const s3 = createS3ArtifactDestination({ id: 'node-s3', label: 'Node S3', config: { bucket: 'bucket', region: 'auto', accessKeyId: 'test-key', secretAccessKey: 'test-secret-key-123456', endpoint: 'http://127.0.0.1:9100', allowInsecureEndpoint: true }, fetch: async (_url, init) => {
  const key = 'api-invoices/generation/json';
  if (init.method === 'PUT') { s3Objects.set(key, new Uint8Array(await new Response(init.body).arrayBuffer())); return new Response(null, { status: 200 }); }
  const object = s3Objects.get(key);
  return object ? new Response(object) : new Response('missing', { status: 404 });
} });
const s3Bytes = new TextEncoder().encode('node signed archive');
const s3Digest = new Uint8Array(await crypto.subtle.digest('SHA-256', s3Bytes));
const s3Sha256 = Array.from(s3Digest, (value) => value.toString(16).padStart(2, '0')).join('');
const s3Result = await s3.write({ codigoGeneracion: 'generation', kind: 'json', filename: null, contentType: 'application/json', bytes: s3Bytes, sha256: s3Sha256 });
if (s3Result !== 'stored' || !s3Objects.has('api-invoices/generation/json')) throw new Error('Node S3 adapter runtime verification failed');
let supabaseObject;
const supabase = createSupabaseArtifactDestination({ id: 'node-supabase', label: 'Node Supabase', config: { url: 'https://project.example.test', serviceKey: 'service-key', bucket: 'private' }, fetch: async (_url, init) => {
  if (init.method === 'POST') { if (new Headers(init.headers).get('x-upsert') !== 'false') throw new Error('Supabase overwrite protection missing'); supabaseObject = new Uint8Array(await new Response(init.body).arrayBuffer()); return new Response('{}', { status: 200 }); }
  return supabaseObject ? new Response(Uint8Array.from(supabaseObject).buffer) : Response.json({ statusCode: '404', error: 'not_found', message: 'Object not found', code: 'NoSuchKey' }, { status: 400 });
} });
const supabaseBytes = new TextEncoder().encode('node supabase archive');
const supabaseDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', supabaseBytes));
const supabaseSha256 = Array.from(supabaseDigest, (value) => value.toString(16).padStart(2, '0')).join('');
const supabaseResult = await supabase.write({ codigoGeneracion: 'generation', kind: 'pdf', filename: null, contentType: 'application/pdf', bytes: supabaseBytes, sha256: supabaseSha256 });
if (supabaseResult !== 'stored' || !supabaseObject) throw new Error('Node Supabase adapter runtime verification failed');
const oneDriveObjects = new Map();
const oneDrive = createOneDriveArtifactDestination({ id: 'node-onedrive', label: 'Node OneDrive', accessToken: 'test-token', fetch: async (url, init) => {
  const target = new URL(String(url));
  if (target.hostname === 'upload.example.test') { oneDriveObjects.set('api-invoices/generation/json', new Uint8Array(await new Response(init.body).arrayBuffer())); return new Response(null, { status: 201 }); }
  if (init.method === 'POST' && target.pathname.endsWith('/children')) return Response.json({ id: 'folder' }, { status: 201 });
  if (target.pathname.endsWith('/json:/createUploadSession')) return Response.json({ uploadUrl: 'https://upload.example.test/session' });
  if (target.pathname.endsWith('/json:/content')) { const value = oneDriveObjects.get('api-invoices/generation/json'); return value ? new Response(value) : new Response('missing', { status: 404 }); }
  throw new Error('Unexpected mocked OneDrive request');
} });
const oneDriveBytes = new TextEncoder().encode('node onedrive archive');
const oneDriveDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', oneDriveBytes));
const oneDriveSha256 = Array.from(oneDriveDigest, (value) => value.toString(16).padStart(2, '0')).join('');
const oneDriveResult = await oneDrive.write({ codigoGeneracion: 'generation', kind: 'json', filename: null, contentType: 'application/json', bytes: oneDriveBytes, sha256: oneDriveSha256 });
if (oneDriveResult !== 'stored' || !oneDriveObjects.has('api-invoices/generation/json')) throw new Error('Node OneDrive adapter runtime verification failed');
let gdriveBytes;
const gdrive = createGoogleDriveArtifactDestination({ id: 'node-gdrive', label: 'Node Google Drive', config: { accessToken: 'test-token', folderId: 'facta-folder' }, fetch: async (url, init) => {
  const target = new URL(String(url));
  if (target.pathname === '/drive/v3/files' && (init.method ?? 'GET') === 'GET') { const query = target.searchParams.get('q') ?? ''; return Response.json({ files: query.includes('appProperties has') && gdriveBytes ? [{ id: 'gdrive-file' }] : [] }); }
  if (target.pathname === '/drive/v3/files' && init.method === 'POST') return Response.json({ id: 'gdrive-folder' });
  if (target.pathname === '/upload/drive/v3/files' && init.method === 'POST') { gdriveBytes = new TextEncoder().encode('node Google Drive archive'); return Response.json({ id: 'gdrive-file' }); }
  if (target.searchParams.get('alt') === 'media') return gdriveBytes ? new Response(gdriveBytes) : new Response('missing', { status: 404 });
  throw new Error('Unexpected mocked Google Drive request');
} });
const gdriveBytesToStore = new TextEncoder().encode('node Google Drive archive');
const gdriveDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', gdriveBytesToStore));
const gdriveSha256 = Array.from(gdriveDigest, (value) => value.toString(16).padStart(2, '0')).join('');
const gdriveResult = await gdrive.write({ codigoGeneracion: 'generation', kind: 'json', filename: null, contentType: 'application/json', bytes: gdriveBytesToStore, sha256: gdriveSha256 });
if (gdriveResult !== 'stored' || !gdriveBytes) throw new Error('Node Google Drive adapter runtime verification failed');
const bridgeObjects = new Map();
const bridge = createBridgeArtifactDestination({ id: 'node-bridge', label: 'Node bridge', config: { port: 9494, apiKey: 'test-bridge-token', sessionId: 'nas' }, fetch: async (url, init) => {
  if (String(url) !== 'http://127.0.0.1:9494/v1/storage' || new Headers(init.headers).get('authorization') !== 'Bearer test-bridge-token') throw new Error('Bridge loopback/auth contract failed');
  const operation = JSON.parse(init.body);
  if (operation.op === 'put') { const binary = atob(operation.body); bridgeObjects.set(operation.path, Uint8Array.from(binary, (value) => value.charCodeAt(0))); return Response.json({ ok: true }); }
  const bytes = bridgeObjects.get(operation.path);
  return bytes ? Response.json({ ok: true, data: btoa(String.fromCharCode(...bytes)) }) : Response.json({ code: 'not_found', error: 'missing' }, { status: 404 });
} });
const bridgeBytes = new TextEncoder().encode('node bridge archive');
const bridgeDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', bridgeBytes));
const bridgeSha256 = Array.from(bridgeDigest, (value) => value.toString(16).padStart(2, '0')).join('');
const bridgeResult = await bridge.write({ codigoGeneracion: 'generation', kind: 'json', filename: 'invoice.json', contentType: 'application/json', bytes: bridgeBytes, sha256: bridgeSha256 });
if (bridgeResult !== 'stored' || bridgeObjects.size !== 1) throw new Error('Node bridge artifact verification failed');
const directory = mkdtempSync(join(tmpdir(), 'facta-archive-node-'));
try {
  const configFile = join(directory, 'client.json');
  writeFileSync(configFile, JSON.stringify({ version: 1, baseUrl: 'https://packed.example.test/api-v1' }));
  let configUrl = '';
  const configuredClient = await createFactaFromConfigFile({
    configFile,
    apiKey: 'facta_test_a.bbbbbbbbbbbbbbbb',
    fetch: async (url) => { configUrl = String(url); return Response.json({ ok: true }); },
  });
  await configuredClient.status();
  if (configUrl !== 'https://packed.example.test/api-v1/v1/status') throw new Error('Node config file did not configure the packed client.');
  const passphrase = 'correct-horse-battery-staple-archive';
  const archive = await FileInvoiceArchive.open({ directory, passphrase });
  await archive.assertReady();
  const codigoGeneracion = '7875BC7A-9580-441D-94E4-FA455E9D8BD0';
  const invalidationId = 'node-invalidation';
  await archive.beginInvalidation({ id: invalidationId, targetCodigoGeneracion: codigoGeneracion, idempotencyKey: invalidationId, requestSha256: 'c'.repeat(64), request: { tipoAnulacion: 2 }, createdAt: new Date().toISOString(), state: 'started' });
  await archive.completeInvalidation(invalidationId, { estado: 'invalidado', codigoGeneracion, numeroControl: 'DTE-03-M001P001-000000000000175', tipoDte: '03', ambiente: '00', evento: { codigoGeneracion: 'BEB08A1C-1722-4E35-AEA6-52AB1234CDEF', selloRecibido: 'event-seal', tipoAnulacion: 2 }, documento: {}, jws: 'exact-event-jws', anotadoEnElIndice: true });
  const emission = { codigoGeneracion };
  await archive.begin({ id: 'node-consumer', idempotencyKey: 'node-consumer', requestSha256: 'a'.repeat(64), createdAt: new Date().toISOString(), state: 'started', ticketPaperWidthMm: 80 });
  await archive.markIssued('node-consumer', emission);
  const bytes = new TextEncoder().encode('{"node":"exact"}');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const sha256 = Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
  await archive.saveArtifact({ codigoGeneracion, kind: 'json', filename: 'invoice.json', contentType: 'application/json', bytes, sha256 });
  const jws = new TextEncoder().encode('signed-jws-node');
  const jwsDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', jws));
  await archive.saveArtifact({ codigoGeneracion, kind: 'jws', filename: codigoGeneracion + '.jws', contentType: 'application/jose', bytes: jws, sha256: Array.from(jwsDigest, (value) => value.toString(16).padStart(2, '0')).join('') });
  const pdf = new Uint8Array([37, 80, 68, 70]);
  const pdfDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', pdf));
  await archive.saveArtifact({ codigoGeneracion, kind: 'pdf', filename: 'invoice.pdf', contentType: 'application/pdf', bytes: pdf, sha256: Array.from(pdfDigest, (value) => value.toString(16).padStart(2, '0')).join('') });
  const ticket = new Uint8Array([37, 80, 68, 70, 45, 84]);
  const ticketDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', ticket));
  await archive.saveArtifact({ codigoGeneracion, kind: 'ticket', filename: codigoGeneracion + '-ticket.pdf', contentType: 'application/pdf', bytes: ticket, sha256: Array.from(ticketDigest, (value) => value.toString(16).padStart(2, '0')).join('') });
  await archive.finish('node-consumer');
  await archive.recordRemoteCopy('node-consumer', { destinationId: 'remote-node', kind: 'json', label: 'Remote Node', state: 'unknown', sha256, updatedAt: new Date().toISOString() });
  const restarted = await FileInvoiceArchive.open({ directory, passphrase });
  const invalidation = await restarted.findInvalidation(invalidationId);
  if (invalidation?.state !== 'complete' || invalidation.result?.jws !== 'exact-event-jws' || !(await restarted.pendingInvalidations()).every((row) => row.id !== invalidationId)) throw new Error('Node invalidation archive restart verification failed');
  const stored = await restarted.getArtifact(codigoGeneracion, 'json');
  const storedJws = await restarted.getArtifact(codigoGeneracion, 'jws');
  const storedTicket = await restarted.getArtifact(codigoGeneracion, 'ticket');
  if (!stored || new TextDecoder().decode(stored.bytes) !== '{"node":"exact"}' || !storedJws || new TextDecoder().decode(storedJws.bytes) !== 'signed-jws-node' || !storedTicket || new TextDecoder().decode(storedTicket.bytes) !== '%PDF-T' || (await restarted.pending()).length !== 1) throw new Error('Node archive restart verification failed');
  let remoteWrites = 0;
  const getRemoteWrites = () => remoteWrites;
  const facta = new Facta({ apiKey: 'facta_test_node.secret' });
  const remote = { id: 'remote-node', kind: 's3', label: 'Remote Node', async check() { return 'missing'; }, async write() { remoteWrites++; return 'stored'; } };
  const probe = await facta.diagnoseDestinations('node-consumer', restarted, [remote]);
  if (probe.results.length !== 4 || probe.results.some((result) => result.state !== 'missing') || getRemoteWrites() !== 0) throw new Error('Node read-only destination probe verification failed');
  const report = await facta.replicateArchive('node-consumer', restarted, [remote]);
  if (report.outcomes.length !== 4 || remoteWrites !== 4 || (await restarted.pending()).length !== 0) throw new Error('Node remote-copy recovery verification failed');
} finally { rmSync(directory, { recursive: true, force: true }); }
`,
  );
  writeFileSync(
    join(temp, "consumer-deno.ts"),
    `
import { Facta, createBridgeArtifactDestination, createGoogleDriveArtifactDestination, createOneDriveArtifactDestination, createS3ArtifactDestination, createSupabaseArtifactDestination } from "${packageInfo.name}";
import { FileInvoiceArchive } from "${packageInfo.name}/file-archive";
type TestFetchInit = { method?: string; headers?: HeadersInit; body?: BodyInit | null };
if (typeof Facta !== "function" || typeof createBridgeArtifactDestination !== "function" || typeof createGoogleDriveArtifactDestination !== "function" || typeof createOneDriveArtifactDestination !== "function" || typeof createS3ArtifactDestination !== "function" || typeof createSupabaseArtifactDestination !== "function") throw new Error("SDK runtime import failed");
const s3Objects = new Map<string, Uint8Array>();
const s3 = createS3ArtifactDestination({ id: 'deno-s3', label: 'Deno S3', config: { bucket: 'bucket', region: 'auto', accessKeyId: 'test-key', secretAccessKey: 'test-secret-key-123456', endpoint: 'http://127.0.0.1:9100', allowInsecureEndpoint: true }, fetch: async (_url, init?: TestFetchInit) => {
  const key = 'api-invoices/generation/json';
  if (init?.method === 'PUT') { s3Objects.set(key, new Uint8Array(await new Response(init.body).arrayBuffer())); return new Response(null, { status: 200 }); }
  const object = s3Objects.get(key);
  return object ? new Response(Uint8Array.from(object).buffer as ArrayBuffer) : new Response('missing', { status: 404 });
} });
const s3Bytes = new TextEncoder().encode('deno signed archive');
const s3Digest = new Uint8Array(await crypto.subtle.digest('SHA-256', s3Bytes));
const s3Sha256 = Array.from(s3Digest, (value) => value.toString(16).padStart(2, '0')).join('');
const s3Result = await s3.write({ codigoGeneracion: 'generation', kind: 'json', filename: null, contentType: 'application/json', bytes: s3Bytes, sha256: s3Sha256 });
if (s3Result !== 'stored' || !s3Objects.has('api-invoices/generation/json')) throw new Error('Deno S3 adapter runtime verification failed');
let supabaseObject: Uint8Array | undefined;
const supabase = createSupabaseArtifactDestination({ id: 'deno-supabase', label: 'Deno Supabase', config: { url: 'https://project.example.test', serviceKey: 'service-key', bucket: 'private' }, fetch: async (_url, init?: TestFetchInit) => {
  if (init?.method === 'POST') { if (new Headers(init.headers).get('x-upsert') !== 'false') throw new Error('Supabase overwrite protection missing'); supabaseObject = new Uint8Array(await new Response(init.body).arrayBuffer()); return new Response('{}', { status: 200 }); }
  return supabaseObject ? new Response(Uint8Array.from(supabaseObject).buffer as ArrayBuffer) : Response.json({ statusCode: '404', error: 'not_found', message: 'Object not found', code: 'NoSuchKey' }, { status: 400 });
} });
const supabaseBytes = new TextEncoder().encode('deno supabase archive');
const supabaseDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', supabaseBytes));
const supabaseSha256 = Array.from(supabaseDigest, (value) => value.toString(16).padStart(2, '0')).join('');
const supabaseResult = await supabase.write({ codigoGeneracion: 'generation', kind: 'pdf', filename: null, contentType: 'application/pdf', bytes: supabaseBytes, sha256: supabaseSha256 });
if (supabaseResult !== 'stored' || !supabaseObject) throw new Error('Deno Supabase adapter runtime verification failed');
const oneDriveObjects = new Map<string, Uint8Array>();
const oneDrive = createOneDriveArtifactDestination({ id: 'deno-onedrive', label: 'Deno OneDrive', accessToken: 'test-token', fetch: async (url, init?: TestFetchInit) => {
  const target = new URL(String(url));
  if (target.hostname === 'upload.example.test') { oneDriveObjects.set('api-invoices/generation/json', new Uint8Array(await new Response(init?.body).arrayBuffer())); return new Response(null, { status: 201 }); }
  if (init?.method === 'POST' && target.pathname.endsWith('/children')) return Response.json({ id: 'folder' }, { status: 201 });
  if (target.pathname.endsWith('/json:/createUploadSession')) return Response.json({ uploadUrl: 'https://upload.example.test/session' });
  if (target.pathname.endsWith('/json:/content')) { const value = oneDriveObjects.get('api-invoices/generation/json'); return value ? new Response(Uint8Array.from(value).buffer as ArrayBuffer) : new Response('missing', { status: 404 }); }
  throw new Error('Unexpected mocked OneDrive request');
} });
const oneDriveBytes = new TextEncoder().encode('deno onedrive archive');
const oneDriveDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', oneDriveBytes));
const oneDriveSha256 = Array.from(oneDriveDigest, (value) => value.toString(16).padStart(2, '0')).join('');
const oneDriveResult = await oneDrive.write({ codigoGeneracion: 'generation', kind: 'json', filename: null, contentType: 'application/json', bytes: oneDriveBytes, sha256: oneDriveSha256 });
if (oneDriveResult !== 'stored' || !oneDriveObjects.has('api-invoices/generation/json')) throw new Error('Deno OneDrive adapter runtime verification failed');
let gdriveBytes: Uint8Array | undefined;
const gdrive = createGoogleDriveArtifactDestination({ id: 'deno-gdrive', label: 'Deno Google Drive', config: { accessToken: 'test-token', folderId: 'facta-folder' }, fetch: async (url, init?: TestFetchInit) => {
  const target = new URL(String(url));
  if (target.pathname === '/drive/v3/files' && (init?.method ?? 'GET') === 'GET') { const query = target.searchParams.get('q') ?? ''; return Response.json({ files: query.includes('appProperties has') && gdriveBytes ? [{ id: 'gdrive-file' }] : [] }); }
  if (target.pathname === '/drive/v3/files' && init?.method === 'POST') return Response.json({ id: 'gdrive-folder' });
  if (target.pathname === '/upload/drive/v3/files' && init?.method === 'POST') { gdriveBytes = new TextEncoder().encode('deno Google Drive archive'); return Response.json({ id: 'gdrive-file' }); }
  if (target.searchParams.get('alt') === 'media') return gdriveBytes ? new Response(Uint8Array.from(gdriveBytes).buffer as ArrayBuffer) : new Response('missing', { status: 404 });
  throw new Error('Unexpected mocked Google Drive request');
} });
const gdriveBytesToStore = new TextEncoder().encode('deno Google Drive archive');
const gdriveDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', gdriveBytesToStore));
const gdriveSha256 = Array.from(gdriveDigest, (value) => value.toString(16).padStart(2, '0')).join('');
const gdriveResult = await gdrive.write({ codigoGeneracion: 'generation', kind: 'json', filename: null, contentType: 'application/json', bytes: gdriveBytesToStore, sha256: gdriveSha256 });
if (gdriveResult !== 'stored' || !gdriveBytes) throw new Error('Deno Google Drive adapter runtime verification failed');
const bridgeObjects = new Map<string, Uint8Array>();
const bridge = createBridgeArtifactDestination({ id: 'deno-bridge', label: 'Deno bridge', config: { port: 9494, apiKey: 'test-bridge-token', sessionId: 'nas' }, fetch: async (url, init?: TestFetchInit) => {
  if (String(url) !== 'http://127.0.0.1:9494/v1/storage' || new Headers(init?.headers).get('authorization') !== 'Bearer test-bridge-token') throw new Error('Bridge loopback/auth contract failed');
  const operation = JSON.parse(String(init?.body));
  if (operation.op === 'put') { const binary = atob(operation.body); bridgeObjects.set(operation.path, Uint8Array.from(binary, (value) => value.charCodeAt(0))); return Response.json({ ok: true }); }
  const value = bridgeObjects.get(operation.path);
  if (!value) return Response.json({ code: 'not_found', error: 'missing' }, { status: 404 });
  let binary = ''; for (let index = 0; index < value.length; index += 0x8000) binary += String.fromCharCode(...value.subarray(index, index + 0x8000));
  return Response.json({ ok: true, data: btoa(binary) });
} });
const bridgeBytes = new TextEncoder().encode('deno bridge archive');
const bridgeDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', bridgeBytes));
const bridgeSha256 = Array.from(bridgeDigest, (value) => value.toString(16).padStart(2, '0')).join('');
const bridgeResult = await bridge.write({ codigoGeneracion: 'generation', kind: 'json', filename: 'invoice.json', contentType: 'application/json', bytes: bridgeBytes, sha256: bridgeSha256 });
if (bridgeResult !== 'stored' || bridgeObjects.size !== 1) throw new Error('Deno bridge artifact verification failed');
const directory = await Deno.makeTempDir({ prefix: 'facta-archive-deno-' });
try {
  const passphrase = 'correct-horse-battery-staple-archive';
  const archive = await FileInvoiceArchive.open({ directory, passphrase });
  await archive.assertReady();
  const codigoGeneracion = '7875BC7A-9580-441D-94E4-FA455E9D8BD0';
  await archive.begin({ id: 'deno-consumer', idempotencyKey: 'deno-consumer', requestSha256: 'b'.repeat(64), createdAt: new Date().toISOString(), state: 'started', ticketPaperWidthMm: 80 });
  await archive.markIssued('deno-consumer', {
    estado: 'sellado', codigoGeneracion, numeroControl: 'DTE-03-M001P001-000000000000175', tipoDte: '03',
    ambiente: '00', fecEmi: '2026-09-30', horEmi: '12:00:00', selloRecibido: 'seal', fhProcesamiento: null,
    observaciones: [], totales: { totalNoSuj: 0, totalExenta: 0, totalGravada: 1, totalDescu: 0, totalIva: 0,
      montoTotalOperacion: 1, totalPagar: 1, totalLetras: 'uno' }, documento: {}, jws: 'signed',
  });
  const bytes = new TextEncoder().encode('{"deno":"exact"}');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const sha256 = Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
  await archive.saveArtifact({ codigoGeneracion, kind: 'json', filename: 'invoice.json', contentType: 'application/json', bytes, sha256 });
  const jws = new TextEncoder().encode('signed-jws-deno');
  const jwsDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', jws));
  await archive.saveArtifact({ codigoGeneracion, kind: 'jws', filename: codigoGeneracion + '.jws', contentType: 'application/jose', bytes: jws, sha256: Array.from(jwsDigest, (value) => value.toString(16).padStart(2, '0')).join('') });
  const pdf = new Uint8Array([37, 80, 68, 70]);
  const pdfDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', pdf));
  await archive.saveArtifact({ codigoGeneracion, kind: 'pdf', filename: 'invoice.pdf', contentType: 'application/pdf', bytes: pdf, sha256: Array.from(pdfDigest, (value) => value.toString(16).padStart(2, '0')).join('') });
  const ticket = new Uint8Array([37, 80, 68, 70, 45, 84]);
  const ticketDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', ticket));
  await archive.saveArtifact({ codigoGeneracion, kind: 'ticket', filename: codigoGeneracion + '-ticket.pdf', contentType: 'application/pdf', bytes: ticket, sha256: Array.from(ticketDigest, (value) => value.toString(16).padStart(2, '0')).join('') });
  await archive.finish('deno-consumer');
  await archive.recordRemoteCopy('deno-consumer', { destinationId: 'remote-deno', kind: 'json', label: 'Remote Deno', state: 'unknown', sha256, updatedAt: new Date().toISOString() });
  const restarted = await FileInvoiceArchive.open({ directory, passphrase });
  const stored = await restarted.getArtifact(codigoGeneracion, 'json');
  const storedJws = await restarted.getArtifact(codigoGeneracion, 'jws');
  const storedTicket = await restarted.getArtifact(codigoGeneracion, 'ticket');
  if (!stored || new TextDecoder().decode(stored.bytes) !== '{"deno":"exact"}' || !storedJws || new TextDecoder().decode(storedJws.bytes) !== 'signed-jws-deno' || !storedTicket || new TextDecoder().decode(storedTicket.bytes) !== '%PDF-T' || (await restarted.pending()).length !== 1) throw new Error('Deno archive restart verification failed');
  let remoteWrites = 0;
  const getRemoteWrites = () => remoteWrites;
  const facta = new Facta({ apiKey: 'facta_test_deno.secret' });
  const remote = { id: 'remote-deno', kind: 's3', label: 'Remote Deno', async check() { return 'missing' as const; }, async write() { remoteWrites++; return 'stored' as const; } };
  const probe = await facta.diagnoseDestinations('deno-consumer', restarted, [remote]);
  if (probe.results.length !== 4 || probe.results.some((result) => result.state !== 'missing') || getRemoteWrites() !== 0) throw new Error('Deno read-only destination probe verification failed');
  const report = await facta.replicateArchive('deno-consumer', restarted, [remote]);
  if (report.outcomes.length !== 4 || remoteWrites !== 4 || (await restarted.pending()).length !== 0) throw new Error('Deno remote-copy recovery verification failed');
} finally { await Deno.remove(directory, { recursive: true }); }
`,
  );

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(npm, [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    tarball,
  ], {
    cwd: temp,
    stdio: "inherit",
    ...(process.platform === "win32" ? { shell: true } : {}),
  });
  execFileSync(process.execPath, [
    tsc,
    "--noEmit",
    "--strict",
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--skipLibCheck",
    "consumer.mts",
  ], {
    cwd: temp,
    stdio: "inherit",
  });
  execFileSync(process.execPath, [join(temp, "consumer.mjs")], {
    cwd: temp,
    stdio: "inherit",
  });
  const archiveDirectory = join(temp, "concurrent-archive");
  const archivePassphrase = "packed-consumer-concurrency-secret-8pW2cN5mR9xK4vT7";
  const seedArchive = `
import { FileInvoiceArchive } from "@facta-dte/api/node";
const archive = await FileInvoiceArchive.open({ directory: ${JSON.stringify(archiveDirectory)}, passphrase: ${JSON.stringify(archivePassphrase)} });
await archive.begin({ id: "concurrent-operation", idempotencyKey: "concurrent-operation", requestSha256: "a".repeat(64), createdAt: new Date().toISOString(), state: "issued", codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0" });
`;
  const archiveSeedPath = join(temp, "seed-archive.mjs");
  writeFileSync(archiveSeedPath, seedArchive);
  execFileSync(process.execPath, [archiveSeedPath], { cwd: temp, stdio: "inherit" });
  const concurrentWriterPath = join(temp, "concurrent-writer.mjs");
  writeFileSync(concurrentWriterPath, `
import { existsSync } from "node:fs";
import { FileInvoiceArchive } from "@facta-dte/api/node";
const [prefix, gate, directory, passphrase] = process.argv.slice(2);
const archive = await FileInvoiceArchive.open({ directory, passphrase });
while (!existsSync(gate)) await new Promise((resolve) => setTimeout(resolve, 5));
for (let index = 0; index < 20; index += 1) {
  await archive.recordRemoteCopy("concurrent-operation", {
    destinationId: prefix + "-" + index,
    kind: "json",
    label: prefix,
    state: "stored",
    sha256: "b".repeat(64),
    updatedAt: new Date().toISOString(),
  });
}
`);
  const gatePath = join(temp, "writers-go");
  const runWriter = (prefix) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [concurrentWriterPath, prefix, gatePath, archiveDirectory, archivePassphrase], { cwd: temp, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Concurrent writer ${prefix} exited ${code}.`)));
  });
  const writers = [runWriter("left"), runWriter("right")];
  writeFileSync(gatePath, "go");
  await Promise.all(writers);
  const verifyArchivePath = join(temp, "verify-archive.mjs");
  writeFileSync(verifyArchivePath, `
import { FileInvoiceArchive } from "@facta-dte/api/node";
const archive = await FileInvoiceArchive.open({ directory: ${JSON.stringify(archiveDirectory)}, passphrase: ${JSON.stringify(archivePassphrase)} });
const operation = await archive.find("concurrent-operation");
if (operation?.remoteCopies?.length !== 40) throw new Error("Cross-process archive updates were lost.");
`);
  execFileSync(process.execPath, [verifyArchivePath], { cwd: temp, stdio: "inherit" });
  execFileSync("deno", ["check", "consumer-deno.ts"], {
    cwd: temp,
    stdio: "inherit",
  });
  execFileSync("deno", [
    "run",
    "--allow-read",
    "--allow-write",
    "consumer-deno.ts",
  ], { cwd: temp, stdio: "inherit" });
} finally {
  rmSync(temp, { recursive: true, force: true });
}
