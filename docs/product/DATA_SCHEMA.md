# Data Schema

SQLite file: `data/answer_collection.sqlite3`. The complete Session resides in `practice_sessions.snapshot_json`; legacy relational tables receive no destructive migration.

## Snapshot schema v6

New Sessions use:

```text
session_schema_version = 6
structure_mode = dynamic_manual
```

- Package metadata: `package_id`, `source_relative_path`, `created_at`, `mode`, and `selected_sections`. New v6 does not persist an absolute real SOURCE_ROOT. Recovery JSON and SQLite `practice_sessions.source_path` metadata also use a relative package identity; the old column name remains without a schema upgrade.
- `selected_sections` and `dynamic_sections[]` permit only Reading, Listening, and Writing in fixed R/L/W order; Speaking is invalid.
- `dynamic_sections[]` stores `section_id`, `status`, `item_ids`, `next_item_ordinal`, active/pause time, and lifecycle timestamps. Initially `item_ids` is empty and future Items do not exist.
- In v6, `questions[]` contains confirmed `DynamicPracticeItem` instances. Identity combines a Section prefix with a consecutive ordinal, such as R1, R2, L1, or W1.
- Each Item freezes `type_id`, display label, one of four safe `renderer` values, ordered option labels, optional time limit, answer lifecycle, progress/flags, visit/timing, and creation/completion time. Real prompts, real option text, and answer keys are not stored.
- `item_type_registry[]` contains built-in or user-defined configurations. A renderer string is never executed as a component name. Single/multiple choice requires 2–10 nonempty, unique labels without dangerous control characters.
- A single-choice answer is a label or null; multiple choice uses a label array; short/long text uses a string. Long text also stores metrics and local undo/redo history.
- `modules[]` and `tasks[]` are always empty. Blueprint identity, Speaking, and future Items are invalid in a valid v6 Snapshot.
- Recovery strictly validates v6 directly and retains v6, starts paused, and continues event sequence numbering. v5 Recovery is not migrated to v6.

## Legacy Snapshot schema v5

v5 retains v4 Session, Section/Scope, Question, Answer, and event fields, and adds:

- `current_task_id`
- `tasks[]`
- `blueprint_id` / `blueprint_version` (written by legacy schema v5 Sessions; older snapshots may omit these and map to a compatible Blueprint)

Each Task contains:

- Identity: `task_id`, `section_id`, `task_type`, `question_ids`
- Status: `NOT_STARTED / ACTIVE / PAUSED / COMPLETED / NEEDS_RETRY / OVERTIME`
- Integer timing: `active_time_ms`, `pause_time_ms`, `timer_limit_ms`, `remaining_ms`
- Lifecycle: `started_at`, `completed_at`, `attempt_count`
- Independent flags: `is_overtime`, `overtime_event_recorded`, `needs_retry`

Writing Email/Discussion additionally store full `text`, word/character/keyboard CPM, keyboard/paste/delete, cut/paste/undo/redo, modification count, and local undo/redo stacks. Speaking stores only status and time, not audio, prompts, or answer keys.

## Compatibility and integer boundaries

- Schemas v2/v3/v4 construct v5 Tasks from existing W/S questions, answers, and scope state.
- Schema v5 continues to use persisted Blueprint/Question/Module/Task/Speaking runtime. It is neither migrated automatically nor presented as dynamic Items. Schema v6 bypasses legacy migration.
- Old answers, active time, timestamps, progress, and events are retained; old snapshots are not deleted.
- Persisted milliseconds must be finite, nonnegative JavaScript safe integers, consistently rounded with `Math.round`. Raw milliseconds in JSON/JSONL/CSV, record indexes, Recovery, and IPC `i64` all obey this boundary.
- Answer `active_time_ms` / `total_active_ms` are required accumulators, so explicit null is invalid. `first_answer_elapsed_ms` is nullable lifecycle metadata: missing, null, or a valid number are allowed; null remains null rather than becoming 0. Question active, Task active/pause, Scope/Section/Session active/pause, and event seq/elapsed remain required.
- Required accumulators include Session `active_ms/paused_ms/unattributed_active_time_ms`, Answer/Question active, Task `active_time_ms/pause_time_ms`, Scope/Section active, and event elapsed/seq. Explicit null is invalid; missing values receive defaults only under old-schema compatibility rules.
- Nullable limits include Question `time_limit_ms/timer_limit_ms/remaining_ms` and Task `timer_limit_ms/remaining_ms`. Null, missing, and nonnegative integer values are allowed. Null means no individual limit and never becomes 0.
- Question/Task leaf values are rounded to integers before Scope, Section, and Session values are derived.
- A `performance.now()` anchor is not persisted; restore decides whether to restart one from Task status.
- Speaking transition guard/pending state exists only in process memory and does not inherit an old monotonic timestamp on restore.
- Speaking `NEEDS_RETRY` keeps `status = NEEDS_RETRY` and `needs_retry = true`. Explicit “finish anyway” only finalizes Scope/Session; it does not turn the Task into `COMPLETED`. Summary, JSON, Markdown, and Task CSV read the original status.
- Answers, full text, ISO timestamps, booleans, counts, and CPM ratios are not rounded as durations.

