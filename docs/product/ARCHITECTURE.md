# Architecture

## Overall structure

The app combines a local Tauri backend, a TypeScript dynamic Session/Item core, a React right-half-screen UI, and SQLite/recovery/Typing-draft recovery layers. Read-only scanning of real packages enumerates only immediate package folder names. All runtime writes are confined to APP_ROOT.

```text
User-confirmed dynamic Item (R1 / L1 / W1 ...)
      ↓
Safe renderer registry + answer/timing lifecycle
      ↓
Section → Session
      ↓
SQLite / recovery / events / exports
```

## Configuration and management layer

```text
package_id + source_relative_path metadata
      → empty Reading / Listening / Writing Sections
      → user-confirmed Item creation + safe renderer registry
      → Session snapshot + event seq + lightweight record index

React Records / Recovery / Settings
      → typed Tauri commands
      → Rust root-specific resolver
      → records / typing_records / data/recovery / trash
```

- Settings edit APP_ROOT and SOURCE_ROOT separately. The writable APP_ROOT defaults to Tauri's `app_local_data_dir`; the external read-only SOURCE_ROOT may be empty. The frontend previews and backend enforces derivation of `records`, `typing_records`, `trash`, `data/recovery`, SQLite, and `logs`. SOURCE_ROOT scanning sees only immediate package folder names and validation writes nothing. Equal, nested, or link-overlapping roots are rejected. An unset or temporarily unavailable source produces a recoverable new-package scan error without blocking local data and settings.
- Path configuration separates persisted valid state from an unsaved component draft. Tauri `app_config_dir` is the new write location for configuration and LKG; old repository `config/app-settings.local.json`, `app-settings.json`, and LKG are read-only fallbacks. A temporary file and atomic replace write the new location only after successful validation and explicit confirmation; failure does not switch active state. With no valid configuration, the app uses Tauri's per-user default APP_ROOT and empty SOURCE_ROOT. Old repository data is not migrated; startup and Settings prompt the user to select the old APP_ROOT manually when needed.
- APP_ROOT switching and setting mutations share a generation/context guard and serialized queue; requests bound to the old root are rejected before writing. Startup hydration, clicking the already selected page, and closing flushes do not create new setting mutations. Only real user transitions are saved.
- New Sessions do not infer item counts, types, or order from Blueprint or package filenames. `config/blueprints/toefl-2026.json` and overrides remain only for v2–v5 legacy Session/Recovery compatibility, with status `LEGACY_NEW_SESSION_DISABLED`.
- `itemTypeRegistry` is v6's sole renderer mapping and permits only single choice, multiple choice, short text, and long text. Users may save display labels, 2–10 ordered unique option labels, and optional limits, but an arbitrary string cannot load a remote or dynamic component. R008.5 displays known system presets by stable `type_id` and locale resources while preserving persisted labels and custom text.
- `itemBatchRegistry` holds stable built-in batch IDs, type IDs, counts, and locale display keys. `dynamicSession.createDynamicItemBatch` prechecks every block, ordinal, ID, and registry entry in one pure operation before returning a candidate Session. Only the first item is entered; later items receive visit time through `enterDynamicItem` on actual navigation. The Store has a pending guard for batch submission and saves the one candidate once.
- `itemTemplate` stores only an ordered per-Section creation recipe. System types refer to stable IDs; custom types retain a validated config snapshot. The library uses the current APP_ROOT's `app_settings.item_templates`; corrupt settings retain their original value and show an error. Template definitions do not enter Session snapshots, the item type registry, or exports.
- Central shortcuts use one Registry and one window listener. Every action calls existing Store/engine behavior and cannot bypass navigation, pause, Task pending, or Speaking guards.
- Record lists consume only lightweight indexes, bounded summaries, directory metadata, or SQLite `json_extract/json_valid` fields, not full answer text.
- Rust resolves file operations by separate records, typing, recovery, and trash roots and checks boundaries after canonicalization. The frontend passes only record identity and controlled relative paths.
- Recovery continues the maximum persisted event sequence, starts paused with a new process-local pause anchor, and never persists or reuses an old `performance.now()` anchor.
- Continue practice, structured incomplete export, and raw diagnostic export are three Recovery boundaries. The first two migrate schema and validate business structure; raw export only copies snapshot/events within a controlled root and generates a manifest without answer content, without parsing the Session.
- `data/recovery` is the live recovery source for unfinished, paused, save-close, and export-failed Sessions and is used by Continue, incomplete export, and Record Manager. A completed/exported Session cleans live snapshot/events only after the formal index/file set, SQLite completed row, snapshot/event save queue, and non-Active state are confirmed. Validation or cleanup failure preserves safe data and offers cleanup-only retry. `records/recovery-diagnostics` holds only user-requested read-only diagnostic copies and does not participate in Continue.
- A physical TOEFL bundle, Recovery snapshot/events, SQLite row, and Trash payload may share one logical identity. TOEFL and Recovery merge by TOEFL family plus `session_id`; Typing has its own family and does not merge on matching Session text. Historical completed/exported remnants are `STALE_TERMINAL_RECOVERY`, attached to the formal TOEFL record, and permit explicit cleanup only.
- In v6, ReviewPanel reads progress and skip/uncertain/overtime for created Items, including batch-created but unvisited Items. The current item has a yellow border and `aria-current`. Uncreated Items and Modules are not shown.
- A v6 Section's lifecycle covers only created Items. An empty Section can be explicitly skipped and reopened. Next navigates to an already batch-created next item in the same Section before offering the creation dialog after the last item. Canceling creation adds no identity or event.
- For schema v5 snapshots with an earlier Blueprint version, persisted Questions/Modules define recovery structure. Blueprint 1.2.0's 35+12 and 1.1.0's single `LISTENING_SECTION` are not silently rewritten by another Blueprint. Answers, Module status, time, event sequence, and flags remain. Schemas v2/v3/v4 use existing nondestructive compatibility construction.

