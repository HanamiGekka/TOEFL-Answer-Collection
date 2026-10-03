# Privacy and Safety

Current release: 1.0.1, a local usability and cleanup maintenance release. Session schema remains v6 and SQLite schema is unchanged; official v1.0.0 dynamic v6 records remain supported.

The app is a local answer recorder and English Typing tool with no network/telemetry feature. Real materials stay outside the application/repository. The product reads no prompts, audio, real option text, or answer keys and does not grade answers.

## Local data

Practice starts from a Training name without a source/material folder. Settings expose one Data folder, defaulting to per-user app data. Records, Typing records, Trash, Recovery, SQLite, and Logs remain under it; configuration and LKG live in per-user app configuration.

Path edits remain unsaved drafts until validation/confirmation. Cancel, window close, and process termination do not commit drafts. Atomic replacement, containment/canonical checks, write probes, and generation guards protect storage. Invalid current configuration falls back to valid current LKG/default. Startup does not discover repository configuration or old data. Changing the Data folder does not migrate records; selecting the previous folder restores access.

Optional configuration `source_root` and safe official v1.0.0 v6 `source_relative_path` are passive metadata. New sessions omit source fields, and the existing SQLite source column is empty for them. Recovery supports dynamic v6 only; unsupported snapshots are not rewritten/deleted automatically.

## Save and deletion

Integer DTOs, serialized saves, atomic exports, and guarded window close retain newest state and permit retry. Recovery resumes paused with a fresh anchor. Existing v6 Writing text is preserved on loading; subsequent edits follow English input policy.

Record Manager requires two confirmations before trashing/permanent deletion. Trash can be restored. Permanent TOEFL/Recovery deletion removes controlled files, session row, related timer events, and marker; other record families remain separate. Batch actions report partial failures. Never clear a whole Data folder to remove one test record.

## Public source

The explicit public allowlist excludes user data, Recovery, SQLite, local configuration, screenshots, exports, private prompts, real materials/answers, and private development history. Tests/compatibility fixtures are synthetic. Public source uses independent ancestry. Publication requires the applicable manual/release gate.

The Windows installer is unsigned; signing remains separate. See [data schema](DATA_SCHEMA.md) and [architecture](ARCHITECTURE.md).