## Legacy Blueprint 1.3.0 and Listening compatibility

- R1–R10: independent text Questions with `type_label = Complete the Words` and `passage_group_id = READING_M1_CTW_A`.
- R11–R20: independent text Questions with `passage_group_id = READING_M1_CTW_B`.
- R36–R45: independent text Questions with `passage_group_id = READING_M2_CTW_A`.
- `passage_group_id` denotes a shared passage only; it does not merge Question identity, answers, or per-question timing. The exact positions of R21–R35 and R46–R50 remain `NEEDS_USER_CONFIRMATION`.
- Legacy Blueprint 1.3.0 places `Listening-1`–`Listening-32` in `LISTENING_MODULE_1` and `Listening-33`–`Listening-47` in `LISTENING_MODULE_2`. All 47 Question identities remain and retain generic type `External Audio Question`.
- Persisted Questions/Modules in Blueprint 1.2.0 Snapshots continue to define L1–L35 and L36–L47. Recovery, Summary, export, and record index retain `blueprint_version = 1.2.0`; default Blueprint 1.3.0 does not rewrite them.
- A Blueprint 1.1.0 Snapshot with one `LISTENING_SECTION` likewise retains original Questions, Module, Blueprint version, answers, time, event sequence, and flags during recovery and is not marked migrated.
- Schema v5 Recovery prefers persisted Question `module_id` and `modules[].questionIds` for older Blueprint versions and requires complete matching membership. Blueprint 1.3.0 no longer drives new schema v6 Sessions.
- Exact positions of Response/Conversation/Announcement/Academic Talk, audio grouping, and package order remain `NEEDS_USER_CONFIRMATION` and are not inferred into the schema.

## Other data

`answers`, `answer_revisions`, `timer_events`, `minute_samples`, `typing_sessions/events`, `app_settings`, and `timing_profiles` retain their existing roles. `app_settings` accepts allowlisted `shortcuts`, `record_filters`, `home_view`, and `item_templates` keys; R008.5 adds `ui_locale` without a table migration. `item_templates` is an independent template-library schema v1: `{schema_version: 1, templates: [{template_id, name, section, blocks}]}`. A block holds either a stable system-preset `type_id` or a snapshot of a user-defined config, plus integer `count`. A template has at most 20 blocks and 100 Items, belongs to one Reading, Listening, or Writing Section, follows the current APP_ROOT, and enters neither Session schema v6 nor a new SQLite table.

`record_trash` stores every record type's `trash_id`, `session_id`, type, manifest JSON, and move time. A TOEFL/Recovery family marker hides a trashed live Recovery without deleting the original Session SQLite row. Scanning also reads published physical manifests to cover the interruption window after filesystem publication but before the SQLite marker. Restore removes the marker only by `trash_id`. Permanent TOEFL/Recovery deletion removes related timer events, practice session, and marker in a SQLite transaction, then removes controlled Recovery files and Trash payload. A Typing Session with the same name is a separate type and does not hide Recovery.

Exported TOEFL/Typing Session directories contain a small `record-index.json` duplicating only listing metadata, not answer text. The v6 index also has `structure_mode = dynamic_manual` and per-Section `section_item_counts`; legacy v5 is marked `LEGACY V5` and retains Blueprint metadata. New atomic exports set `directory_size_bytes` to the final recursive byte count including the index itself, converging through at most eight fixed-point writes; Trash restore recalculates it. An old index value of `0` is not written back automatically; Record Manager computes a read-only in-memory fallback. Besides original/trashed paths, type, time, Session, and schema, Trash manifests embed package, creation, mode/profile, structure/Blueprint, sections/item counts, active/pause, completion/export, schema/app, file list, and Recovery classification/count. Older manifests with missing fields remain listable and restorable through optional/default compatibility. Local absolute path settings are written only to the current user's Tauri `app_config_dir`; old repository settings are read-only fallback. Typing drafts still use localStorage schema v1, recording only the count of rejected characters.

Direct v6 and legacy v2–v5 recovery retain identity, answers, time, and flags, start paused, and do not reuse an old monotonic anchor. Automation uses only synthetic compatibility fixtures or marker-bound disposable APP_ROOTs to cover these boundaries.
