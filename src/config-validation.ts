import type { FactaConfigV1 } from "./client.ts";

const CONFIG_KEYS = new Set([
  "version",
  "expectedEnvironment",
  "requiredScopes",
  "allowStaleCatalogReads",
  "ticketPaperWidthMm",
  "timeoutMs",
  "maxRetries",
  "baseUrl",
]);

export function validateFactaConfig(
  value: unknown,
): asserts value is FactaConfigV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Facta config must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new TypeError(`Unknown Facta config key: ${key}.`);
    }
  }
  if (record["version"] !== 1) {
    throw new TypeError("Facta config version must be 1.");
  }
  if (
    record["expectedEnvironment"] !== undefined &&
    record["expectedEnvironment"] !== "00" &&
    record["expectedEnvironment"] !== "01"
  ) {
    throw new TypeError("config.expectedEnvironment must be '00' or '01'.");
  }
  if (
    record["requiredScopes"] !== undefined &&
    (!Array.isArray(record["requiredScopes"]) ||
      record["requiredScopes"].some((scope) =>
        typeof scope !== "string" || scope.length === 0
      ))
  ) {
    throw new TypeError(
      "config.requiredScopes must be an array of non-empty strings.",
    );
  }
  if (
    record["allowStaleCatalogReads"] !== undefined &&
    typeof record["allowStaleCatalogReads"] !== "boolean"
  ) {
    throw new TypeError("config.allowStaleCatalogReads must be a boolean.");
  }
  if (
    record["ticketPaperWidthMm"] !== undefined &&
    (!Number.isInteger(record["ticketPaperWidthMm"]) ||
      Number(record["ticketPaperWidthMm"]) < 40 ||
      Number(record["ticketPaperWidthMm"]) > 120)
  ) {
    throw new TypeError(
      "config.ticketPaperWidthMm must be an integer from 40 through 120.",
    );
  }
  if (
    record["maxRetries"] !== undefined &&
    (!Number.isInteger(record["maxRetries"]) ||
      Number(record["maxRetries"]) < 0 ||
      Number(record["maxRetries"]) > 10)
  ) {
    throw new TypeError(
      "config.maxRetries must be an integer from 0 through 10.",
    );
  }
  if (
    record["timeoutMs"] !== undefined &&
    (!Number.isInteger(record["timeoutMs"]) ||
      Number(record["timeoutMs"]) < 1 ||
      Number(record["timeoutMs"]) > 300_000)
  ) {
    throw new TypeError(
      "config.timeoutMs must be an integer from 1 through 300000.",
    );
  }
  if (record["baseUrl"] !== undefined) {
    if (typeof record["baseUrl"] !== "string") {
      throw new TypeError("config.baseUrl must be a URL string.");
    }
    let url: URL;
    try {
      url = new URL(record["baseUrl"]);
    } catch {
      throw new TypeError(
        "config.baseUrl must be an absolute HTTP or HTTPS URL.",
      );
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") || url.username ||
      url.password || url.search || url.hash
    ) {
      throw new TypeError(
        "config.baseUrl must use HTTP(S) and contain no credentials, query, or fragment.",
      );
    }
  }
}
