# TOEFL Answer Collection

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [繁體中文](README.zh-TW.md)

TOEFL Answer Collection は、練習解答を記録し、練習時間を計測する**ローカル優先の Windows アプリ**です。英語のタッチタイピング練習にも対応しています。教材はアプリの外で参照します。**公式 TOEFL の問題、音声、正解は収録していません。**

![TOEFL Answer Collection v1.0.1：架空の文章を使った練習設定とタイピング画面（英語 UI）](docs/images/home-and-typing-v1.0.1.jpg)

*実際の v1.0.1 Windows アプリを、独立したテスト環境と架空の文章で撮影した英語 UI の画面です。テスト用の表示は残しており、個人の記録や公式教材は含みません。[撮影条件](docs/product/SCREENSHOTS.md)。*

## はじめに

1. [Release から v1.0.1 の Windows インストーラー](https://github.com/HanamiGekka/TOEFL-Answer-Collection/releases/tag/v1.0.1)を取得し、現在の Windows アカウントにインストールしてスタートメニューから起動します。
2. 練習画面で**練習名**を入力し、Reading／Listening／Writing を選んで練習を開始します。設問は個別または一括で作成でき、教材フォルダーの指定は不要です。
3. 英語のタッチタイピングは、同じ画面のタイピング練習欄で開始します。一時停止や終了ができ、下書きと書き出しはローカルに保存されます。
4. 保存済みの記録は Record Manager、保存先の確認・変更は設定の**データフォルダー**から行います。

**動作環境：**Windows 10/11 x64 と Microsoft Edge **WebView2**。WebView2 がない場合は、インストーラーが導入を支援することがあります。配布物は**未署名**で、SmartScreen の警告が表示される場合があります。インストール済みアプリの利用に Node.js や Rust は不要です。

## 現在の機能

- Reading、Listening、Writing の解答を**動的 schema v6** で記録。単一選択、複数選択、短文、長文の設問を作成し、ラベルや任意の制限時間を設定できます。
- **1～100 問**の一括作成、標準の一括設定、セクションごとの複数ブロックを含む再利用可能なテンプレート。テンプレートは現在のデータフォルダーのローカル設定に保存します。
- 計時、一時停止・再開、状態の記録、設問移動、セクションの再開、結果一覧、未完了セッションの復元、複数形式の書き出し。
- 英語タイピングの下書き、統計、書き出しと、Record Manager／ごみ箱によるローカル記録の管理。
- 英語、簡体字中国語、日本語、繁体字中国語の UI。初回は英語で、保存した言語設定を維持します。

## データの安全性

**データフォルダー**の既定値は、現在のアカウントのアプリデータ領域です。記録、Recovery、SQLite、ログ、書き出しはその中に、アプリ設定はアカウントの設定領域に保存します。**保存先を変更しても、古い記録は自動移行されません。** 過去の記録を見るには以前のフォルダーを選び直します。

アプリにネットワーク通信やテレメトリーはありません。正式な記録の削除は Record Manager から行い、書き出しを共有する前に内容を確認してください。公開ソースには個人の解答、実際の練習記録、Recovery、データベース、ローカル設定、教材、非公開の開発履歴を含めません。[プライバシーと安全性](docs/product/PRIVACY_AND_SAFETY.md)も参照してください。

## ローカル開発

Tauri、TypeScript、Rust で構築しています。 ソースからのビルドには **Node.js 24.18.0**（互換 24.x 可）、**Rust 1.96.1**、Windows 用 Tauri の前提コンポーネントが必要です。導入、監査、試験、パッケージ作成のコマンドは[開発・ビルドガイド](docs/development/BUILD.md)、構成は[アーキテクチャ](docs/product/ARCHITECTURE.md)にまとめています。CI は Ubuntu フロントエンドと Windows ネイティブ／パッケージングを検査します。

## 記録の互換性

正式版 **v1.0.0 の動的 v6 記録は引き続き読み込めます**。v6 より前の記録は非対応で、現行版に Speaking はありません。

## ライセンスと独立性

プロジェクト独自のソースと文書は [MIT ライセンス](LICENSE)で提供し、依存関係にはそれぞれの条件が適用されます。独立した学習ツールであり、**ETS との提携や ETS による承認はありません**。公式 TOEFL の問題、音声、解答は配布しません。

## ドキュメント

[ロードマップ](docs/development/ROADMAP.md) · [変更履歴](docs/development/CHANGELOG.md) · [データスキーマ](docs/product/DATA_SCHEMA.md) · [書き出し形式](docs/product/EXPORT_FORMAT.md) · [プライバシーと安全性](docs/product/PRIVACY_AND_SAFETY.md)
