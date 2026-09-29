# TOEFL Answer Collection

Language / 语言 / 言語 / 語言: [English](#english) → [简体中文](#simplified-chinese) → [日本語](#japanese) → [繁體中文](#traditional-chinese)

<a id="english"></a>

## English

TOEFL Answer Collection v1.0.0 is a local-first Windows/Tauri tool for recording TOEFL answers and practicing English blind typing alongside study materials kept outside the app. The [public source](https://github.com/HanamiGekka/TOEFL-Answer-Collection) and [Windows v1.0.0 release](https://github.com/HanamiGekka/TOEFL-Answer-Collection/releases/tag/v1.0.0) are available.


For normal use on Windows 10/11 x64, run the current-user NSIS installer and launch TOEFL Answer Collection from the Start Menu. The installed application does not need Node.js, npm, Rust, Cargo, Git, Visual Studio Build Tools, or Python. Microsoft Edge WebView2 is the Windows runtime prerequisite; supported Windows installations normally have it, and the installer may bootstrap it when missing. The unsigned installer may trigger a SmartScreen warning.

### Current features

- New sessions use dynamic schema v6. In Reading, Listening, and Writing, users can create single-choice, multiple-choice, short-text, and long-text items one at a time, with custom labels, option labels, and optional time limits.
- Batch creation supports 1–100 items. Built-in batches are Reading Fill in the Blank ×10, Academic Reading single-choice ×5, Academic Lecture single-choice ×4, and Writing Build a Sentence ×10. Reusable templates with multiple blocks per section can be saved, reloaded, updated, deleted, and applied repeatedly. Templates live in local settings under the current APP_ROOT.
- Sessions support navigation, pausing, timing, status marks, reopening sections, a summary, recovery of incomplete sessions, and several local export formats.
- A separate Typing mode supports English blind typing, drafts, metrics, and export. The local Record Manager manages records and Trash.
- Old v2–v5 sessions and legacy Speaking/Listening structures remain readable. The new-session flow does not offer Speaking.
- The app does not read or store real question content, audio, or answer keys. It has no network access or telemetry.
- The interface supports English, Simplified Chinese, Japanese, and Traditional Chinese; fresh use starts in English, and a saved language choice persists.

### Local development

Use Node 24.18.0 from [`app/.nvmrc`](app/.nvmrc); `package.json` accepts compatible versions in the same 24 series. Rust is pinned to 1.96.1 by `app/src-tauri/rust-toolchain.toml`. After installing the Windows prerequisites for Tauri, use the lockfile in `app/`:

```powershell
npm ci
npm run audit:privacy
npm run audit:i18n
npm run audit:public-release
npm run typecheck
npm run lint
npm run test
npm run build
npm run e2e
npm run tauri:dev
```

Run `cargo fmt --check`, `cargo check --locked`, `cargo test --locked`, and `cargo audit` in `app/src-tauri/`. On Windows, `npm run tauri:build` produces the current-user NSIS setup executable. The release is unsigned. See the [architecture](docs/product/ARCHITECTURE.md) for runtime structure. Use `npm install` only when maintaining dependencies and updating `package.json` / `package-lock.json`, then verify with `npm ci`. The public repository runs Ubuntu frontend and Windows native/packaging CI.

### Data safety

On first launch, APP_ROOT defaults to the operating system's per-user application data directory. Settings can select a writable APP_ROOT and a separate read-only external TOEFL materials directory, SOURCE_ROOT. SOURCE_ROOT may remain unset; local records and settings still work, but starting a TOEFL session requires selecting a materials directory. Real study materials stay outside the repository; test fixtures contain only synthetic content.

User records, Recovery, SQLite, logs, exports, and local path configuration stay on the machine and are not committed to Git. Path settings live in the current user's application configuration directory; old repository settings are a read-only fallback. Changing APP_ROOT does not migrate old data automatically. To view old records that disappear from the list, manually select the previous APP_ROOT in Settings. Delete formal records through the in-app Record Manager. See [engineering rules](AGENTS.md) and [privacy and safety](docs/product/PRIVACY_AND_SAFETY.md).

The [synthetic package example](samples/README.md) contains only folder structure. The public source excludes real materials, user records, Recovery, SQLite, local settings, exports, and private development history.

### License and independence

Project-authored source and documentation are offered under the [MIT License](LICENSE); third-party dependencies keep their own licenses. This is an independent study tool and is not affiliated with or endorsed by ETS. This repository does not distribute official TOEFL questions, audio, or answer keys. Real study materials remain outside the repository.

### Documentation

[Roadmap](docs/development/ROADMAP.md) · [Changelog](docs/development/CHANGELOG.md) · [Data schema](docs/product/DATA_SCHEMA.md) · [Export format](docs/product/EXPORT_FORMAT.md) · [Privacy and safety](docs/product/PRIVACY_AND_SAFETY.md)

---

<a id="simplified-chinese"></a>

## 简体中文

TOEFL Answer Collection v1.0.0 是基于 Windows/Tauri、以本地为主的 TOEFL 答案记录与英文盲打工具，配合应用外的学习资料使用。[公开源码](https://github.com/HanamiGekka/TOEFL-Answer-Collection)和 [Windows v1.0.0 正式版](https://github.com/HanamiGekka/TOEFL-Answer-Collection/releases/tag/v1.0.0)现已提供。


在 Windows 10/11 x64 上正常使用时，运行当前用户模式的 NSIS 安装程序，然后从开始菜单启动 TOEFL Answer Collection。用户无需安装 Node.js、npm、Rust、Cargo、Git、Visual Studio Build Tools 或 Python。Windows 运行时需要 Microsoft Edge WebView2；受支持的系统通常已安装，缺少时安装程序可能会引导安装。未签名的安装程序可能触发 SmartScreen 提示。

### 当前功能

- 新 Session 使用动态 schema v6。在 Reading、Listening、Writing 中，可逐题创建单选、多选、短文本和长文本 Item，支持自定义标签、选项标签和可选时限。
- 批量建题支持 1–100 题。内置批次为 Reading 填词 ×10、Academic Reading 单选 ×5、Academic Lecture 单选 ×4、Writing Build a Sentence ×10。每个 Section 的多 block 可复用模板可保存、重载、更新、删除和重复应用，保存在当前 APP_ROOT 的本地设置中。
- Session 支持导航、暂停、计时、状态标记、Section 重开、Summary、未完成 Session 恢复和多格式本地导出。
- 独立 Typing 模式支持英文盲打、草稿、统计与导出。本地 Record Manager 管理记录和 Trash。
- v2–v5 旧 Session 及旧 Speaking/Listening 结构仍可读取。新建 Session 流程不提供 Speaking。
- 应用不读取或存储真实题目、音频或标准答案；无联网功能或遥测。
- 界面支持英语、简体中文、日语和繁体中文；首次使用默认英语，已保存的语言选择会保留。

### 本地开发

Node 使用 [`app/.nvmrc`](app/.nvmrc) 中的 24.18.0；`package.json` 接受同一 24 系列兼容版本。Rust 由 `app/src-tauri/rust-toolchain.toml` 固定为 1.96.1。安装 Tauri 所需的 Windows 组件后，在 `app/` 使用锁文件：

```powershell
npm ci
npm run audit:privacy
npm run audit:i18n
npm run audit:public-release
npm run typecheck
npm run lint
npm run test
npm run build
npm run e2e
npm run tauri:dev
```

在 `app/src-tauri/` 执行 `cargo fmt --check`、`cargo check --locked`、`cargo test --locked` 和 `cargo audit`。在 Windows 上，`npm run tauri:build` 生成当前用户模式的 NSIS 安装程序；正式版尚未签名。运行结构见[架构](docs/product/ARCHITECTURE.md)。仅维护依赖时使用 `npm install` 更新 `package.json` / `package-lock.json`，随后以 `npm ci` 复验。公开仓库设有 Ubuntu 前端及 Windows native/打包 CI。

### 数据安全

首次启动时，APP_ROOT 默认使用操作系统为当前用户提供的应用数据目录。设置中可选择可写的 APP_ROOT 和独立的只读外部 TOEFL 资料目录 SOURCE_ROOT。SOURCE_ROOT 可以暂不配置；本地记录和设置仍可使用，但新建 TOEFL Session 前需选择资料目录。真实资料留在仓库外；测试 fixture 仅含虚构内容。

用户记录、Recovery、SQLite、日志、导出与本机路径配置仅留本地，不提交到 Git。路径设置位于当前用户的应用配置目录；旧仓库设置仅作只读回退。切换 APP_ROOT 不自动迁移旧数据。如果旧记录暂时不在列表中，可在设置里手动选择原 APP_ROOT。正式记录请通过应用内 Record Manager 删除。详见[工程规则](AGENTS.md)与[隐私和安全](docs/product/PRIVACY_AND_SAFETY.md)。

[合成包示例](samples/README.md)仅包含目录结构。公开源码不包含真实资料、用户记录、Recovery、SQLite、本机设置、导出和私人开发历史。

### 许可与独立性

项目原创源码及文档采用 [MIT 许可证](LICENSE)；第三方依赖保留各自的许可证。本项目是独立学习工具，与 ETS 无关联，也未获其认可。仓库不分发官方 TOEFL 题目、音频或答案；真实学习资料保留在仓库外。

### 文档

[路线图](docs/development/ROADMAP.md) · [版本变更](docs/development/CHANGELOG.md) · [数据模型](docs/product/DATA_SCHEMA.md) · [导出格式](docs/product/EXPORT_FORMAT.md) · [隐私和安全](docs/product/PRIVACY_AND_SAFETY.md)

---

<a id="japanese"></a>

## 日本語

TOEFL Answer Collection v1.0.0 は、アプリの外に置いた学習資料と併用する、Windows/Tauri 製のローカル優先 TOEFL 解答記録・英語ブラインドタイピングツールです。[公開ソース](https://github.com/HanamiGekka/TOEFL-Answer-Collection)と [Windows v1.0.0 リリース](https://github.com/HanamiGekka/TOEFL-Answer-Collection/releases/tag/v1.0.0)を利用できます。


Windows 10/11 x64 で通常使用する場合は、現在のユーザー向け NSIS インストーラーを実行し、スタートメニューから TOEFL Answer Collection を起動します。利用者は Node.js、npm、Rust、Cargo、Git、Visual Studio Build Tools、Python をインストールする必要はありません。Windows の実行には Microsoft Edge WebView2 が必要です。対応する Windows には通常含まれ、ない場合はインストーラーが導入を支援することがあります。未署名のインストーラーには SmartScreen の警告が表示される場合があります。

### 現在の機能

- 新しい Session は動的 schema v6 を使用します。Reading、Listening、Writing では、単一選択、複数選択、短文、長文の Item を 1 問ずつ作成でき、独自のラベル、選択肢ラベル、任意の制限時間を設定できます。
- 一括作成では 1～100 問を作れます。標準の一括設定は Reading の穴埋め ×10、Academic Reading の単一選択 ×5、Academic Lecture の単一選択 ×4、Writing Build a Sentence ×10 です。Section ごとに複数 block を含む再利用可能なテンプレートを保存、再読込、更新、削除、繰り返し適用できます。テンプレートは現在の APP_ROOT のローカル設定に保存されます。
- Session には問題移動、一時停止、計時、状態の記録、Section の再開、Summary、未完了 Session の復元、複数形式でのローカル書き出しがあります。
- 独立した Typing モードでは、英語のブラインドタイピング、下書き、統計、書き出しを利用できます。ローカルの Record Manager で記録と Trash を管理します。
- 古い v2～v5 Session と従来の Speaking/Listening 構造は引き続き読み込めます。新しい Session の作成画面には Speaking はありません。
- アプリは実際の問題文、音声、正解を読み込んだり保存したりしません。ネットワーク通信やテレメトリーはありません。
- UI は英語、簡体字中国語、日本語、繁体字中国語に対応します。初回は英語で始まり、保存した言語設定は維持されます。

### ローカル開発

Node は [`app/.nvmrc`](app/.nvmrc) の 24.18.0 を使用します。`package.json` は同じ 24 系列の互換バージョンを受け付けます。Rust は `app/src-tauri/rust-toolchain.toml` で 1.96.1 に固定されています。Windows 用 Tauri の前提コンポーネントを導入した後、`app/` でロックファイルを使います。

```powershell
npm ci
npm run audit:privacy
npm run audit:i18n
npm run audit:public-release
npm run typecheck
npm run lint
npm run test
npm run build
npm run e2e
npm run tauri:dev
```

`app/src-tauri/` では `cargo fmt --check`、`cargo check --locked`、`cargo test --locked`、`cargo audit` を実行します。Windows では `npm run tauri:build` で現在のユーザー向け NSIS インストーラーを生成します。公開版には署名がありません。構成は[アーキテクチャ](docs/product/ARCHITECTURE.md)を参照してください。依存関係を保守するときに限り `npm install` で `package.json` / `package-lock.json` を更新し、その後 `npm ci` で確認します。公開リポジトリでは Ubuntu frontend と Windows native／パッケージングの CI が実行されます。

### データの安全性

初回起動時、APP_ROOT は OS が現在のユーザーに用意するアプリデータフォルダーを使用します。設定では書き込み可能な APP_ROOT と、外部にある読み取り専用の TOEFL 資料フォルダー SOURCE_ROOT を別々に選べます。SOURCE_ROOT は未設定でもローカル記録と設定を利用できますが、TOEFL Session を開始する前には資料フォルダーの選択が必要です。実際の学習資料はリポジトリ外に置き、テスト用 fixture には架空の内容だけを使用します。

ユーザーの記録、Recovery、SQLite、ログ、書き出し、ローカルのパス設定は端末内に残し、Git にコミットしません。パス設定は現在のユーザーのアプリ設定フォルダーに保存され、以前のリポジトリ内設定は読み取り専用の予備としてのみ使います。APP_ROOT の変更では古いデータは自動移行されません。古い記録が一覧にない場合は、設定で以前の APP_ROOT を手動選択できます。正式な記録の削除にはアプリ内の Record Manager を使ってください。[開発ルール](AGENTS.md)と[プライバシーと安全性](docs/product/PRIVACY_AND_SAFETY.md)も参照してください。

[合成パッケージの例](samples/README.md)にはフォルダー構造だけを含めています。公開ソースには、実際の教材、ユーザー記録、Recovery、SQLite、ローカル設定、書き出し、非公開の開発履歴を含めません。

### ライセンスと独立性

本プロジェクトが作成したソースと文書は [MIT ライセンス](LICENSE)で提供します。第三者の依存関係にはそれぞれのライセンスが適用されます。本プロジェクトは独立した学習ツールであり、ETS との提携や ETS による承認はありません。公式 TOEFL の問題、音声、解答は配布しません。実際の学習教材はリポジトリの外に置きます。

### ドキュメント

[ロードマップ](docs/development/ROADMAP.md) · [変更履歴](docs/development/CHANGELOG.md) · [データスキーマ](docs/product/DATA_SCHEMA.md) · [書き出し形式](docs/product/EXPORT_FORMAT.md) · [プライバシーと安全性](docs/product/PRIVACY_AND_SAFETY.md)

---

<a id="traditional-chinese"></a>

## 繁體中文

TOEFL Answer Collection v1.0.0 是以本機為優先、使用 Windows/Tauri 的 TOEFL 答案記錄與英文盲打工具，搭配應用程式外的學習資料使用。[公開原始碼](https://github.com/HanamiGekka/TOEFL-Answer-Collection)與 [Windows v1.0.0 正式版](https://github.com/HanamiGekka/TOEFL-Answer-Collection/releases/tag/v1.0.0)現已提供。


在 Windows 10/11 x64 上一般使用時，執行目前使用者模式的 NSIS 安裝程式，再從開始功能表啟動 TOEFL Answer Collection。使用者不需安裝 Node.js、npm、Rust、Cargo、Git、Visual Studio Build Tools 或 Python。Windows 執行時需要 Microsoft Edge WebView2；支援的 Windows 通常已具備，缺少時安裝程式可能協助安裝。未簽署的安裝程式可能觸發 SmartScreen 警告。

### 目前功能

- 新 Session 使用動態 schema v6。在 Reading、Listening、Writing 中，可逐題建立單選、多選、短文字與長文字 Item，支援自訂標籤、選項標籤和選用時限。
- 批次建題支援 1–100 題。內建批次為 Reading 填空 ×10、Academic Reading 單選 ×5、Academic Lecture 單選 ×4、Writing Build a Sentence ×10。每個 Section 可儲存、重新載入、更新、刪除和重複套用含多個 block 的範本。範本儲存在目前 APP_ROOT 的本機設定中。
- Session 支援導覽、暫停、計時、狀態標記、重新開啟 Section、Summary、復原未完成 Session，以及多種格式的本機匯出。
- 獨立 Typing 模式支援英文盲打、草稿、統計和匯出。本機 Record Manager 管理記錄與 Trash。
- 舊版 v2–v5 Session 與原有 Speaking/Listening 結構仍可讀取。新建 Session 流程不提供 Speaking。
- 應用程式不讀取或儲存真實題目、音訊或標準答案；沒有網路功能或遙測。
- 介面支援英文、簡體中文、日文與繁體中文；首次使用預設英文，已儲存的語言選擇會保留。

### 本機開發

Node 使用 [`app/.nvmrc`](app/.nvmrc) 中的 24.18.0；`package.json` 接受同一 24 系列的相容版本。Rust 由 `app/src-tauri/rust-toolchain.toml` 固定為 1.96.1。安裝 Tauri 所需的 Windows 元件後，在 `app/` 使用鎖定檔：

```powershell
npm ci
npm run audit:privacy
npm run audit:i18n
npm run audit:public-release
npm run typecheck
npm run lint
npm run test
npm run build
npm run e2e
npm run tauri:dev
```

在 `app/src-tauri/` 執行 `cargo fmt --check`、`cargo check --locked`、`cargo test --locked` 和 `cargo audit`。在 Windows 上，`npm run tauri:build` 會產生目前使用者模式的 NSIS 安裝程式；正式版尚未簽署。執行結構見[架構](docs/product/ARCHITECTURE.md)。僅在維護相依套件時使用 `npm install` 更新 `package.json` / `package-lock.json`，再以 `npm ci` 複驗。公開儲存庫設有 Ubuntu 前端及 Windows native／封裝 CI。

### 資料安全

首次啟動時，APP_ROOT 預設使用作業系統提供給目前使用者的應用程式資料目錄。設定中可分別選擇可寫入的 APP_ROOT，以及獨立、唯讀的外部 TOEFL 資料目錄 SOURCE_ROOT。SOURCE_ROOT 可以暫不設定；本機記錄和設定仍可使用，但新建 TOEFL Session 前需選擇資料目錄。真實學習資料留在儲存庫外；測試 fixture 僅使用虛構內容。

使用者記錄、Recovery、SQLite、日誌、匯出和本機路徑設定僅留在本機，不提交到 Git。路徑設定儲存在目前使用者的應用程式設定目錄；舊儲存庫設定只作唯讀備援。切換 APP_ROOT 不會自動移轉舊資料。若舊記錄暫時不在清單中，可在設定中手動選擇原 APP_ROOT。正式記錄請透過應用程式內的 Record Manager 刪除。詳見[工程規則](AGENTS.md)與[隱私及安全](docs/product/PRIVACY_AND_SAFETY.md)。

[合成套件範例](samples/README.md)只包含目錄結構。公開原始碼不包含真實資料、使用者記錄、Recovery、SQLite、本機設定、匯出和私人開發歷史。

### 授權與獨立性

本專案原創原始碼及文件採用 [MIT 授權](LICENSE)；第三方相依套件保留各自的授權。本專案是獨立的學習工具，與 ETS 無關，也未獲其認可。儲存庫不散布官方 TOEFL 題目、音訊或答案；真實學習資料保留在儲存庫外。

### 文件

[路線圖](docs/development/ROADMAP.md) · [變更記錄](docs/development/CHANGELOG.md) · [資料模型](docs/product/DATA_SCHEMA.md) · [匯出格式](docs/product/EXPORT_FORMAT.md) · [隱私及安全](docs/product/PRIVACY_AND_SAFETY.md)
