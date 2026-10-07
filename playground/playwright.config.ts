import { defineConfig } from "@playwright/test";

// Smoke tests against a running playground. Not run in CI yet.
//   PLAYGROUND_BASE_URL=http://localhost:8787 pnpm playground:smoke
// A deployed site behind Cloudflare Access needs a service-token header:
//   PLAYGROUND_ACCESS_CLIENT_ID / PLAYGROUND_ACCESS_CLIENT_SECRET
const extraHTTPHeaders: Record<string, string> = {};
if (process.env.PLAYGROUND_ACCESS_CLIENT_ID && process.env.PLAYGROUND_ACCESS_CLIENT_SECRET) {
  extraHTTPHeaders["CF-Access-Client-Id"] = process.env.PLAYGROUND_ACCESS_CLIENT_ID;
  extraHTTPHeaders["CF-Access-Client-Secret"] = process.env.PLAYGROUND_ACCESS_CLIENT_SECRET;
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.PLAYGROUND_BASE_URL ?? "http://localhost:8787",
    extraHTTPHeaders,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "phone", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
});
