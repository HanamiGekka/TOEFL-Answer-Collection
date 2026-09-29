use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
use std::{
    collections::HashMap,
    ffi::OsStr,
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
};
use tauri::Manager;
#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

mod app_paths;
mod records;

use app_paths::{current_app_paths, AppPaths};

#[derive(Debug, Serialize)]
struct PackageSummary {
    package_id: String,
    source_relative_path: String,
    modules: Vec<PackageModuleSummary>,
}

#[derive(Debug, Serialize)]
struct PackageModuleSummary {
    module_name: String,
    file_names: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct PracticeSessionLite {
    session_id: String,
    package_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_relative_path: Option<String>,
    mode: String,
    timing_profile_id: String,
    timing_profile_version: String,
    created_at: String,
    started_at: Option<String>,
    completed_at: Option<String>,
    active_ms: i64,
    paused_ms: i64,
    unattributed_active_time_ms: i64,
    questions: Vec<PracticeQuestionTimeLite>,
    answers: HashMap<String, AnswerTimeLite>,
    modules: Vec<ModuleTimeLite>,
    #[serde(default)]
    tasks: Vec<TaskTimeLite>,
    #[serde(flatten)]
    _extra: Value,
}

#[derive(Debug, Deserialize, Serialize)]
struct PracticeQuestionTimeLite {
    id: String,
    time_limit_ms: Option<i64>,
    remaining_ms: Option<i64>,
    timer_limit_ms: Option<i64>,
    #[serde(flatten)]
    _extra: Value,
}

#[derive(Debug, Deserialize, Serialize)]
struct AnswerTimeLite {
    first_answer_elapsed_ms: Option<i64>,
    active_time_ms: i64,
    total_active_ms: i64,
    #[serde(flatten)]
    _extra: Value,
}

#[derive(Debug, Deserialize, Serialize)]
struct ModuleTimeLite {
    id: String,
    #[serde(rename = "activeTimeMs")]
    active_time_ms: i64,
    #[serde(flatten)]
    _extra: Value,
}

#[derive(Debug, Deserialize, Serialize)]
struct TaskTimeLite {
    task_id: String,
    active_time_ms: i64,
    pause_time_ms: i64,
    remaining_ms: Option<i64>,
    timer_limit_ms: Option<i64>,
    #[serde(flatten)]
    _extra: Value,
}

#[derive(Debug, Deserialize, Serialize)]
struct EventLogEntry {
    session_id: String,
    seq: i64,
    monotonic_elapsed_ms: i64,
    wall_clock: String,
    event_type: String,
    payload: Value,
    schema_version: String,
}

#[tauri::command]
fn ensure_data_dirs() -> Result<(), String> {
    ensure_data_dirs_for_paths(&current_app_paths())
}

fn ensure_data_dirs_for_paths(paths: &AppPaths) -> Result<(), String> {
    app_paths::validate_controlled_roots(paths)?;
    for relative in [
        "data",
        "data/recovery",
        "logs",
        "config",
        "config/timing-profiles",
    ] {
        fs::create_dir_all(paths.app_root.join(relative)).map_err(to_string)?;
    }
    fs::create_dir_all(&paths.records_root).map_err(to_string)?;
    fs::create_dir_all(&paths.typing_records_root).map_err(to_string)?;
    fs::create_dir_all(&paths.trash_root).map_err(to_string)?;
    Ok(())
}

#[tauri::command]
fn init_database() -> Result<(), String> {
    init_database_for_paths(&current_app_paths())
}

fn init_database_for_paths(paths: &AppPaths) -> Result<(), String> {
    ensure_data_dirs_for_paths(paths)?;
    let conn = Connection::open(paths.database_path()).map_err(to_string)?;
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS practice_sessions (
            session_id TEXT PRIMARY KEY,
            package_id TEXT NOT NULL,
            source_path TEXT NOT NULL,
            mode TEXT NOT NULL,
            timing_profile_id TEXT NOT NULL,
            timing_profile_version TEXT NOT NULL,
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            active_ms INTEGER NOT NULL DEFAULT 0,
            paused_ms INTEGER NOT NULL DEFAULT 0,
            snapshot_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS section_runs (
            section_run_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            section_name TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            active_ms INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(session_id) REFERENCES practice_sessions(session_id)
        );

        CREATE TABLE IF NOT EXISTS question_runs (
            question_run_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            section_name TEXT NOT NULL,
            question_id TEXT NOT NULL,
            question_number INTEGER NOT NULL,
            status TEXT NOT NULL,
            active_ms INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(session_id) REFERENCES practice_sessions(session_id)
        );

        CREATE TABLE IF NOT EXISTS answers (
            answer_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            question_id TEXT NOT NULL,
            answer_value_json TEXT,
            status TEXT NOT NULL,
            is_overtime INTEGER NOT NULL DEFAULT 0,
            is_skipped INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES practice_sessions(session_id)
        );

        CREATE TABLE IF NOT EXISTS answer_revisions (
            revision_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            question_id TEXT NOT NULL,
            seq INTEGER NOT NULL,
            answer_value_json TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES practice_sessions(session_id)
        );

        CREATE TABLE IF NOT EXISTS timer_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            seq INTEGER NOT NULL,
            monotonic_elapsed_ms INTEGER NOT NULL,
            wall_clock TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            schema_version TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS minute_samples (
            sample_id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL,
            owner_type TEXT NOT NULL,
            sample_json TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS typing_sessions (
            typing_session_id TEXT PRIMARY KEY,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            active_ms INTEGER NOT NULL DEFAULT 0,
            paused_ms INTEGER NOT NULL DEFAULT 0,
            summary_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS typing_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            typing_session_id TEXT NOT NULL,
            seq INTEGER NOT NULL,
            monotonic_elapsed_ms INTEGER NOT NULL,
            wall_clock TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS timing_profiles (
            profile_id TEXT NOT NULL,
            profile_version TEXT NOT NULL,
            profile_json TEXT NOT NULL,
            PRIMARY KEY(profile_id, profile_version)
        );

        CREATE TABLE IF NOT EXISTS record_trash (
            trash_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            record_type TEXT NOT NULL,
            manifest_json TEXT NOT NULL,
            trashed_at TEXT NOT NULL
        );

        INSERT OR IGNORE INTO schema_migrations(version) VALUES ('1.0.0');
        "#,
    )
    .map_err(to_string)?;
    Ok(())
}

#[tauri::command]
fn scan_packages() -> Result<Vec<PackageSummary>, String> {
    scan_packages_at(&current_app_paths().source_root)
}

fn scan_packages_at(root: &Path) -> Result<Vec<PackageSummary>, String> {
    app_paths::inspect_source_root(root)?;
    let id_re =
        Regex::new(r"^(?:\d{2}\.\d{2}\.[A-Z]\.\d+|Mock\.\d{2}\.[A-Z]\.\d+)$").map_err(to_string)?;
    let mut packages = Vec::new();

    for entry in fs::read_dir(root).map_err(to_string)? {
        let entry = entry.map_err(to_string)?;
        if !entry.file_type().map_err(to_string)?.is_dir() {
            continue;
        }
        let package_id = entry.file_name().to_string_lossy().to_string();
        if !id_re.is_match(&package_id) {
            continue;
        }
        packages.push(PackageSummary {
            source_relative_path: package_id.clone(),
            package_id,
            modules: Vec::new(),
        });
    }
    packages.sort_by(|a, b| a.package_id.cmp(&b.package_id));
    Ok(packages)
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum PersistenceReason {
    Runtime,
    Autosave,
    WindowClose,
}

#[tauri::command]
fn save_session_snapshot(
    session: PracticeSessionLite,
    reason: Option<PersistenceReason>,
) -> Result<(), String> {
    save_session_snapshot_for_paths_with_fault(
        &current_app_paths(),
        session,
        reason.unwrap_or(PersistenceReason::Runtime),
        false,
    )
}

#[cfg(test)]
fn save_session_snapshot_to(root: &Path, session: PracticeSessionLite) -> Result<(), String> {
    save_session_snapshot_for_paths_with_fault(
        &AppPaths::for_root(root, Path::new("")),
        session,
        PersistenceReason::Runtime,
        false,
    )
}

fn save_session_snapshot_for_paths_with_fault(
    paths: &AppPaths,
    session: PracticeSessionLite,
    reason: PersistenceReason,
    inject_test_fault: bool,
) -> Result<(), String> {
    init_database_for_paths(paths)?;
    if reason == PersistenceReason::WindowClose
        && (inject_test_fault || app_paths::consume_r0063_fault("recovery_window_close"))
    {
        return Err(
            "R006.3 TEST MODE：一次性 Recovery 保存故障已触发；窗口保持打开，可取消或重试。"
                .to_string(),
        );
    }
    let snapshot = serde_json::to_string_pretty(&session).map_err(to_string)?;
    let metadata_source_path = session
        .source_relative_path
        .as_deref()
        .or(session.source_path.as_deref())
        .unwrap_or("");
    let path = paths
        .recovery_root()
        .join(format!("{}.json", safe_file_name(&session.session_id)));
    atomic_write(&path, &snapshot)?;

    let conn = Connection::open(paths.database_path()).map_err(to_string)?;
    conn.execute(
        r#"
        INSERT INTO practice_sessions (
            session_id, package_id, source_path, mode, timing_profile_id, timing_profile_version,
            created_at, started_at, completed_at, active_ms, paused_ms, snapshot_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        ON CONFLICT(session_id) DO UPDATE SET
            active_ms = excluded.active_ms,
            paused_ms = excluded.paused_ms,
            completed_at = excluded.completed_at,
            snapshot_json = excluded.snapshot_json
        "#,
        params![
            session.session_id,
            session.package_id,
            metadata_source_path,
            session.mode,
            session.timing_profile_id,
            session.timing_profile_version,
            session.created_at,
            session.started_at,
            session.completed_at,
            session.active_ms,
            session.paused_ms,
            snapshot
        ],
    )
    .map_err(to_string)?;
    Ok(())
}

#[tauri::command]
fn append_event(entry: EventLogEntry) -> Result<(), String> {
    init_database()?;
    let conn = Connection::open(current_app_paths().database_path()).map_err(to_string)?;
    conn.execute(
        r#"
        INSERT INTO timer_events (
            session_id, seq, monotonic_elapsed_ms, wall_clock, event_type, payload_json, schema_version
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        "#,
        params![
            entry.session_id,
            entry.seq,
            entry.monotonic_elapsed_ms,
            entry.wall_clock,
            entry.event_type,
            serde_json::to_string(&entry.payload).map_err(to_string)?,
            entry.schema_version
        ],
    )
    .map_err(to_string)?;

    let json_line = serde_json::to_string(&entry).map_err(to_string)?;
    let path = app_path(&format!(
        "data/recovery/{}.events.jsonl",
        safe_file_name(&entry.session_id)
    ));
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(to_string)?;
    writeln!(file, "{json_line}").map_err(to_string)?;
    Ok(())
}

#[tauri::command]
fn load_recovery_events(session_id: String) -> Result<Vec<EventLogEntry>, String> {
    let paths = current_app_paths();
    load_recovery_events_for_paths(&paths, &session_id)
}

fn load_recovery_events_for_paths(
    paths: &AppPaths,
    session_id: &str,
) -> Result<Vec<EventLogEntry>, String> {
    init_database_for_paths(paths)?;
    let conn = Connection::open(paths.database_path()).map_err(to_string)?;
    let mut statement = conn
        .prepare(
            r#"
            SELECT session_id, seq, monotonic_elapsed_ms, wall_clock,
                   event_type, payload_json, schema_version
              FROM timer_events
             WHERE session_id = ?1
             ORDER BY seq ASC, id ASC
            "#,
        )
        .map_err(to_string)?;
    let rows = statement
        .query_map(params![session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(to_string)?;
    rows.map(|row| {
        let (
            session_id,
            seq,
            monotonic_elapsed_ms,
            wall_clock,
            event_type,
            payload,
            schema_version,
        ) = row.map_err(to_string)?;
        Ok(EventLogEntry {
            session_id,
            seq,
            monotonic_elapsed_ms,
            wall_clock,
            event_type,
            payload: serde_json::from_str(&payload).map_err(to_string)?,
            schema_version,
        })
    })
    .collect()
}

#[tauri::command]
fn get_app_setting(key: String) -> Result<Option<Value>, String> {
    let paths = current_app_paths();
    get_app_setting_for_paths(&paths, &key)
}

fn get_app_setting_for_paths(paths: &AppPaths, key: &str) -> Result<Option<Value>, String> {
    if !matches!(
        key,
        "shortcuts" | "record_filters" | "home_view" | "item_templates" | "ui_locale"
    ) {
        return Err("unsupported app setting key".to_string());
    }
    init_database_for_paths(paths)?;
    let conn = Connection::open(paths.database_path()).map_err(to_string)?;
    let value: Option<String> = conn
        .query_row(
            "SELECT value_json FROM app_settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(to_string)?;
    value
        .map(|raw| serde_json::from_str(&raw).map_err(to_string))
        .transpose()
}

#[tauri::command]
fn save_app_setting(
    key: String,
    value: Value,
    expected_app_root: PathBuf,
    expected_generation: u64,
) -> Result<(), String> {
    app_paths::with_bound_app_paths(&expected_app_root, expected_generation, |paths| {
        save_app_setting_for_paths(paths, &key, &value)
    })
}

fn save_app_setting_for_paths(paths: &AppPaths, key: &str, value: &Value) -> Result<(), String> {
    if !matches!(
        key,
        "shortcuts" | "record_filters" | "home_view" | "item_templates" | "ui_locale"
    ) {
        return Err("unsupported app setting key".to_string());
    }
    init_database_for_paths(paths)?;
    let conn = Connection::open(paths.database_path()).map_err(to_string)?;
    let existing: Option<String> = conn
        .query_row(
            "SELECT value_json FROM app_settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(to_string)?;
    if existing
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .as_ref()
        == Some(value)
    {
        return Ok(());
    }
    conn.execute(
        r#"
        INSERT INTO app_settings(key, value_json, updated_at)
        VALUES (?1, ?2, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP
        "#,
        params![key, serde_json::to_string(&value).map_err(to_string)?],
    )
    .map_err(to_string)?;
    Ok(())
}

#[tauri::command]
fn load_blueprint_override(package_id: String) -> Result<Option<Value>, String> {
    let id_re =
        Regex::new(r"^(?:\d{2}\.\d{2}\.[A-Z]\.\d+|Mock\.\d{2}\.[A-Z]\.\d+)$").map_err(to_string)?;
    if !id_re.is_match(&package_id) {
        return Err("invalid package id for blueprint override".to_string());
    }
    let paths = current_app_paths();
    app_paths::validate_controlled_roots(&paths)?;
    let path = paths
        .app_root
        .join("config/package-overrides")
        .join(format!("{package_id}.json"));
    if !path.exists() {
        return Ok(None);
    }
    let metadata = fs::symlink_metadata(&path).map_err(to_string)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 256 * 1024 {
        return Err("blueprint override is unsafe, not a file, or too large".to_string());
    }
    let content = fs::read_to_string(path).map_err(to_string)?;
    serde_json::from_str(&content).map(Some).map_err(to_string)
}

#[tauri::command]
fn export_text_atomic(relative_path: String, content: String) -> Result<(), String> {
    let path = safe_typing_path(&relative_path)?;
    atomic_write(&path, &content)
}

#[tauri::command]
fn export_session_text_atomic(relative_path: String, content: String) -> Result<(), String> {
    let path = safe_records_path(&relative_path, true)?;
    atomic_write(&path, &content)
}

#[derive(Clone, Copy)]
enum ExportDirectoryRoot {
    Records,
    TypingRecords,
}

impl ExportDirectoryRoot {
    fn name(self) -> &'static str {
        match self {
            Self::Records => "records",
            Self::TypingRecords => "typing_records",
        }
    }
}

#[tauri::command]
fn open_session_export_directory(relative_path: String) -> Result<(), String> {
    let path = resolve_export_directory(ExportDirectoryRoot::Records, &relative_path)?;
    open_directory_in_explorer(&path)
}

#[tauri::command]
fn open_typing_export_directory(relative_path: String) -> Result<(), String> {
    let path = resolve_export_directory(ExportDirectoryRoot::TypingRecords, &relative_path)?;
    open_directory_in_explorer(&path)
}

fn resolve_export_directory(
    root_kind: ExportDirectoryRoot,
    relative_path: &str,
) -> Result<PathBuf, String> {
    ensure_data_dirs()?;
    let paths = current_app_paths();
    let root = match root_kind {
        ExportDirectoryRoot::Records => &paths.records_root,
        ExportDirectoryRoot::TypingRecords => &paths.typing_records_root,
    };
    resolve_export_directory_from_root(root, root_kind, relative_path)
}

#[cfg(test)]
fn resolve_export_directory_from(
    app_root: &Path,
    root_kind: ExportDirectoryRoot,
    relative_path: &str,
) -> Result<PathBuf, String> {
    resolve_export_directory_from_root(&app_root.join(root_kind.name()), root_kind, relative_path)
}

fn resolve_export_directory_from_root(
    configured_root: &Path,
    root_kind: ExportDirectoryRoot,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.is_absolute() {
        return Err("absolute export directory paths are not allowed".to_string());
    }
    let components: Vec<_> = relative.components().collect();
    if components.len() != 3
        || components
            .iter()
            .any(|component| !matches!(component, Component::Normal(_)))
        || components.first() != Some(&Component::Normal(OsStr::new(root_kind.name())))
    {
        return Err(format!(
            "export directory must remain under {}/<group>/<session>/",
            root_kind.name()
        ));
    }

    let canonical_root = configured_root
        .canonicalize()
        .map_err(|error| format!("export root is unavailable: {error}"))?;
    let candidate = configured_root
        .join(relative.components().skip(1).collect::<PathBuf>())
        .canonicalize()
        .map_err(|error| format!("export directory does not exist: {error}"))?;
    if candidate == canonical_root || !candidate.starts_with(&canonical_root) {
        return Err("export directory escapes its allowed root".to_string());
    }
    if !candidate.is_dir() {
        return Err("export directory target is not a directory".to_string());
    }
    Ok(candidate)
}

pub(crate) fn open_directory_in_explorer(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(path.as_os_str())
            .spawn()
            .map_err(to_string)?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("opening the export directory is only implemented on Windows".to_string())
    }
}

fn app_path(relative: &str) -> PathBuf {
    current_app_paths().app_root.join(relative)
}

fn safe_typing_path(relative: &str) -> Result<PathBuf, String> {
    let suffix = typing_export_suffix(relative)?;
    ensure_data_dirs()?;
    Ok(current_app_paths().typing_records_root.join(suffix))
}

#[cfg(test)]
fn safe_typing_path_from_root(
    relative: &str,
    typing_records_root: &Path,
) -> Result<PathBuf, String> {
    Ok(typing_records_root.join(typing_export_suffix(relative)?))
}

fn typing_export_suffix(relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if path.is_absolute() {
        return Err("absolute typing export paths are not allowed".to_string());
    }
    let components: Vec<_> = path.components().collect();
    if components.len() < 2
        || components
            .iter()
            .any(|component| !matches!(component, Component::Normal(_)))
        || components.first() != Some(&Component::Normal(OsStr::new("typing_records")))
    {
        return Err("typing exports must remain under typing_records/".to_string());
    }
    Ok(path.components().skip(1).collect())
}

fn safe_records_path(relative: &str, require_file: bool) -> Result<PathBuf, String> {
    let suffix = records_export_suffix(relative, require_file)?;
    ensure_data_dirs()?;
    Ok(current_app_paths().records_root.join(suffix))
}

#[cfg(test)]
fn safe_records_path_from_root(
    relative: &str,
    require_file: bool,
    records_root: &Path,
) -> Result<PathBuf, String> {
    Ok(records_root.join(records_export_suffix(relative, require_file)?))
}

fn records_export_suffix(relative: &str, require_file: bool) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if path.is_absolute() {
        return Err("absolute export paths are not allowed".to_string());
    }
    let components: Vec<_> = path.components().collect();
    if components
        .iter()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("only normal relative export path components are allowed".to_string());
    }
    let minimum = if require_file { 4 } else { 3 };
    if components.len() < minimum
        || components.first() != Some(&Component::Normal(OsStr::new("records")))
    {
        return Err("session exports must remain under records/<package>/<session>/".to_string());
    }
    Ok(path.components().skip(1).collect())
}

pub(crate) fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(to_string)?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, content.as_bytes()).map_err(to_string)?;
    match replace_file(&tmp, path) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&tmp);
            Err(error)
        }
    }
}

#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> Result<(), String> {
    let from_w = wide(from.as_os_str());
    let to_w = wide(to.as_os_str());
    let result = unsafe {
        MoveFileExW(
            from_w.as_ptr(),
            to_w.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(windows)]
fn wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> Result<(), String> {
    fs::rename(from, to).map_err(to_string)
}

pub(crate) fn safe_file_name(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn to_string<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let default_app_root = app.path().app_local_data_dir()?;
            app_paths::initialize_runtime_paths(config_dir, default_app_root)
                .map_err(std::io::Error::other)?;
            // A stale or unavailable configured data root must not prevent the
            // Settings recovery UI from opening. Commands continue to surface
            // the concrete validation/I/O error until the user saves a valid root.
            let _ = ensure_data_dirs();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ensure_data_dirs,
            init_database,
            scan_packages,
            save_session_snapshot,
            append_event,
            get_app_setting,
            save_app_setting,
            load_blueprint_override,
            export_text_atomic,
            export_session_text_atomic,
            records::export_session_bundle_atomic,
            records::export_typing_bundle_atomic,
            open_session_export_directory,
            open_typing_export_directory,
            app_paths::get_app_paths,
            app_paths::get_default_app_root,
            app_paths::get_app_configuration_context,
            app_paths::get_runtime_mode,
            app_paths::preview_app_paths,
            app_paths::save_app_paths,
            records::list_local_records,
            records::open_record_directory,
            records::move_records_to_trash,
            records::restore_trash_records,
            records::permanently_delete_trash_records,
            records::cleanup_terminal_recovery,
            records::load_recovery_snapshot,
            records::get_recovery_event_seq,
            load_recovery_events,
            records::export_recovery_raw,
            records::write_record_index
        ])
        .run(tauri::generate_context!())
        .expect("error while running TOEFL Answer Collection");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn r0073_package_scan_returns_metadata_without_inspecting_package_files() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("toefl-r0073-package-metadata-{nonce}"));
        let package = root.join("Mock.01.A.1");
        fs::create_dir_all(package.join("Reading")).expect("package fixture");
        fs::write(
            package.join("Reading").join("must-not-be-listed.txt"),
            "synthetic",
        )
        .expect("synthetic package file");

