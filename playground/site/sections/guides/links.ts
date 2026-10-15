import { githubFileUrl } from "../../source-links.ts";

/** A card of the playground's own «Referencia del SDK» page (`/referencia#<entry id>`, ids in shared/sdk-coverage.ts). */
export const referenceLink = (what: string, entry?: string) => ({
  label: `Referencia del SDK: ${what} →`,
  to: entry === undefined ? "/referencia" : `/referencia#${entry}`,
});

export const STORAGE_GUIDE_URL = githubFileUrl("guides/storage-adapters.md");
export const CATALOG_GUIDE_URL = githubFileUrl("guides/catalog.md");
export const REACT_GUIDE_URL = githubFileUrl("guides/react.md");
export const REACT_SERVER_GUIDE_URL = githubFileUrl("guides/react-server.md");
export const DELIVERY_DOC_URL = githubFileUrl("docs/api-delivery-tokens.md");

export const recipeLink = (label: string, id: string) => ({ label, to: `/servidor?receta=${id}` });