## UI theme layer

`app/src/styles/theme.css` is the single source of design tokens for color, radius, and shadow and loads before `styles.css`. `styles.css` describes brand regions, canvas, surfaces, text, borders, status, focus, overlay, and scrollbar only through semantic tokens. React components hold no concrete color values.

`TOEFL Reference Light Theme` is a local approximation from read-only references, not an official ETS theme or palette. The theme consumes existing classes and state without writing to the Store. ReviewPanel derives current, answered, skipped, uncertain, and overtime classes from existing progress/flags; the business model still supplies status text and `aria-current`. Home, Records, Settings, dynamic Items, Writing, Typing, Recovery, Trash, Summary, and overlays share one token layer; legacy Speaking remains only while running old records. Existing grids and breakpoints control 560/720/900px layouts.

## Schema v6 Dynamic Manual Runtime

- `session_schema_version = 6` and `structure_mode = dynamic_manual`; only package ID, relative source path, creation time, mode, and selected Reading/Listening/Writing Sections are stored.
- `dynamic_sections[]` stores Section status, ordered Item identities, next ordinal, and active/pause time. In v6, `questions[]` carries created `DynamicPracticeItem` instances; `modules[]` and `tasks[]` stay empty.
- Each Item freezes a `type_id/type_label/renderer/option_labels/custom_time_limit_ms` config snapshot; later registry changes do not rewrite it.
- Long text retains controlled English input, metrics, and local undo/redo history. Single choice saves one label, multiple choice a label array, and short text a string.
- Recovery validates v6 directly without migrating it to v5, starts paused, and continues event sequencing. Record/Trash metadata store structure mode and created Item counts per Section.

## Legacy schema v2–v5 Session Runtime

