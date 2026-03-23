# @renxqoo/renx-code

Renx Code terminal AI coding assistant for the command line.

## Install

```bash
npm install -g @renxqoo/renx-code
```

## Usage

```bash
renx
renx --help
renx --version
```

## Supported Platforms

- macOS arm64
- macOS x64
- Linux arm64
- Linux x64
- Windows x64

Windows arm64 is not bundled yet because the current Bun compiler target matrix does not provide a native `bun-windows-arm64` executable target.

## Runtime Cache

The launcher copies installed native binaries into a user-scoped cache before execution. This keeps active Windows processes from locking files inside `node_modules` during upgrades.

- Default cache path on Windows: `%LOCALAPPDATA%\Renx\binary-cache`
- Override cache path: `RENX_BINARY_CACHE_DIR`
- Disable the cache for debugging: `RENX_DISABLE_BINARY_CACHE=1`

## Release

### GitHub Actions workflow

Use the manual GitHub Actions workflow at `.github/workflows/cli-release.yml`.

- Workflow name: `CLI Release`
- Trigger: `workflow_dispatch`
- Inputs:
  - `npm_tag`: optional npm dist-tag. Leave empty to publish with the default npm tag.
  - `otp`: optional one-time password for npm publish when your npm setup requires it.

The workflow publishes platform packages first, then publishes the main package only after all platform publishes succeed.

### Required secrets and permissions

Configure these before running the workflow:

- `NPM_TOKEN`: required. The workflow exposes it as `NODE_AUTH_TOKEN` for npm publish.
- npm package publish permission for `@renxqoo/renx-code` and the platform packages under the same scope.
- If your npm publish flow requires OTP, provide it through the `otp` workflow input when triggering the run.

### First release recommendation

For the first public release of a new version, prefer this sequence:

1. Run the workflow with `npm_tag=next`.
2. Verify install and execution from the published `next` tag on the platforms you care about.
3. Run the workflow again with an empty `npm_tag` value to publish to the default tag, or set `npm_tag=latest` explicitly if you want to be explicit.

This reduces the chance of breaking users on `latest` before the new platform packages are validated.

### Dist-tag usage

- Stable release: leave `npm_tag` empty, or set `npm_tag=latest`.
- Preview / canary release: set `npm_tag=next`.

Example installs:

```bash
npm install -g @renxqoo/renx-code@latest
npm install -g @renxqoo/renx-code@next
```

### Local verification commands

Before triggering the publish workflow, these local commands are useful:

```bash
pnpm --filter @renxqoo/renx-code release:pack -- --main-only --dry-run
pnpm --filter @renxqoo/renx-code release:pack -- --platform-only --target darwin-arm64 --dry-run
pnpm --filter @renxqoo/renx-code release:pack -- --platform-only --target darwin-x64 --dry-run
pnpm --filter @renxqoo/renx-code release:pack -- --platform-only --target linux-arm64 --dry-run
pnpm --filter @renxqoo/renx-code release:pack -- --platform-only --target linux-x64 --dry-run
pnpm --filter @renxqoo/renx-code release:pack -- --platform-only --target win32-x64 --dry-run
```

For local npm authentication checks, run:

```bash
pnpm --filter @renxqoo/renx-code release:preflight
```

### Local manual publish

If you need to publish outside GitHub Actions, use the same unified script entrypoints:

```bash
pnpm --filter @renxqoo/renx-code release:publish -- --platform-only --target darwin-arm64 --tag next
pnpm --filter @renxqoo/renx-code release:publish -- --main-only --tag next
```
