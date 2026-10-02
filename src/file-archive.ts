import {
  link,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pid, platform } from "node:process";
import type {
  ArchiveArtifact,
  ArchiveOperation,
  InvalidationOperation,
  InvalidationArchive,
  InvoiceArchive,
  RemoteCopyRecord,
} from "./archive.ts";
import type { InvalidationResult, IssueResult } from "./types.ts";
import { FactaError } from "./errors.ts";

const CONFIG = "facta-archive.json";
const WRITER_LOCK = ".facta-writer-lock";
const RECOVERY_LOCK = ".facta-writer-recovery";
const KDF_ROUNDS = 310_000;
const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
type JsonValue = Record<string, unknown>;
const directoryQueues = new Map<string, Promise<void>>();

/** Journal schema v1 is additive: readers accept legacy rows without a version. */
function parseJournalRecord<T>(bytes: Uint8Array, label: string): T {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new FactaError("archive_integrity_error", `${label} journal is not valid JSON.`, 0);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FactaError("archive_integrity_error", `${label} journal has an invalid shape.`, 0);
  }
  const version = (value as Record<string, unknown>).schemaVersion;
  if (version !== undefined && version !== 1) {
    throw new FactaError("archive_integrity_error", `${label} journal schema version is unsupported.`, 0);
  }
  return value as T;
}

interface WriterLockOwner {
  lockId: string;
  processId: number;
  acquiredAt: string;
}

async function serializeDirectory<T>(
  directory: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = directoryQueues.get(directory) ?? Promise.resolve();
  let release!: () => void;
  const queued = new Promise<void>((resolveQueue) => {
    release = resolveQueue;
  });
  directoryQueues.set(directory, queued);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (directoryQueues.get(directory) === queued) {
      directoryQueues.delete(directory);
    }
  }
}

function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}
function b64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function unb64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new Uint8Array(bytes).buffer as ArrayBuffer,
    ),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
async function hashText(value: string): Promise<string> {
  return await sha256(new TextEncoder().encode(value));
}
async function encrypt(
  key: CryptoKey,
  bytes: Uint8Array,
  aad: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
      key,
      new Uint8Array(bytes).buffer as ArrayBuffer,
    ),
  );
  const result = new Uint8Array(iv.length + ciphertext.length);
  result.set(iv);
  result.set(ciphertext, iv.length);
  return result;
}
async function decrypt(
  key: CryptoKey,
  bytes: Uint8Array,
  aad: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if (bytes.length < 29) {
    throw new Error("Encrypted archive file is truncated.");
  }
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: Uint8Array.from(bytes.subarray(0, 12)),
        additionalData: new TextEncoder().encode(aad),
      },
      key,
      Uint8Array.from(bytes.subarray(12)).buffer as ArrayBuffer,
    ),
  );
}
async function derive(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new Uint8Array(salt).buffer as ArrayBuffer,
      iterations: KDF_ROUNDS,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function readOptional(
  path: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    return new Uint8Array(await readFile(path));
  } catch (error) {
    if (codeOf(error) === "ENOENT") return null;
    throw error;
  }
}
async function createExclusiveFile(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const temp = path + "." + crypto.randomUUID() + ".tmp";
  const handle = await open(temp, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temp, path);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
  await syncDirectory(dirname(path));
}

async function syncDirectory(directory: string): Promise<void> {
  if (platform === "win32") return;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR", "EBADF"].includes(codeOf(error) ?? "")) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (codeOf(error) === "ENOENT") return false;
    throw error;
  }
}

