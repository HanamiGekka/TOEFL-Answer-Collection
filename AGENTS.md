# Agent rules — TOEFL Answer Collection

## Purpose and architecture

TOEFL Answer Collection is a local-first TOEFL answer recorder and typing app with a React/TypeScript frontend in `app/src`, a Tauri/Rust backend in `app/src-tauri`, and tests beside source or in `app/scripts`. Real training content stays outside the repository. New sessions use dynamic schema v6; older readers and exporters remain compatibility code. Historical development ancestry stays in a private repository; public releases use reviewed clean snapshots.

## Version, rounds and branches

`VERSION` is the display version (`1.0.0`); npm/Cargo/Tauri use the same SemVer. Change these together only by deliberate product version decision. `R00X`, `R00X.M`, and `R00X.M.N` identify work scope, not releases. Name branches like `r008-1-recovery-integrity` and keep each within its round.

## Git permissions and protected areas

By default, agents must not run `git add`, `git commit`, `git merge`, `git rebase`, `git tag`, `git push`, or history rewrite without a specific user instruction. Before handoff inspect `git status`, `git diff --stat`, and `git diff --check`. Never use `git clean -fdx`.

Without specific user authorization, do not modify, move or delete `Demand/`, `Code prompt/`, `data/`, `records/`, `typing_records/`, `backups/`, `exports/`, `logs/`, `trash/`, `.git/`, or real material in `../Organized_TOEFL_Resources/`. Treat unknown data as private. Never recursively delete by wildcard. Resolve exact targets, verify they stay inside the authorized root, and reject symlink/junction escapes.

## Compatibility and data safety

Preserve schema v2–v5 readers, legacy Speaking, Listening 35+12 and 32+15, old Blueprints and Recovery. Do not delete them because new sessions do not use them. Keep schema v6 stable unless a task expressly requires migration. Use synthetic fixtures; never copy real TOEFL text, media or personal answers into tests, samples, logs or a public handoff. Do not automatically migrate real records.

## Verification

For changed behavior, write meaningful regression tests, preferably RED → GREEN, and run relevant checks. From `app/`: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, plus `npm run e2e` when relevant. From `app/src-tauri/`: `cargo fmt --check`, `cargo check --locked`, `cargo test --locked`. Do not run ignored destructive fixture tests without a verified disposable root. Report failures and skips honestly; automated pass alone does not mean release ready.

Automated tests carry primary regression responsibility. Manual testing is for real Tauri/OS behavior, difficult UI interaction, installation/permissions/system integration, and visual confirmation. An ordinary round should require at most one or two concentrated, risk-based smoke flows. Do not ask users to repeat an invariant precisely covered by automation or perform an impossible product lifecycle flow. Remove a round-specific manual checklist after it is complete.

## Documentation and temporary data

The repository root holds `README.md`, `LICENSE`, `AGENTS.md`, `VERSION`, and project/tool configuration only. `docs/product/` describes current product behavior and architecture. `docs/development/CHANGELOG.md` records user-visible changes only; `ROADMAP.md` lists future scope only; `DEVELOPMENT_LOG.md` compresses engineering history; `CURRENT_ROUND.md` states the current round only; `KNOWN_ISSUES.md` lists real open issues only. `docs/testing/TEST_STATUS.md` holds the latest verification and is the only durable testing report. Avoid duplicate round reports, checklists, and audits.

Engineering, developer, test, architecture, data and agent-facing documentation is English only. `README.md` is the one multilingual user-facing README, ordered English, Simplified Chinese, Japanese, Traditional Chinese. Do not recreate separate localized README files. The UI supports `en`, `zh-CN`, `ja` and `zh-TW`; English is the canonical translation source and the only fallback. Never translate machine identifiers, persisted keys or user-entered text. New agent-generated engineering documents must be in English.

Keep plans, raw audit output, round reports, checklists and generated test data temporary. At close, absorb stable facts into proper documents and remove completed temporary material without an archive. Retain tracked test source and synthetic fixtures. Generated Sessions, Recovery, SQLite, logs, exports and temporary roots are cleanup candidates only when origin, scope and lack of unique evidence are verified; real user data remain protected.

## Logging and ChatGPT handoff

At round start update `docs/development/CURRENT_ROUND.md`. During work keep detailed output in the working context. At close update product docs if behavior changed, open issues, latest test status, and one concise `DEVELOPMENT_LOG.md` entry. A round-specific user instruction may authorize commits and pushes.

For ChatGPT review, use ignored `temp/` as a single flat directory: put `00_HANDOFF.md` and at most 19 byte-identical copies of current repository files directly in `temp/` (20 files total), with no subdirectories. Use distinct flat filenames and map each copy to its original path in the handoff. List omitted relevant files; exclude protected/private data. `temp/` is neither source of truth, backup, archive nor Git evidence. Before applying feedback, re-read current repository files and compare them with copies.

## Definition of done and release boundary

Complete authorized scope, regression and compatibility checks, documentation, safe cleanup, diff/link review and precise handoff. Distinguish code completion, automated pass, manual UI/export pass, automated Recovery pass and release readiness. Public release, installer and Git operations require separate scope and verification.

Keep the historical development repository private and its history intact. Public releases use separately reviewed clean baseline/history. Never import private ancestry, real records, private prompts, or study materials into a public repository. When working in the private repository, preserve its visibility and history; when working in the public repository, keep source and release assets public-safe.
