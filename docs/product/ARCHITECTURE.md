# Architecture

Current release: 1.0.1, a local usability and cleanup maintenance release. Session schema remains v6 and SQLite schema is unchanged; official v1.0.0 dynamic v6 records remain supported.

TOEFL Answer Collection combines React/TypeScript, a Tauri Windows backend, and local SQLite, Recovery, export, and Typing storage. Practice starts with a validated Training name and selected Reading, Listening, or Writing sections. No materials directory or external question content is required.

## Current runtime

Only Session schema v6 with `structure_mode = dynamic_manual` is supported, including official v1.0.0 dynamic records. Pre-v6 Recovery is rejected as `UNSUPPORTED_SESSION_SCHEMA` without rewriting original files. R009 removed obsolete Speaking and Blueprint/module/task execution and migration code.

Sections start empty. Confirmed items receive stable consecutive identities (R1, L1, W1) and frozen single-choice, multiple-choice, short-text, or long-text configurations. Users define labels and optional time limits. Reading and Writing permit backward navigation; Listening follows practice/exam policy.

Batch creation validates an ordered recipe before placing one candidate in the Store and saving once. Failed saves retain the same candidate and identities. Templates contain recipes only, follow the current Data folder, and never enter session/export schema. Writing retains English input policy, metrics, and local per-item undo/redo. Existing v6 text is preserved on Recovery; text-policy notices are not schema migration.

## Timing and persistence

One monotonic anchor measures the current item. Navigation, pause, completion, save, and export settle it first. Rounded item milliseconds derive section/session totals, retaining explicit unattributed time. No anchor is persisted. Recovery validates identity, membership, options, answers, flags, and timing, starts paused, and resumes event numbering.

Snapshots and events are queued. A request during an in-flight save persists the newest state afterward, with window-close priority. The close coordinator holds timing, flushes settings/events/snapshots, and destroys the window only after successful persistence. Failure allows retry/cancel. Cancel resumes only a previously active session. Typing retains independent drafts and metrics.

## Storage and interface

Settings expose one Data folder. Internal `app_root`/APP_ROOT derives Records, Typing, Trash, Recovery, SQLite, and Logs. Default storage uses Tauri per-user app data. Configuration and last known good state live in per-user app configuration. Startup uses current valid configuration, current LKG, or current default; no old repository root discovery or transition notice remains.

Containment/canonical checks, absolute-path validation, write probes, atomic configuration replacement, and generation/context guards remain. Root changes do not migrate records. Optional `source_root` configuration and safe v6 `source_relative_path` are passive metadata and trigger no scan. New sessions omit source metadata.

Atomic export publishes a complete directory and index. Listing uses metadata rather than answer bodies. Trash/restore operates on record families; permanent TOEFL/Recovery deletion removes controlled payload, Recovery files, session row, timer events, and marker. Typing is a separate family. SQLite table definitions remain unchanged.

The central shortcut registry dispatches guarded actions through one listener. Settings show friendly action names, bindings, conflicts, and practical help; obsolete saved keys are ignored. Record cards show Training name, date, mode, sections, active/pause time, status, item counts, size, and actions. UUID, format, application/profile metadata, and relative path are in native collapsed details.

English is canonical; Simplified Chinese, Japanese, and Traditional Chinese maintain strict key parity. Translation does not change machine identifiers, user text, or exports. Shared grids support 560/720/900px layouts. The app reads no study materials, records no audio, has no network/telemetry feature, and does not grade answers.

See [data schema](DATA_SCHEMA.md), [export format](EXPORT_FORMAT.md), and [privacy and safety](PRIVACY_AND_SAFETY.md).