- Reading and Blueprint 1.2.0/1.3.0 Listening use two-Module Question runtime; 1.1.0 Listening's single scope remains only for Recovery compatibility.
- Writing has three independent Task scopes: Build a Sentence, Email, and Academic Discussion.
- Speaking has Listen and Repeat (SR1–SR7) and Interview (SI1–SI4) Task scopes.
- Tasks store status, active/pause, limit/remaining, attempts, overtime, needs retry, and timestamps. Writing additionally stores full text, metrics, and editing history.
- Schemas v2/v3/v4 nondestructively construct v5 Tasks from old questions/answers/scopes while preserving old answers, time, status, and events.

## Single timing source

Runtime still has one `currentActivityId` and one monotonic-clock anchor. Speaking has no active anchor before explicit Start. Navigation, pause, Task/Scope completion, save, and export settle the current activity first; no independent drifting Task clock is created.

Email and Academic Discussion active/remaining/overtime are derived through `getTaskTimingState`. An old snapshot's Question `time_limit_ms` remains readable for compatibility but no longer drives long-writing UI or export. One-shot `overtime_event_recorded` prevents duplicate timeout events after restore.

```text
v6 Section = sum(created Items)
legacy Task = sum(mapped Questions/items)
legacy Scope = sum(Tasks) or compatible Questions
legacy Section = sum(Scopes)
Session = sum(Sections) + unattributed_active_time_ms
```

A single persistence boundary rounds every formal duration with `Math.round` to a nonnegative safe integer before JSON, CSV, record index, Recovery, or Rust `i64`. Explicit null for required accumulators is rejected. Nullable lifecycle metadata such as Answer `first_answer_elapsed_ms` may be missing or retain null; null means no reliable relative millisecond value, not zero. Fractional `performance.now()` values in Typing exist only at runtime; ratios such as CPM/WPM/retention are not rounded. Global pause adds no active time and is charged as pause time to the currently started Task.

## Transaction boundaries

v6 Item switching settles current timing before saving the newest state. Batch creation completes every pure precheck, places one candidate in the Store, and persists it once. On save failure, the candidate, original numbering, and error remain; retry saves the same Session without generating Items again. Legacy Writing Tasks and Speaking items retain their transaction boundaries. Speaking results/retries append events without overwriting old attempt events.

Speaking Start/Retry establishes a 750ms monotonic guard tied to Task ID and attempt. A Store-level pending state rejects duplicate actions during asynchronous persistence. Pause and real timeouts remain available. The in-memory guard is absent from snapshots.

`NEEDS_RETRY` is a persisted Speaking outcome. It is not `COMPLETED`, but Scope/Session may finalize after explicit confirmation that displays the retry count. Returning to the first retry item does not change its outcome. “Finish anyway” also leaves status, attempt, time, remaining, and events unchanged. One selector/Store action supplies this policy to practice and exam simulation.

Typing and TOEFL exports share a Rust directory transaction: validate file set → write all files in staging → converge directory size including the index through bounded fixed-point writes → publish boundary → atomic directory replacement. Failure before publish removes staging; retry with the same Session identity replaces the same directory. After terminal TOEFL publish, the app waits for the latest snapshot and serialized event queue before calling a cleanup command that accepts only a matching completed/exported index, readable file set, and completed SQLite row. Save-close waits for current persistence and issues a high-priority `WINDOW_CLOSE` request for the latest Store Snapshot. Failure does not destroy the window; cancel restores the prior runtime, and only a successful retry closes it.

## Safety boundaries

Real materials are never read for content, enumerated within packages, or written. New Sessions exclude Speaking; legacy Speaking does not record audio. Export paths reject absolute paths, `..`, wrong roots, and canonical escape. The product does not check answers, grade, or calculate accuracy.

The first Trash deletion uses a controlled same-root rename, complete lightweight manifest, and SQLite Trash marker. A completed TOEFL record with a verified terminal Recovery enters one Trash entry with it. The physical manifest covers a marker-publication interruption so Recovery cannot reappear. Restore renames safely on conflict without recreating terminal Recovery. Permanent deletion is Trash-only and cleans Recovery files/SQLite rows for the same logical identity. UI double confirmation, Rust `confirmed`, symlink/reparse targets, wrong types, missing targets, and Active Session guards remain effective.
