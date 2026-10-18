# TOEFL Answer Collection

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [繁體中文](README.zh-TW.md)

<a id="english"></a>

A **local-first Windows app** for recording TOEFL practice answers, timing sessions and practicing English typing. Keep your study materials outside the app and record your work alongside them. **No official TOEFL questions, audio or answer keys are included.**

![TOEFL Answer Collection v1.0.1: practice setup and typing with synthetic demo text (English UI)](docs/images/home-and-typing-v1.0.1.jpg)

*Actual v1.0.1 Windows app with English UI, captured in isolated test-data mode using synthetic text. The test banner is intentionally visible; no personal records or official materials appear. [Screenshot details](docs/product/SCREENSHOTS.md).*

## Quick start

1. Download the **v1.0.1 Windows installer** from [Releases](https://github.com/HanamiGekka/TOEFL-Answer-Collection/releases/tag/v1.0.1), install for the current Windows account and open it from the Start menu.
2. On the Practice page, enter a **Training name**, choose Reading, Listening or Writing, then select **Start practice**. Add items individually or in batches; no materials folder is required.
3. For typing, use **Blind typing practice → Start** on the same page. Pause or end the practice as needed; drafts and exports stay local.
4. Open **Record Manager** to review saved records, or **Settings → Data folder** to locate or select the storage folder.

**Requirements:** Windows 10/11 x64 and Microsoft Edge **WebView2**. The installer may bootstrap WebView2 if it is missing. The installer is **unsigned**, so SmartScreen may show a warning. Running the installed app does not require Node.js, Rust or other development tools.

## Current features

- Reading, Listening and Writing answer records under **dynamic schema v6**, with single-choice, multiple-choice, short-text and long-text items, custom labels and optional time limits.
- Batch creation of **1–100 items**, built-in batch presets and reusable multi-block templates for each section. Templates stay in the current Data folder's local settings.
- Timing, pause/resume, status marks, navigation, section reopening, summaries, recovery of incomplete sessions and several local export formats.
- Separate English typing practice with drafts, statistics and exports; a local Record Manager and Trash.
- English, Simplified Chinese, Japanese and Traditional Chinese UI. Fresh use starts in English; the saved language choice persists.

## Data safety

The **Data folder** defaults to the operating system's per-account application data directory. Records, Recovery, SQLite, logs and exports stay there; application settings stay in the per-account configuration directory. Selecting another Data folder **does not move old records automatically**. Select the previous folder again to view its records.

The app has no network access or telemetry. Use Record Manager for formal-record deletion and review exports before sharing them. Public source excludes personal answers, real practice records, Recovery, databases, local settings, external study materials and private development history. See [privacy and safety](docs/product/PRIVACY_AND_SAFETY.md).

## Local development

Built with Tauri, TypeScript and Rust. Build from source with **Node.js 24.18.0** (compatible 24.x accepted) and **Rust 1.96.1**, plus the Windows Tauri prerequisites. The [development and build guide](docs/development/BUILD.md) contains installation, audit, test and packaging commands. See [architecture](docs/product/ARCHITECTURE.md) for runtime structure. The repository CI checks Ubuntu frontend and Windows native/packaging behavior.

## Compatibility

Official **v1.0.0 dynamic v6 records remain readable**. Pre-v6 records are unsupported. Speaking is not part of the current runtime.

## License and independence

Project-authored source and documentation use the [MIT License](LICENSE); dependencies retain their own licenses. This independent study tool is **not affiliated with or endorsed by ETS** and does not distribute official TOEFL questions, audio or answer keys.

## Documentation

[Roadmap](docs/development/ROADMAP.md) · [Changelog](docs/development/CHANGELOG.md) · [Data schema](docs/product/DATA_SCHEMA.md) · [Export format](docs/product/EXPORT_FORMAT.md) · [Privacy and safety](docs/product/PRIVACY_AND_SAFETY.md)

## Other languages and legacy links

The historical language URLs remain available through these links.

<a id="simplified-chinese"></a>

### 简体中文

[简体中文 README](README.zh-CN.md)

<a id="japanese"></a>

### 日本語

[日本語 README](README.ja.md)

<a id="traditional-chinese"></a>

### 繁體中文

[繁體中文 README](README.zh-TW.md)
