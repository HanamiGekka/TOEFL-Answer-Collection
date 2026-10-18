# TOEFL Answer Collection

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [繁體中文](README.zh-TW.md)

TOEFL Answer Collection 是**本地优先的 Windows 答案记录与英文盲打工具**，用于记录 TOEFL 练习答案、计时和复习。学习资料在应用外自行使用；**程序不包含官方题目、音频或标准答案**。


![TOEFL Answer Collection v1.0.1：合成文字的练习设置与盲打界面（英语 UI）](docs/images/home-and-typing-v1.0.1.jpg)

*实际 v1.0.1 Windows 应用，使用隔离测试数据与合成文字截图，画面为英语 UI。测试提示刻意保留；不含个人记录或官方材料。[截图来源](docs/product/SCREENSHOTS.md)。*

## 快速开始

1. 从 [Release 下载 v1.0.1 Windows 安装包](https://github.com/HanamiGekka/TOEFL-Answer-Collection/releases/tag/v1.0.1)，按当前 Windows 账户安装，再从开始菜单启动。
2. 在练习页输入**训练名称**，选择 Reading／Listening／Writing，点击“开始练习”，随后逐题或批量建题，无需选择教材目录。
3. 英文盲打在同页的盲打练习区开始，可暂停或结束；草稿和导出保存在本地。
4. 在 Record Manager 查看已保存记录，在设置的**数据文件夹**中查看或选择存储位置。

**运行要求：**Windows 10/11 x64 和 Microsoft Edge **WebView2**；缺少 WebView2 时安装程序可能引导安装。安装包**未签名**，可能出现 SmartScreen 提示。运行正式应用无需 Node.js、Rust 等开发工具。

## 当前功能

- Reading、Listening、Writing 使用**动态 schema v6** 记录答案，可创建单选、多选、短文本、长文本题目，并设置自定义标签和可选时限。
- 支持 **1–100 题**批量创建、内置批次及各部分的多块可复用模板；模板保存在当前数据文件夹的本地设置中。
- 支持计时、暂停与继续、状态标记、题目导航、重新打开部分、结果汇总、未完成会话恢复和多格式本地导出。
- 独立英文盲打提供草稿、统计和导出；Record Manager 与回收站管理本地记录。
- 界面支持英语、简体中文、日语和繁体中文，首次默认英语，后续保留已保存的语言选择。

## 数据安全

**数据文件夹**默认位于当前账户的应用数据目录。记录、Recovery、SQLite、日志与导出保存在这里，应用设置另存于账户的配置目录。**更换数据文件夹不会自动迁移旧记录**；需要查看旧记录时，重新选择原文件夹。

应用无联网功能或遥测。正式记录通过 Record Manager 删除，导出分享前请检查内容。公开源码不含个人答案、真实练习记录、Recovery、数据库、本机设置、外部学习资料或私有开发历史。详见[隐私和安全](docs/product/PRIVACY_AND_SAFETY.md)。

## 本地开发

采用 Tauri、TypeScript 和 Rust 构建。 源码构建使用 **Node.js 24.18.0**（接受兼容的 24.x）和 **Rust 1.96.1**，并需准备 Windows Tauri 组件。[开发与构建指南](docs/development/BUILD.md)集中说明安装、审计、测试和打包命令；运行结构见[架构](docs/product/ARCHITECTURE.md)。仓库 CI 检查 Ubuntu 前端和 Windows 原生／打包行为。

## 记录兼容性

正式 **v1.0.0 动态 v6 记录仍可读取**；不支持 v6 之前的记录，当前程序不提供 Speaking。

## 许可与独立性

项目原创源码及文档采用 [MIT 许可证](LICENSE)，依赖保留各自条款。本项目是独立学习工具，**与 ETS 无关联，也未获其认可**；不分发官方 TOEFL 题目、音频或答案。

## 文档

[路线图](docs/development/ROADMAP.md) · [版本变更](docs/development/CHANGELOG.md) · [数据模型](docs/product/DATA_SCHEMA.md) · [导出格式](docs/product/EXPORT_FORMAT.md) · [隐私和安全](docs/product/PRIVACY_AND_SAFETY.md)
