import type { ArchiveArtifact, RemoteArtifactDestination } from "./archive.ts";
import { createGoogleDriveArtifactDestination } from "./gdrive-artifact-destination.ts";
import type { DriveTokenBroker } from "./drive-token.ts";
import { createS3ArtifactDestination, type S3ArtifactStoreConfig } from "./s3-artifact-destination.ts";
import {
  createSupabaseArtifactDestination,
  type SupabaseArtifactStoreConfig,
} from "./supabase-artifact-destination.ts";

/** Folder Facta's app reads: `DTE/pruebas` for the test environment, `DTE` for production. */
export function archiveRoot(environment: "00" | "01"): string {
  return environment === "00" ? "DTE/pruebas" : "DTE";
}

export interface DocumentIdentity {
  numeroControl: string;
  fecEmi: string;
}

/** Canonical archive path: `archiveRoot/YYYY/MM/<numeroControl>.<ext>`. */
export function canonicalArchivePath(
  environment: "00" | "01",
  identity: DocumentIdentity,
  ext: "json" | "pdf",
): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(identity.fecEmi);
  if (!match) throw new TypeError("fecEmi must be a YYYY-MM-DD date.");
  if (!/^[A-Za-z0-9-]+$/.test(identity.numeroControl)) {
    throw new TypeError("numeroControl contains characters that are not valid in an archive path.");
  }
  return `${archiveRoot(environment)}/${match[1]}/${match[2]}/${identity.numeroControl}.${ext}`;
}

/** Read the control number and issue date from the exact legal JSON, never from a guess. */
export function readDocumentIdentity(jsonBytes: Uint8Array): DocumentIdentity {
  const parsed = JSON.parse(new TextDecoder().decode(jsonBytes)) as Record<string, unknown>;
  const ident = parsed.identificacion;
  const source = ident !== null && typeof ident === "object" ? ident as Record<string, unknown> : parsed;
  const numeroControl = source.numeroControl;
  const fecEmi = source.fecEmi;
  if (typeof numeroControl !== "string" || typeof fecEmi !== "string") {
    throw new TypeError("The legal JSON does not carry numeroControl and fecEmi.");
  }
  return { numeroControl, fecEmi };
}

const S3_FAMILY = new Set(["s3", "r2", "b2", "wasabi", "spaces", "minio"]);

/** Fields of a `gdrive` entry's decrypted secret that this SDK reads (the app's `GDriveConfig`). */
interface GoogleDriveVaultSecret {
  accessToken?: unknown;
  expiresAt?: unknown;
  folderId?: unknown;
  refreshToken?: unknown;
}

const DRIVE_NO_LONG_KEY =
  "This Google Drive has no long key: open Facta and press «Confirmar en Google» on that destination " +
  "(Este Drive no tiene llave larga: abra Facta y pulse «Confirmar en Google»).";
const DRIVE_TOKEN_UNAVAILABLE = "Google Drive could not be authorized from the long key; no copy was attempted";

function hasLongKey(config: GoogleDriveVaultSecret): config is GoogleDriveVaultSecret & { refreshToken: string } {
  return typeof config.refreshToken === "string" && config.refreshToken.trim() !== "";
}

/**
 * Register every long-keyed Drive of a snapshot with the broker and obtain a
 * first access token for each (once, in parallel). Never throws: a failure is
 * read back by `buildSyncedDestinations` as a skip carrying the error code.
 */
export async function prepareDriveTokens(
  snapshot: { destinos: Array<{ id: string; kind: string; secret: string }> },
  broker: DriveTokenBroker,
): Promise<void> {
  await Promise.all(snapshot.destinos.map(async (entry) => {
    if (entry.kind !== "gdrive") return;
    try {
      const config = JSON.parse(entry.secret) as GoogleDriveVaultSecret;
      if (!hasLongKey(config)) return;
      broker.seed(entry.id, config);
      await broker.prepare(entry.id);
    } catch {
      // The entry is reported by buildSyncedDestinations; never echo the secret.
    }
  }));
}

export interface SyncedDestinationSkip {
  destinationId: string;
  kind: string;
  reason: string;
}

/**
 * Turn the destinations snapshot into writers that use the canonical archive
 * paths and can be reported to Facta. Only kinds that can be written without a
 * person present are built (S3-compatible buckets, Supabase Storage and Google
 * Drive destinations that carry a long key); every
 * other entry is returned in `skipped` so the caller can warn about it.
 */
