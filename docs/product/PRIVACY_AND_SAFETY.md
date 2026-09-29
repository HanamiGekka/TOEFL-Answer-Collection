# Privacy and Safety

## Offline operation

Current runtime source has no external CDN, telemetry, cloud sync, upload, or update logic. Its production CSP permits local resources and Tauri IPC; a loopback development connection is configured for Vite. Development tools and GitHub CI use the network outside the app runtime.

The Windows NSIS release installer is built from the public v1.0.0 source/tag without bundling real user records or TOEFL materials. Tauri's WebView2 prerequisite bootstrap may use the network during installation; this does not add application runtime telemetry. Installer binaries are GitHub Release assets, not tracked public source files. The user confirmed that the application icon was AI-generated for this project, has no known third-party source asset, and is authorized for public redistribution; the tracked Tauri icons are included in the public source.

## Real materials are read-only

Real materials directory:

`<TOEFL_SOURCE_ROOT>`

The app enumerates only immediate package folder names under the source root to derive `package_id` and `source_relative_path` metadata. It does not enumerate files within packages or Module filenames, read or display question content, or write, move, or delete anything in the real materials directory.

## Local data locations

By default, answers, events, the database, recovery snapshots, logs, and exports are written only under:

`<APP_ROOT>`

Tauri supplies the default APP_ROOT through the current user's `app_local_data_dir`, independent of the repository and development machine. Settings allow separate selection of APP_ROOT and an external read-only SOURCE_ROOT; the latter may be empty. Records, Typing, Trash, Recovery, SQLite, and Logs are derived from APP_ROOT. SOURCE_ROOT validation uses only directory existence, canonical paths, and immediate-directory metadata and writes nothing. Roots that overlap directly or through links are rejected. Export APIs reject absolute paths, `..`, wrong roots, and canonical-path escape.

Path input remains an unsaved draft until validation and explicit confirmation atomically persist it in the current user's Tauri `app_config_dir`. X, Alt+F4, Cancel, and process termination do not save a draft. Old repository configuration is only a read-only compatibility fallback; invalid settings fall back only to valid LKG/default values. APP_ROOT changes do not migrate real data. Users can manually select the old directory when needed.

The frontend and backend jointly validate the boundaries for APP_ROOT, Records, Typing, Trash, Recovery, SQLite, and Logs. Absolute export paths, `..`, canonical escape, symlinks, and junctions are rejected. Settings hydration, selecting the same page, and closing flushes should not create new persistent mutations.

## Deletion policy

The app does not automatically delete formal TOEFL/Typing records. A completed/exported TOEFL Session's live Recovery snapshot/events converge to terminal state only after the formal bundle, SQLite completed row, save queue, and non-Active state are confirmed. On failure, the formal record and Recovery remain, and cleanup requires an explicit retry. User-initiated record cleanup requires double confirmation and prefers moving to `trash/`; permanent deletion of the same logical identity requires explicit confirmation. Test data is created only under a marker-bound disposable root and is cleaned after the corresponding acceptance is closed and its marker verified.

## Content boundary

- Rejected blind-typing characters are counted but their content is not saved.
- Schema v6 stores only manually defined type/option labels and answers, not real prompts, real option text, or answer keys.
- New v6 Session, Recovery, SQLite source metadata, and exports use only `package_id`/`source_relative_path`, never absolute SOURCE_ROOT. Old v2–v5 and old v6 `source_path` remain readable for recovery and compatible with their original export format; real records are not rewritten automatically.
- New Sessions do not offer Speaking. Legacy v2–v5 Speaking stores only task status, timing, and attempt events, without recording or saving audio.
- Logs should not contain prompts, listening transcripts, answer keys, or sensitive system information.
- The app provides no answer keys, automatic answer checking, accuracy scores, predicted scores, or grading.

## Repository history and publication boundary

The historical development repository remains private and retains its existing history without rewriting it. Historical commits are confirmed to contain machine paths, private directory metadata, and a non-noreply author identity. Real answer content or credentials have not been confirmed in Git. The public repository was created from a reviewed clean source snapshot with new ancestry; no historical private commits were copied. The current-tree privacy gate checks tracked content and does not replace review of old history. Never turn the historical private repository directly Public.

`scripts/public-release/allowlist.json` names the files and source directories eligible for the clean public source. `npm run audit:public-release` copies only those paths to a disposable staging directory and checks private directories, machine paths, secrets, binary/size boundaries, synthetic markers, the MIT license, disclaimers, and local Markdown links. The public source excludes runtime `records/`, `typing_records/`, `data/` and Recovery, `trash/`, `exports/`, `logs/`, backups, local path settings, `temp/`, private prompts, personal materials, and private development reports. Synthetic fixtures are identified explicitly; real packages and user template contents are not sample data. This audit supports review but does not prove that every possible private or copyrighted fact is absent.

The public repository began with one reviewed initial commit from this sanitized snapshot. Its v1.0.0 tag supplies the release installer source. Private development ancestry is absent. The historical development repository remains separately private.
