# Releasing

The SDK uses npm Trusted Publishing from GitHub Actions. Releases are submitted to npm's staging area, where a maintainer reviews and approves the package with two-factor authentication before it becomes installable.

## One-time npm setup

The npm Trusted Publisher is configured for this package. GitHub Actions uses OIDC; no long-lived npm token is stored in GitHub. The publisher settings are:

- Organization: `Facta-DTE`
- Repository: `facta-api-sdk`
- Workflow file: `publish.yml`
- Environment: leave empty
- Permission: allow staged publishing only (`npm stage publish`)

Trusted publishing requires GitHub-hosted runners, Node.js 22.14 or newer, npm 11.5.1 or newer, and the workflow's `id-token: write` permission. The release workflow pins npm 11.21.0 and runs on Node.js 24.

## Release a version

1. Update `version` in `package.json` and commit the release to `main`.
2. Create and push a matching version tag, such as `v0.1.0`:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. GitHub Actions verifies that the tag matches `package.json`, that its commit is reachable from `main`, runs tests and the packed-consumer check, then stages the package on npm.
4. Review the staged files and metadata on npm. Approve the stage with 2FA to make it publicly available, or reject it to discard it.

Prerelease versions are staged with a dist-tag derived from the prerelease identifier (`beta`, `rc`, and so on). Stable versions use `latest`.

The workflow does not publish directly. npm generates provenance attestations for trusted publishing, and staged publishing keeps the version unavailable until a maintainer approves it.

## Development validation

Open development pull requests against the `dev` branch. The `SDK CI` workflow runs the unit suite and packed-consumer check for pull requests to `dev` and `main`.

The staging live integration also runs for pull requests to `dev` that originate in this repository. It waits for approval of the `staging-live-test` GitHub Environment before accessing the test secrets and issuing one FE in the staging test environment. Fork pull requests do not receive the live-test secrets or run the live job. The test API key must have `issue`, `query`, and `download` scopes. Live checks stop before issuance if those scopes are missing.

After a successful live run, the workflow summary and pull request comment report the test FE status, identifiers, issue time, and total. The exact downloaded legal JSON and PDF are uploaded as the `staging-invoice` workflow artifact for 7 days. The test run emits one real test-environment FE for $0.01; it does not emit a production invoice. Because this repository is public, its workflow artifacts can be downloaded by anyone with repository read access. Keep test issuer data suitable for public disclosure, or remove the JSON/PDF upload before running against data that must stay private.
