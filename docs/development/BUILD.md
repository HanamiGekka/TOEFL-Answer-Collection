# Development and build guide

The packaged Windows app does not need a development environment. For ordinary use, download the installer linked from the [README](../../README.md).

## Toolchain

- Node.js **24.18.0**, pinned in `app/.nvmrc`; `app/package.json` accepts compatible versions in the 24 series.
- Rust **1.96.1**, pinned in `app/src-tauri/rust-toolchain.toml`.
- Windows Tauri prerequisites, including the MSVC build tools and Microsoft Edge WebView2.

Use the committed npm and Cargo lockfiles. Use `npm install` only when deliberately maintaining dependencies and updating the npm manifests, then verify with `npm ci`.

## Frontend, audits and desktop development

From `app/`:

```powershell
npm ci
npm audit --package-lock-only --ignore-scripts --audit-level=high
npm run audit:privacy
npm run audit:i18n
npm run audit:public-release
npm run typecheck
npm run lint
npm run test
npm run build
npm run e2e
npm run tauri:dev
```

The independent Documentation checks workflow runs without installing application dependencies. It validates the public-safe snapshot independently of the full CI dependency/build checks. The full CI security gates remain enabled.

The existing privacy and public-release audits check the reviewed public surface, local Markdown links, four README language anchors and release facts. The synthetic screenshot is individually allowlisted and pinned by SHA-256; this does not allow arbitrary binary files.

The 2026-10-18 maintenance lockfile uses development-only `source-map-js` **1.2.2**, within PostCSS's existing `^1.2.1` range, for [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). This changes no direct dependency, application source, Session schema, version or frozen v1.0.1 installer. Current source checks do not establish the security status of an older binary.

## Rust checks

From `app/src-tauri/`:

```powershell
cargo fmt --check
cargo check --locked
cargo test --locked
cargo audit
```

## Windows packaging

From `app/` on Windows:

```powershell
npm run tauri:build
npm run verify:windows-release
```

The canonical package is a current-user NSIS installer. The current v1.0.1 release is unsigned. A new local build is not a replacement for the frozen official installer. CI checks Ubuntu frontend behavior and Windows native/packaging behavior; only completed results apply to their exact commits.

## Data and compatibility boundaries

Use synthetic fixtures and isolated data roots for development. Never commit real answers, study materials, Recovery, SQLite, exports, local settings or private development history. Runtime Session schema remains **v6**; official v1.0.0 dynamic-v6 records are supported, while pre-v6 records and Speaking are unsupported. See [architecture](../product/ARCHITECTURE.md), [schema](../product/DATA_SCHEMA.md) and [privacy](../product/PRIVACY_AND_SAFETY.md).
