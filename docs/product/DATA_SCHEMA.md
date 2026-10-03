# Data Schema

Current release: 1.0.1, a local usability and cleanup maintenance release. Session schema remains v6 and SQLite schema is unchanged; official v1.0.0 dynamic v6 records remain supported.

Session schema remains **v6**; SQLite table definitions remain unchanged. The database is `data/answer_collection.sqlite3`; `practice_sessions.snapshot_json` stores the full snapshot. Existing relational tables remain without destructive migration.

## Dynamic snapshot

- `session_schema_version = 6`, `structure_mode = dynamic_manual`.
- `package_id` stores validated Training name. New sessions omit source metadata; official v1.0.0 v6 snapshots may retain safe optional `source_relative_path`. No material directory is read. The unchanged SQLite source column is empty for new sessions.
- `selected_sections` and `dynamic_sections` contain Reading, Listening, and Writing in fixed order. Sections store status, item IDs, next ordinal, lifecycle timestamps, and active/pause time.
- `questions` contains confirmed dynamic items only. Item identity combines section prefix and consecutive ordinal. Configuration freezes type ID, label, renderer, ordered option labels, optional limit, lifecycle, flags, visits, and timing.
- Renderers are `single_choice`, `multiple_choice`, `short_text`, and `long_text`. Choice labels are 2-10 unique nonempty strings. Answers are a label/null, label array, or text string. Long text retains metrics and local history.
- `item_type_registry` stores validated configurations. Future items do not exist. `modules` and `tasks` are empty persisted wire fields, with no execution/migration runtime. Official v1.0.0 v6 answer duration/progress aliases remain. Blueprint identity and nonempty module/task structures are invalid.

## Compatibility and time

Only dynamic v6 Recovery/export is supported. Older Recovery returns `UNSUPPORTED_SESSION_SCHEMA` without rewriting original data. One compact synthetic fixture generated with official v1.0.0 source verifies Recovery, serialization, index/filtering, and export.

Persisted milliseconds are finite nonnegative JavaScript safe integers rounded with `Math.round`; Rust receives `i64`. Required accumulators reject null, negative, fractional persisted input, and overflow. Nullable first-answer times and optional limits preserve null. Item time derives section/session totals with explicit unattributed time. CPM ratios may remain fractional. Monotonic anchors never enter storage; Recovery starts paused with a fresh anchor.

## Settings, Typing, indexes, and Trash

`app_settings` stores allowlisted shortcuts, filters, home view, locale, and templates. The independent template library is schema v1, limited to 20 blocks and 100 items per section recipe; it follows the Data folder without adding a table/session field. Obsolete shortcut keys are ignored, preserving valid current bindings.

Typing retains independent snapshots, events, minute samples, and localStorage draft schema v1. Session cleanup does not alter Typing records.

`record-index.json` contains listing metadata, not answers: identity, Training name, timestamps, mode, sections/item counts, time, status, schema/application/profile, relative directory, file list, and directory size. UI hides technical fields in collapsed details without deleting them. Atomic export computes size including the index by bounded fixed-point writes. Missing/zero old size uses a read-only fallback; listing does not rewrite old indexes.

`record_trash` stores identity, type, manifest, and move time. A TOEFL/Recovery family marker hides associated live Recovery; physical manifests cover interrupted publication before SQLite marking. Restore removes the matching marker and recalculates size. Permanent deletion removes related timer events, practice session, and marker in a SQLite transaction, then controlled Recovery/Trash files. Optional metadata in existing v6/Typing indexes and manifests remains readable/restorable.

Path configuration and LKG live in current per-user app configuration. Passive source fields remain accepted, but old repository configuration is not discovered. Root switching uses atomic replacement/generation guards and never migrates records automatically.
