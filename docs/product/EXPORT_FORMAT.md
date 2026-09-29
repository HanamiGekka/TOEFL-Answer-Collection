# Export Format

Session directory:

```text
records/<package_id>/<YYYY-MM-DD_HH-mm-ss_session-id>/
```

## Schema v6 dynamic_manual file set

- `session_summary.md`
- `answers.json`
- `events.jsonl`
- `item_metrics.csv`
- `section_metrics.csv`
- `Reading.md` / `Listening.md` / `Writing.md` for selected Sections, including explicitly skipped empty Sections
- `record-index.json` with lightweight listing metadata and no answer text

`answers.json` uses `practice-session-v6` and `structure_mode: "dynamic_manual"` and stores dynamic Sections, frozen Item configurations, answer/progress/flags/timing/lifecycle, and Writing history. It does not emit Blueprint, Module, Task, Speaking, or absolute SOURCE_ROOT. JSON, CSV, Markdown, and record indexes omit new v6 machine source paths; old records retain their original schema's compatible export. Choice items emit only user-defined labels and selected labels, without real option text.

`item_metrics.csv` has one row per created Item with Session/package/Section/Item identity, ordinal, type/renderer, option labels, answer summary, progress/flags, visit/modification, active/pause/limit/remaining/overtime, and lifecycle times. `section_metrics.csv` outputs selected Sections in fixed R/L/W order with status, created/answered/skipped/overtime Item counts, and active/pause time. Summary includes per-Section and renderer/type counts without Module metrics.

R008.4 batch-created and individually created Items share the same v6 export format and appear in created-Item order; unvisited Items still appear as created/unanswered. The independent `item_templates` library is absent from every Session export file.

Section Markdown lists only Items actually created. Long text emits full user text in a fenced block. An empty Section can still have an explicit zero-Item document. `record-index.json` stores `structure_mode`, `section_item_counts`, and standard lightweight metadata.

## Legacy v2–v5 file set

Old Sessions continue to export `question_metrics.csv`, `task_metrics.csv`, existing Reading/Listening/Writing/Speaking Markdown, and Blueprint identity from their persisted structures. They are not silently converted to v6 dynamic Items. An old v5 index displays `LEGACY V5`.

Listening export always consumes a Session's own persisted Modules:

- New Blueprint 1.3.0 records export `LISTENING_MODULE_1` (L1–L32, 32 question IDs) and `LISTENING_MODULE_2` (L33–L47, 15).
- Old Blueprint 1.2.0 records keep L1–L35 and L36–L47, or 35+12.
- Old Blueprint 1.1.0 records keep one `LISTENING_SECTION`.

Legacy `session_summary.md`, `answers.json`, `Listening.md`, `question_metrics.csv`, and `record-index.json` share the same persisted module identity; another Blueprint does not rewrite an old export. Section active time equals the sum of that legacy Session's Listening Module active time.

Legacy `Writing.md` separately emits Build a Sentence, Email, and Academic Discussion. Email/Discussion include limit/active/overtime, word/character/CPM, keyboard/paste/delete, cut/paste/undo/redo, changes, and complete original text.

Legacy `Speaking.md` emits the local 2:00 Listen and Repeat group time, SR1–SR7 status/time, and SI1–SI4 45-second limit, active/remaining, attempt, completed/needs-retry/overtime. Export contains no audio; schema v6 does not generate this file.

JSON, JSONL, CSV, Markdown, Summary, and `record-index.json` consume one `Math.round` integer DTO. Remaining/overtime for v6 Items and legacy Email/Discussion are derived by their respective selectors. All formal duration/elapsed values are nonnegative safe integers; ratios such as CPM may retain decimals. No file contains prompts, real option text, answer keys, automatic checking, accuracy, or grading. R008.5 keeps machine fields and the existing Markdown export contract independent of UI locale.

## Typing

`typing_records/YYYY-MM/<session_id>/` generates `typing_summary.md`, `typing_session.json`, `minute_samples.csv`, and `final_text.txt`. The month is derived consistently from the creation time in the production Session ID; retry across a month boundary does not change the relative path.

The four Typing files and `record-index.json` share one Rust staging/publish transaction. Snapshot, minute samples, and index use one integerized active/pause result. Failed publication exposes neither a directory nor an empty index and does not clear an ended draft; cleanup follows success only. Retry retains record/session/path identity and forms one logical record. An incomplete Recovery can also emit the standard Session file set with `completion_status = INCOMPLETE`. A TOEFL Session directory is determined only by `created_at + session_id`; INCOMPLETE retry, retry after continued practice, and final COMPLETED atomically update the same directory. Physical index identity remains `record_type + session_id`; Record Manager treats TOEFL and Recovery as one logical identity by TOEFL family plus `session_id`, while Typing is independent.

New TOEFL/Typing bundles rewrite `record-index.json` in staging a finite number of times until `directory_size_bytes` equals the final recursive size including the index itself; publication fails if it does not converge within eight writes. Old zero-size indexes are not rewritten in bulk; listing scans calculate a read-only fallback. Structured Trash restore recalculates under the new relative path and never resets size to zero.

## Read-only Session audit

From `app`, run:

```powershell
npm run audit:session -- "<session-export-directory>"
```

Optional flags are `--pre-snapshot <file>`, `--pre-events <file>`, and `--json-report <file>`. The auditor reads the export directory only, checking identity; a nonnegative integer time ledger; Question/Task/Module/Section/Session closure; event sequence and semantic duplicates; Speaking attempts; completion; stable record identity; and file set. Blueprint identity determines validation for Listening 1.1.0 one-Module, 1.2.0 35+12, and 1.3.0 32+15. Listening must also have consecutive Question IDs with no duplicates or omissions, a total of 47, consistent Question/module membership, and Module active time summing to Section active time. A mismatch between Blueprint and persisted Snapshot topology returns `LISTENING_BLUEPRINT_SNAPSHOT_MISMATCH` and a nonzero exit code. A new report is written only when `--json-report` is supplied; audited files are never modified.

## Raw Recovery diagnostic export

```text
records/recovery-diagnostics/<session-id>-<stamp>/
  snapshot.json
  events.jsonl                  # if source events exist
  diagnostic-manifest.json
```

This action copies controlled Recovery-root originals read-only without depending on JSON parsing, schema migration, or business validation. The manifest records only Session ID, whether each file was copied, byte counts, and `business_validation = NOT_PERFORMED`, not answers or Writing text. Source files are neither overwritten, moved, nor deleted.

`data/recovery` is the live recovery source for Continue, structured incomplete export, and export-failed retry. Completed/exported Sessions clean up live snapshot/events after the formal index, file set, SQLite completed row, and save queue are confirmed. Failure keeps the formal export and Recovery and permits retrying cleanup alone. Historical remnants are classified `STALE_TERMINAL_RECOVERY` and cannot Continue. `records/recovery-diagnostics` is a user-generated read-only troubleshooting/backup copy. It does not participate in Continue and cannot replace the live recovery source; deletion uses Trash or explicit confirmation.

## Path safety

Writes reject absolute paths and `..`; Session/Typing directories must stay under their controlled roots. The backend uses sibling staging/backup and atomic directory replacement so failures can be retried. Scans ignore hidden staging/backup names.
