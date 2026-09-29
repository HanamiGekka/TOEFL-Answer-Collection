# Roadmap

R numbers define development scope, not product versions. The first public product version is 1.0.0.

- **R008.7.1 — Release candidate hardening: COMPLETE.** Consolidated documentation and tests, repaired Windows release startup, and verified a fresh NSIS installer and clean public source snapshot.
- **R008.8 — Public release v1.0.0.** The public source uses clean ancestry separate from the historical private development repository. The Windows release uses the reviewed NSIS package.
- **Maintenance.** Fix real defects and data-safety issues, review dependency/security advisories, and consider signing if distribution needs justify it. Future features require a separate decision.

The v1.0.0 installer is unsigned and Windows SmartScreen may warn.
