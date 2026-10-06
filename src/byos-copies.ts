import type { ArchiveArtifact, RemoteArtifactDestination } from "./archive.ts";
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

export interface SyncedDestinationSkip {
  destinationId: string;
  kind: string;
  reason: string;
}

/**
 * Turn the destinations snapshot into writers that use the canonical archive
 * paths and can be reported to Facta. Only kinds that can be written without a
 * person present are built (S3-compatible buckets and Supabase Storage); every
 * other entry is returned in `skipped` so the caller can warn about it.
 */
export function buildSyncedDestinations(
  snapshot: { destinos: Array<{ id: string; kind: string; label: string; secret: string }> },
  options: {
    environment: "00" | "01";
    identity: DocumentIdentity;
    fetch?: typeof fetch;
  },
): { destinations: RemoteArtifactDestination[]; skipped: SyncedDestinationSkip[] } {
  const jsonPath = canonicalArchivePath(options.environment, options.identity, "json");
  const pdfPath = canonicalArchivePath(options.environment, options.identity, "pdf");
  const pathForArtifact = (artifact: ArchiveArtifact): string => {
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
        canonicalCopy: { secretId: entry.id, jsonPath, pdfPath },
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
