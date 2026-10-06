// The recipe files, imported as text: what the page shows is the file the Worker executes.
import issueIdempotent from "../../../server/recipes/issue-idempotent.ts?raw";
import prepareSign from "../../../server/recipes/prepare-sign.ts?raw";
import statusRecovery from "../../../server/recipes/status-recovery.ts?raw";
import invalidate from "../../../server/recipes/invalidate.ts?raw";
import documentsStorage from "../../../server/recipes/documents-storage.ts?raw";
import catalogRefs from "../../../server/recipes/catalog-refs.ts?raw";
import orderWebhook from "../../../server/recipes/order-webhook.ts?raw";

export const RECIPE_SOURCES: Record<string, string> = {
  "issue-idempotent": issueIdempotent,
  "prepare-sign": prepareSign,
  "status-recovery": statusRecovery,
  "invalidate": invalidate,
  "documents-storage": documentsStorage,
  "catalog-refs": catalogRefs,
  "order-webhook": orderWebhook,
};
