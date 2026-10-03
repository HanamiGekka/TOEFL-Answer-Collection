# Changelog

User-visible changes. R numbers identify development rounds within a release.

## 1.0.1 — 2026-10-03

Small usability and cleanup maintenance release.

### Changed

- Start practice directly from a Training name without materials-folder setup.
- Storage settings show one Data folder; shortcuts show friendly names and bindings.
- Record cards show useful summaries with technical metadata behind collapsed details.
- English, Simplified Chinese, Japanese and Traditional Chinese remain available.

### Removed

- Obsolete Speaking runtime/UI, pre-v6 readers/migration and source-package scanner/sample flow.

### Compatibility

- Official v1.0.0 dynamic v6 Sessions, optional safe source metadata, Recovery/index/export remain supported.
- Session schema remains v6; SQLite schema is unchanged.

## 1.0.0 — 2026-09-29

First public release for Windows 10/11 x64. The current-user NSIS installer is unsigned, so Windows SmartScreen may warn. The tool records Reading, Listening, and Writing answers; supports batch creation, reusable templates, Recovery, local export, and blind Typing; and offers four interface languages. Real study materials stay external. This independent project is not affiliated with ETS and includes no official TOEFL questions, audio, or answer keys.

The [public v1.0.0 release](https://github.com/HanamiGekka/TOEFL-Answer-Collection/releases/tag/v1.0.0) contains the Windows installer and its SHA-256 checksum. Public source begins at clean commit `f265fa161d541dbc5e503e01f48e908ed933e064`; historical development commits remain private.

### R008.7.1 — Release candidate hardening

- The installed Windows application opens directly without a persistent blank Command Prompt window.
- The NSIS installer and uninstaller use the selected application icon.
- One README now presents the product in English, Simplified Chinese, Japanese, and Traditional Chinese.

### R008.7 — Windows packaging

- Added the project catgirl icon and a current-user NSIS installer in four languages.

### R008.6 — Public preparation

- Added an MIT license, an independent-project disclaimer, and a synthetic package structure example. Official TOEFL questions, audio, and answer keys are not included.
- Path setup and package scan failures display localized messages in all four interface languages.

### R008.5 — Four-language interface

- Settings can switch the interface among English, Simplified Chinese, Japanese, and Traditional Chinese. English is the first-use default; the selected language persists.
- Built-in item and batch names follow the interface language. User-entered labels and template names stay as entered.

### R008.4 — Batches and templates

- Reading, Listening, and Writing items can be created in batches of 1-100. Built-in batches cover Fill in the Blank, Academic Reading, Academic Lecture, and Build a Sentence.
- Per-section templates can save, load, update, delete, and repeatedly apply multiple creation blocks. Repeat previous operation replays the most recent successful recipe.

### R008.3 — Portable paths and privacy

- First launch uses the current user's application data directory. APP_ROOT and a separate read-only SOURCE_ROOT can be selected in Settings; changing APP_ROOT does not move old records automatically.
- New records and exports omit absolute source paths. Older v2-v5 sessions and their Reading, Listening, Writing, and Speaking structures remain readable.

### R008.1 — Recovery fixes

- Fixed recovery after creating custom item types with matching labels and different time limits.
- Fixed recovery after reopening an earlier section and appending items, while preserving existing items and answers.
- Editing an unavailable item preset now shows a recoverable error.

### R007.3 and earlier — Core application

- New sessions use dynamic Reading, Listening, and Writing items, with single choice, multiple choice, short text, long text, custom labels, options, and optional time limits. New-session creation does not offer Speaking.
- Sessions provide navigation, timing, status marks, summaries, Recovery, and local exports. Legacy session structures remain readable without automatic migration.
- Typing mode provides English blind typing, drafts, timing and performance metrics, and local exports.
- Record Manager lists TOEFL, Typing, Recovery, and Trash entries and supports restore and confirmed permanent deletion.
- Window close waits for safe persistence; failed saving leaves the window open for retry. Retrying an export updates the same logical record.
- Real study materials remain external and read-only. The app does not provide official question content, answer keys, automatic scoring, or telemetry.
