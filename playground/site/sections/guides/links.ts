import { githubFileUrl } from "../../source-links.ts";

// Where the guides point when they send the reader to the SDK's own documentation. The reference lives in
// the repository today; when the playground gets its own «Referencia del SDK» section, change it here and
// every guide follows.
export const SDK_REFERENCE: { label: string; href: string } = {
  label: "Referencia del SDK",
  href: `${githubFileUrl("guides/reference.md")}#dte-operations`,
};

export const STORAGE_GUIDE_URL = githubFileUrl("guides/storage-adapters.md");
export const CATALOG_GUIDE_URL = githubFileUrl("guides/catalog.md");
export const REACT_GUIDE_URL = githubFileUrl("guides/react.md");
export const REACT_SERVER_GUIDE_URL = githubFileUrl("guides/react-server.md");
export const DELIVERY_DOC_URL = githubFileUrl("docs/api-delivery-tokens.md");

export const recipeLink = (label: string, id: string) => ({ label, to: `/servidor?receta=${id}` });
