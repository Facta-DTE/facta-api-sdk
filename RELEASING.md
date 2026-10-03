# Releasing

The SDK uses npm Trusted Publishing from GitHub Actions. Releases are submitted to npm's staging area, where a maintainer reviews and approves the package with two-factor authentication before it becomes installable.

## One-time npm setup

The package must first exist on npm before npm can associate it with a trusted publisher. Do not configure a long-lived npm token in GitHub Actions. npm supports creating a new package through staged publishing, but the package name can become visible with a placeholder while the staged files remain unavailable. Review the tarball and choose how to bootstrap the package before doing that step.

After the first version has been created on npm, open the package's **Settings → Trusted publishers** page and add a GitHub Actions publisher with:

- Organization: `Facta-DTE`
- Repository: `facta-api-sdk`
- Workflow file: `publish.yml`
- Environment: leave empty
- Permission: allow staged publishing only (`npm stage publish`)

Trusted publishing requires GitHub-hosted runners, Node.js 22.14 or newer, npm 11.5.1 or newer, and the workflow's `id-token: write` permission. The release workflow pins npm 11.21.0 and runs on Node.js 24.

## Release a version

1. Update `version` in `package.json` and commit the release to `main`.
2. Create and push a matching version tag, such as `v0.1.0-beta.1`:

   ```sh
   git tag v0.1.0-beta.1
   git push origin v0.1.0-beta.1
   ```

3. GitHub Actions verifies that the tag matches `package.json`, that its commit is reachable from `main`, runs tests and the packed-consumer check, then stages the package on npm.
4. Review the staged files and metadata on npm. Approve the stage with 2FA to make it publicly available, or reject it to discard it.

Prerelease versions are staged with a dist-tag derived from the prerelease identifier (`beta`, `rc`, and so on). Stable versions use `latest`.

The workflow does not publish directly. npm generates provenance attestations for trusted publishing, and staged publishing keeps the version unavailable until a maintainer approves it.

## First package bootstrap

Trusted publisher setup depends on the package already existing on npm, so the first package creation cannot use this GitHub publisher yet. After reviewing the local tarball, create the package once through npm. `npm stage publish` can create a new package while keeping the staged version unavailable pending approval, though npm may show a public placeholder for the package name. A direct first publish makes the version public immediately. Once the package exists, configure the trusted publisher above; later versions can be staged by this workflow for manual approval.