async function acquireWriterLock(
  directory: string,
  timeoutMs: number,
): Promise<() => Promise<void>> {
  const lockPath = join(directory, WRITER_LOCK);
  const recoveryPath = join(directory, RECOVERY_LOCK);
  const ownerPath = join(lockPath, "owner.json");
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (await exists(recoveryPath)) {
      if (Date.now() >= deadline) {
        throw new Error("Archive lock recovery is in progress; retry after it completes.");
      }
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 25));
      continue;
    }
    try {
      await mkdir(lockPath, { mode: 0o700 });
    } catch (error) {
      if (codeOf(error) !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        let owner = "owner metadata unavailable";
        try {
          owner = new TextDecoder().decode(await readFile(ownerPath));
        } catch {
          // A partially created lock is never stolen automatically.
        }
        throw new Error(
          `Archive is locked by another writer (${owner}). Stop every writer and recover it explicitly with FileInvoiceArchive.releaseStaleLock().`,
        );
      }
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 25));
      continue;
    }

    const owner: WriterLockOwner = {
      lockId: crypto.randomUUID(),
      processId: pid,
      acquiredAt: new Date().toISOString(),
    };
    try {
      const handle = await open(ownerPath, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(owner));
        await handle.sync();
      } finally {
        await handle.close();
      }
      // A stale-lock recovery in progress blocks new owners too.
      if (await exists(recoveryPath)) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
    } catch (error) {
      await rm(lockPath, { recursive: true, force: true });
      throw error;
    }

    return async () => {
      let held: WriterLockOwner;
      try {
        held = JSON.parse(await readFile(ownerPath, "utf8")) as WriterLockOwner;
      } catch {
        throw new Error("Archive writer lock ownership changed before release.");
      }
      if (held.lockId !== owner.lockId) {
        throw new Error("Archive writer lock ownership changed before release.");
      }
      await rm(lockPath, { recursive: true, force: true });
    };
  }
}

/**
 * Encrypted local archive for Node and Deno's Node compatibility layer.
 * Supply a separate, high-entropy passphrase from a secret manager; it is
 * never sent to Facta. Cross-process writers are serialized with an exclusive
 * local filesystem lock. Network filesystems are unsupported.
 */
export class FileInvoiceArchive implements InvoiceArchive, InvalidationArchive {
  readonly #directory: string;
  readonly #key: CryptoKey;
  readonly #lockTimeoutMs: number;

  private constructor(directory: string, key: CryptoKey, lockTimeoutMs: number) {
    this.#directory = directory;
    this.#key = key;
    this.#lockTimeoutMs = lockTimeoutMs;
  }