        let packages = scan_packages_at(&root).expect("scan");
        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].package_id, "Mock.01.A.1");
        assert_eq!(packages[0].source_relative_path, "Mock.01.A.1");
        assert!(packages[0].modules.is_empty());

        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn r0083_unconfigured_source_scan_is_recoverable() {
        let error = scan_packages_at(Path::new("")).expect_err("no configured SOURCE_ROOT");
        assert_eq!(error, "SOURCE_ROOT_UNCONFIGURED");
    }

    #[test]
    fn export_text_atomic_rejects_unsafe_paths() {
        assert!(export_text_atomic("../outside.txt".to_string(), "no".to_string()).is_err());
        assert!(export_text_atomic(r"E:\outside.txt".to_string(), "no".to_string()).is_err());
    }

    #[test]
    fn session_export_path_is_restricted_to_a_session_under_records() {
        let records_root = std::env::temp_dir().join("synthetic-records-root");
        assert!(safe_records_path_from_root(
            "records/Mock.01.A.1/session/answers.json",
            true,
            &records_root
        )
        .is_ok());
        assert!(
            safe_records_path_from_root("records/Mock.01.A.1/session", false, &records_root)
                .is_ok()
        );
        assert!(safe_records_path_from_root(
            "typing_records/session/answers.json",
            true,
            &records_root
        )
        .is_err());
        assert!(safe_records_path_from_root(
            "records/../outside/answers.json",
            true,
            &records_root
        )
        .is_err());
        assert!(
            safe_records_path_from_root(r"E:\outside\answers.json", true, &records_root).is_err()
        );
    }

    #[test]
    fn typing_export_path_and_atomic_write_stay_inside_synthetic_root() {
        let root =
            std::env::temp_dir().join(format!("synthetic-typing-export-{}", std::process::id()));
        let typing_records_root = root.join("typing_records");
        fs::create_dir_all(&typing_records_root).expect("synthetic typing root");
        let relative_path = "typing_records/r004_tauri_command_test.txt";
        let target = safe_typing_path_from_root(relative_path, &typing_records_root)
            .expect("typing export must remain inside its root");

        atomic_write(&target, "typing export ok")
            .expect("typing export should write inside the synthetic root");

        let content = fs::read_to_string(&target).expect("test export file should be readable");
        assert_eq!(content, "typing export ok");
        fs::remove_dir_all(root).expect("synthetic typing fixture cleanup");
    }

    #[test]
    fn resolves_exact_records_and_typing_session_directories() {
        let root = std::env::temp_dir().join(format!("toefl-r0052-{}", std::process::id()));
        let records = root.join("records").join("套题.01").join("session.01");
        let typing = root
            .join("typing_records")
            .join("2026-07")
            .join("typing.01");
        fs::create_dir_all(&records).expect("records fixture");
        fs::create_dir_all(&typing).expect("typing fixture");

        let resolved_records = resolve_export_directory_from(
            &root,
            ExportDirectoryRoot::Records,
            "records/套题.01/session.01",
        )
        .expect("records directory should resolve");
        let resolved_typing = resolve_export_directory_from(
            &root,
            ExportDirectoryRoot::TypingRecords,
            "typing_records/2026-07/typing.01",
        )
        .expect("typing directory should resolve");

        assert_eq!(
            resolved_records,
            records.canonicalize().expect("canonical records")
        );
        assert_eq!(
            resolved_typing,
            typing.canonicalize().expect("canonical typing")
        );
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn export_directory_resolution_rejects_escape_wrong_root_and_missing_paths() {
        let root = std::env::temp_dir().join(format!("toefl-r0052-invalid-{}", std::process::id()));
        fs::create_dir_all(root.join("records").join("pkg").join("session"))
            .expect("records fixture");
        fs::create_dir_all(root.join("typing_records")).expect("typing root fixture");

        assert!(
            resolve_export_directory_from(&root, ExportDirectoryRoot::Records, r"E:\outside")
                .is_err()
        );
        assert!(resolve_export_directory_from(
            &root,
            ExportDirectoryRoot::Records,
            "records/pkg/../outside"
        )
        .is_err());
        assert!(resolve_export_directory_from(
            &root,
            ExportDirectoryRoot::Records,
            "typing_records/2026-07/session"
        )
        .is_err());
        assert!(resolve_export_directory_from(
            &root,
            ExportDirectoryRoot::TypingRecords,
            "records/pkg/session"
        )
        .is_err());
        assert!(resolve_export_directory_from(
            &root,
            ExportDirectoryRoot::Records,
            "records/pkg/missing"
        )
        .is_err());
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn complete_integer_frontend_payload_deserializes_but_float_duration_is_rejected() {
        let fixture = include_str!("../tests/fixtures/r005_2_1_session_payload.json");
        let parsed: PracticeSessionLite =
            serde_json::from_str(fixture).expect("integer frontend fixture should deserialize");
        assert_eq!(parsed.active_ms, 24_203);
        assert_eq!(parsed.tasks[0].active_time_ms, 412);

        let floating = fixture.replacen(
            "\"active_time_ms\": 22790",
            "\"active_time_ms\": 22790.29999999702",
            1,
        );
        assert!(serde_json::from_str::<PracticeSessionLite>(&floating).is_err());
    }

    #[test]
    fn large_safe_integer_payload_deserializes_and_saves() {
        let fixture = include_str!("../tests/fixtures/r005_2_1_session_payload.json");
        let large = fixture.replacen("\"active_ms\": 24203", "\"active_ms\": 9007199254740991", 1);
        let parsed: PracticeSessionLite = serde_json::from_str(&large)
            .expect("large JS-safe i64 milliseconds should deserialize");
        assert_eq!(parsed.active_ms, 9_007_199_254_740_991);

        let root = std::env::temp_dir().join(format!("toefl-r00521-large-{}", std::process::id()));
        save_session_snapshot_to(&root, parsed).expect("large valid i64 should save");
        let conn = Connection::open(root.join("data/answer_collection.sqlite3"))
            .expect("fixture database should open");
        let stored: i64 = conn
            .query_row(
                "SELECT active_ms FROM practice_sessions WHERE session_id = ?1",
                ["r005-2-1-rust-fixture"],
                |row| row.get(0),
            )
            .expect("large duration row should exist");
        assert_eq!(stored, 9_007_199_254_740_991);
        drop(conn);
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn normalized_snapshot_round_trips_through_recovery_and_sqlite() {
        let root = std::env::temp_dir().join(format!("toefl-r00521-save-{}", std::process::id()));
        let fixture = include_str!("../tests/fixtures/r005_2_1_session_payload.json");
        let parsed: PracticeSessionLite = serde_json::from_str(fixture).expect("valid fixture");

        save_session_snapshot_to(&root, parsed).expect("snapshot should save");
        let recovery = fs::read_to_string(root.join("data/recovery/r005-2-1-rust-fixture.json"))
            .expect("recovery snapshot should exist");
        let recovered: PracticeSessionLite =
            serde_json::from_str(&recovery).expect("recovery should deserialize again");
        assert_eq!(recovered.active_ms, 24_203);

        let conn = Connection::open(root.join("data/answer_collection.sqlite3"))
            .expect("fixture database should open");
        let stored: (i64, i64, String) = conn
            .query_row(
                "SELECT active_ms, paused_ms, snapshot_json FROM practice_sessions WHERE session_id = ?1",
                ["r005-2-1-rust-fixture"],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("saved row should exist");
        assert_eq!((stored.0, stored.1), (24_203, 412));
        serde_json::from_str::<PracticeSessionLite>(&stored.2)
            .expect("SQLite snapshot JSON should deserialize again");
        drop(conn);
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn r0073_dynamic_snapshot_round_trips_v6_extras_through_recovery_and_sqlite() {
        let root = std::env::temp_dir().join(format!("toefl-r0073-v6-{}", std::process::id()));
        let fixture = r#"{
          "session_schema_version":6,
          "structure_mode":"dynamic_manual",
          "session_id":"r0073-v6-round-trip",
          "package_id":"Mock.01.A.1",
          "source_path":"C:\\Synthetic\\LegacySource",
          "mode":"practice",
          "timing_profile_id":"dynamic-manual",
          "timing_profile_version":"1.0.0",
          "created_at":"2026-08-03T04:00:00Z",
          "started_at":"2026-08-03T04:00:00Z",
          "completed_at":null,
          "active_ms":1200,
          "paused_ms":300,
          "unattributed_active_time_ms":0,
          "selected_sections":["Reading"],
          "current_section_id":"Reading",
          "current_question_id":"R1",
          "questions":[{"id":"R1","time_limit_ms":null,"remaining_ms":null,"timer_limit_ms":null,"item_id":"R1","ordinal":1,"renderer":"multiple_choice","option_labels":["A","C","B"]}],
          "answers":{"R1":{"first_answer_elapsed_ms":600,"final_answer_elapsed_ms":900,"active_time_ms":1200,"total_active_ms":1200,"answer_value":["C","A"],"is_uncertain":true}},
          "modules":[],
          "tasks":[],
          "dynamic_sections":[{"section_id":"Reading","item_ids":["R1"],"next_item_ordinal":2,"active_time_ms":1200,"pause_time_ms":300}],
          "item_type_registry":[{"type_id":"custom_multi","renderer":"multiple_choice","option_labels":["A","C","B"]}]
        }"#;
        let parsed: PracticeSessionLite =
            serde_json::from_str(fixture).expect("v6 dynamic payload should deserialize");
        save_session_snapshot_to(&root, parsed).expect("v6 snapshot should save");
        let recovery = fs::read_to_string(root.join("data/recovery/r0073-v6-round-trip.json"))
            .expect("v6 Recovery snapshot");
        let recovered: Value = serde_json::from_str(&recovery).expect("v6 Recovery JSON");
        assert_eq!(recovered["session_schema_version"], 6);
        assert_eq!(recovered["structure_mode"], "dynamic_manual");
        assert_eq!(recovered["source_path"], r"C:\Synthetic\LegacySource");
        assert_eq!(recovered["dynamic_sections"][0]["next_item_ordinal"], 2);
        assert_eq!(recovered["questions"][0]["option_labels"][1], "C");
        assert_eq!(recovered["answers"]["R1"]["answer_value"][0], "C");
        assert_eq!(recovered["answers"]["R1"]["final_answer_elapsed_ms"], 900);

        let conn = Connection::open(root.join("data/answer_collection.sqlite3"))
            .expect("v6 fixture database");
        let stored: String = conn
            .query_row(
                "SELECT snapshot_json FROM practice_sessions WHERE session_id = ?1",
                ["r0073-v6-round-trip"],
                |row| row.get(0),
            )
            .expect("v6 SQLite row");
        let stored: Value = serde_json::from_str(&stored).expect("v6 SQLite JSON");
        assert_eq!(stored["dynamic_sections"][0]["item_ids"][0], "R1");
        drop(conn);
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn r0083_new_v6_persists_only_relative_source_metadata() {
        let root = std::env::temp_dir().join(format!("toefl-r0083-v6-{}", std::process::id()));
        let payload = serde_json::json!({
            "session_schema_version": 6,
            "structure_mode": "dynamic_manual",
            "session_id": "r0083-relative-source",
            "package_id": "Mock.01.A.1",
            "source_relative_path": "Mock.01.A.1",
            "mode": "practice",
            "timing_profile_id": "dynamic-manual",
            "timing_profile_version": "1.0.0",
            "created_at": "2026-09-27T00:00:00Z",
            "started_at": "2026-09-27T00:00:00Z",
            "completed_at": null,
            "active_ms": 0,
            "paused_ms": 0,
            "unattributed_active_time_ms": 0,
            "questions": [],
            "answers": {},
            "modules": [],
            "tasks": [],
            "dynamic_sections": []
        });
        let parsed: PracticeSessionLite = serde_json::from_value(payload).expect("new v6 fixture");
        save_session_snapshot_to(&root, parsed).expect("new v6 snapshot should save");
        let recovery = fs::read_to_string(root.join("data/recovery/r0083-relative-source.json"))
            .expect("new v6 Recovery JSON");
        let conn =
            Connection::open(root.join("data/answer_collection.sqlite3")).expect("new v6 database");
        let (source_path, snapshot): (String, String) = conn
            .query_row(
                "SELECT source_path, snapshot_json FROM practice_sessions WHERE session_id = ?1",
                ["r0083-relative-source"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("new v6 SQLite row");
        assert_eq!(source_path, "Mock.01.A.1");
        for serialized in [&recovery, &snapshot] {
            let value: Value = serde_json::from_str(serialized).expect("valid v6 JSON");
            assert_eq!(value["source_relative_path"], "Mock.01.A.1");
            assert!(value.get("source_path").is_none());
            assert!(!serialized.contains(&root.to_string_lossy().to_string()));
        }
        drop(conn);
        fs::remove_dir_all(root).expect("synthetic fixture cleanup");
    }

    #[test]
    fn r0063_window_close_fault_writes_nothing_and_retry_upserts_one_recovery() {
        let root =
            std::env::temp_dir().join(format!("toefl-r0063-close-retry-{}", std::process::id()));
        let source = root.join("source");
        fs::create_dir_all(&source).expect("source fixture");
        let paths = AppPaths::for_root(&root.join("app"), &source);
        let fixture = include_str!("../tests/fixtures/r005_2_1_session_payload.json");
        let mut parsed: PracticeSessionLite = serde_json::from_str(fixture).expect("valid fixture");
        parsed.session_id = "r0063-window-close-retry".to_string();

        let error = save_session_snapshot_for_paths_with_fault(
            &paths,
            parsed,
            PersistenceReason::WindowClose,
            true,
        )
        .expect_err("one-shot close save fault");
        assert!(error.contains("R006.3 TEST MODE"));
        let recovery_path = paths.recovery_root().join("r0063-window-close-retry.json");
        assert!(!recovery_path.exists());
        let conn = Connection::open(paths.database_path()).expect("fixture database");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM practice_sessions WHERE session_id = ?1",
                ["r0063-window-close-retry"],
                |row| row.get(0),
            )
            .expect("failed write row count");
        assert_eq!(count, 0);
        drop(conn);

        let retry_fixture = include_str!("../tests/fixtures/r005_2_1_session_payload.json");
        let mut retry: PracticeSessionLite =
            serde_json::from_str(retry_fixture).expect("retry fixture");
        retry.session_id = "r0063-window-close-retry".to_string();
        save_session_snapshot_for_paths_with_fault(
            &paths,
            retry,
            PersistenceReason::WindowClose,
            false,
        )
        .expect("retry saves recovery");

        let second_retry_fixture = include_str!("../tests/fixtures/r005_2_1_session_payload.json");
        let mut second_retry: PracticeSessionLite =
            serde_json::from_str(second_retry_fixture).expect("second retry fixture");
        second_retry.session_id = "r0063-window-close-retry".to_string();
        save_session_snapshot_for_paths_with_fault(
            &paths,
            second_retry,
            PersistenceReason::WindowClose,
            false,
        )
        .expect("idempotent close retry");

        let recovered: PracticeSessionLite = serde_json::from_str(
            &fs::read_to_string(&recovery_path).expect("recovery file after retry"),
        )
        .expect("recovery snapshot remains valid");
        assert_eq!(recovered.session_id, "r0063-window-close-retry");
        let conn = Connection::open(paths.database_path()).expect("retry database");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM practice_sessions WHERE session_id = ?1",
                ["r0063-window-close-retry"],
                |row| row.get(0),
            )
            .expect("retry row count");
        assert_eq!(count, 1);
        drop(conn);
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn task_overtime_event_marker_round_trips_as_extra_schema_data() {
        let root = std::env::temp_dir().join(format!("toefl-r00541-marker-{}", std::process::id()));
        let fixture = include_str!("../tests/fixtures/r005_2_1_session_payload.json").replacen(
            "\"is_overtime\": false,",
            "\"is_overtime\": false, \"overtime_event_recorded\": true,",
            1,
        );
        let parsed: PracticeSessionLite =
            serde_json::from_str(&fixture).expect("marker fixture should deserialize");

        save_session_snapshot_to(&root, parsed).expect("marker snapshot should save");
        let recovery = fs::read_to_string(root.join("data/recovery/r005-2-1-rust-fixture.json"))
            .expect("marker recovery snapshot should exist");
        let recovered: Value =
            serde_json::from_str(&recovery).expect("marker recovery should parse");
        assert_eq!(recovered["tasks"][0]["overtime_event_recorded"], true);

        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn recovery_events_load_in_sequence_with_payloads_intact() {
        let root = std::env::temp_dir().join(format!("toefl-r00612-events-{}", std::process::id()));
        let source = root.join("source");
        fs::create_dir_all(&source).expect("source fixture");
        let paths = AppPaths::for_root(&root.join("app"), &source);
        init_database_for_paths(&paths).expect("database");
        let conn = Connection::open(paths.database_path()).expect("open database");
        for (seq, event_type) in [(2_i64, "second"), (1_i64, "first")] {
            conn.execute(
                r#"
                INSERT INTO timer_events(
                    session_id, seq, monotonic_elapsed_ms, wall_clock,
                    event_type, payload_json, schema_version
                ) VALUES ('event-session', ?1, ?1, '2026-07-19T01:00:00Z', ?2, ?3, '1.0.0')
                "#,
                params![seq, event_type, format!(r#"{{"source":"{event_type}"}}"#)],
            )
            .expect("event row");
        }
        drop(conn);

        let events = load_recovery_events_for_paths(&paths, "event-session").expect("load events");
        assert_eq!(
            events.iter().map(|event| event.seq).collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert_eq!(events[0].payload["source"], "first");
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn item_template_setting_uses_existing_whitelist_and_database() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "toefl-r0084-settings-{}-{unique}",
            std::process::id()
        ));
        let source = root.join("source");
        fs::create_dir_all(&source).expect("source fixture");
        let paths = AppPaths::for_root(&root.join("app"), &source);
        let value = serde_json::json!({ "schema_version": 1, "templates": [] });
        assert_eq!(
            get_app_setting_for_paths(&paths, "item_templates").expect("empty setting"),
            None
        );
        save_app_setting_for_paths(&paths, "item_templates", &value).expect("save templates");
        assert_eq!(
            get_app_setting_for_paths(&paths, "item_templates").expect("read templates"),
            Some(value)
        );
        let locale = serde_json::json!("ja");
        save_app_setting_for_paths(&paths, "ui_locale", &locale).expect("save locale");
        assert_eq!(
            get_app_setting_for_paths(&paths, "ui_locale").expect("read locale"),
            Some(locale)
        );
        assert!(
            save_app_setting_for_paths(&paths, "arbitrary_key", &serde_json::json!(1)).is_err()
        );
        assert!(get_app_setting_for_paths(&paths, "arbitrary_key").is_err());
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn identical_app_setting_save_does_not_rewrite_volatile_metadata() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "toefl-r00641-settings-{}-{unique}",
            std::process::id()
        ));
        let source = root.join("source");
        fs::create_dir_all(&source).expect("source fixture");
        let paths = AppPaths::for_root(&root.join("app"), &source);
        init_database_for_paths(&paths).expect("database");
        let value = serde_json::json!({
            "type": "ALL",
            "completion": "ALL",
            "search": "",
            "sort": "NEWEST",
            "page": 1
        });

        save_app_setting_for_paths(&paths, "record_filters", &value).expect("initial setting");
        let conn = Connection::open(paths.database_path()).expect("open setting database");
        conn.execute(
            "UPDATE app_settings SET updated_at = '2000-01-01 00:00:00' WHERE key = 'record_filters'",
            [],
        )
        .expect("stable sentinel timestamp");
        drop(conn);
        let before_same_value =
            fs::read(paths.database_path()).expect("database before identical setting");

        save_app_setting_for_paths(&paths, "record_filters", &value).expect("identical setting");
        let after_same_value =
            fs::read(paths.database_path()).expect("database after identical setting");
        assert_eq!(after_same_value, before_same_value);
        let conn = Connection::open(paths.database_path()).expect("reopen setting database");
        let unchanged: String = conn
            .query_row(
                "SELECT updated_at FROM app_settings WHERE key = 'record_filters'",
                [],
                |row| row.get(0),
            )
            .expect("setting timestamp");
        assert_eq!(unchanged, "2000-01-01 00:00:00");
        drop(conn);

        let changed = serde_json::json!({
            "type": "TOEFL",
            "completion": "ALL",
            "search": "",
            "sort": "NEWEST",
            "page": 1
        });
        save_app_setting_for_paths(&paths, "record_filters", &changed).expect("changed setting");
        let conn =
            Connection::open(paths.database_path()).expect("reopen changed setting database");
        let (stored, changed_at): (String, String) = conn
            .query_row(
                "SELECT value_json, updated_at FROM app_settings WHERE key = 'record_filters'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("changed setting row");
        assert_eq!(
            serde_json::from_str::<Value>(&stored).expect("changed setting JSON"),
            changed
        );
        assert_ne!(changed_at, "2000-01-01 00:00:00");
        drop(conn);
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn repeated_database_initialization_is_byte_stable_without_sidecars() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "toefl-r00642-init-stable-{}-{unique}",
            std::process::id()
        ));
        let source = root.join("source");
        fs::create_dir_all(&source).expect("source fixture");
        let paths = AppPaths::for_root(&root.join("app"), &source);
        init_database_for_paths(&paths).expect("initial database");
        let before = fs::read(paths.database_path()).expect("initial database bytes");

        init_database_for_paths(&paths).expect("repeat database initialization");
        let after = fs::read(paths.database_path()).expect("reinitialized database bytes");

        assert_eq!(after, before);
        assert!(!paths.database_path().with_extension("sqlite3-shm").exists());
        assert!(!paths.database_path().with_extension("sqlite3-wal").exists());
        fs::remove_dir_all(root).expect("fixture cleanup");
    }
}
