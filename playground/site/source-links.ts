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

// The agent skill (skills/facta-dte-api). The zip is a static asset built by `playground:build`
// (playground/skill-zip-plugin.ts). The GitHub link points at `dev` until the skill reaches `main`:
// switch SKILL_GITHUB_BRANCH to "main" then, and nothing else changes.
export const SKILL_ZIP_URL = "/facta-dte-api-skill.zip";
export const SKILL_GITHUB_BRANCH = "main";
export const SKILL_GITHUB_URL = `${REPO_URL}/tree/${SKILL_GITHUB_BRANCH}/skills/facta-dte-api`;
