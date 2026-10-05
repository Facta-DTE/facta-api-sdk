# Releasing

The SDK uses npm Trusted Publishing from GitHub Actions. Validated version tags publish directly to npm through OIDC. The npm trusted publisher must explicitly permit direct publishing; no separate staged-package approval is required.

## One-time npm setup

The npm Trusted Publisher is configured for this package. GitHub Actions uses OIDC; no long-lived npm token is stored in GitHub. The publisher settings are:

- Organization: `Facta-DTE`
- Repository: `facta-api-sdk`
- Workflow file: `publish.yml`
- Environment: leave empty
- Permission: allow direct publishing (`npm publish`); staged publishing remains available but is not used by this workflow

Trusted publishing requires GitHub-hosted runners, Node.js 22.14 or newer, npm 11.15.0 or newer, and the workflow's `id-token: write` permission. The release workflow pins npm 11.21.0 and runs on Node.js 24.

## Release a version

1. Update `version` in `package.json` and commit the release to `main`.
2. Create and push a matching version tag, such as `v0.2.1`:

   ```sh
   git tag -a v0.2.1 -m "Release @facta-dte/api 0.2.1"
   git push origin refs/tags/v0.2.1
   ```

3. GitHub Actions verifies that the tag matches `package.json`, that its commit is reachable from `main`, runs tests and the packed-consumer check, then publishes the package directly on npm.
4. Verify the release workflow, registry version/dist-tags, provenance, and installation in a fresh consumer. Never move an existing tag or republish a version.

Prerelease versions are published with a dist-tag derived from the prerelease identifier (`beta`, `rc`, and so on). Stable versions use `latest`.

npm generates provenance attestations for trusted publishing. Repository/workflow identity remains scoped to the configured trusted publisher; no saved npm publishing token is introduced. Changes to that publisher permission require owner confirmation and may require npm 2FA.

## Development validation

Open development pull requests against the `dev` branch. The `SDK CI` workflow runs the unit suite and packed-consumer check for pull requests to `dev` and `main`.

The staging live integration also runs for pull requests to `dev` that originate in this repository. It runs in the `staging-live-test` GitHub Environment (no manual approval) and issues one FE in the staging test environment. Fork pull requests do not receive the live-test secrets or run the live job. The test API key must have `issue`, `query`, and `download` scopes. Live checks stop before issuance if those scopes are missing.

After a live run, the workflow summary and pull request comment contain only an allowlisted validation table. Signed JSON/PDF are verified in memory and in an encrypted temporary archive, which is removed after the run. No fiscal documents, document links, generation codes, control numbers, issuer/customer identifiers, or raw API errors are uploaded or published. The test run emits one test-environment FE for $0.01; it does not issue a production invoice. Optional additional DTE coverage requires authorized fixtures and key permissions, and missing coverage is reported explicitly.
