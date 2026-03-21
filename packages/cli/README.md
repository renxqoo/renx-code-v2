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
