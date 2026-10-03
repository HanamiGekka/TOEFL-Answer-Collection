# TOEFL Answer Collection

Language / 语言 / 言語 / 語言: [English](#english) → [简体中文](#simplified-chinese) → [日本語](#japanese) → [繁體中文](#traditional-chinese)

<a id="english"></a>

## English

TOEFL Answer Collection is a local-first Windows/Tauri tool for recording TOEFL answers and practicing English blind typing alongside study materials kept outside the app. The [public source](https://github.com/HanamiGekka/TOEFL-Answer-Collection) and [Windows v1.0.1 release](https://github.com/HanamiGekka/TOEFL-Answer-Collection/releases/tag/v1.0.1) are available.


For normal use on Windows 10/11 x64, run the current-user NSIS installer and launch TOEFL Answer Collection from the Start Menu. The installed application does not need Node.js, npm, Rust, Cargo, Git, Visual Studio Build Tools, or Python. Microsoft Edge WebView2 is the Windows runtime prerequisite; supported Windows installations normally have it, and the installer may bootstrap it when missing. The unsigned installer may trigger a SmartScreen warning.

### Current features

- New sessions use dynamic schema v6. In Reading, Listening, and Writing, users can create single-choice, multiple-choice, short-text, and long-text items one at a time, with custom labels, option labels, and optional time limits.
- Batch creation supports 1–100 items. Built-in batches are Reading Fill in the Blank ×10, Academic Reading single-choice ×5, Academic Lecture single-choice ×4, and Writing Build a Sentence ×10. Reusable templates with multiple blocks per section can be saved, reloaded, updated, deleted, and applied repeatedly. Templates live in local settings under the current Data folder.
- Sessions support navigation, pausing, timing, status marks, reopening sections, a summary, recovery of incomplete sessions, and several local export formats.
- A separate Typing mode supports English blind typing, drafts, metrics, and export. The local Record Manager manages records and Trash.
- Official v1.0.0 dynamic v6 records remain readable. Pre-v6 records are unsupported; obsolete Speaking runtime has been removed. Shortcut settings show friendly names, and record cards keep technical metadata in expandable details.
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

To start, install the app, enter a Training name, select Reading, Listening, or Writing, and choose Start practice. No external files or materials folder are required. The app does not need to know where separately used study materials are stored.

The Data folder defaults to the operating system's per-user application data directory. Settings can choose another Data folder and open the current one. User records, Recovery, SQLite, logs, and exports stay under that folder; settings stay in the per-user configuration directory. Changing the Data folder does not move old records automatically. To view them, select the previous folder in Settings. Delete formal records through the in-app Record Manager. See [engineering rules](AGENTS.md) and [privacy and safety](docs/product/PRIVACY_AND_SAFETY.md).

The public source excludes real materials, user records, Recovery, SQLite, local settings, exports, and private development history.

### License and independence

Project-authored source and documentation are offered under the [MIT License](LICENSE); third-party dependencies keep their own licenses. This is an independent study tool and is not affiliated with or endorsed by ETS. This repository does not distribute official TOEFL questions, audio, or answer keys. Real study materials remain outside the repository.

### Documentation

[Roadmap](docs/development/ROADMAP.md) · [Changelog](docs/development/CHANGELOG.md) · [Data schema](docs/product/DATA_SCHEMA.md) · [Export format](docs/product/EXPORT_FORMAT.md) · [Privacy and safety](docs/product/PRIVACY_AND_SAFETY.md)

---

<a id="simplified-chinese"></a>

## 简体中文

TOEFL Answer Collection 是基于 Windows/Tauri、以本地为主的 TOEFL 答案记录与英文盲打工具，配合应用外的学习资料使用。[公开源码](https://github.com/HanamiGekka/TOEFL-Answer-Collection)和 [Windows v1.0.1 正式版](https://github.com/HanamiGekka/TOEFL-Answer-Collection/releases/tag/v1.0.1)现已提供。


在 Windows 10/11 x64 上正常使用时，运行当前用户模式的 NSIS 安装程序，然后从开始菜单启动 TOEFL Answer Collection。用户无需安装 Node.js、npm、Rust、Cargo、Git、Visual Studio Build Tools 或 Python。Windows 运行时需要 Microsoft Edge WebView2；受支持的系统通常已安装，缺少时安装程序可能会引导安装。未签名的安装程序可能触发 SmartScreen 提示。

### 当前功能

- 新 Session 使用动态 schema v6。在 Reading、Listening、Writing 中，可逐题创建单选、多选、短文本和长文本 Item，支持自定义标签、选项标签和可选时限。
- 批量建题支持 1–100 题。内置批次为 Reading 填词 ×10、Academic Reading 单选 ×5、Academic Lecture 单选 ×4、Writing Build a Sentence ×10。每个 Section 的多 block 可复用模板可保存、重载、更新、删除和重复应用，保存在当前数据文件夹的本地设置中。
- Session 支持导航、暂停、计时、状态标记、Section 重开、Summary、未完成 Session 恢复和多格式本地导出。
- 独立 Typing 模式支持英文盲打、草稿、统计与导出。本地 Record Manager 管理记录和 Trash。
- 正式 v1.0.0 的动态 v6 记录仍可读取；不再支持 v6 之前的记录，旧 Speaking 运行代码已移除。快捷键设置显示易读名称，记录卡片的技术信息可按需展开。
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

安装应用后，输入训练名称、选择 Reading／Listening／Writing，再点击“开始练习”即可，无需准备外部文件或资料目录。应用不需要知道另外使用的学习资料存放在哪里。

数据文件夹默认位于当前用户的应用数据目录，设置中可选择其他文件夹或打开当前文件夹。用户记录、Recovery、SQLite、日志和导出保存在数据文件夹下；设置保存在当前用户的应用配置目录。更换数据文件夹不会自动迁移旧记录，如需查看旧记录，请在设置中选择原文件夹。正式记录请通过应用内 Record Manager 删除。详见[工程规则](AGENTS.md)与[隐私和安全](docs/product/PRIVACY_AND_SAFETY.md)。

公开源码不包含真实资料、用户记录、Recovery、SQLite、本机设置、导出和私人开发历史。

### 许可与独立性

项目原创源码及文档采用 [MIT 许可证](LICENSE)；第三方依赖保留各自的许可证。本项目是独立学习工具，与 ETS 无关联，也未获其认可。仓库不分发官方 TOEFL 题目、音频或答案；真实学习资料保留在仓库外。

### 文档

[路线图](docs/development/ROADMAP.md) · [版本变更](docs/development/CHANGELOG.md) · [数据模型](docs/product/DATA_SCHEMA.md) · [导出格式](docs/product/EXPORT_FORMAT.md) · [隐私和安全](docs/product/PRIVACY_AND_SAFETY.md)

---

<a id="japanese"></a>

## 日本語

TOEFL Answer Collection は、アプリの外に置いた学習資料と併用する、Windows/Tauri 製のローカル優先 TOEFL 解答記録・英語ブラインドタイピングツールです。[公開ソース](https://github.com/HanamiGekka/TOEFL-Answer-Collection)と [Windows v1.0.1 リリース](https://github.com/HanamiGekka/TOEFL-Answer-Collection/releases/tag/v1.0.1)を利用できます。


Windows 10/11 x64 で通常使用する場合は、現在のユーザー向け NSIS インストーラーを実行し、スタートメニューから TOEFL Answer Collection を起動します。利用者は Node.js、npm、Rust、Cargo、Git、Visual Studio Build Tools、Python をインストールする必要はありません。Windows の実行には Microsoft Edge WebView2 が必要です。対応する Windows には通常含まれ、ない場合はインストーラーが導入を支援することがあります。未署名のインストーラーには SmartScreen の警告が表示される場合があります。

### 現在の機能

- 新しい Session は動的 schema v6 を使用します。Reading、Listening、Writing では、単一選択、複数選択、短文、長文の Item を 1 問ずつ作成でき、独自のラベル、選択肢ラベル、任意の制限時間を設定できます。
- 一括作成では 1～100 問を作れます。標準の一括設定は Reading の穴埋め ×10、Academic Reading の単一選択 ×5、Academic Lecture の単一選択 ×4、Writing Build a Sentence ×10 です。Section ごとに複数 block を含む再利用可能なテンプレートを保存、再読込、更新、削除、繰り返し適用できます。テンプレートは現在のデータフォルダーのローカル設定に保存されます。
- Session には問題移動、一時停止、計時、状態の記録、Section の再開、Summary、未完了 Session の復元、複数形式でのローカル書き出しがあります。
- 独立した Typing モードでは、英語のブラインドタイピング、下書き、統計、書き出しを利用できます。ローカルの Record Manager で記録と Trash を管理します。
- 正式版 v1.0.0 を含む動的 v6 記録を引き続き読み込めます。v6 より前の記録は非対応となり、従来の Speaking 処理は削除されました。ショートカットは分かりやすい名前で表示し、記録の技術情報は必要に応じて展開できます。
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

アプリをインストールし、練習名を入力して Reading／Listening／Writing を選び、「練習を開始」を押します。外部ファイルや教材フォルダーの準備は不要です。別に使う学習教材の保存先をアプリに知らせる必要はありません。

データフォルダーの既定値は現在のユーザーのアプリデータ領域です。設定で別のフォルダーを選択したり、現在のフォルダーを開いたりできます。記録、Recovery、SQLite、ログ、書き出しはそのフォルダー内に保存され、設定はユーザーのアプリ設定フォルダーに保存されます。データフォルダーの変更では古い記録は自動移行されません。必要なら設定で以前のフォルダーを選びます。正式な記録の削除にはアプリ内の Record Manager を使ってください。[開発ルール](AGENTS.md)と[プライバシーと安全性](docs/product/PRIVACY_AND_SAFETY.md)も参照してください。

公開ソースには、実際の教材、ユーザー記録、Recovery、SQLite、ローカル設定、書き出し、非公開の開発履歴を含めません。

### ライセンスと独立性

本プロジェクトが作成したソースと文書は [MIT ライセンス](LICENSE)で提供します。第三者の依存関係にはそれぞれのライセンスが適用されます。本プロジェクトは独立した学習ツールであり、ETS との提携や ETS による承認はありません。公式 TOEFL の問題、音声、解答は配布しません。実際の学習教材はリポジトリの外に置きます。

### ドキュメント

[ロードマップ](docs/development/ROADMAP.md) · [変更履歴](docs/development/CHANGELOG.md) · [データスキーマ](docs/product/DATA_SCHEMA.md) · [書き出し形式](docs/product/EXPORT_FORMAT.md) · [プライバシーと安全性](docs/product/PRIVACY_AND_SAFETY.md)

---

<a id="traditional-chinese"></a>

## 繁體中文

TOEFL Answer Collection 是以本機為優先、使用 Windows/Tauri 的 TOEFL 答案記錄與英文盲打工具，搭配應用程式外的學習資料使用。[公開原始碼](https://github.com/HanamiGekka/TOEFL-Answer-Collection)與 [Windows v1.0.1 正式版](https://github.com/HanamiGekka/TOEFL-Answer-Collection/releases/tag/v1.0.1)現已提供。


在 Windows 10/11 x64 上一般使用時，執行目前使用者模式的 NSIS 安裝程式，再從開始功能表啟動 TOEFL Answer Collection。使用者不需安裝 Node.js、npm、Rust、Cargo、Git、Visual Studio Build Tools 或 Python。Windows 執行時需要 Microsoft Edge WebView2；支援的 Windows 通常已具備，缺少時安裝程式可能協助安裝。未簽署的安裝程式可能觸發 SmartScreen 警告。

### 目前功能

- 新 Session 使用動態 schema v6。在 Reading、Listening、Writing 中，可逐題建立單選、多選、短文字與長文字 Item，支援自訂標籤、選項標籤和選用時限。
- 批次建題支援 1–100 題。內建批次為 Reading 填空 ×10、Academic Reading 單選 ×5、Academic Lecture 單選 ×4、Writing Build a Sentence ×10。每個 Section 可儲存、重新載入、更新、刪除和重複套用含多個 block 的範本。範本儲存在目前資料資料夾的本機設定中。
- Session 支援導覽、暫停、計時、狀態標記、重新開啟 Section、Summary、復原未完成 Session，以及多種格式的本機匯出。
- 獨立 Typing 模式支援英文盲打、草稿、統計和匯出。本機 Record Manager 管理記錄與 Trash。
- 正式 v1.0.0 的動態 v6 記錄仍可讀取；不再支援 v6 之前的記錄，舊 Speaking 執行程式碼已移除。快捷鍵設定顯示易讀名稱，記錄卡片的技術資訊可按需展開。
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

安裝應用程式後，輸入練習名稱、選擇 Reading／Listening／Writing，再按「開始練習」即可，無需準備外部檔案或教材資料夾。應用程式不需要知道另行使用的學習資料存放位置。

資料資料夾預設位於目前使用者的應用程式資料目錄。設定中可選擇其他資料夾或開啟目前的資料夾。記錄、Recovery、SQLite、日誌與匯出儲存在資料資料夾下；設定儲存在使用者的應用程式設定目錄。更換資料資料夾不會自動移轉舊記錄；如需檢視，請在設定中選擇原資料夾。正式記錄請透過應用程式內的 Record Manager 刪除。詳見[工程規則](AGENTS.md)與[隱私及安全](docs/product/PRIVACY_AND_SAFETY.md)。

公開原始碼不包含真實資料、使用者記錄、Recovery、SQLite、本機設定、匯出和私人開發歷史。

### 授權與獨立性

本專案原創原始碼及文件採用 [MIT 授權](LICENSE)；第三方相依套件保留各自的授權。本專案是獨立的學習工具，與 ETS 無關，也未獲其認可。儲存庫不散布官方 TOEFL 題目、音訊或答案；真實學習資料保留在儲存庫外。

### 文件

[路線圖](docs/development/ROADMAP.md) · [變更記錄](docs/development/CHANGELOG.md) · [資料模型](docs/product/DATA_SCHEMA.md) · [匯出格式](docs/product/EXPORT_FORMAT.md) · [隱私及安全](docs/product/PRIVACY_AND_SAFETY.md)
