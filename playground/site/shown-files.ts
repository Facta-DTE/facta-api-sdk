// Every source file the playground shows, imported as text with `?raw` next to its repository path.
// The page shows `SOURCES[path]` and links `githubFileUrl(path)`, so the code, the link and the
// executed file cannot drift apart.

import appearance from "./sections/screens/examples/appearance-studio.tsx?raw";
import delivery from "./sections/screens/examples/delivery.tsx?raw";
import dialog from "./sections/screens/examples/dialog.tsx?raw";
import documentDetail from "./sections/screens/examples/document-detail.tsx?raw";
import documentList from "./sections/screens/examples/document-list.tsx?raw";
import drawer from "./sections/screens/examples/drawer.tsx?raw";
import inline from "./sections/screens/examples/inline.tsx?raw";
import invalidate from "./sections/screens/examples/invalidate.tsx?raw";
import issueButton from "./sections/screens/examples/issue-button.tsx?raw";
import pickers from "./sections/screens/examples/pickers.tsx?raw";
import receipt from "./sections/screens/examples/receipt.tsx?raw";
import serviceStatus from "./sections/screens/examples/service-status.tsx?raw";
import windowHook from "./sections/screens/examples/window-hook.tsx?raw";
import liveInvoice from "./sections/home/live-invoice.tsx?raw";
import checkout from "./sections/headless/checkout-form.tsx?raw";
import credit from "./sections/headless/credit-switch.tsx?raw";
import outcome from "./sections/headless/outcome.tsx?raw";
import pos from "./sections/headless/pos-keypad.tsx?raw";
import router from "../server/router.ts?raw";
import sale from "../server/sale.ts?raw";
import deliveryServer from "../server/delivery.ts?raw";
import orderKey from "../server/order-key.ts?raw";
import catalogRefs from "../server/recipes/catalog-refs.ts?raw";
import deliverEmail from "../server/recipes/deliver-email.ts?raw";
import documentsStorage from "../server/recipes/documents-storage.ts?raw";
import invalidateRecipe from "../server/recipes/invalidate.ts?raw";
import issueIdempotent from "../server/recipes/issue-idempotent.ts?raw";
import orderWebhook from "../server/recipes/order-webhook.ts?raw";
import prepareSign from "../server/recipes/prepare-sign.ts?raw";
import statusRecovery from "../server/recipes/status-recovery.ts?raw";
import { githubFileUrl } from "./source-links.ts";

const S = "playground/site/sections/";
const R = "playground/server/recipes/";

export const SOURCES = {
  [`${S}screens/examples/appearance-studio.tsx`]: appearance,
  [`${S}screens/examples/delivery.tsx`]: delivery,
  [`${S}screens/examples/dialog.tsx`]: dialog,
  [`${S}screens/examples/document-detail.tsx`]: documentDetail,
  [`${S}screens/examples/document-list.tsx`]: documentList,
  [`${S}screens/examples/drawer.tsx`]: drawer,
  [`${S}screens/examples/inline.tsx`]: inline,
  [`${S}screens/examples/invalidate.tsx`]: invalidate,
  [`${S}screens/examples/issue-button.tsx`]: issueButton,
  [`${S}screens/examples/pickers.tsx`]: pickers,
  [`${S}screens/examples/receipt.tsx`]: receipt,
  [`${S}screens/examples/service-status.tsx`]: serviceStatus,
  [`${S}screens/examples/window-hook.tsx`]: windowHook,
  [`${S}home/live-invoice.tsx`]: liveInvoice,
  [`${S}headless/checkout-form.tsx`]: checkout,
  [`${S}headless/credit-switch.tsx`]: credit,
  [`${S}headless/outcome.tsx`]: outcome,
  [`${S}headless/pos-keypad.tsx`]: pos,
  "playground/server/router.ts": router,
  "playground/server/sale.ts": sale,
  "playground/server/delivery.ts": deliveryServer,
  "playground/server/order-key.ts": orderKey,
  [`${R}catalog-refs.ts`]: catalogRefs,
  [`${R}deliver-email.ts`]: deliverEmail,
  [`${R}documents-storage.ts`]: documentsStorage,
  [`${R}invalidate.ts`]: invalidateRecipe,
  [`${R}issue-idempotent.ts`]: issueIdempotent,
  [`${R}order-webhook.ts`]: orderWebhook,
  [`${R}prepare-sign.ts`]: prepareSign,
  [`${R}status-recovery.ts`]: statusRecovery,
} as const satisfies Record<string, string>;

export type SourcePath = keyof typeof SOURCES;

/** A file the page shows: its repository path and its text. */
export interface SourceFile {
  path: SourcePath;
  code: string;
}

export const sourceFile = (path: SourcePath): SourceFile => ({ path, code: SOURCES[path] });

/** `playground/site/sections/screens/examples/dialog.tsx` -> `examples/dialog.tsx`. */
export const shortName = (path: string): string => path.replace(/^playground\/(site\/sections\/screens\/|site\/sections\/|server\/)?/, "");

export const sourceUrl = (path: SourcePath): string => githubFileUrl(path);