export function buildSyncedDestinations(
  snapshot: { destinos: Array<{ id: string; kind: string; label: string; secret: string }> },
  options: {
    environment: "00" | "01";
    /** Omit to build read-only destinations (no canonical write path, no `canonicalCopy`). */
    identity?: DocumentIdentity;
    fetch?: typeof fetch;
    /**
     * Renews access tokens for Google Drive destinations that carry a long key.
     * Without it a `gdrive` entry is skipped. Destinations are registered in it
     * here; call `broker.prepare(id)` beforehand (see `prepareDriveTokens`) so a
     * revoked key is reported as a skip with its code instead of failing a write.
     */
    drive?: DriveTokenBroker;
  },
): { destinations: RemoteArtifactDestination[]; skipped: SyncedDestinationSkip[] } {
  const identity = options.identity;
  const jsonPath = identity ? canonicalArchivePath(options.environment, identity, "json") : null;
  const pdfPath = identity ? canonicalArchivePath(options.environment, identity, "pdf") : null;
  const pathForArtifact = (artifact: ArchiveArtifact): string => {
    if (jsonPath === null || pdfPath === null) throw new TypeError("These destinations were built to read, not to write.");
    if (artifact.kind === "json") return jsonPath;
    if (artifact.kind === "pdf") return pdfPath;
    throw new TypeError("Only the legal JSON and PDF are written to synced destinations.");
  };
  const destinations: RemoteArtifactDestination[] = [];
  const skipped: SyncedDestinationSkip[] = [];
  for (const entry of snapshot.destinos) {
    try {
      let destination: RemoteArtifactDestination;
      if (S3_FAMILY.has(entry.kind)) {
        destination = createS3ArtifactDestination({
          id: entry.id,
          label: entry.label,
          config: JSON.parse(entry.secret) as S3ArtifactStoreConfig,
          pathForArtifact,
          ...(options.fetch ? { fetch: options.fetch } : {}),
        });
      } else if (entry.kind === "supabase") {
        destination = createSupabaseArtifactDestination({
          id: entry.id,
          label: entry.label,
          config: JSON.parse(entry.secret) as SupabaseArtifactStoreConfig,
          pathForArtifact,
          ...(options.fetch ? { fetch: options.fetch } : {}),
        });
      } else if (entry.kind === "gdrive") {
        const config = JSON.parse(entry.secret) as GoogleDriveVaultSecret;
        const broker = options.drive;
        if (!hasLongKey(config) || broker === undefined) {
          skipped.push({ destinationId: entry.id, kind: entry.kind, reason: DRIVE_NO_LONG_KEY });
          continue;
        }
        broker.seed(entry.id, config);
        const failure = broker.failure(entry.id);
        if (failure !== undefined) {
          skipped.push({ destinationId: entry.id, kind: entry.kind, reason: `${DRIVE_TOKEN_UNAVAILABLE} (${failure}).` });
          continue;
        }
        if (typeof config.folderId !== "string" || config.folderId.trim() === "") throw new TypeError("folderId missing");
        const base = options.fetch ?? fetch;
        // The broker owns the token: every request carries a current one, renewed
        // once for all concurrent artifacts, and a 401 forces one more renewal.
        const driveFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const headers = new Headers(init?.headers);
          headers.set("authorization", `Bearer ${await broker.token(entry.id)}`);
          return await base(input, { ...init, headers });
        }) as typeof fetch;
        const drive = createGoogleDriveArtifactDestination({
          id: entry.id,
          label: entry.label,
          config: { accessToken: "managed-by-broker", folderId: config.folderId },
          refreshAccessToken: () => broker.token(entry.id, { force: true }),
          pathForArtifact,
          fetch: driveFetch,
        });
        destination = {
          ...drive,
          // A token that cannot be had means nothing was written: report it as
          // unavailable rather than as an ambiguous write.
          write: async (artifact, writeOptions) => {
            let state: Awaited<ReturnType<typeof drive.write>>;
            try {
              state = await drive.write(artifact, writeOptions);
            } catch (cause) {
              if (broker.failure(entry.id) !== undefined && !writeOptions?.signal?.aborted) return "unavailable";
              throw cause;
            }
            return state !== "stored" && broker.failure(entry.id) !== undefined ? "unavailable" : state;
          },
        };
      } else {
        skipped.push({
          destinationId: entry.id,
          kind: entry.kind,
          reason: "This destination type cannot be written without the Facta app (it needs an interactive session).",
        });
        continue;
      }
      destinations.push({
        ...destination,
        kinds: ["json", "pdf"],
        ...(jsonPath !== null && pdfPath !== null ? { canonicalCopy: { secretId: entry.id, jsonPath, pdfPath } } : {}),
      });
    } catch {
      // Never echo the error: it can quote the credential JSON.
      skipped.push({
        destinationId: entry.id,
        kind: entry.kind,
        reason: "The destination configuration in the snapshot is not usable.",
      });
    }
  }
  return { destinations, skipped };
}