  static async open(
    options: { directory: string; passphrase: string; lockTimeoutMs?: number },
  ): Promise<FileInvoiceArchive> {
    if (!options.directory.trim()) {
      throw new TypeError("archive directory is required");
    }
    if (options.passphrase.length < 32) {
      throw new TypeError(
        "archive passphrase must contain at least 32 characters",
      );
    }
    const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 0 || lockTimeoutMs > 300_000) {
      throw new RangeError("archive lockTimeoutMs must be an integer from 0 through 300000.");
    }
    const directory = resolve(options.directory);
    await mkdir(directory, { recursive: true });
    const configPath = join(directory, CONFIG);
    let config: { formatVersion: number; salt: string; keyCheck: string };
    try {
      config = JSON.parse(await readFile(configPath, "utf8")) as typeof config;
    } catch (error) {
      if (codeOf(error) !== "ENOENT") throw error;
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await derive(options.passphrase, salt);
      const created = {
        formatVersion: 1,
        salt: b64(salt),
        keyCheck: b64(
          await encrypt(
            key,
            new TextEncoder().encode("facta archive key v1"),
            "key-check",
          ),
        ),
      };
      try {
        await createExclusiveFile(
          configPath,
          new TextEncoder().encode(JSON.stringify(created)),
        );
        config = created;
      } catch (cause) {
        if (codeOf(cause) !== "EEXIST") throw cause;
        config = JSON.parse(
          await readFile(configPath, "utf8"),
        ) as typeof config;
      }
    }
    if (
      config.formatVersion !== 1 || typeof config.salt !== "string" ||
      typeof config.keyCheck !== "string"
    ) {
      throw new Error("Unsupported or corrupt Facta archive configuration.");
    }
    const key = await derive(options.passphrase, unb64(config.salt));
    let checked: Uint8Array;
    try {
      checked = await decrypt(key, unb64(config.keyCheck), "key-check");
    } catch {
      throw new Error("Incorrect archive passphrase.");
    }
    if (new TextDecoder().decode(checked) !== "facta archive key v1") {
      throw new Error("Incorrect archive passphrase.");
    }
    await mkdir(join(directory, "operations"), { recursive: true });
    await mkdir(join(directory, "artifacts"), { recursive: true });
    await mkdir(join(directory, "events"), { recursive: true });
    return new FileInvoiceArchive(directory, key, lockTimeoutMs);
  }

  async beginInvalidation(operation: InvalidationOperation): Promise<boolean> {
    return await this.#exclusive(async () => {
      validateId(operation.id);
      validateCode(operation.targetCodigoGeneracion);
      const existing = await this.#readInvalidation(operation.id);
      if (existing) {
        if (
          existing.targetCodigoGeneracion !== operation.targetCodigoGeneracion ||
          existing.idempotencyKey !== operation.idempotencyKey ||
          existing.requestSha256 !== operation.requestSha256
        ) {
          throw new Error("Invalidation archive ID belongs to a different request.");
        }
        return false;
      }
      await this.#writeInvalidation(operation, true);
      return true;
    });
  }

  async findInvalidation(id: string): Promise<InvalidationOperation | null> {
    validateId(id);
    return await this.#readInvalidation(id);
  }

  async pendingInvalidations(): Promise<InvalidationOperation[]> {
    const directory = join(this.#directory, "events");
    const rows: InvalidationOperation[] = [];
    for (const name of await readdir(directory)) {
      if (!name.endsWith(".enc")) continue;
      const sealed = await readFile(join(directory, name));
      const row = await this.#decodeInvalidation(sealed);
      if ((await hashText(row.id)) + ".enc" !== name) {
        throw new FactaError("archive_integrity_error", "Invalidation journal ID does not match its archive path.", 0);
      }
      if (row.state !== "complete") rows.push(row);
    }
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async completeInvalidation(id: string, result: InvalidationResult): Promise<void> {
    if (!("jws" in result) || typeof result.jws !== "string" || result.jws.length === 0) {
      throw new Error("The invalidation response does not contain its signed event JWS.");
    }
    await this.#exclusive(async () => {
      const operation = await this.#requireInvalidation(id);
      if (result.codigoGeneracion !== operation.targetCodigoGeneracion) {
        throw new Error("Invalidation response targets a different generation code.");
      }
      const bytes = new TextEncoder().encode(result.jws);
      const { detail: _detail, ...withoutDetail } = operation;
      await this.#writeInvalidation({
        ...withoutDetail,
        state: "complete",
        result,
        eventJwsSha256: await sha256(bytes),
      });
    });
  }

  async markInvalidationNeedsAttention(
    id: string,
    detail: string,
    result?: InvalidationResult,
  ): Promise<void> {
    await this.#exclusive(async () => {
      const operation = await this.#requireInvalidation(id);
      await this.#writeInvalidation({
        ...operation,
        state: "needs_attention",
        detail: detail.slice(0, 500),
        ...(result === undefined ? {} : { result }),
      });
    });
  }

  async #readInvalidation(id: string): Promise<InvalidationOperation | null> {
    const path = await this.#invalidationPath(id);
    const sealed = await readOptional(path);
    if (!sealed) return null;
    const operation = await this.#decodeInvalidation(sealed);
    if (operation.id !== id) {
      throw new FactaError("archive_integrity_error", "Invalidation journal ID does not match its path.", 0);
    }
    return operation;
  }
  async #decodeInvalidation(sealed: Uint8Array): Promise<InvalidationOperation> {
    const operation = parseJournalRecord<InvalidationOperation>(
      await decrypt(this.#key, sealed, "invalidation-record"),
      "Invalidation",
    );
    if (operation.eventJwsSha256 !== undefined) {
      if (
        !operation.result || !("jws" in operation.result) ||
        await sha256(new TextEncoder().encode(operation.result.jws)) !==
          operation.eventJwsSha256
      ) {
        throw new FactaError("archive_integrity_error", "Invalidation event JWS failed its SHA-256 integrity check.", 0);
      }
    }
    if (
      operation.state === "complete" &&
      (!operation.result || !("jws" in operation.result) ||
        operation.eventJwsSha256 === undefined)
    ) {
      throw new FactaError("archive_integrity_error", "Completed invalidation journal is missing its signed event.", 0);
    }
    return operation;
  }
  async #writeInvalidation(operation: InvalidationOperation, create = false): Promise<void> {
    const sealed = await encrypt(
      this.#key,
      new TextEncoder().encode(JSON.stringify({ ...operation, schemaVersion: 1 })),
      "invalidation-record",
    );
    const path = await this.#invalidationPath(operation.id);
    if (create) await createExclusiveFile(path, sealed);
    else await this.#atomicWrite(path, sealed);
  }
  async #requireInvalidation(id: string): Promise<InvalidationOperation> {
    const value = await this.#readInvalidation(id);
    if (!value) throw new Error("Invalidation operation not found: " + id);
    return value;
  }
  async #invalidationPath(id: string): Promise<string> {
    return join(this.#directory, "events", (await hashText(id)) + ".enc");
  }

  /** Remove an abandoned writer lock only after every writer has been stopped. */
  static async releaseStaleLock(options: {
    directory: string;
    confirmNoConcurrentWriters: true;
  }): Promise<boolean> {
    if (options.confirmNoConcurrentWriters !== true) {
      throw new TypeError("Confirm that all archive writers are stopped before recovering a lock.");
    }
    const directory = resolve(options.directory);
    const recoveryPath = join(directory, RECOVERY_LOCK);
    const lockPath = join(directory, WRITER_LOCK);
    const quarantinePath = join(directory, `${WRITER_LOCK}.recovery-${crypto.randomUUID()}`);
    await mkdir(recoveryPath, { mode: 0o700 });
    try {
      if (!await exists(lockPath)) return false;
      const ownerPath = join(lockPath, "owner.json");
      let knownLockId: string | null = null;
      try {
        const owner = JSON.parse(await readFile(ownerPath, "utf8")) as Partial<WriterLockOwner>;
        if (typeof owner.lockId === "string") knownLockId = owner.lockId;
      } catch {
        // A process may stop after creating the lock directory but before
        // writing owner metadata. Explicit operator confirmation still allows
        // recovery; the lock is never stolen automatically.
      }
      try {
        await rename(lockPath, quarantinePath);
      } catch (error) {
        if (codeOf(error) === "ENOENT") return false;
        throw error;
      }
      if (knownLockId !== null) {
        const movedOwner = JSON.parse(await readFile(join(quarantinePath, "owner.json"), "utf8")) as WriterLockOwner;
        if (movedOwner.lockId !== knownLockId) {
          await rename(quarantinePath, lockPath).catch(() => undefined);
          throw new Error("Archive lock changed during recovery; it was not removed.");
        }
      }
      await rm(quarantinePath, { recursive: true });
      return true;
    } finally {
      await rm(recoveryPath, { recursive: true, force: true });
    }
  }

  async assertReady(): Promise<void> {
    await this.#exclusive(async () => {
      const path = join(this.#directory, ".probe-" + crypto.randomUUID());
      try {
        await this.#atomicWrite(
          path,
          await encrypt(this.#key, new TextEncoder().encode("ready"), "probe"),
        );
        const bytes = await decrypt(this.#key, await readFile(path), "probe");
        if (new TextDecoder().decode(bytes) !== "ready") {
          throw new Error("Archive readiness check failed.");
        }
      } finally {
        await unlink(path).catch(() => undefined);
      }
    });
  }

  async begin(operation: ArchiveOperation): Promise<boolean> {
    return await this.#exclusive(async () => {
      validateId(operation.id);
      if (operation.ticketPaperWidthMm !== undefined && (
        !Number.isInteger(operation.ticketPaperWidthMm) ||
        operation.ticketPaperWidthMm < 40 || operation.ticketPaperWidthMm > 120
      )) {
        throw new TypeError("ticketPaperWidthMm must be an integer from 40 through 120.");
      }
      const existing = await this.#readOperation(operation.id);
      if (existing) {
        if (
          existing.idempotencyKey !== operation.idempotencyKey ||
          existing.requestSha256 !== operation.requestSha256
        ) {
          throw new Error(
            "Archive operation ID belongs to a different request.",
          );
        }
        return false;
      }
      try {
        await this.#writeOperation(operation, true);
      } catch (error) {
        if (codeOf(error) !== "EEXIST") throw error;
        const raced = await this.#readOperation(operation.id);
        if (
          !raced || raced.idempotencyKey !== operation.idempotencyKey ||
          raced.requestSha256 !== operation.requestSha256
        ) {
          throw new Error(
            "Archive operation ID was concurrently claimed by a different request.",
          );
        }
        return false;
      }
      return true;
    });
  }

  async find(id: string): Promise<ArchiveOperation | null> {
    validateId(id);
    return await this.#readOperation(id);
  }

  async pending(): Promise<ArchiveOperation[]> {
    const directory = join(this.#directory, "operations");
    const rows: ArchiveOperation[] = [];
    for (const name of await readdir(directory)) {
      if (!name.endsWith(".enc")) continue;
      const path = join(directory, name);
      try {
        const bytes = await decrypt(
          this.#key,
          await readFile(path),
          "operation-record",
        );
        const value = parseJournalRecord<ArchiveOperation>(bytes, "Invoice");
        if ((await hashText(value.id)) + ".enc" !== name) {
          throw new FactaError("archive_integrity_error", "Invoice journal ID does not match its archive path.", 0);
        }
        if (value.state !== "complete" || value.remoteCopies?.some((copy) => copy.state !== "stored")) {
          rows.push(value);
        }
      } catch (error) {
        if (error instanceof FactaError) throw error;
        throw new Error(
          "Could not read archive journal " + name + ": " + String(error),
        );
      }
    }
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async markIssued(id: string, result: IssueResult): Promise<void> {
    await this.#exclusive(async () => {
      const operation = await this.#requireOperation(id);
      if (
        operation.codigoGeneracion &&
        operation.codigoGeneracion !== result.codigoGeneracion
      ) {
        throw new Error(
          "Archive journal points to a different generation code.",
        );
      }
      await this.#writeOperation({
        ...operation,
        state: "issued",
        codigoGeneracion: result.codigoGeneracion,
      });
    });
  }

  async saveArtifact(artifact: ArchiveArtifact): Promise<void> {
    await this.#exclusive(async () => {
      validateCode(artifact.codigoGeneracion);
      if (await sha256(artifact.bytes) !== artifact.sha256) {
        throw new Error("Artifact SHA-256 does not match its bytes.");
      }
      const operation = (await this.pending()).find((row) =>
        row.codigoGeneracion === artifact.codigoGeneracion
      );
      if (!operation) {
        throw new Error(
          "No pending journal operation owns this generation code.",
        );
      }
      const base = await this.#artifactBase(
        artifact.codigoGeneracion,
        artifact.kind,
      );
      const dataPath = base + ".enc";
      const metaPath = base + ".meta.enc";
      const existingMeta = await readOptional(metaPath);
      const existingData = await readOptional(dataPath);
      if ((existingMeta === null) !== (existingData === null)) {
        throw new FactaError("archive_integrity_error", "Archived artifact data and metadata are incomplete; refusing to replace partial evidence.", 0, {
          codigoGeneracion: artifact.codigoGeneracion,
          kind: artifact.kind,
        });
      }
      if (existingMeta) {
        const metadata = JSON.parse(new TextDecoder().decode(
          await decrypt(
            this.#key,
            existingMeta,
            "metadata:" + artifact.codigoGeneracion + ":" + artifact.kind,
          ),
        )) as { sha256: string };
        if (metadata.sha256 !== artifact.sha256) {
          throw new Error(
            "Refusing to replace an archived artifact with different bytes.",
          );
        }
        const verifiedData = await decrypt(
          this.#key,
          existingData!,
          "artifact:" + artifact.codigoGeneracion + ":" + artifact.kind,
        );
        if (await sha256(verifiedData) !== artifact.sha256) {
          throw new Error("Archived artifact failed its integrity check.");
        }
        return;
      }
      await this.#atomicWrite(
        dataPath,
        await encrypt(
          this.#key,
          artifact.bytes,
          "artifact:" + artifact.codigoGeneracion + ":" + artifact.kind,
        ),
      );
      const metadata: JsonValue = {
        codigoGeneracion: artifact.codigoGeneracion,
        kind: artifact.kind,
        filename: artifact.filename,
        contentType: artifact.contentType,
        sha256: artifact.sha256,
      };
      await this.#atomicWrite(
        metaPath,
        await encrypt(
          this.#key,
          new TextEncoder().encode(JSON.stringify(metadata)),
          "metadata:" + artifact.codigoGeneracion + ":" + artifact.kind,
        ),
      );
    });
  }

  async getArtifact(
    code: string,
    kind: "json" | "pdf" | "jws" | "ticket",
  ): Promise<ArchiveArtifact | null> {
    validateCode(code);
    const base = await this.#artifactBase(code, kind);
    const metadataBytes = await readOptional(base + ".meta.enc");
    const dataBytes = await readOptional(base + ".enc");
    if (metadataBytes === null && dataBytes === null) return null;
    if (metadataBytes === null || dataBytes === null) {
      throw new FactaError("archive_integrity_error", "Archived artifact data and metadata are incomplete.", 0, {
        codigoGeneracion: code,
        kind,
      });
    }
    const aad = "metadata:" + code + ":" + kind;
    const metadata = JSON.parse(
      new TextDecoder().decode(await decrypt(this.#key, metadataBytes, aad)),
    ) as {
      codigoGeneracion: string;
      kind: "json" | "pdf" | "jws" | "ticket";
      filename: string | null;
      contentType: string;
      sha256: string;
    };
    const bytes = await decrypt(
      this.#key,
      dataBytes,
      "artifact:" + code + ":" + kind,
    );
    if (
      metadata.codigoGeneracion !== code || metadata.kind !== kind ||
      await sha256(bytes) !== metadata.sha256
    ) {
      throw new Error(
        "Archived artifact failed its identity or integrity check.",
      );
    }
    return { ...metadata, bytes };
  }

  async finish(id: string): Promise<void> {
    await this.#exclusive(async () => {
      const operation = await this.#requireOperation(id);
      if (
        !operation.codigoGeneracion ||
        (operation.state !== "issued" && operation.state !== "needs_attention")
      ) {
        throw new Error(
          "Cannot complete an archive operation before issuance is journaled.",
        );
      }
      const requiredKinds = operation.ticketPaperWidthMm === undefined
        ? ["json", "pdf", "jws"] as const
        : ["json", "pdf", "jws", "ticket"] as const;
      for (const kind of requiredKinds) {
        const base = await this.#artifactBase(operation.codigoGeneracion, kind);
        const metadata = await readOptional(base + ".meta.enc");
        const data = await readOptional(base + ".enc");
        if (!metadata || !data) {
          throw new Error(
            "Missing " + kind + " artifact; archive remains pending.",
          );
        }
        const metadataBytes = await decrypt(
          this.#key,
          metadata,
          "metadata:" + operation.codigoGeneracion + ":" + kind,
        );
        const record = JSON.parse(new TextDecoder().decode(metadataBytes)) as {
          sha256: string;
        };
        const artifactBytes = await decrypt(
          this.#key,
          data,
          "artifact:" + operation.codigoGeneracion + ":" + kind,
        );
        if (await sha256(artifactBytes) !== record.sha256) {
          throw new Error(
            "Archived " + kind +
              " artifact failed its SHA-256 integrity check.",
          );
        }
      }
      const { detail: _detail, ...complete } = operation;
      await this.#writeOperation({ ...complete, state: "complete" });
    });
  }

  async markNeedsAttention(id: string, detail: string): Promise<void> {
    await this.#exclusive(async () => {
      const operation = await this.#requireOperation(id);
      if (operation.state !== "complete") {
        await this.#writeOperation({
          ...operation,
          state: "needs_attention",
          detail,
        });
      }
    });
  }

  async recordRemoteCopy(id: string, record: RemoteCopyRecord): Promise<void> {
    await this.#exclusive(async () => {
      const operation = await this.#requireOperation(id);
      if (!operation.codigoGeneracion) {
        throw new Error("Cannot record a remote copy before issuance is journaled.");
      }
      validateCode(operation.codigoGeneracion);
      if (!(["json", "pdf", "jws", "ticket"] as string[]).includes(record.kind)) {
        throw new TypeError("Unsupported remote artifact kind.");
      }
      if (!(["stored", "unknown", "failed", "unavailable"] as string[]).includes(record.state)) {
        throw new TypeError("Unsupported remote copy state.");
      }
      if (!record.destinationId.trim() || !record.label.trim() || !/^[a-f0-9]{64}$/.test(record.sha256)) {
        throw new TypeError("Invalid remote copy identity or digest.");
      }
      const rows = operation.remoteCopies ?? [];
      const index = rows.findIndex((row) =>
        row.destinationId === record.destinationId && row.kind === record.kind
      );
      const remoteCopies = index < 0
        ? [...rows, record]
        : rows.map((row, i) => i === index ? record : row);
      await this.#writeOperation({ ...operation, remoteCopies });
    });
  }

  async #exclusive<T>(work: () => Promise<T>): Promise<T> {
    return await serializeDirectory(this.#directory, async () => {
      const release = await acquireWriterLock(this.#directory, this.#lockTimeoutMs);
      try {
        return await work();
      } finally {
        await release();
      }
    });
  }
  async #readOperation(id: string): Promise<ArchiveOperation | null> {
    const path = await this.#operationPath(id);
    const sealed = await readOptional(path);
    if (!sealed) return null;
    const operation = parseJournalRecord<ArchiveOperation>(
      await decrypt(this.#key, sealed, "operation-record"),
      "Invoice",
    );
    if (operation.id !== id) {
      throw new FactaError("archive_integrity_error", "Invoice journal ID does not match its archive path.", 0);
    }
    return operation;
  }
  async #writeOperation(
    operation: ArchiveOperation,
    create = false,
  ): Promise<void> {
    const sealed = await encrypt(
      this.#key,
      new TextEncoder().encode(JSON.stringify({ ...operation, schemaVersion: 1 })),
      "operation-record",
    );
    const path = await this.#operationPath(operation.id);
    if (create) await createExclusiveFile(path, sealed);
    else await this.#atomicWrite(path, sealed);
  }
  async #requireOperation(id: string): Promise<ArchiveOperation> {
    const value = await this.#readOperation(id);
    if (!value) throw new Error("Archive operation not found: " + id);
    return value;
  }
  async #operationPath(id: string): Promise<string> {
    return join(this.#directory, "operations", (await hashText(id)) + ".enc");
  }
  async #artifactBase(code: string, kind: "json" | "pdf" | "jws" | "ticket"): Promise<string> {
    return join(
      this.#directory,
      "artifacts",
      await hashText(code + ":" + kind),
    );
  }
  async #atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
    const temp = path + "." + crypto.randomUUID() + ".tmp";
    const handle = await open(temp, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temp, path);
      await syncDirectory(dirname(path));
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  }
}

function validateId(id: string): void {
  if (!/^[\w.:-]{1,128}$/.test(id)) {
    throw new TypeError(
      "operationId must be 1-128 letters, digits, dot, colon, underscore, or hyphen.",
    );
  }
}
function validateCode(code: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(code)) {
    throw new TypeError("codigoGeneracion must be a UUID.");
  }
}
