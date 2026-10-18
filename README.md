# TOEFL Answer Collection

Language / 语言 / 言語 / 語言: [English](#english) → [简体中文](#simplified-chinese) → [日本語](#japanese) → [繁體中文](#traditional-chinese)

<a id="english"></a>

## English

A **local-first Windows app** for recording TOEFL practice answers, timing sessions and practicing English blind typing. Keep your study materials outside the app and record your work alongside them. **No official TOEFL questions, audio or answer keys are included.**

![TOEFL Answer Collection v1.0.1: training setup and blind typing with synthetic demo text](docs/images/home-and-typing-v1.0.1.jpg)

*Actual v1.0.1 Windows app, captured in isolated test-data mode with synthetic text. The test banner is intentionally visible; no personal records or official materials appear. [Screenshot details](docs/product/SCREENSHOTS.md).*

### Quick start

1. Download the **v1.0.1 Windows installer** from [Releases](https://github.com/HanamiGekka/TOEFL-Answer-Collection/releases/tag/v1.0.1), install for the current Windows account and open it from the Start menu.
2. On the Practice page, enter a **Training name**, choose Reading, Listening or Writing, then select **Start practice**. Add items individually or in batches; no materials folder is required.
3. For typing, use **Blind typing practice → Start** on the same page. Pause or end the practice as needed; drafts and exports stay local.
4. Open **Record Manager** to review saved records, or **Settings → Data folder** to locate or select the storage folder.

**Requirements:** Windows 10/11 x64 and Microsoft Edge **WebView2**. The installer may bootstrap WebView2 if it is missing. The installer is **unsigned**, so SmartScreen may show a warning. Running the installed app does not require Node.js, Rust or other development tools.

### Current features

- Reading, Listening and Writing answer records under **dynamic schema v6**, with single-choice, multiple-choice, short-text and long-text items, custom labels and optional time limits.
- Batch creation of **1–100 items**, built-in batch presets and reusable multi-block templates for each section. Templates stay in the current Data folder's local settings.
- Timing, pause/resume, status marks, navigation, section reopening, summaries, recovery of incomplete sessions and several local export formats.
- Separate English blind typing with drafts, statistics and exports; a local Record Manager and Trash.
- English, Simplified Chinese, Japanese and Traditional Chinese UI. Fresh use starts in English; the saved language choice persists.
- Official **v1.0.0 dynamic v6 records remain readable**. Pre-v6 records are unsupported. Speaking is not part of the current runtime.

### Data safety

The **Data folder** defaults to the operating system's per-account application data directory. Records, Recovery, SQLite, logs and exports stay there; application settings stay in the per-account configuration directory. Selecting another Data folder **does not move old records automatically**. Select the previous folder again to view its records.

The app has no network access or telemetry. Use Record Manager for formal-record deletion and review exports before sharing them. Public source excludes personal answers, real practice records, Recovery, databases, local settings, external study materials and private development history. See [privacy and safety](docs/product/PRIVACY_AND_SAFETY.md).

### Local development

Build from source with **Node.js 24.18.0** (compatible 24.x accepted) and **Rust 1.96.1**, plus the Windows Tauri prerequisites. The [development and build guide](docs/development/BUILD.md) contains installation, audit, test and packaging commands. See [architecture](docs/product/ARCHITECTURE.md) for runtime structure. The repository CI checks Ubuntu frontend and Windows native/packaging behavior.

### License and independence

Project-authored source and documentation use the [MIT License](LICENSE); dependencies retain their own licenses. This independent study tool is **not affiliated with or endorsed by ETS** and does not distribute official TOEFL questions, audio or answer keys.

### Documentation

[Roadmap](docs/development/ROADMAP.md) · [Changelog](docs/development/CHANGELOG.md) · [Data schema](docs/product/DATA_SCHEMA.md) · [Export format](docs/product/EXPORT_FORMAT.md) · [Privacy and safety](docs/product/PRIVACY_AND_SAFETY.md)

---

<a id="simplified-chinese"></a>

## 简体中文

TOEFL Answer Collection 是**以本地为主的 Windows 答案记录与英文盲打工具**，用于记录 TOEFL 练习答案、计时和复习。学习资料在应用外自行使用；**程序不包含官方题目、音频或标准答案**。

### 快速开始

1. 从 [Release 下载 v1.0.1 Windows 安装包](https://github.com/HanamiGekka/TOEFL-Answer-Collection/releases/tag/v1.0.1)，按当前 Windows 账户安装，再从开始菜单启动。
2. 在练习页输入**训练名称**，选择 Reading／Listening／Writing，点击“开始练习”，随后逐题或批量建题，无需选择教材目录。
3. 英文盲打在同页的盲打练习区开始，可暂停或结束；草稿和导出保存在本地。
4. 在 Record Manager 查看已保存记录，在设置的**数据文件夹**中查看或选择存储位置。

**运行要求：**Windows 10/11 x64 和 Microsoft Edge **WebView2**；缺少 WebView2 时安装程序可能引导安装。安装包**未签名**，可能出现 SmartScreen 提示。运行正式应用无需 Node.js、Rust 等开发工具。[上方展示图](#english)来自隔离测试环境，仅含合成文字。

### 当前功能

- Reading、Listening、Writing 使用**动态 schema v6** 记录答案，可创建单选、多选、短文本、长文本题目，并设置自定义标签和可选时限。
- 支持 **1–100 题**批量创建、内置批次及各部分的多块可复用模板；模板保存在当前数据文件夹的本地设置中。
- 支持计时、暂停与继续、状态标记、题目导航、重新打开部分、结果汇总、未完成会话恢复和多格式本地导出。
- 独立英文盲打提供草稿、统计和导出；Record Manager 与回收站管理本地记录。
- 界面支持英语、简体中文、日语和繁体中文，首次默认英语，后续保留已保存的语言选择。
- 正式 **v1.0.0 动态 v6 记录仍可读取**；不支持 v6 之前的记录，当前程序不提供 Speaking。

### 数据安全

**数据文件夹**默认位于当前账户的应用数据目录。记录、Recovery、SQLite、日志与导出保存在这里，应用设置另存于账户的配置目录。**更换数据文件夹不会自动迁移旧记录**；需要查看旧记录时，重新选择原文件夹。

应用无联网功能或遥测。正式记录通过 Record Manager 删除，导出分享前请检查内容。公开源码不含个人答案、真实练习记录、Recovery、数据库、本机设置、外部学习资料或私有开发历史。详见[隐私和安全](docs/product/PRIVACY_AND_SAFETY.md)。

### 本地开发

源码构建使用 **Node.js 24.18.0**（接受兼容的 24.x）和 **Rust 1.96.1**，并需准备 Windows Tauri 组件。[开发与构建指南](docs/development/BUILD.md)集中说明安装、审计、测试和打包命令；运行结构见[架构](docs/product/ARCHITECTURE.md)。仓库 CI 检查 Ubuntu 前端和 Windows 原生／打包行为。

### 许可与独立性

项目原创源码及文档采用 [MIT 许可证](LICENSE)，依赖保留各自条款。本项目是独立学习工具，**与 ETS 无关联，也未获其认可**；不分发官方 TOEFL 题目、音频或答案。

### 文档

[路线图](docs/development/ROADMAP.md) · [版本变更](docs/development/CHANGELOG.md) · [数据模型](docs/product/DATA_SCHEMA.md) · [导出格式](docs/product/EXPORT_FORMAT.md) · [隐私和安全](docs/product/PRIVACY_AND_SAFETY.md)

---

<a id="japanese"></a>

## 日本語

TOEFL Answer Collection は、TOEFL の練習解答、計時、英語のタッチタイピングを扱う、**ローカル優先の Windows アプリ**です。教材はアプリの外で参照しながら使います。**公式 TOEFL の問題、音声、正解は収録していません。**

### はじめに

1. [Release から v1.0.1 の Windows インストーラー](https://github.com/HanamiGekka/TOEFL-Answer-Collection/releases/tag/v1.0.1)を取得し、現在の Windows アカウントにインストールしてスタートメニューから起動します。
2. 練習画面で**練習名**を入力し、Reading／Listening／Writing を選んで練習を開始します。設問は個別または一括で作成でき、教材フォルダーの指定は不要です。
3. 英語のタッチタイピングは、同じ画面のタイピング練習欄で開始します。一時停止や終了ができ、下書きと書き出しはローカルに保存されます。
4. 保存済みの記録は Record Manager、保存先の確認・変更は設定の**データフォルダー**から行います。

**動作環境：**Windows 10/11 x64 と Microsoft Edge **WebView2**。WebView2 がない場合は、インストーラーが導入を支援することがあります。配布物は**未署名**で、SmartScreen の警告が表示される場合があります。インストール済みアプリの利用に Node.js や Rust は不要です。[上の画面例](#english)は独立したテスト環境で撮影し、架空の文章だけを使っています。

### 現在の機能

- Reading、Listening、Writing の解答を**動的 schema v6** で記録。単一選択、複数選択、短文、長文の設問を作成し、ラベルや任意の制限時間を設定できます。
- **1～100 問**の一括作成、標準の一括設定、セクションごとの複数ブロックを含む再利用可能なテンプレート。テンプレートは現在のデータフォルダーのローカル設定に保存します。
- 計時、一時停止・再開、状態の記録、設問移動、セクションの再開、結果一覧、未完了セッションの復元、複数形式の書き出し。
- 英語タイピングの下書き、統計、書き出しと、Record Manager／ごみ箱によるローカル記録の管理。
- 英語、簡体字中国語、日本語、繁体字中国語の UI。初回は英語で、保存した言語設定を維持します。
- 正式版 **v1.0.0 の動的 v6 記録は引き続き読み込めます**。v6 より前の記録は非対応で、現行版に Speaking はありません。

### データの安全性

**データフォルダー**の既定値は、現在のアカウントのアプリデータ領域です。記録、Recovery、SQLite、ログ、書き出しはその中に、アプリ設定はアカウントの設定領域に保存します。**保存先を変更しても、古い記録は自動移行されません。** 過去の記録を見るには以前のフォルダーを選び直します。

アプリにネットワーク通信やテレメトリーはありません。正式な記録の削除は Record Manager から行い、書き出しを共有する前に内容を確認してください。公開ソースには個人の解答、実際の練習記録、Recovery、データベース、ローカル設定、教材、非公開の開発履歴を含めません。[プライバシーと安全性](docs/product/PRIVACY_AND_SAFETY.md)も参照してください。

### ローカル開発

ソースからのビルドには **Node.js 24.18.0**（互換 24.x 可）、**Rust 1.96.1**、Windows 用 Tauri の前提コンポーネントが必要です。導入、監査、試験、パッケージ作成のコマンドは[開発・ビルドガイド](docs/development/BUILD.md)、構成は[アーキテクチャ](docs/product/ARCHITECTURE.md)にまとめています。CI は Ubuntu フロントエンドと Windows ネイティブ／パッケージングを検査します。

### ライセンスと独立性

プロジェクト独自のソースと文書は [MIT ライセンス](LICENSE)で提供し、依存関係にはそれぞれの条件が適用されます。独立した学習ツールであり、**ETS との提携や ETS による承認はありません**。公式 TOEFL の問題、音声、解答は配布しません。

### ドキュメント

[ロードマップ](docs/development/ROADMAP.md) · [変更履歴](docs/development/CHANGELOG.md) · [データスキーマ](docs/product/DATA_SCHEMA.md) · [書き出し形式](docs/product/EXPORT_FORMAT.md) · [プライバシーと安全性](docs/product/PRIVACY_AND_SAFETY.md)

---

<a id="traditional-chinese"></a>

## 繁體中文

TOEFL Answer Collection 是**以本機為優先的 Windows 答案記錄與英文盲打工具**，用來記錄 TOEFL 練習答案、計時與複習。學習資料在應用程式外自行參閱；**程式不包含官方題目、音訊或標準答案**。

### 快速開始

1. 從 [Release 下載 v1.0.1 Windows 安裝程式](https://github.com/HanamiGekka/TOEFL-Answer-Collection/releases/tag/v1.0.1)，以目前的 Windows 帳戶安裝，再從開始功能表啟動。
2. 在練習頁輸入**練習名稱**，選擇 Reading／Listening／Writing，再開始練習。接著逐題或批次建題，不必指定教材資料夾。
3. 英文盲打可直接在同頁的盲打練習區開始，並可暫停或結束；草稿與匯出檔儲存在本機。
4. 在 Record Manager 檢視已儲存記錄，在設定的**資料資料夾**中查看或選擇儲存位置。

**執行需求：**Windows 10/11 x64 與 Microsoft Edge **WebView2**；未安裝 WebView2 時，安裝程式可能協助導入。安裝程式**未簽署**，可能出現 SmartScreen 警告。執行正式應用程式不需要 Node.js、Rust 等開發工具。[上方展示圖](#english)來自獨立測試環境，只含合成文字。

### 目前功能

- Reading、Listening、Writing 以**動態 schema v6** 記錄答案，可建立單選、多選、短文字、長文字題目，設定自訂標籤與選用時限。
- 支援 **1–100 題**批次建立、內建批次與各部分含多個區塊的可重用範本；範本儲存在目前資料資料夾的本機設定中。
- 支援計時、暫停與繼續、狀態標記、題目導覽、重新開啟部分、結果摘要、復原未完成工作階段與多格式匯出。
- 獨立英文盲打提供草稿、統計與匯出；Record Manager 與垃圾桶管理本機記錄。
- 介面支援英文、簡體中文、日文與繁體中文。首次預設英文，後續保留已儲存的語言選擇。
- 正式 **v1.0.0 動態 v6 記錄仍可讀取**；不支援 v6 之前的記錄，目前程式不提供 Speaking。

### 資料安全

**資料資料夾**預設位於目前帳戶的應用程式資料目錄。記錄、Recovery、SQLite、日誌與匯出儲存在這裡，應用程式設定另存於帳戶的設定目錄。**變更資料資料夾不會自動移轉舊記錄**；需要查看舊記錄時，請重新選擇原資料夾。

應用程式沒有網路功能或遙測。正式記錄透過 Record Manager 刪除，分享匯出檔前請檢查內容。公開原始碼不含個人答案、真實練習記錄、Recovery、資料庫、本機設定、外部教材或私有開發歷史。詳見[隱私及安全](docs/product/PRIVACY_AND_SAFETY.md)。

### 本機開發

從原始碼建置使用 **Node.js 24.18.0**（接受相容的 24.x）與 **Rust 1.96.1**，並需準備 Windows Tauri 元件。[開發與建置指南](docs/development/BUILD.md)集中說明安裝、稽核、測試與封裝指令；執行結構見[架構](docs/product/ARCHITECTURE.md)。儲存庫 CI 檢查 Ubuntu 前端與 Windows 原生／封裝行為。

### 授權與獨立性

專案原創原始碼及文件採用 [MIT 授權](LICENSE)，相依套件保留各自條款。本專案是獨立學習工具，**與 ETS 無關，也未獲其認可**；不散布官方 TOEFL 題目、音訊或答案。

### 文件

[路線圖](docs/development/ROADMAP.md) · [變更記錄](docs/development/CHANGELOG.md) · [資料模型](docs/product/DATA_SCHEMA.md) · [匯出格式](docs/product/EXPORT_FORMAT.md) · [隱私及安全](docs/product/PRIVACY_AND_SAFETY.md)
