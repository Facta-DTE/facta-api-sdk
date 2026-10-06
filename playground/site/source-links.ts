// Where the code is public. Every file the page shows has a «Ver en GitHub» link built from its path
// in this repository; `shown-files.ts` is the only place a path and its `?raw` text meet, and a test
// (`test/source-links.test.ts`) checks that each path exists and holds exactly the text shown.

export const REPO_URL = "https://github.com/Facta-DTE/facta-api-sdk";
export const PLAYGROUND_TREE_URL = `${REPO_URL}/tree/main/playground`;
export const NPM_URL = "https://www.npmjs.com/package/@facta-dte/api";
export const DOCS_URL = "https://sdk.factadte.com";
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

/** `https://github.com/Facta-DTE/facta-api-sdk/blob/main/<path>` for a repository-relative path. */
export const githubFileUrl = (path: string): string => `${REPO_URL}/blob/main/${path}`;
