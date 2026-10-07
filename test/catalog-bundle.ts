import type { CatalogSnapshot } from "../src/types.ts";

// An encrypted catalog snapshot exactly as the server hands it out (the vault wrap + one sealed row).
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export async function encryptedCatalogBundle(snapshot: CatalogSnapshot, revision: number) {
  const encoder = new TextEncoder();
  const vaultId = "vault-1";
  const companyId = "company-1";
  const keyId = "key-1";
  const rowId = "catalog-1";
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const catalogIv = crypto.getRandomValues(new Uint8Array(12));
  const dekBytes = crypto.getRandomValues(new Uint8Array(32));
  const unlockMaterial = await crypto.subtle.importKey("raw", encoder.encode("factauk_test"), "HKDF", false, ["deriveKey"]);
  const wrappingKey = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("facta-api-vault-destinations") }, unlockMaterial,
    { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const wrappedDek = await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrapIv, additionalData: encoder.encode(`api-vault:${vaultId}:pass`) }, wrappingKey, dekBytes);
  const master = await crypto.subtle.importKey("raw", dekBytes, "HKDF", false, ["deriveKey"]);
  const catalogKey = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: encoder.encode("facta-api-vault-catalog") }, master,
    { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const aad = `api-secret:v2:${companyId}:${keyId}:catalog:catalog_snapshot:${rowId}:${revision}`;
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: catalogIv, additionalData: encoder.encode(aad) }, catalogKey, encoder.encode(JSON.stringify(snapshot)));
  const secret = { id: rowId, kind: "catalog_snapshot", iv: encode(catalogIv), ciphertext: encode(new Uint8Array(ciphertext)), formatVersion: 2, revision };
  const envelope = { id: secret.id, kind: secret.kind, iv: secret.iv, ciphertext: secret.ciphertext, formatVersion: secret.formatVersion, revision: secret.revision };
  const envelopeDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify([envelope])))), (b) => b.toString(16).padStart(2, "0")).join("");
  dekBytes.fill(0);
  return {
    companyId,
    vault: {
      id: vaultId,
      passSalt: encode(salt),
      wrapPass: { iv: encode(wrapIv), ciphertext: encode(new Uint8Array(wrappedDek)) },
      catalog: { ...secret, envelopeDigest, syncStatus: "ready", desiredRevision: revision, publishedRevision: revision },
    },
  };
}

