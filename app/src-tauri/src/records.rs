use crate::{
    app_paths::{current_app_paths, validate_controlled_roots, AppPaths},
    atomic_write, ensure_data_dirs_for_paths, init_database_for_paths, open_directory_in_explorer,
    safe_file_name,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    ffi::OsStr,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
pub enum LocalRecordType {
    #[serde(rename = "TOEFL")]
    Toefl,
    #[serde(rename = "TYPING")]
    Typing,
    #[serde(rename = "RECOVERY")]
    Recovery,
    #[serde(rename = "TRASH")]
    Trash,
}

impl LocalRecordType {
    fn trash_group(self) -> &'static str {
        match self {
            Self::Toefl => "records",
            Self::Typing => "typing_records",
            Self::Recovery => "recovery",
            Self::Trash => "trash",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LocalRecordSummary {
    pub record_id: String,
    pub record_type: LocalRecordType,
    pub session_id: String,
    pub package_id: Option<String>,
    pub created_at: Option<String>,
    pub mode: Option<String>,
    pub profile_id: Option<String>,
    #[serde(default)]
    pub blueprint_id: Option<String>,
    #[serde(default)]
    pub blueprint_version: Option<String>,
    #[serde(default)]
    pub structure_mode: Option<String>,
    #[serde(default)]
    pub section_item_counts: HashMap<String, u64>,
    #[serde(default)]
    pub legacy_label: Option<String>,
    #[serde(default)]
    pub selected_sections: Vec<String>,
    pub active_time_ms: i64,
    pub pause_time_ms: i64,
    pub completion_status: String,
    pub export_status: String,
    pub schema_version: Option<String>,
    pub app_version: Option<String>,
    pub directory_size_bytes: u64,
    pub relative_path: String,
    #[serde(default)]
    pub file_names: Vec<String>,
    pub current_section_id: Option<String>,
    pub current_scope_id: Option<String>,
    pub current_task_id: Option<String>,
    pub last_saved_at: Option<String>,
    pub needs_migration: Option<bool>,
    pub diagnostic: Option<String>,
    #[serde(default)]
    pub recovery_classification: Option<String>,
    #[serde(default)]
    pub recovery_artifact_count: u64,
    pub trash_id: Option<String>,
    pub original_relative_path: Option<String>,
    #[serde(default)]
    pub original_record_type: Option<LocalRecordType>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RecordReference {
    pub record_id: String,
    pub record_type: LocalRecordType,
    pub session_id: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SessionExportFile {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecordActionResult {
    pub record_id: String,
    pub ok: bool,
    pub error: Option<String>,
    pub relative_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct TrashManifest {
    trash_id: String,
    original_relative_path: String,
    trashed_relative_path: String,
    record_type: LocalRecordType,
    trashed_at: String,
    session_id: String,
    schema_version: Option<String>,
    #[serde(default)]
    summary: Option<LocalRecordSummary>,
    #[serde(default)]
    terminal_recovery_files: Vec<String>,
}

const LIVE_RECOVERY: &str = "LIVE_RECOVERY";
const STALE_TERMINAL_RECOVERY: &str = "STALE_TERMINAL_RECOVERY";

#[tauri::command]
pub async fn list_local_records() -> Result<Vec<LocalRecordSummary>, String> {
    tauri::async_runtime::spawn_blocking(|| scan_records_at(&current_app_paths()))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn open_record_directory(record: RecordReference) -> Result<(), String> {
    let paths = current_app_paths();
    validate_controlled_roots(&paths)?;
    let target = resolve_record_existing(&paths, &record)?;
    let directory = if target.is_dir() {
        target
    } else {
        target
            .parent()
            .ok_or_else(|| "record has no parent directory".to_string())?
            .to_path_buf()
    };
    open_directory_in_explorer(&directory)
}

#[tauri::command]
pub fn move_records_to_trash(
    records: Vec<RecordReference>,
    active_session_id: Option<String>,
) -> Vec<RecordActionResult> {
    let paths = current_app_paths();
    if let Err(error) = validate_controlled_roots(&paths) {
        return failed_action_results(records, error);
    }
    records
        .into_iter()
        .map(|record| {
            action_result(
                &record,
                move_one_to_trash(&paths, &record, active_session_id.as_deref()),
            )
        })
        .collect()
}

#[tauri::command]
pub fn restore_trash_records(records: Vec<RecordReference>) -> Vec<RecordActionResult> {
    let paths = current_app_paths();
    if let Err(error) = validate_controlled_roots(&paths) {
        return failed_action_results(records, error);
    }
    records
        .into_iter()
        .map(|record| action_result(&record, restore_one_from_trash(&paths, &record)))
        .collect()
}

#[tauri::command]
pub fn permanently_delete_trash_records(
    records: Vec<RecordReference>,
    confirmed: bool,
) -> Vec<RecordActionResult> {
    let paths = current_app_paths();
    if let Err(error) = validate_controlled_roots(&paths) {
        return failed_action_results(records, error);
    }
    records
        .into_iter()
        .map(|record| {
            let result = if confirmed {
                permanently_delete_one(&paths, &record)
            } else {
                Err("permanent deletion requires explicit confirmation".to_string())
            };
            action_result(&record, result)
        })
        .collect()
}

#[tauri::command]
pub fn cleanup_terminal_recovery(
    session_id: String,
    record_relative_path: String,
    active_session_id: Option<String>,
) -> Result<u64, String> {
    let paths = current_app_paths();
    validate_controlled_roots(&paths)?;
    cleanup_terminal_recovery_for_paths(
        &paths,
        &session_id,
        &record_relative_path,
        active_session_id.as_deref(),
    )
}

fn cleanup_terminal_recovery_for_paths(
    paths: &AppPaths,
    session_id: &str,
    record_relative_path: &str,
    active_session_id: Option<&str>,
) -> Result<u64, String> {
    cleanup_terminal_recovery_for_paths_with_fault(
        paths,
        session_id,
        record_relative_path,
        active_session_id,
        false,
    )
}

fn cleanup_terminal_recovery_for_paths_with_fault(
    paths: &AppPaths,
    session_id: &str,
    record_relative_path: &str,
    active_session_id: Option<&str>,
    inject_test_fault: bool,
) -> Result<u64, String> {
    validate_terminal_export(paths, session_id, record_relative_path, active_session_id)?;
    let recovery_files = existing_recovery_paths(paths, session_id)?;
    if recovery_files.is_empty() {
        return Ok(0);
    }
    if inject_test_fault {
        return Err("R007.2.1 TEST MODE: terminal cleanup fault".to_string());
    }

    let nonce = OffsetDateTime::now_utc().unix_timestamp_nanos();
    let quarantine = paths.recovery_root().join(format!(
        ".terminal-cleanup-{}-{nonce}",
        safe_file_name(session_id)
    ));
    fs::create_dir(&quarantine).map_err(|error| error.to_string())?;
    let mut moved = Vec::new();
    for source in &recovery_files {
        let file_name = source
            .file_name()
            .ok_or_else(|| "recovery file has no safe file name".to_string())?;
        let destination = quarantine.join(file_name);
        if let Err(error) = fs::rename(source, &destination) {
            for (original, staged) in moved.iter().rev() {
                let _ = fs::rename(staged, original);
            }
            let _ = fs::remove_dir(&quarantine);
            return Err(format!("terminal recovery cleanup staging failed: {error}"));
        }
        moved.push((source.clone(), destination));
    }
    if let Err(error) = fs::remove_dir_all(&quarantine) {
        for (original, staged) in moved.iter().rev() {
            if staged.exists() {
                let _ = fs::rename(staged, original);
            }
        }
        let _ = fs::remove_dir(&quarantine);
        return Err(format!(
            "terminal recovery cleanup could not remove staged files: {error}"
        ));
    }
    Ok(recovery_files.len() as u64)
}

#[tauri::command]
pub fn load_recovery_snapshot(session_id: String) -> Result<String, String> {
    let paths = current_app_paths();
    init_database_for_paths(&paths)?;
    let conn = Connection::open(paths.database_path()).map_err(|error| error.to_string())?;
    conn.query_row(
        "SELECT snapshot_json FROM practice_sessions WHERE session_id = ?1 AND session_id NOT IN (SELECT session_id FROM record_trash)",
        params![session_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|error| error.to_string())?
    .ok_or_else(|| "recovery snapshot is unavailable or in Trash".to_string())
}

#[tauri::command]
pub fn get_recovery_event_seq(session_id: String) -> Result<u64, String> {
    let paths = current_app_paths();
    init_database_for_paths(&paths)?;
    let conn = Connection::open(paths.database_path()).map_err(|error| error.to_string())?;
    let maximum: Option<i64> = conn
        .query_row(
            "SELECT MAX(seq) FROM timer_events WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    Ok(maximum.unwrap_or(0).max(0) as u64)
}

#[tauri::command]
pub fn export_recovery_raw(session_id: String) -> Result<String, String> {
    let paths = current_app_paths();
    let stamp = OffsetDateTime::now_utc().unix_timestamp_nanos();
    export_recovery_raw_for_paths(&paths, &session_id, stamp)
}

fn export_recovery_raw_for_paths(
    paths: &AppPaths,
    session_id: &str,
    stamp: i128,
) -> Result<String, String> {
    validate_controlled_roots(paths)?;
    if session_id.is_empty() || safe_file_name(session_id) != session_id {
        return Err("unsafe recovery Session ID".to_string());
    }
    let snapshot = read_file_only_recovery(paths, session_id)
        .map_err(|error| format!("recovery snapshot file is unreadable: {error}"))?;
    let event_name = format!("{session_id}.events.jsonl");
    let events = match read_recovery_file(paths, &event_name, 128 * 1024 * 1024) {
        Ok(value) => Some(value),
        Err(_error) if !paths.recovery_root().join(&event_name).exists() => None,
        Err(error) => return Err(format!("recovery events file is unreadable: {error}")),
    };
    let directory = format!(
        "records/recovery-diagnostics/{}-{stamp}",
        safe_file_name(session_id)
    );
    let target_directory = paths
        .records_root
        .join("recovery-diagnostics")
        .join(format!("{}-{stamp}", safe_file_name(session_id)));
    atomic_write(&target_directory.join("snapshot.json"), &snapshot)?;
    if let Some(events) = &events {
        atomic_write(&target_directory.join("events.jsonl"), events)?;
    }
    let manifest = serde_json::json!({
        "manifest_schema": "recovery-diagnostic-v1",
        "session_id": session_id,
        "snapshot_copied": true,
        "events_copied": events.is_some(),
        "snapshot_file": "snapshot.json",
        "events_file": events.as_ref().map(|_| "events.jsonl"),
        "snapshot_bytes": snapshot.len(),
        "events_bytes": events.as_ref().map(String::len),
        "business_validation": "NOT_PERFORMED",
        "source_files_modified": false
    });
    atomic_write(
        &target_directory.join("diagnostic-manifest.json"),
        &serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?,
    )?;
    Ok(directory)
}

fn read_file_only_recovery(paths: &AppPaths, session_id: &str) -> Result<String, String> {
    if session_id.is_empty() || safe_file_name(session_id) != session_id {
        return Err("unsafe recovery Session ID".to_string());
    }
    read_recovery_file(paths, &format!("{session_id}.json"), 64 * 1024 * 1024)
}

fn read_recovery_file(paths: &AppPaths, file_name: &str, limit: u64) -> Result<String, String> {
    if file_name.is_empty()
        || Path::new(file_name).components().count() != 1
        || safe_file_name(file_name) != file_name
    {
        return Err("unsafe recovery file name".to_string());
    }
    let root = paths
        .recovery_root()
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let candidate = paths.recovery_root().join(file_name);
    let metadata = fs::symlink_metadata(&candidate).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("recovery snapshot must be a regular file".to_string());
    }
    if metadata.len() > limit {
        return Err(format!(
            "recovery file exceeds the {} MiB diagnostic export limit",
            limit / (1024 * 1024)
        ));
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !canonical.starts_with(root) {
        return Err("recovery snapshot escapes the recovery root".to_string());
    }
    fs::read_to_string(canonical).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn write_record_index(index: LocalRecordSummary) -> Result<(), String> {
    if !matches!(
        index.record_type,
        LocalRecordType::Toefl | LocalRecordType::Typing
    ) {
        return Err(
            "record indexes are only written for exported TOEFL or Typing records".to_string(),
        );
    }
    let paths = current_app_paths();
    validate_controlled_roots(&paths)?;
    let expected_prefix = match index.record_type {
        LocalRecordType::Toefl => "TOEFL",
        LocalRecordType::Typing => "TYPING",
        _ => unreachable!("record type was checked above"),
    };
    if index.record_id != format!("{expected_prefix}:{}", index.session_id) {
        return Err("record index identity does not match its Session".to_string());
    }
    let reference = RecordReference {
        record_id: index.record_id.clone(),
        record_type: index.record_type,
        session_id: index.session_id.clone(),
        relative_path: index.relative_path.clone(),
    };
    let directory = resolve_record_existing(&paths, &reference)?;
    if !directory.is_dir() {
        return Err("record index target must be a directory".to_string());
    }
    let directory_name = directory
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or_default();
    let safe_session = safe_file_name(&index.session_id);
    let directory_matches = match index.record_type {
        LocalRecordType::Toefl => directory_name.ends_with(safe_session.as_str()),
        LocalRecordType::Typing => directory_name == safe_session,
        _ => false,
    };
    if !directory_matches {
        return Err("record index Session does not match its target directory".to_string());
    }
    let content = serde_json::to_string_pretty(&index).map_err(|error| error.to_string())?;
    atomic_write(&directory.join("record-index.json"), &content)
}

#[tauri::command]
pub fn export_session_bundle_atomic(
    relative_directory: String,
    files: Vec<SessionExportFile>,
    index: LocalRecordSummary,
) -> Result<(), String> {
    export_session_bundle_atomic_for_paths(
        &current_app_paths(),
        &relative_directory,
        &files,
        &index,
    )
}

#[tauri::command]
pub fn export_typing_bundle_atomic(
    relative_directory: String,
    files: Vec<SessionExportFile>,
    index: LocalRecordSummary,
) -> Result<(), String> {
    export_typing_bundle_atomic_for_paths(&current_app_paths(), &relative_directory, &files, &index)
}

fn export_session_bundle_atomic_for_paths(
    paths: &AppPaths,
    relative_directory: &str,
    files: &[SessionExportFile],
    index: &LocalRecordSummary,
) -> Result<(), String> {
    ensure_data_dirs_for_paths(paths)?;
    if index.record_type != LocalRecordType::Toefl
        || index.record_id != format!("TOEFL:{}", index.session_id)
        || index.relative_path != relative_directory
    {
        return Err("session bundle index identity or path is inconsistent".to_string());
    }

    let relative = Path::new(relative_directory);
    let components = relative.components().collect::<Vec<_>>();
    if components.len() != 3
        || components
            .iter()
            .any(|component| !matches!(component, Component::Normal(_)))
        || components.first() != Some(&Component::Normal(OsStr::new("records")))
    {
        return Err("session bundle must remain under records/<package>/<session>/".to_string());
    }
    let directory_name = components[2].as_os_str().to_string_lossy();
    if index.session_id.is_empty() || !directory_name.ends_with(&safe_file_name(&index.session_id))
    {
        return Err("session bundle directory does not match its Session ID".to_string());
    }

    let mut supplied_names = HashSet::new();
    for file in files {
        if file.name.is_empty()
            || file.name == "record-index.json"
            || Path::new(&file.name).components().count() != 1
            || !matches!(
                Path::new(&file.name).components().next(),
                Some(Component::Normal(_))
            )
            || !supplied_names.insert(file.name.clone())
        {
            return Err("session bundle contains an unsafe or duplicate file name".to_string());
        }
    }
    let indexed_names = index.file_names.iter().cloned().collect::<HashSet<_>>();
    if supplied_names != indexed_names || indexed_names.len() != index.file_names.len() {
        return Err("session bundle files do not match record-index file_names".to_string());
    }

    stage_and_publish_record_bundle(
        &paths.records_root,
        components[1].as_os_str(),
        components[2].as_os_str(),
        files,
        index,
        None,
        false,
    )
}

fn export_typing_bundle_atomic_for_paths(
    paths: &AppPaths,
    relative_directory: &str,
    files: &[SessionExportFile],
    index: &LocalRecordSummary,
) -> Result<(), String> {
    export_typing_bundle_atomic_for_paths_with_fault(paths, relative_directory, files, index, false)
}

fn export_typing_bundle_atomic_for_paths_with_fault(
    paths: &AppPaths,
    relative_directory: &str,
    files: &[SessionExportFile],
    index: &LocalRecordSummary,
    inject_test_fault: bool,
) -> Result<(), String> {
    ensure_data_dirs_for_paths(paths)?;
    if index.record_type != LocalRecordType::Typing
        || index.record_id != format!("TYPING:{}", index.session_id)
        || index.relative_path != relative_directory
    {
        return Err("typing bundle index identity or path is inconsistent".to_string());
    }
    let relative = Path::new(relative_directory);
    let components = relative.components().collect::<Vec<_>>();
    if components.len() != 3
        || components
            .iter()
            .any(|component| !matches!(component, Component::Normal(_)))
        || components.first() != Some(&Component::Normal(OsStr::new("typing_records")))
    {
        return Err(
            "typing bundle must remain under typing_records/<month>/<session>/".to_string(),
        );
    }
    if index.session_id.is_empty()
        || components[2].as_os_str().to_string_lossy() != safe_file_name(&index.session_id)
    {
        return Err("typing bundle directory does not match its Session ID".to_string());
    }
    validate_bundle_file_set(files, index)?;
    stage_and_publish_record_bundle(
        &paths.typing_records_root,
        components[1].as_os_str(),
        components[2].as_os_str(),
        files,
        index,
        Some("typing_export_publish"),
        inject_test_fault,
    )
}

fn validate_bundle_file_set(
    files: &[SessionExportFile],
    index: &LocalRecordSummary,
) -> Result<(), String> {
    let mut supplied_names = HashSet::new();
    for file in files {
        if file.name.is_empty()
            || file.name == "record-index.json"
            || Path::new(&file.name).components().count() != 1
            || !matches!(
                Path::new(&file.name).components().next(),
                Some(Component::Normal(_))
            )
            || !supplied_names.insert(file.name.clone())
        {
            return Err("record bundle contains an unsafe or duplicate file name".to_string());
        }
    }
    let indexed_names = index.file_names.iter().cloned().collect::<HashSet<_>>();
    if supplied_names != indexed_names || indexed_names.len() != index.file_names.len() {
        return Err("record bundle files do not match record-index file_names".to_string());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn stage_and_publish_record_bundle(
    controlled_root: &Path,
    group_name: &OsStr,
    directory_name: &OsStr,
    files: &[SessionExportFile],
    index: &LocalRecordSummary,
    fault_point: Option<&str>,
    inject_test_fault: bool,
) -> Result<(), String> {
    let group_parent = controlled_root.join(group_name);
    if group_parent.exists() {
        let metadata = fs::symlink_metadata(&group_parent).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("record bundle group target is not a safe directory".to_string());
        }
    } else {
        fs::create_dir(&group_parent).map_err(|error| error.to_string())?;
    }
    let canonical_root = controlled_root
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let canonical_parent = group_parent
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err("record bundle group escapes its controlled root".to_string());
    }
    let target = group_parent.join(directory_name);
    if target.exists() {
        let metadata = fs::symlink_metadata(&target).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("existing record bundle target is not a safe directory".to_string());
        }
    }

    let nonce = OffsetDateTime::now_utc().unix_timestamp_nanos();
    let stem = safe_file_name(&index.session_id);
    let staging = group_parent.join(format!(".{stem}.staging-{nonce}"));
    let backup = group_parent.join(format!(".{stem}.backup-{nonce}"));
    fs::create_dir(&staging).map_err(|error| error.to_string())?;
    let write_result = (|| -> Result<(), String> {
        for file in files {
            fs::write(staging.join(&file.name), file.content.as_bytes())
                .map_err(|error| error.to_string())?;
        }
        write_sized_record_index(&staging, index)?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    if inject_test_fault || fault_point.is_some_and(crate::app_paths::consume_r0063_fault) {
        let _ = fs::remove_dir_all(&staging);
        return Err(
            "R006.3 TEST MODE：一次性 Typing 发布故障已触发；草稿保持，可直接重试。".to_string(),
        );
    }

    if target.exists() {
        fs::rename(&target, &backup).map_err(|error| {
            let _ = fs::remove_dir_all(&staging);
            error.to_string()
        })?;
    }
    if let Err(error) = fs::rename(&staging, &target) {
        if backup.exists() {
            let _ = fs::rename(&backup, &target);
        }
        let _ = fs::remove_dir_all(&staging);
        return Err(error.to_string());
    }
    if backup.exists() {
        fs::remove_dir_all(&backup).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn write_sized_record_index(directory: &Path, index: &LocalRecordSummary) -> Result<(), String> {
    let mut sized = index.clone();
    const MAX_FIXED_POINT_WRITES: usize = 8;
    for _ in 0..MAX_FIXED_POINT_WRITES {
        let content = serde_json::to_string_pretty(&sized).map_err(|error| error.to_string())?;
        atomic_write(&directory.join("record-index.json"), &content)?;
        let actual = directory_size_without_links(directory)?;
        if sized.directory_size_bytes == actual {
            return Ok(());
        }
        sized.directory_size_bytes = actual;
    }
    Err("record-index directory_size_bytes did not reach a fixed point".to_string())
}

pub fn scan_records_at(paths: &AppPaths) -> Result<Vec<LocalRecordSummary>, String> {
    init_database_for_paths(paths)?;
    let mut records = Vec::new();
    let mut exported_session_ids = HashSet::new();
    let trashed_recovery_session_ids = physically_trashed_recovery_session_ids(paths)?;
    scan_export_directories(
        paths,
        LocalRecordType::Toefl,
        &mut records,
        &mut exported_session_ids,
    )?;
    scan_export_directories(
        paths,
        LocalRecordType::Typing,
        &mut records,
        &mut exported_session_ids,
    )?;
    scan_recovery(
        paths,
        &exported_session_ids,
        &trashed_recovery_session_ids,
        &mut records,
    )?;
    coalesce_logical_records(&mut records);
    scan_trash(paths, &mut records)?;
    records.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(records)
}

#[cfg(test)]
fn coalesce_export_records(records: &mut Vec<LocalRecordSummary>) {
    coalesce_logical_records(records);
}

fn coalesce_logical_records(records: &mut Vec<LocalRecordSummary>) {
    let mut coalesced = Vec::with_capacity(records.len());
    let mut positions = HashMap::<(&'static str, String), usize>::new();
    for mut record in records.drain(..) {
        let family = match record.record_type {
            LocalRecordType::Toefl | LocalRecordType::Recovery => "TOEFL",
            LocalRecordType::Typing => "TYPING",
            LocalRecordType::Trash => {
                coalesced.push(record);
                continue;
            }
        };
        let key = (family, record.session_id.clone());
        if let Some(position) = positions.get(&key).copied() {
            let existing = &coalesced[position];
            let replace = record_wins_precedence(&record, existing);
            let existing_type = existing.record_type;
            let note = "Duplicate export directories were coalesced by record identity.";
            if replace {
                preserve_stale_recovery_attachment(&mut record, existing);
                if record.record_type == existing_type
                    && record.record_type != LocalRecordType::Recovery
                {
                    record.diagnostic = Some(match record.diagnostic.take() {
                        Some(value) => format!("{value} {note}"),
                        None => note.to_string(),
                    });
                }
                coalesced[position] = record;
            } else {
                preserve_stale_recovery_attachment(&mut coalesced[position], &record);
                if record.record_type == existing_type
                    && record.record_type != LocalRecordType::Recovery
                    && coalesced[position].diagnostic.is_none()
                {
                    coalesced[position].diagnostic = Some(note.to_string());
                }
            }
        } else {
            positions.insert(key, coalesced.len());
            coalesced.push(record);
        }
    }
    *records = coalesced;
}

fn preserve_stale_recovery_attachment(
    target: &mut LocalRecordSummary,
    source: &LocalRecordSummary,
) {
    if source.recovery_classification.as_deref() != Some(STALE_TERMINAL_RECOVERY) {
        return;
    }
    target.recovery_classification = Some(STALE_TERMINAL_RECOVERY.to_string());
    target.recovery_artifact_count = source.recovery_artifact_count;
    let notice = "已存在完成且导出的正式记录，此恢复快照属于终态残留";
    if !target
        .diagnostic
        .as_deref()
        .is_some_and(|diagnostic| diagnostic.contains(notice))
    {
        target.diagnostic = Some(match target.diagnostic.take() {
            Some(diagnostic) => format!("{diagnostic} {notice}"),
            None => notice.to_string(),
        });
    }
}

fn record_wins_precedence(candidate: &LocalRecordSummary, existing: &LocalRecordSummary) -> bool {
    let candidate_rank = record_precedence(candidate);
    let existing_rank = record_precedence(existing);
    candidate_rank > existing_rank
        || (candidate_rank == existing_rank && candidate.created_at > existing.created_at)
        || (candidate_rank == existing_rank
            && candidate.created_at == existing.created_at
            && candidate.relative_path < existing.relative_path)
}

fn record_precedence(record: &LocalRecordSummary) -> u8 {
    match record.record_type {
        LocalRecordType::Toefl if record.completion_status == "COMPLETED" => 30,
        LocalRecordType::Toefl if record.completion_status == "INCOMPLETE" => 20,
        LocalRecordType::Toefl => 15,
        LocalRecordType::Typing if record.completion_status == "COMPLETED" => 30,
        LocalRecordType::Typing => 20,
        LocalRecordType::Recovery if record.completion_status == "INCOMPLETE" => 10,
        LocalRecordType::Recovery => 5,
        LocalRecordType::Trash => 0,
    }
}

fn scan_export_directories(
    paths: &AppPaths,
    kind: LocalRecordType,
    records: &mut Vec<LocalRecordSummary>,
    exported_session_ids: &mut HashSet<String>,
) -> Result<(), String> {
    let root = match kind {
        LocalRecordType::Toefl => &paths.records_root,
        LocalRecordType::Typing => &paths.typing_records_root,
        _ => return Ok(()),
    };
    if !root.exists() {
        return Ok(());
    }
    for group in fs::read_dir(root).map_err(|error| error.to_string())? {
        let group = group.map_err(|error| error.to_string())?;
        if kind == LocalRecordType::Toefl
            && group.file_name().to_string_lossy() == "recovery-diagnostics"
        {
            continue;
        }
        if !group
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            continue;
        }
        for session in fs::read_dir(group.path()).map_err(|error| error.to_string())? {
            let session = session.map_err(|error| error.to_string())?;
            if session.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            if !session
                .file_type()
                .map_err(|error| error.to_string())?
                .is_dir()
            {
                continue;
            }
            if fs::symlink_metadata(session.path())
                .map_err(|error| error.to_string())?
                .file_type()
                .is_symlink()
            {
                continue;
            }
            let relative = logical_relative_path(paths, kind, &session.path())?;
            let index_path = session.path().join("record-index.json");
            let mut summary = if index_path.is_file() {
                let candidate =
                    match read_bounded_json::<LocalRecordSummary>(&index_path, 64 * 1024) {
                        Ok(value) => value,
                        Err(_) => continue,
                    };
                if !valid_scanned_export_index(&candidate, kind, &relative, &session.path()) {
                    continue;
                }
                candidate
            } else {
                legacy_export_summary(kind, &session.path(), &relative)?
            };
            apply_structure_labels(&mut summary);
            summary.directory_size_bytes = directory_size_without_links(&session.path())?;
            summary.file_names = list_direct_files(&session.path(), 100)?;
            if kind == LocalRecordType::Toefl {
                exported_session_ids.insert(summary.session_id.clone());
            }
            records.push(summary);
        }
    }
    Ok(())
}

fn valid_scanned_export_index(
    index: &LocalRecordSummary,
    expected_type: LocalRecordType,
    expected_relative_path: &str,
    directory: &Path,
) -> bool {
    if index.record_type != expected_type
        || index.relative_path != expected_relative_path
        || index.session_id.is_empty()
        || safe_file_name(&index.session_id) != index.session_id
    {
        return false;
    }
    let prefix = match expected_type {
        LocalRecordType::Toefl => "TOEFL",
        LocalRecordType::Typing => "TYPING",
        _ => return false,
    };
    if index.record_id != format!("{prefix}:{}", index.session_id) {
        return false;
    }
    let directory_name = directory
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or_default();
    let directory_matches = match expected_type {
        LocalRecordType::Toefl => directory_name.ends_with(&safe_file_name(&index.session_id)),
        LocalRecordType::Typing => directory_name == safe_file_name(&index.session_id),
        _ => false,
    };
    let status_matches = match expected_type {
        LocalRecordType::Toefl => {
            matches!(index.completion_status.as_str(), "INCOMPLETE" | "COMPLETED")
        }
        LocalRecordType::Typing => index.completion_status == "COMPLETED",
        _ => false,
    };
    directory_matches && status_matches && index.export_status == "EXPORTED"
}

fn apply_structure_labels(summary: &mut LocalRecordSummary) {
    let Some(schema) = summary
        .schema_version
        .as_deref()
        .and_then(|value| value.strip_prefix("practice-session-v"))
        .and_then(|value| value.parse::<u8>().ok())
    else {
        return;
    };
    if schema <= 5 {
        summary
            .structure_mode
            .get_or_insert_with(|| "legacy_blueprint".to_string());
        summary
            .legacy_label
            .get_or_insert_with(|| "LEGACY V5".to_string());
    } else if schema == 6 {
        summary
            .structure_mode
            .get_or_insert_with(|| "dynamic_manual".to_string());
        summary.legacy_label = None;
    }
}

fn validate_terminal_export(
    paths: &AppPaths,
    session_id: &str,
    record_relative_path: &str,
    active_session_id: Option<&str>,
) -> Result<(PathBuf, LocalRecordSummary), String> {
    if session_id.is_empty() || safe_file_name(session_id) != session_id {
        return Err("unsafe terminal Session ID".to_string());
    }
    if active_session_id == Some(session_id) {
        return Err("the current Active Session cannot be cleaned".to_string());
    }
    let reference = RecordReference {
        record_id: format!("TOEFL:{session_id}"),
        record_type: LocalRecordType::Toefl,
        session_id: session_id.to_string(),
        relative_path: record_relative_path.to_string(),
    };
    let directory = resolve_record_existing(paths, &reference)?;
    if !directory.is_dir() {
        return Err("terminal export target is not a directory".to_string());
    }
    let index =
        read_bounded_json::<LocalRecordSummary>(&directory.join("record-index.json"), 64 * 1024)?;
    if !valid_scanned_export_index(
        &index,
        LocalRecordType::Toefl,
        record_relative_path,
        &directory,
    ) || index.session_id != session_id
        || index.completion_status != "COMPLETED"
        || index.export_status != "EXPORTED"
    {
        return Err(
            "terminal recovery cleanup requires a matching completed and exported TOEFL index"
                .to_string(),
        );
    }
    let indexed_names = index
        .file_names
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    if !indexed_names.contains("answers.json") || !indexed_names.contains("session_summary.md") {
        return Err(
            "terminal export is missing its required answers or summary artifact".to_string(),
        );
    }
    for file_name in &index.file_names {
        if file_name.is_empty()
            || file_name == "record-index.json"
            || Path::new(file_name).components().count() != 1
            || !matches!(
                Path::new(file_name).components().next(),
                Some(Component::Normal(_))
            )
        {
            return Err("terminal export index contains an unsafe file name".to_string());
        }
        let file = directory.join(file_name);
        let metadata = fs::symlink_metadata(&file)
            .map_err(|error| format!("terminal export file is unavailable: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("terminal export file is not a readable regular file".to_string());
        }
        fs::File::open(&file)
            .map_err(|error| format!("terminal export file is unreadable: {error}"))?;
    }

    let conn = Connection::open(paths.database_path()).map_err(|error| error.to_string())?;
    let terminal_row: Option<(Option<String>, i64)> = conn
        .query_row(
            "SELECT completed_at, json_valid(snapshot_json) FROM practice_sessions WHERE session_id = ?1",
            params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if !matches!(terminal_row, Some((Some(_), 1))) {
        return Err(
            "terminal recovery cleanup requires a completed, readable SQLite Session row"
                .to_string(),
        );
    }
    Ok((directory, index))
}

fn existing_recovery_paths(paths: &AppPaths, session_id: &str) -> Result<Vec<PathBuf>, String> {
    if session_id.is_empty() || safe_file_name(session_id) != session_id {
        return Err("unsafe recovery Session ID".to_string());
    }
    let mut files = Vec::new();
    for name in [
        format!("{session_id}.json"),
        format!("{session_id}.events.jsonl"),
    ] {
        let path = paths.recovery_root().join(name);
        if !path.exists() {
            continue;
        }
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("recovery artifact is not a safe regular file".to_string());
        }
        files.push(path);
    }
    Ok(files)
}

fn legacy_export_summary(
    kind: LocalRecordType,
    directory: &Path,
    relative_path: &str,
) -> Result<LocalRecordSummary, String> {
    let directory_name = directory
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("unknown");
    let group_name = directory
        .parent()
        .and_then(Path::file_name)
        .and_then(OsStr::to_str)
        .unwrap_or("unknown");
    let fallback_session_id = directory_name
        .splitn(3, '_')
        .nth(2)
        .unwrap_or(directory_name)
        .to_string();
    let mut summary = LocalRecordSummary {
        record_id: format!(
            "{}:{fallback_session_id}",
            match kind {
                LocalRecordType::Toefl => "TOEFL",
                LocalRecordType::Typing => "TYPING",
                LocalRecordType::Recovery => "RECOVERY",
                LocalRecordType::Trash => "TRASH",
            }
        ),
        record_type: kind,
        session_id: fallback_session_id,
        package_id: (kind == LocalRecordType::Toefl).then(|| group_name.to_string()),
        created_at: timestamp_from_directory_name(directory_name),
        mode: None,
        profile_id: None,
        blueprint_id: None,
        blueprint_version: None,
        structure_mode: None,
        section_item_counts: HashMap::new(),
        legacy_label: None,
        selected_sections: Vec::new(),
        active_time_ms: 0,
        pause_time_ms: 0,
        completion_status: "COMPLETED".to_string(),
        export_status: "EXPORTED".to_string(),
        schema_version: None,
        app_version: None,
        directory_size_bytes: 0,
        relative_path: relative_path.to_string(),
        file_names: Vec::new(),
        current_section_id: None,
        current_scope_id: None,
        current_task_id: None,
        last_saved_at: None,
        needs_migration: None,
        diagnostic: Some(
            "Legacy export: lightweight index will be created on the next export.".to_string(),
        ),
        recovery_classification: None,
        recovery_artifact_count: 0,
        trash_id: None,
        original_relative_path: None,
        original_record_type: None,
    };
    if kind == LocalRecordType::Toefl {
        let summary_path = directory.join("session_summary.md");
        if summary_path.is_file() {
            let text = read_bounded_text(&summary_path, 64 * 1024)?;
            apply_markdown_summary(&mut summary, &text);
        }
    }
    Ok(summary)
}

fn scan_recovery(
    paths: &AppPaths,
    exported_session_ids: &HashSet<String>,
    physically_trashed_session_ids: &HashSet<String>,
    records: &mut Vec<LocalRecordSummary>,
) -> Result<(), String> {
    let conn = Connection::open(paths.database_path()).map_err(|error| error.to_string())?;
    let mut statement = conn
        .prepare(
            r#"
            SELECT ps.session_id, ps.package_id, ps.created_at, ps.mode, ps.timing_profile_id,
                   ps.active_ms, ps.paused_ms, ps.completed_at,
                   json_valid(ps.snapshot_json),
                   CASE WHEN json_valid(ps.snapshot_json) THEN json_extract(ps.snapshot_json, '$.session_schema_version') END,
                   CASE WHEN json_valid(ps.snapshot_json) THEN json_extract(ps.snapshot_json, '$.current_section_id') END,
                   CASE WHEN json_valid(ps.snapshot_json) THEN json_extract(ps.snapshot_json, '$.current_scope_id') END,
                   CASE WHEN json_valid(ps.snapshot_json) THEN json_extract(ps.snapshot_json, '$.current_task_id') END,
                   CASE WHEN json_valid(ps.snapshot_json) THEN
                     (SELECT group_concat(DISTINCT json_extract(value, '$.section_id'))
                        FROM json_each(ps.snapshot_json, '$.questions'))
                   END,
                   ps.snapshot_json
              FROM practice_sessions ps
             WHERE NOT EXISTS (
                   SELECT 1
                     FROM record_trash rt
                    WHERE rt.session_id = ps.session_id
                      AND rt.record_type IN ('TOEFL', 'RECOVERY')
             )
            "#,
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, i64>(8)?,
                row.get::<_, Option<i64>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, Option<String>>(12)?,
                row.get::<_, Option<String>>(13)?,
                row.get::<_, String>(14)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut database_ids = HashSet::new();
    for row in rows {
        let (
            session_id,
            package_id,
            created_at,
            mode,
            profile,
            active,
            pause,
            completed,
            valid,
            schema,
            section,
            scope,
            task,
            sections,
            snapshot_json,
        ) = row.map_err(|error| error.to_string())?;
        let snapshot_value = serde_json::from_str::<Value>(&snapshot_json).unwrap_or(Value::Null);
        let structure_mode = snapshot_value
            .get("structure_mode")
            .and_then(Value::as_str)
            .map(str::to_string);
        let selected_sections = snapshot_value
            .get("selected_sections")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .filter(|values| !values.is_empty())
            .unwrap_or_else(|| {
                sections
                    .unwrap_or_default()
                    .split(',')
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .collect()
            });
        let section_item_counts = snapshot_value
            .get("dynamic_sections")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(|section| {
                        Some((
                            section.get("section_id")?.as_str()?.to_string(),
                            section.get("item_ids")?.as_array()?.len() as u64,
                        ))
                    })
                    .collect::<HashMap<_, _>>()
            })
            .unwrap_or_default();
        database_ids.insert(session_id.clone());
        if physically_trashed_session_ids.contains(&session_id) {
            continue;
        }
        let snapshot_path = paths
            .recovery_root()
            .join(format!("{}.json", safe_file_name(&session_id)));
        let file_exists = snapshot_path.is_file();
        let recovery_files = recovery_file_names(paths, &session_id);
        let exported = exported_session_ids.contains(&session_id);
        let terminal = completed.is_some();
        if terminal && exported && recovery_files.is_empty() {
            continue;
        }
        let recovery_classification = if terminal && exported {
            STALE_TERMINAL_RECOVERY
        } else {
            LIVE_RECOVERY
        };
        records.push(LocalRecordSummary {
            record_id: format!("RECOVERY:{session_id}"),
            record_type: LocalRecordType::Recovery,
            session_id: session_id.clone(),
            package_id: Some(package_id),
            created_at: Some(created_at),
            mode: Some(mode),
            profile_id: Some(profile),
            blueprint_id: None,
            blueprint_version: None,
            structure_mode: structure_mode.or_else(|| {
                schema.map(|version| {
                    if version <= 5 {
                        "legacy_blueprint".to_string()
                    } else {
                        "dynamic_manual".to_string()
                    }
                })
            }),
            section_item_counts,
            legacy_label: schema
                .filter(|version| *version <= 5)
                .map(|_| "LEGACY V5".to_string()),
            selected_sections,
            active_time_ms: active,
            pause_time_ms: pause,
            completion_status: if valid == 0 {
                "CORRUPT"
            } else if completed.is_some() {
                "COMPLETED"
            } else {
                "INCOMPLETE"
            }
            .to_string(),
            export_status: if exported { "EXPORTED" } else { "RETRYABLE" }.to_string(),
            schema_version: schema.map(|version| format!("practice-session-v{version}")),
            app_version: None,
            directory_size_bytes: snapshot_path
                .metadata()
                .map(|metadata| metadata.len())
                .unwrap_or(0),
            relative_path: format!("data/recovery/{}.json", safe_file_name(&session_id)),
            file_names: recovery_files.clone(),
            current_section_id: section,
            current_scope_id: scope,
            current_task_id: task,
            last_saved_at: snapshot_path
                .metadata()
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .map(system_time_string),
            needs_migration: schema.map(|version| version < 5),
            diagnostic: if recovery_classification == STALE_TERMINAL_RECOVERY {
                Some("已存在完成且导出的正式记录，此恢复快照属于终态残留".to_string())
            } else if valid == 0 {
                Some("SQLite snapshot JSON is damaged.".to_string())
            } else if !file_exists {
                Some("SQLite snapshot exists but recovery file is missing.".to_string())
            } else {
                None
            },
            recovery_classification: Some(recovery_classification.to_string()),
            recovery_artifact_count: recovery_files.len() as u64,
            trash_id: None,
            original_relative_path: None,
            original_record_type: None,
        });
    }
    if paths.recovery_root().is_dir() {
        for entry in fs::read_dir(paths.recovery_root()).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".json") || name.ends_with(".events.json") {
                continue;
            }
            let session_id = name.trim_end_matches(".json").to_string();
            if database_ids.contains(&session_id)
                || physically_trashed_session_ids.contains(&session_id)
            {
                continue;
            }
            records.push(LocalRecordSummary {
                record_id: format!("RECOVERY:{session_id}"),
                record_type: LocalRecordType::Recovery,
                session_id: session_id.clone(),
                package_id: None,
                created_at: None,
                mode: None,
                profile_id: None,
                blueprint_id: None,
                blueprint_version: None,
                structure_mode: None,
                section_item_counts: HashMap::new(),
                legacy_label: None,
                selected_sections: Vec::new(),
                active_time_ms: 0,
                pause_time_ms: 0,
                completion_status: "CORRUPT".to_string(),
                export_status: "RETRYABLE".to_string(),
                schema_version: None,
                app_version: None,
                directory_size_bytes: entry.metadata().map(|metadata| metadata.len()).unwrap_or(0),
                relative_path: format!("data/recovery/{name}"),
                file_names: recovery_file_names(paths, &session_id),
                current_section_id: None,
                current_scope_id: None,
                current_task_id: None,
                last_saved_at: None,
                needs_migration: None,
                diagnostic: Some("Recovery file exists without a matching SQLite row.".to_string()),
                recovery_classification: Some(LIVE_RECOVERY.to_string()),
                recovery_artifact_count: recovery_file_names(paths, &session_id).len() as u64,
                trash_id: None,
                original_relative_path: None,
                original_record_type: None,
            });
        }
    }
    Ok(())
}

fn scan_trash(paths: &AppPaths, records: &mut Vec<LocalRecordSummary>) -> Result<(), String> {
    if !paths.trash_root.exists() {
        return Ok(());
    }
    for group in fs::read_dir(&paths.trash_root).map_err(|error| error.to_string())? {
        let group = group.map_err(|error| error.to_string())?;
        if !group
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            continue;
        }
        for entry in fs::read_dir(group.path()).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            if !entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_dir()
            {
                continue;
            }
            let manifest_path = entry.path().join("manifest.json");
            let manifest = match read_bounded_json::<TrashManifest>(&manifest_path, 64 * 1024) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let mut summary = manifest
                .summary
                .clone()
                .unwrap_or_else(|| LocalRecordSummary {
                    record_id: String::new(),
                    record_type: LocalRecordType::Trash,
                    session_id: manifest.session_id.clone(),
                    package_id: None,
                    created_at: Some(manifest.trashed_at.clone()),
                    mode: None,
                    profile_id: None,
                    blueprint_id: None,
                    blueprint_version: None,
                    structure_mode: None,
                    section_item_counts: HashMap::new(),
                    legacy_label: None,
                    selected_sections: Vec::new(),
                    active_time_ms: 0,
                    pause_time_ms: 0,
                    completion_status: "UNKNOWN".to_string(),
                    export_status: "UNKNOWN".to_string(),
                    schema_version: manifest.schema_version.clone(),
                    app_version: None,
                    directory_size_bytes: 0,
                    relative_path: String::new(),
                    file_names: Vec::new(),
                    current_section_id: None,
                    current_scope_id: None,
                    current_task_id: None,
                    last_saved_at: Some(manifest.trashed_at.clone()),
                    needs_migration: None,
                    diagnostic: Some(
                        "Legacy Trash manifest: optional lightweight metadata is unavailable."
                            .to_string(),
                    ),
                    recovery_classification: None,
                    recovery_artifact_count: 0,
                    trash_id: None,
                    original_relative_path: None,
                    original_record_type: None,
                });
            summary.record_id = format!("TRASH:{}", manifest.trash_id);
            summary.record_type = LocalRecordType::Trash;
            summary.session_id = manifest.session_id.clone();
            summary.directory_size_bytes = directory_size_without_links(&entry.path())?;
            summary.relative_path = manifest.trashed_relative_path.clone();
            summary.trash_id = Some(manifest.trash_id);
            summary.original_relative_path = Some(manifest.original_relative_path);
            summary.original_record_type = Some(manifest.record_type);
            apply_structure_labels(&mut summary);
            records.push(summary);
        }
    }
    Ok(())
}

fn physically_trashed_recovery_session_ids(paths: &AppPaths) -> Result<HashSet<String>, String> {
    let mut session_ids = HashSet::new();
    if !paths.trash_root.exists() {
        return Ok(session_ids);
    }
    for group in fs::read_dir(&paths.trash_root).map_err(|error| error.to_string())? {
        let group = group.map_err(|error| error.to_string())?;
        if !group
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            continue;
        }
        for entry in fs::read_dir(group.path()).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            if entry.file_name().to_string_lossy().starts_with('.')
                || !entry
                    .file_type()
                    .map_err(|error| error.to_string())?
                    .is_dir()
            {
                continue;
            }
            let manifest = match read_bounded_json::<TrashManifest>(
                &entry.path().join("manifest.json"),
                64 * 1024,
            ) {
                Ok(manifest) => manifest,
                Err(_) => continue,
            };
            if matches!(
                manifest.record_type,
                LocalRecordType::Toefl | LocalRecordType::Recovery
            ) {
                session_ids.insert(manifest.session_id);
            }
        }
    }
    Ok(session_ids)
}

fn move_one_to_trash(
    paths: &AppPaths,
    record: &RecordReference,
    active_session_id: Option<&str>,
) -> Result<String, String> {
    if active_session_id == Some(record.session_id.as_str()) {
        return Err("the current Active Session cannot be moved or deleted".to_string());
    }
    if record.record_type == LocalRecordType::Trash {
        return Err("a Trash record is already in Trash".to_string());
    }
    let source = resolve_record_existing(paths, record)?;
    let source_summary = scan_records_at(paths)?
        .into_iter()
        .find(|summary| {
            summary.record_type == record.record_type
                && summary.session_id == record.session_id
                && summary.relative_path == record.relative_path
        })
        .ok_or_else(|| "record summary is unavailable for Trash metadata".to_string())?;
    let terminal_recovery_paths = if record.record_type == LocalRecordType::Toefl
        && source_summary.recovery_classification.as_deref() == Some(STALE_TERMINAL_RECOVERY)
    {
        validate_terminal_export(
            paths,
            &record.session_id,
            &record.relative_path,
            active_session_id,
        )?;
        existing_recovery_paths(paths, &record.session_id)?
    } else {
        Vec::new()
    };
    let terminal_recovery_files = terminal_recovery_paths
        .iter()
        .filter_map(|path| path.file_name())
        .map(|name| name.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    let trash_id = format!(
        "{}-{}",
        safe_file_name(&record.session_id),
        OffsetDateTime::now_utc().unix_timestamp_nanos()
    );
    let group_root = paths.trash_root.join(record.record_type.trash_group());
    fs::create_dir_all(&group_root).map_err(|error| error.to_string())?;
    let temp = group_root.join(format!(".{trash_id}.tmp"));
    let final_path = group_root.join(&trash_id);
    fs::create_dir_all(&temp).map_err(|error| error.to_string())?;
    let manifest = TrashManifest {
        trash_id: trash_id.clone(),
        original_relative_path: record.relative_path.clone(),
        trashed_relative_path: format!("trash/{}/{trash_id}", record.record_type.trash_group()),
        record_type: record.record_type,
        trashed_at: OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .map_err(|error| error.to_string())?,
        session_id: record.session_id.clone(),
        schema_version: source_summary.schema_version.clone(),
        summary: Some(source_summary),
        terminal_recovery_files: terminal_recovery_files.clone(),
    };
    atomic_write(
        &temp.join("manifest.json"),
        &serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?,
    )?;
    let payload = temp.join("payload");
    let move_result = if record.record_type == LocalRecordType::Recovery {
        fs::create_dir_all(&payload).map_err(|error| error.to_string())?;
        move_recovery_files(paths, &record.session_id, &payload)
    } else {
        fs::rename(&source, &payload).map_err(|error| error.to_string())
    };
    if let Err(error) = move_result {
        let _ = fs::remove_dir_all(&temp);
        return Err(error);
    }
    if !terminal_recovery_paths.is_empty() {
        let terminal_payload = temp.join("terminal-recovery");
        if let Err(error) = move_paths_to_directory(&terminal_recovery_paths, &terminal_payload) {
            rollback_payload(paths, record, &payload);
            let _ = fs::remove_dir_all(&temp);
            return Err(error);
        }
    }
    if let Err(error) = fs::rename(&temp, &final_path) {
        rollback_payload(paths, record, &payload);
        let _ = restore_terminal_recovery_payload(
            paths,
            &temp.join("terminal-recovery"),
            &terminal_recovery_files,
        );
        let _ = fs::remove_dir_all(&temp);
        return Err(error.to_string());
    }
    if let Err(error) = mark_record_trashed(paths, &manifest) {
        rollback_payload(paths, record, &final_path.join("payload"));
        let _ = restore_terminal_recovery_payload(
            paths,
            &final_path.join("terminal-recovery"),
            &terminal_recovery_files,
        );
        let _ = fs::remove_dir_all(&final_path);
        return Err(error);
    }
    Ok(manifest.trashed_relative_path)
}

fn restore_one_from_trash(paths: &AppPaths, record: &RecordReference) -> Result<String, String> {
    if record.record_type != LocalRecordType::Trash {
        return Err("only Trash records can be restored".to_string());
    }
    let trash_entry = resolve_record_existing(paths, record)?;
    let manifest =
        read_bounded_json::<TrashManifest>(&trash_entry.join("manifest.json"), 64 * 1024)?;
    let payload = trash_entry.join("payload");
    if !payload.exists() {
        return Err("Trash payload is missing".to_string());
    }
    unmark_record_trashed(paths, &manifest.trash_id)?;
    let restore_result = if manifest.record_type == LocalRecordType::Recovery {
        match restore_recovery_payload(paths, &payload, &manifest.session_id) {
            Ok(relative) => relative,
            Err(error) => {
                let _ = mark_record_trashed(paths, &manifest);
                return Err(error);
            }
        }
    } else {
        let destination = destination_for_restore(
            paths,
            manifest.record_type,
            &manifest.original_relative_path,
        )?;
        let destination = conflict_free_destination(&destination, &manifest.session_id);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::rename(&payload, &destination).map_err(|error| error.to_string())?;
        let restored_relative = logical_relative_path(paths, manifest.record_type, &destination)?;
        if let Err(error) = rewrite_restored_record_index(
            &destination,
            manifest.record_type,
            &manifest.session_id,
            &restored_relative,
        ) {
            let rollback = fs::rename(&destination, &payload);
            let _ = mark_record_trashed(paths, &manifest);
            return Err(match rollback {
                Ok(()) => error,
                Err(rollback_error) => {
                    format!("{error}; failed to return payload to Trash: {rollback_error}")
                }
            });
        }
        let terminal_recovery = trash_entry.join("terminal-recovery");
        if terminal_recovery.exists() {
            if let Err(error) = fs::remove_dir_all(&terminal_recovery) {
                let rollback = fs::rename(&destination, &payload);
                let _ = mark_record_trashed(paths, &manifest);
                return Err(match rollback {
                    Ok(()) => format!(
                        "restored terminal record but stale recovery cleanup failed: {error}"
                    ),
                    Err(rollback_error) => format!(
                        "stale recovery cleanup failed: {error}; failed to return payload to Trash: {rollback_error}"
                    ),
                });
            }
        }
        restored_relative
    };
    fs::remove_dir_all(&trash_entry).map_err(|error| error.to_string())?;
    Ok(restore_result)
}

fn permanently_delete_one(paths: &AppPaths, record: &RecordReference) -> Result<String, String> {
    if record.record_type != LocalRecordType::Trash {
        return Err("permanent deletion is restricted to Trash entries".to_string());
    }
    let entry = resolve_record_existing(paths, record)?;
    let manifest = read_bounded_json::<TrashManifest>(&entry.join("manifest.json"), 64 * 1024)?;
    let conn = Connection::open(paths.database_path()).map_err(|error| error.to_string())?;
    let transaction = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    if matches!(
        manifest.record_type,
        LocalRecordType::Toefl | LocalRecordType::Recovery
    ) {
        transaction
            .execute(
                "DELETE FROM timer_events WHERE session_id = ?1",
                params![manifest.session_id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM practice_sessions WHERE session_id = ?1",
                params![manifest.session_id],
            )
            .map_err(|error| error.to_string())?;
    } else if manifest.record_type == LocalRecordType::Typing {
        transaction
            .execute(
                "DELETE FROM typing_events WHERE typing_session_id = ?1",
                params![manifest.session_id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM typing_sessions WHERE typing_session_id = ?1",
                params![manifest.session_id],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction
        .execute(
            "DELETE FROM record_trash WHERE trash_id = ?1",
            params![manifest.trash_id],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    if matches!(
        manifest.record_type,
        LocalRecordType::Toefl | LocalRecordType::Recovery
    ) {
        remove_live_recovery_files(paths, &manifest.session_id)?;
    }
    fs::remove_dir_all(&entry).map_err(|error| error.to_string())?;
    Ok(record.relative_path.clone())
}

fn resolve_record_existing(paths: &AppPaths, record: &RecordReference) -> Result<PathBuf, String> {
    let (root, tail, expected_len) =
        controlled_root_and_tail(paths, record.record_type, &record.relative_path)?;
    if tail.len() < expected_len {
        return Err("record relative path has too few components".to_string());
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("allowed root is unavailable: {error}"))?;
    let candidate = tail
        .iter()
        .fold(root, |path, component| path.join(component));
    let metadata = fs::symlink_metadata(&candidate)
        .map_err(|error| format!("record target does not exist: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err("symbolic link record targets are not allowed".to_string());
    }
    let canonical_candidate = candidate
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if canonical_candidate == canonical_root || !canonical_candidate.starts_with(&canonical_root) {
        return Err("record target escapes its allowed root".to_string());
    }
    Ok(canonical_candidate)
}

fn destination_for_restore(
    paths: &AppPaths,
    kind: LocalRecordType,
    relative: &str,
) -> Result<PathBuf, String> {
    let (root, tail, expected_len) = controlled_root_and_tail(paths, kind, relative)?;
    if tail.len() < expected_len {
        return Err("restore path has too few components".to_string());
    }
    let canonical_root = root.canonicalize().map_err(|error| error.to_string())?;
    let destination = tail
        .iter()
        .fold(root, |path, component| path.join(component));
    let parent = destination
        .parent()
        .ok_or_else(|| "restore destination has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let canonical_parent = parent.canonicalize().map_err(|error| error.to_string())?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err("restore destination escapes its allowed root".to_string());
    }
    Ok(destination)
}

fn controlled_root_and_tail(
    paths: &AppPaths,
    kind: LocalRecordType,
    relative: &str,
) -> Result<(PathBuf, Vec<String>, usize), String> {
    let path = Path::new(relative);
    if path.is_absolute() {
        return Err("absolute record paths are not allowed".to_string());
    }
    let components: Vec<_> = path.components().collect();
    if components
        .iter()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("only normal relative record path components are allowed".to_string());
    }
    let names: Vec<String> = components
        .iter()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect();
    match kind {
        LocalRecordType::Toefl if names.first().map(String::as_str) == Some("records") => {
            Ok((paths.records_root.clone(), names[1..].to_vec(), 2))
        }
        LocalRecordType::Typing if names.first().map(String::as_str) == Some("typing_records") => {
            Ok((paths.typing_records_root.clone(), names[1..].to_vec(), 2))
        }
        LocalRecordType::Recovery
            if names.first().map(String::as_str) == Some("data")
                && names.get(1).map(String::as_str) == Some("recovery") =>
        {
            Ok((paths.recovery_root(), names[2..].to_vec(), 1))
        }
        LocalRecordType::Trash if names.first().map(String::as_str) == Some("trash") => {
            Ok((paths.trash_root.clone(), names[1..].to_vec(), 2))
        }
        _ => Err("record path is under the wrong controlled root".to_string()),
    }
}

fn logical_relative_path(
    paths: &AppPaths,
    kind: LocalRecordType,
    target: &Path,
) -> Result<String, String> {
    let (root, prefix) = match kind {
        LocalRecordType::Toefl => (&paths.records_root, "records"),
        LocalRecordType::Typing => (&paths.typing_records_root, "typing_records"),
        LocalRecordType::Recovery => (&paths.recovery_root(), "data/recovery"),
        LocalRecordType::Trash => (&paths.trash_root, "trash"),
    };
    let relative = target
        .strip_prefix(root)
        .map_err(|_| "target is outside its logical root".to_string())?;
    Ok(format!(
        "{prefix}/{}",
        relative.to_string_lossy().replace('\\', "/")
    ))
}

fn conflict_free_destination(destination: &Path, session_id: &str) -> PathBuf {
    if !destination.exists() {
        return destination.to_path_buf();
    }
    let safe_session = safe_file_name(session_id);
    let name = destination
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("record");
    let prefix = name.strip_suffix(&safe_session);
    for index in 1..=10_000 {
        let candidate_name = match prefix {
            Some(value) => {
                let value = value.trim_end_matches(['_', '-']);
                format!("{value}-restored-{index}_{safe_session}")
            }
            None => format!("{name}-restored-{index}"),
        };
        let candidate = destination.with_file_name(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }
    let nonce = OffsetDateTime::now_utc().unix_timestamp_nanos();
    destination.with_file_name(match prefix {
        Some(value) => {
            let value = value.trim_end_matches(['_', '-']);
            format!("{value}-restored-{nonce}_{safe_session}")
        }
        None => format!("{name}-restored-{nonce}"),
    })
}

fn rewrite_restored_record_index(
    directory: &Path,
    record_type: LocalRecordType,
    session_id: &str,
    relative_path: &str,
) -> Result<(), String> {
    let index_path = directory.join("record-index.json");
    if !index_path.is_file() {
        return Ok(());
    }
    let mut index = read_bounded_json::<LocalRecordSummary>(&index_path, 64 * 1024)?;
    let prefix = match record_type {
        LocalRecordType::Toefl => "TOEFL",
        LocalRecordType::Typing => "TYPING",
        _ => return Err("Trash payload has an unsupported structured record type".to_string()),
    };
    if index.record_type != record_type
        || index.session_id != session_id
        || index.record_id != format!("{prefix}:{session_id}")
    {
        return Err("Trash payload record index identity is inconsistent".to_string());
    }
    index.relative_path = relative_path.to_string();
    write_sized_record_index(directory, &index)
}

fn move_recovery_files(paths: &AppPaths, session_id: &str, payload: &Path) -> Result<(), String> {
    let safe = safe_file_name(session_id);
    let snapshot = paths.recovery_root().join(format!("{safe}.json"));
    if !snapshot.is_file() {
        return Err("recovery snapshot file is missing".to_string());
    }
    fs::rename(&snapshot, payload.join(format!("{safe}.json")))
        .map_err(|error| error.to_string())?;
    let events = paths.recovery_root().join(format!("{safe}.events.jsonl"));
    if events.is_file() {
        if let Err(error) = fs::rename(&events, payload.join(format!("{safe}.events.jsonl"))) {
            let _ = fs::rename(payload.join(format!("{safe}.json")), snapshot);
            return Err(error.to_string());
        }
    }
    Ok(())
}

fn move_paths_to_directory(paths: &[PathBuf], destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    let mut moved = Vec::new();
    for source in paths {
        let file_name = source
            .file_name()
            .ok_or_else(|| "recovery artifact has no file name".to_string())?;
        let target = destination.join(file_name);
        if let Err(error) = fs::rename(source, &target) {
            for (original, staged) in moved.iter().rev() {
                let _ = fs::rename(staged, original);
            }
            let _ = fs::remove_dir(destination);
            return Err(format!(
                "could not attach terminal recovery artifact: {error}"
            ));
        }
        moved.push((source.clone(), target));
    }
    Ok(())
}

fn restore_terminal_recovery_payload(
    paths: &AppPaths,
    payload: &Path,
    file_names: &[String],
) -> Result<(), String> {
    if !payload.exists() {
        return Ok(());
    }
    for file_name in file_names {
        if Path::new(file_name).components().count() != 1 || safe_file_name(file_name) != *file_name
        {
            return Err("unsafe terminal recovery attachment name".to_string());
        }
        let source = payload.join(file_name);
        if source.is_file() {
            fs::rename(&source, paths.recovery_root().join(file_name))
                .map_err(|error| error.to_string())?;
        }
    }
    let _ = fs::remove_dir(payload);
    Ok(())
}

fn remove_live_recovery_files(paths: &AppPaths, session_id: &str) -> Result<(), String> {
    for path in existing_recovery_paths(paths, session_id)? {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn restore_recovery_payload(
    paths: &AppPaths,
    payload: &Path,
    session_id: &str,
) -> Result<String, String> {
    let safe = safe_file_name(session_id);
    let source_snapshot = payload.join(format!("{safe}.json"));
    if !source_snapshot.is_file() {
        return Err("Trash recovery snapshot is missing".to_string());
    }
    fs::create_dir_all(paths.recovery_root()).map_err(|error| error.to_string())?;
    let desired = paths.recovery_root().join(format!("{safe}.json"));
    let destination = conflict_free_file_destination(&desired);
    fs::rename(&source_snapshot, &destination).map_err(|error| error.to_string())?;
    let source_events = payload.join(format!("{safe}.events.jsonl"));
    if source_events.is_file() {
        let stem = destination
            .file_stem()
            .and_then(OsStr::to_str)
            .unwrap_or(&safe);
        let event_destination = paths.recovery_root().join(format!("{stem}.events.jsonl"));
        fs::rename(source_events, event_destination).map_err(|error| error.to_string())?;
    }
    let _ = fs::remove_dir(payload);
    logical_relative_path(paths, LocalRecordType::Recovery, &destination)
}

fn conflict_free_file_destination(destination: &Path) -> PathBuf {
    if !destination.exists() {
        return destination.to_path_buf();
    }
    let stem = destination
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or("recovery");
    let extension = destination
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or("json");
    for index in 1..=10_000 {
        let candidate = destination.with_file_name(format!("{stem}-restored-{index}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    destination.with_file_name(format!("{stem}-restored.{}", extension))
}

fn rollback_payload(paths: &AppPaths, record: &RecordReference, payload: &Path) {
    if record.record_type == LocalRecordType::Recovery {
        let _ = restore_recovery_payload(paths, payload, &record.session_id);
    } else if let Ok(destination) =
        destination_for_restore(paths, record.record_type, &record.relative_path)
    {
        let _ = fs::rename(payload, destination);
    }
}

fn mark_record_trashed(paths: &AppPaths, manifest: &TrashManifest) -> Result<(), String> {
    let conn = Connection::open(paths.database_path()).map_err(|error| error.to_string())?;
    let record_type = match manifest.record_type {
        LocalRecordType::Toefl => "TOEFL",
        LocalRecordType::Typing => "TYPING",
        LocalRecordType::Recovery => "RECOVERY",
        LocalRecordType::Trash => "TRASH",
    };
    conn.execute(
        "INSERT OR REPLACE INTO record_trash(trash_id, session_id, record_type, manifest_json, trashed_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            manifest.trash_id,
            manifest.session_id,
            record_type,
            serde_json::to_string(manifest).map_err(|error| error.to_string())?,
            manifest.trashed_at
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn unmark_record_trashed(paths: &AppPaths, trash_id: &str) -> Result<(), String> {
    let conn = Connection::open(paths.database_path()).map_err(|error| error.to_string())?;
    conn.execute(
        "DELETE FROM record_trash WHERE trash_id = ?1",
        params![trash_id],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn action_result(record: &RecordReference, result: Result<String, String>) -> RecordActionResult {
    match result {
        Ok(relative_path) => RecordActionResult {
            record_id: record.record_id.clone(),
            ok: true,
            error: None,
            relative_path: Some(relative_path),
        },
        Err(error) => RecordActionResult {
            record_id: record.record_id.clone(),
            ok: false,
            error: Some(error),
            relative_path: None,
        },
    }
}

fn failed_action_results(records: Vec<RecordReference>, error: String) -> Vec<RecordActionResult> {
    records
        .into_iter()
        .map(|record| action_result(&record, Err(error.clone())))
        .collect()
}

fn apply_markdown_summary(summary: &mut LocalRecordSummary, text: &str) {
    for line in text.lines().take(40) {
        if let Some(value) = line.strip_prefix("- Session ID：") {
            summary.session_id = value.trim().to_string();
            summary.record_id = format!("TOEFL:{}", summary.session_id);
        } else if let Some(value) = line.strip_prefix("- 模式：") {
            summary.mode = Some(value.trim().to_string());
        } else if let Some(value) = line.strip_prefix("- 开始：") {
            summary.created_at = Some(value.trim().to_string());
        } else if let Some(value) = line.strip_prefix("- 总有效时间：") {
            summary.active_time_ms = parse_display_duration(value.trim());
        } else if let Some(value) = line.strip_prefix("- 暂停时间：") {
            summary.pause_time_ms = parse_display_duration(value.trim());
        } else if let Some(value) = line.strip_prefix("- Session schema：") {
            summary.schema_version = Some(value.trim().to_string());
        } else if let Some(value) = line.strip_prefix("- App version：") {
            summary.app_version = Some(value.trim().to_string());
        }
    }
    summary.diagnostic = None;
}

fn parse_display_duration(value: &str) -> i64 {
    let parts: Vec<_> = value.split(':').collect();
    if parts.len() != 2 {
        return 0;
    }
    let minutes = parts[0].parse::<f64>().unwrap_or(0.0);
    let seconds = parts[1].parse::<f64>().unwrap_or(0.0);
    ((minutes * 60.0 + seconds) * 1000.0).round() as i64
}

fn timestamp_from_directory_name(name: &str) -> Option<String> {
    let mut parts = name.split('_');
    let date = parts.next()?;
    let time = parts.next()?.replace('-', ":");
    Some(format!("{date}T{time}"))
}

fn directory_size_without_links(path: &Path) -> Result<u64, String> {
    let mut total = 0;
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            total += directory_size_without_links(&entry.path())?;
        } else if metadata.is_file() {
            total += metadata.len();
        }
    }
    Ok(total)
}

fn list_direct_files(path: &Path, limit: usize) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            names.push(entry.file_name().to_string_lossy().to_string());
        }
        if names.len() >= limit {
            break;
        }
    }
    names.sort();
    Ok(names)
}

fn recovery_file_names(paths: &AppPaths, session_id: &str) -> Vec<String> {
    let safe = safe_file_name(session_id);
    [format!("{safe}.json"), format!("{safe}.events.jsonl")]
        .into_iter()
        .filter(|name| paths.recovery_root().join(name).is_file())
        .collect()
}

fn read_bounded_text(path: &Path, limit: u64) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    file.take(limit)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    String::from_utf8(bytes).map_err(|error| error.to_string())
}

fn read_bounded_json<T: for<'de> Deserialize<'de>>(path: &Path, limit: u64) -> Result<T, String> {
    serde_json::from_str(&read_bounded_text(path, limit)?).map_err(|error| error.to_string())
}

fn system_time_string(value: std::time::SystemTime) -> String {
    let datetime: OffsetDateTime = value.into();
    datetime
        .format(&Rfc3339)
        .unwrap_or_else(|_| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "run only through npm run verify:r0072.1-lifecycle with a marker-bound disposable APP_ROOT"]
    fn r0072_1_generated_lifecycle_acceptance() {
        let root = PathBuf::from(
            std::env::var_os("R00721_VERIFY_ROOT").expect("R00721_VERIFY_ROOT is required"),
        );
        assert!(root.join(".r0072-1-disposable-root").is_file());
        let paths = current_app_paths();
        assert_eq!(paths.app_root, root.join("app"));
        assert_eq!(paths.source_root, root.join("source"));
        ensure_data_dirs_for_paths(&paths).expect("generated data roots");
        init_database_for_paths(&paths).expect("generated database");
        let session_id = "r0072-1-generated-lifecycle";

        insert_recovery_fixture(&paths, session_id);
        assert!(scan_records_at(&paths)
            .expect("generated save-close scan")
            .iter()
            .any(|record| {
                record.session_id == session_id
                    && record.record_type == LocalRecordType::Recovery
                    && record.recovery_classification.as_deref() == Some(LIVE_RECOVERY)
            }));
        complete_recovery_fixture(&paths, session_id);
        let relative = publish_toefl_fixture(&paths, session_id, "COMPLETED");
        cleanup_terminal_recovery_for_paths(&paths, session_id, &relative, None)
            .expect("generated terminal cleanup");
        assert_eq!(
            scan_records_at(&paths)
                .expect("generated exported scan")
                .iter()
                .filter(|record| record.session_id == session_id)
                .count(),
            1
        );

        let first_trash = move_one_to_trash(&paths, &toefl_reference(&relative, session_id), None)
            .expect("generated first Trash");
        let restored = restore_one_from_trash(
            &paths,
            &RecordReference {
                record_id: "TRASH:r0072-1-generated-first".to_string(),
                record_type: LocalRecordType::Trash,
                session_id: session_id.to_string(),
                relative_path: first_trash,
            },
        )
        .expect("generated restore");
        let second_trash = move_one_to_trash(&paths, &toefl_reference(&restored, session_id), None)
            .expect("generated second Trash");
        permanently_delete_one(
            &paths,
            &RecordReference {
                record_id: "TRASH:r0072-1-generated-second".to_string(),
                record_type: LocalRecordType::Trash,
                session_id: session_id.to_string(),
                relative_path: second_trash,
            },
        )
        .expect("generated permanent delete");
        assert!(!scan_records_at(&paths)
            .expect("generated final scan")
            .iter()
            .any(|record| record.session_id == session_id));
        assert!(existing_recovery_paths(&paths, session_id)
            .expect("generated final recovery artifacts")
            .is_empty());
        let conn = Connection::open(paths.database_path()).expect("generated final database");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM practice_sessions WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .expect("generated final identity count");
        assert_eq!(count, 0);
    }

    #[test]
    #[ignore = "run only through npm run verify:r0073-dynamic with a marker-bound disposable APP_ROOT"]
    fn r0073_generated_dynamic_lifecycle_acceptance() {
        let root = PathBuf::from(
            std::env::var_os("R0073_VERIFY_ROOT").expect("R0073_VERIFY_ROOT is required"),
        );
        assert!(root.join(".r0073-disposable-root").is_file());
        let paths = current_app_paths();
        assert_eq!(paths.app_root, root.join("app"));
        assert_eq!(paths.source_root, root.join("source"));
        ensure_data_dirs_for_paths(&paths).expect("generated data roots");
        init_database_for_paths(&paths).expect("generated database");
        let session_id = "r0073-generated-dynamic";

        // Synthetic save-close snapshot: R1/R2 and L1 exist; W1 is intentionally not created yet.
        insert_dynamic_recovery_fixture(&paths, session_id);
        let recovery = scan_records_at(&paths)
            .expect("generated save-close scan")
            .into_iter()
            .find(|record| record.session_id == session_id)
            .expect("generated dynamic Recovery");
        assert_eq!(recovery.record_type, LocalRecordType::Recovery);
        assert_eq!(recovery.structure_mode.as_deref(), Some("dynamic_manual"));
        assert_eq!(recovery.section_item_counts.get("Reading"), Some(&2));
        assert_eq!(recovery.section_item_counts.get("Listening"), Some(&1));
        assert_eq!(recovery.section_item_counts.get("Writing"), Some(&0));

        // Continue is represented by re-reading the same one live Recovery without migration.
        assert_eq!(
            recovery.schema_version.as_deref(),
            Some("practice-session-v6")
        );
        assert_eq!(recovery.legacy_label, None);

        complete_recovery_fixture(&paths, session_id);
        let relative = publish_dynamic_toefl_fixture(&paths, session_id);
        cleanup_terminal_recovery_for_paths(&paths, session_id, &relative, None)
            .expect("generated terminal cleanup");
        let exported = scan_records_at(&paths)
            .expect("generated dynamic export scan")
            .into_iter()
            .find(|record| record.session_id == session_id)
            .expect("one exported dynamic record");
        assert_eq!(exported.structure_mode.as_deref(), Some("dynamic_manual"));
        assert_eq!(exported.section_item_counts.get("Writing"), Some(&1));
        assert!(!exported
            .file_names
            .iter()
            .any(|name| name.contains("Speaking")));
        assert!(!exported
            .file_names
            .iter()
            .any(|name| name.contains("module")));
        let answers_before_trash = fs::read(paths.app_root.join(&relative).join("answers.json"))
            .expect("dynamic answers before Trash");

        let first_trash = move_one_to_trash(&paths, &toefl_reference(&relative, session_id), None)
            .expect("generated first Trash");
        let trash = scan_records_at(&paths)
            .expect("generated Trash scan")
            .into_iter()
            .find(|record| record.session_id == session_id)
            .expect("dynamic Trash summary");
        assert_eq!(trash.structure_mode.as_deref(), Some("dynamic_manual"));
        assert_eq!(trash.section_item_counts.get("Reading"), Some(&2));
        let restored = restore_one_from_trash(
            &paths,
            &RecordReference {
                record_id: "TRASH:r0073-generated-first".to_string(),
                record_type: LocalRecordType::Trash,
                session_id: session_id.to_string(),
                relative_path: first_trash,
            },
        )
        .expect("generated restore");
        assert_eq!(
            fs::read(paths.app_root.join(&restored).join("answers.json"))
                .expect("dynamic answers after restore"),
            answers_before_trash,
            "Restore must preserve dynamic Item order, config, ordinals, answers, and timing bytes"
        );
        let second_trash = move_one_to_trash(&paths, &toefl_reference(&restored, session_id), None)
            .expect("generated second Trash");
        permanently_delete_one(
            &paths,
            &RecordReference {
                record_id: "TRASH:r0073-generated-second".to_string(),
                record_type: LocalRecordType::Trash,
                session_id: session_id.to_string(),
                relative_path: second_trash,
            },
        )
        .expect("generated permanent delete");
        assert!(!scan_records_at(&paths)
            .expect("generated final scan")
            .iter()
            .any(|record| record.session_id == session_id));
        let conn = Connection::open(paths.database_path()).expect("generated final database");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM practice_sessions WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .expect("generated final identity count");
        assert_eq!(count, 0);

        // A separate synthetic v5 Recovery remains readable and explicitly labelled legacy.
        insert_recovery_fixture(&paths, "r0073-legacy-v5-readable");
        let legacy = scan_records_at(&paths)
            .expect("legacy scan")
            .into_iter()
            .find(|record| record.session_id == "r0073-legacy-v5-readable")
            .expect("legacy v5 Recovery");
        assert_eq!(
            legacy.schema_version.as_deref(),
            Some("practice-session-v5")
        );
        assert_eq!(legacy.legacy_label.as_deref(), Some("LEGACY V5"));
    }

    fn fixture(name: &str) -> (PathBuf, AppPaths) {
        let root = std::env::temp_dir().join(format!("r006-records-{name}-{}", std::process::id()));
        let source = root.join("source");
        fs::create_dir_all(&source).expect("source fixture");
        fs::write(
            root.join(".r0072-1-disposable-root"),
            "marker-bound test root",
        )
        .expect("fixture marker");
        let paths = AppPaths::for_root(&root.join("app"), &source);
        crate::ensure_data_dirs_for_paths(&paths).expect("data roots");
        init_database_for_paths(&paths).expect("database");
        (root, paths)
    }

    fn cleanup_fixture(root: PathBuf) {
        assert!(root.starts_with(std::env::temp_dir()));
        assert!(root.join(".r0072-1-disposable-root").is_file());
        fs::remove_dir_all(root).expect("cleanup marker-bound fixture");
    }

    fn toefl_reference(relative: &str, session_id: &str) -> RecordReference {
        RecordReference {
            record_id: format!("TOEFL:{session_id}"),
            record_type: LocalRecordType::Toefl,
            session_id: session_id.to_string(),
            relative_path: relative.to_string(),
        }
    }

    fn toefl_index(
        session_id: &str,
        relative_path: &str,
        completion_status: &str,
        file_names: Vec<String>,
    ) -> LocalRecordSummary {
        LocalRecordSummary {
            record_id: format!("TOEFL:{session_id}"),
            record_type: LocalRecordType::Toefl,
            session_id: session_id.to_string(),
            package_id: Some("Mock.01.A.1".to_string()),
            created_at: Some("2026-07-19T09:00:00Z".to_string()),
            mode: Some("practice".to_string()),
            profile_id: Some("standard".to_string()),
            blueprint_id: Some("toefl-2026".to_string()),
            blueprint_version: Some("1.1.0".to_string()),
            structure_mode: Some("legacy_blueprint".to_string()),
            section_item_counts: HashMap::new(),
            legacy_label: Some("LEGACY V5".to_string()),
            selected_sections: vec!["Reading".to_string()],
            active_time_ms: 1_000,
            pause_time_ms: 200,
            completion_status: completion_status.to_string(),
            export_status: "EXPORTED".to_string(),
            schema_version: Some("practice-session-v5".to_string()),
            app_version: Some("test".to_string()),
            directory_size_bytes: 0,
            relative_path: relative_path.to_string(),
            file_names,
            current_section_id: None,
            current_scope_id: None,
            current_task_id: None,
            last_saved_at: None,
            needs_migration: None,
            diagnostic: None,
            recovery_classification: None,
            recovery_artifact_count: 0,
            trash_id: None,
            original_relative_path: None,
            original_record_type: None,
        }
    }

    fn typing_index(
        session_id: &str,
        relative_path: &str,
        file_names: Vec<String>,
    ) -> LocalRecordSummary {
        let mut index = toefl_index(session_id, relative_path, "COMPLETED", file_names);
        index.record_id = format!("TYPING:{session_id}");
        index.record_type = LocalRecordType::Typing;
        index.package_id = None;
        index.mode = Some("typing".to_string());
        index.profile_id = None;
        index.blueprint_id = None;
        index.blueprint_version = None;
        index.structure_mode = None;
        index.section_item_counts.clear();
        index.legacy_label = None;
        index.selected_sections.clear();
        index.schema_version = Some("typing-session-v1".to_string());
        index
    }

    fn insert_recovery_fixture(paths: &AppPaths, session_id: &str) {
        let snapshot = format!(
            r#"{{
              "session_schema_version": 5,
              "session_id": "{session_id}",
              "current_section_id": "Reading",
              "current_scope_id": "READING_MODULE_1",
              "questions": [{{"section_id": "Reading"}}]
            }}"#
        );
        let conn = Connection::open(paths.database_path()).expect("database");
        conn.execute(
            r#"
            INSERT INTO practice_sessions(
              session_id, package_id, source_path, mode, timing_profile_id,
              timing_profile_version, created_at, started_at, active_ms, paused_ms, snapshot_json
            ) VALUES (?1, 'Mock.01.A.1', 'readonly', 'practice', 'profile', '1.0',
                      '2026-07-19T08:00:00Z', '2026-07-19T08:00:00Z', 1200, 300, ?2)
            "#,
            params![session_id, snapshot],
        )
        .expect("recovery row");
        fs::write(
            paths.recovery_root().join(format!("{session_id}.json")),
            snapshot,
        )
        .expect("recovery file");
    }

    fn insert_dynamic_recovery_fixture(paths: &AppPaths, session_id: &str) {
        let snapshot = format!(
            r#"{{
              "session_schema_version": 6,
              "structure_mode": "dynamic_manual",
              "session_id": "{session_id}",
              "selected_sections": ["Reading", "Listening", "Writing"],
              "current_section_id": "Listening",
              "current_scope_id": "Listening",
              "questions": [{{"section_id": "Reading"}}, {{"section_id": "Reading"}}, {{"section_id": "Listening"}}],
              "dynamic_sections": [
                {{"section_id": "Reading", "item_ids": ["R1", "R2"]}},
                {{"section_id": "Listening", "item_ids": ["L1"]}},
                {{"section_id": "Writing", "item_ids": []}}
              ]
            }}"#
        );
        let conn = Connection::open(paths.database_path()).expect("database");
        conn.execute(
            r#"
            INSERT INTO practice_sessions(
              session_id, package_id, source_path, mode, timing_profile_id,
              timing_profile_version, created_at, started_at, active_ms, paused_ms, snapshot_json
            ) VALUES (?1, 'Mock.01.A.1', 'readonly', 'practice', 'dynamic-manual', '1.0',
                      '2026-08-03T02:00:00Z', '2026-08-03T02:00:00Z', 1200, 300, ?2)
            "#,
            params![session_id, snapshot],
        )
        .expect("dynamic recovery row");
        fs::write(
            paths.recovery_root().join(format!("{session_id}.json")),
            snapshot,
        )
        .expect("dynamic recovery file");
    }

    #[test]
    fn r0073_dynamic_recovery_summary_preserves_structure_and_created_item_counts() {
        let (root, paths) = fixture("r0073-dynamic-recovery-summary");
        insert_dynamic_recovery_fixture(&paths, "dynamic-recovery");
        let record = scan_records_at(&paths)
            .expect("scan dynamic recovery")
            .into_iter()
            .find(|candidate| candidate.session_id == "dynamic-recovery")
            .expect("dynamic Recovery summary");
        assert_eq!(
            record.schema_version.as_deref(),
            Some("practice-session-v6")
        );
        assert_eq!(record.structure_mode.as_deref(), Some("dynamic_manual"));
        assert_eq!(record.legacy_label, None);
        assert_eq!(
            record.selected_sections,
            vec!["Reading", "Listening", "Writing"]
        );
        assert_eq!(record.section_item_counts.get("Reading"), Some(&2));
        assert_eq!(record.section_item_counts.get("Listening"), Some(&1));
        assert_eq!(record.section_item_counts.get("Writing"), Some(&0));
        cleanup_fixture(root);
    }

    fn complete_recovery_fixture(paths: &AppPaths, session_id: &str) {
        let conn = Connection::open(paths.database_path()).expect("database");
        conn.execute(
            "UPDATE practice_sessions SET completed_at = '2026-07-19T09:00:00Z' WHERE session_id = ?1",
            params![session_id],
        )
        .expect("complete recovery row");
    }

    fn publish_toefl_fixture(
        paths: &AppPaths,
        session_id: &str,
        completion_status: &str,
    ) -> String {
        let relative = format!("records/Mock.01.A.1/2026-07-19_09-00-00_{session_id}");
        let files = vec![
            SessionExportFile {
                name: "answers.json".to_string(),
                content: "{}".to_string(),
            },
            SessionExportFile {
                name: "session_summary.md".to_string(),
                content: "# Synthetic summary".to_string(),
            },
        ];
        let index = toefl_index(
            session_id,
            &relative,
            completion_status,
            files.iter().map(|file| file.name.clone()).collect(),
        );
        export_session_bundle_atomic_for_paths(paths, &relative, &files, &index)
            .expect("publish TOEFL fixture");
        relative
    }

    fn publish_dynamic_toefl_fixture(paths: &AppPaths, session_id: &str) -> String {
        let relative = format!("records/Mock.01.A.1/2026-08-03_03-00-00_{session_id}");
        let files = vec![
            SessionExportFile { name: "session_summary.md".to_string(), content: "# Dynamic Session\nReading 2; Listening 1; Writing 1.\n".to_string() },
            SessionExportFile { name: "answers.json".to_string(), content: r#"{"schema_version":"practice-session-v6","structure_mode":"dynamic_manual","sections":[{"section_id":"Reading","item_ids":["R1","R2"],"next_item_ordinal":3},{"section_id":"Listening","item_ids":["L1"],"next_item_ordinal":2},{"section_id":"Writing","item_ids":["W1"],"next_item_ordinal":2}],"items":[{"item_id":"R1","ordinal":1,"type_id":"reading_single_choice","renderer":"single_choice","option_labels":["A","B","C","D"],"answer":"B","timing":{"active_time_ms":1100}},{"item_id":"R2","ordinal":2,"type_id":"reading_short_text","renderer":"short_text","option_labels":[],"answer":"synthetic","timing":{"active_time_ms":1200}},{"item_id":"L1","ordinal":1,"type_id":"listening_multiple_choice","renderer":"multiple_choice","option_labels":["A","B","C","D"],"answer":["A","C"],"timing":{"active_time_ms":1300}},{"item_id":"W1","ordinal":1,"type_id":"writing_email","renderer":"long_text","option_labels":[],"answer":"synthetic draft","timing":{"active_time_ms":1400}}]}"#.to_string() },
            SessionExportFile { name: "events.jsonl".to_string(), content: "".to_string() },
            SessionExportFile { name: "item_metrics.csv".to_string(), content: "item_id,renderer\nR1,single_choice\nR2,short_text\nL1,multiple_choice\nW1,long_text\n".to_string() },
            SessionExportFile { name: "section_metrics.csv".to_string(), content: "section_id,created_item_count\nReading,2\nListening,1\nWriting,1\n".to_string() },
            SessionExportFile { name: "Reading.md".to_string(), content: "# Reading\nR1: B\nR2: synthetic\n".to_string() },
            SessionExportFile { name: "Listening.md".to_string(), content: "# Listening\nL1: A, C\n".to_string() },
            SessionExportFile { name: "Writing.md".to_string(), content: "# Writing\nW1: synthetic draft\n".to_string() },
        ];
        let mut index = toefl_index(
            session_id,
            &relative,
            "COMPLETED",
            files.iter().map(|file| file.name.clone()).collect(),
        );
        index.blueprint_id = None;
        index.blueprint_version = None;
        index.structure_mode = Some("dynamic_manual".to_string());
        index.section_item_counts = HashMap::from([
            ("Reading".to_string(), 2),
            ("Listening".to_string(), 1),
            ("Writing".to_string(), 1),
        ]);
        index.legacy_label = None;
        index.selected_sections = vec![
            "Reading".to_string(),
            "Listening".to_string(),
            "Writing".to_string(),
        ];
        index.schema_version = Some("practice-session-v6".to_string());
        export_session_bundle_atomic_for_paths(paths, &relative, &files, &index)
            .expect("publish dynamic TOEFL fixture");
        let combined = files
            .iter()
            .map(|file| file.content.as_str())
            .collect::<String>();
        assert!(!combined.contains("question_body"));
        assert!(!combined.contains("standard_answer"));
        relative
    }

    #[test]
    fn session_bundle_replaces_one_directory_and_rejected_retry_preserves_previous_bundle() {
        let (root, paths) = fixture("atomic-session-bundle");
        let relative = "records/Mock.01.A.1/2026-07-19_09-00-00_atomic-session";
        let old_files = vec![SessionExportFile {
            name: "answers.json".to_string(),
            content: "old".to_string(),
        }];
        let old_index = toefl_index(
            "atomic-session",
            relative,
            "INCOMPLETE",
            vec!["answers.json".to_string()],
        );
        export_session_bundle_atomic_for_paths(&paths, relative, &old_files, &old_index)
            .expect("initial bundle");

        let target = paths
            .records_root
            .join("Mock.01.A.1")
            .join("2026-07-19_09-00-00_atomic-session");
        assert_eq!(
            fs::read_to_string(target.join("answers.json")).expect("old answers"),
            "old"
        );

        let invalid_index = toefl_index(
            "atomic-session",
            relative,
            "COMPLETED",
            vec!["answers.json".to_string(), "missing.json".to_string()],
        );
        assert!(export_session_bundle_atomic_for_paths(
            &paths,
            relative,
            &[SessionExportFile {
                name: "answers.json".to_string(),
                content: "new".to_string(),
            }],
            &invalid_index,
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(target.join("answers.json")).expect("preserved answers"),
            "old"
        );

        let completed_files = vec![SessionExportFile {
            name: "answers.json".to_string(),
            content: "completed".to_string(),
        }];
        let completed_index = toefl_index(
            "atomic-session",
            relative,
            "COMPLETED",
            vec!["answers.json".to_string()],
        );
        export_session_bundle_atomic_for_paths(
            &paths,
            relative,
            &completed_files,
            &completed_index,
        )
        .expect("completed replacement");
        assert_eq!(
            fs::read_to_string(target.join("answers.json")).expect("completed answers"),
            "completed"
        );
        let persisted: LocalRecordSummary =
            read_bounded_json(&target.join("record-index.json"), 64 * 1024)
                .expect("sized session index");
        assert!(persisted.directory_size_bytes > 0);
        assert_eq!(
            persisted.directory_size_bytes,
            directory_size_without_links(&target).expect("session size")
        );
        cleanup_fixture(root);
    }

    #[test]
    fn r0063_typing_bundle_fault_is_atomic_and_retry_is_one_sized_logical_record() {
        let (root, paths) = fixture("r0063-typing-atomic");
        let session_id = "typing-r0063-atomic";
        let relative = format!("typing_records/2026-07/{session_id}");
        let files = vec![
            SessionExportFile {
                name: "final_text.txt".to_string(),
                content: "retained draft".to_string(),
            },
            SessionExportFile {
                name: "typing_session.json".to_string(),
                content: r#"{"active_ms":65000,"deleted_characters":6}"#.to_string(),
            },
        ];
        let index = typing_index(
            session_id,
            &relative,
            files.iter().map(|file| file.name.clone()).collect(),
        );
        let target = paths.typing_records_root.join("2026-07").join(session_id);

        let error = export_typing_bundle_atomic_for_paths_with_fault(
            &paths, &relative, &files, &index, true,
        )
        .expect_err("one-shot publish fault");
        assert!(error.contains("R006.3 TEST MODE"));
        assert!(
            !target.exists(),
            "failed publish must expose no partial record"
        );
        let group = paths.typing_records_root.join("2026-07");
        assert!(fs::read_dir(&group)
            .expect("typing group")
            .all(|entry| !entry
                .expect("group entry")
                .file_name()
                .to_string_lossy()
                .starts_with('.')));

        export_typing_bundle_atomic_for_paths_with_fault(&paths, &relative, &files, &index, false)
            .expect("retry publishes complete bundle");
        assert_eq!(
            fs::read_to_string(target.join("final_text.txt")).expect("retained text"),
            "retained draft"
        );
        let persisted: LocalRecordSummary =
            read_bounded_json(&target.join("record-index.json"), 64 * 1024).expect("typing index");
        assert!(persisted.directory_size_bytes > 0);
        assert_eq!(
            persisted.directory_size_bytes,
            directory_size_without_links(&target).expect("typing size")
        );

        export_typing_bundle_atomic_for_paths_with_fault(&paths, &relative, &files, &index, false)
            .expect("idempotent replacement");
        let logical = scan_records_at(&paths)
            .expect("record scan")
            .into_iter()
            .filter(|record| record.record_id == format!("TYPING:{session_id}"))
            .collect::<Vec<_>>();
        assert_eq!(logical.len(), 1);
        assert_eq!(
            logical[0].directory_size_bytes,
            directory_size_without_links(&target).unwrap()
        );
        assert!(fs::read_dir(&group)
            .expect("typing group after retry")
            .all(|entry| !entry
                .expect("group entry after retry")
                .file_name()
                .to_string_lossy()
                .starts_with('.')));
        cleanup_fixture(root);
    }

    #[test]
    fn r0063_legacy_zero_size_is_filled_in_memory_without_rewriting_index() {
        let (root, paths) = fixture("r0063-zero-size-fallback");
        let session_id = "typing-r0063-zero";
        let relative = format!("typing_records/2026-07/{session_id}");
        let directory = paths.typing_records_root.join("2026-07").join(session_id);
        fs::create_dir_all(&directory).expect("legacy typing directory");
        fs::write(directory.join("final_text.txt"), "legacy text").expect("legacy text");
        let index = typing_index(session_id, &relative, vec!["final_text.txt".to_string()]);
        let index_path = directory.join("record-index.json");
        fs::write(
            &index_path,
            serde_json::to_string_pretty(&index).expect("legacy zero index"),
        )
        .expect("write legacy zero index");
        let before = fs::read(&index_path).expect("zero index baseline");

        let summary = scan_records_at(&paths)
            .expect("fallback scan")
            .into_iter()
            .find(|record| record.record_id == format!("TYPING:{session_id}"))
            .expect("legacy record remains visible");
        assert!(summary.directory_size_bytes > 0);
        assert_eq!(
            summary.directory_size_bytes,
            directory_size_without_links(&directory).expect("legacy actual size")
        );
        assert_eq!(fs::read(&index_path).expect("index after scan"), before);
        cleanup_fixture(root);
    }

    #[test]
    fn exported_records_are_coalesced_by_type_and_session_identity() {
        let mut records = vec![
            toefl_index(
                "same-session",
                "records/Mock.01.A.1/old_same-session",
                "INCOMPLETE",
                vec![],
            ),
            toefl_index(
                "same-session",
                "records/Mock.01.A.1/new_same-session",
                "COMPLETED",
                vec![],
            ),
        ];
        coalesce_export_records(&mut records);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].completion_status, "COMPLETED");
        assert!(records[0]
            .diagnostic
            .as_deref()
            .unwrap_or_default()
            .contains("coalesced"));
    }

    #[test]
    fn coalescing_is_deterministic_when_completion_and_timestamp_are_equal() {
        let left = toefl_index(
            "same-session",
            "records/Mock.01.A.1/a_same-session",
            "COMPLETED",
            vec![],
        );
        let right = toefl_index(
            "same-session",
            "records/Mock.01.A.1/b_same-session",
            "COMPLETED",
            vec![],
        );
        let mut forward = vec![left.clone(), right.clone()];
        let mut reverse = vec![right, left];
        coalesce_export_records(&mut forward);
        coalesce_export_records(&mut reverse);
        assert_eq!(forward[0].relative_path, reverse[0].relative_path);
        assert_eq!(
            forward[0].relative_path,
            "records/Mock.01.A.1/a_same-session"
        );
    }

    #[test]
    fn completed_toefl_supersedes_same_session_recovery() {
        let (root, paths) = fixture("completed-supersedes-recovery");
        let session_id = "recovered-completed";
        insert_recovery_fixture(&paths, session_id);
        let relative = format!("records/Mock.01.A.1/2026-07-19_09-00-00_{session_id}");
        let directory = paths
            .records_root
            .join("Mock.01.A.1")
            .join(format!("2026-07-19_09-00-00_{session_id}"));
        fs::create_dir_all(&directory).expect("record directory");
        fs::write(
            directory.join("record-index.json"),
            serde_json::to_string_pretty(&toefl_index(session_id, &relative, "COMPLETED", vec![]))
                .expect("index json"),
        )
        .expect("record index");

        let records = scan_records_at(&paths).expect("scan");
        let logical = records
            .iter()
            .filter(|record| record.session_id == session_id)
            .collect::<Vec<_>>();
        assert_eq!(logical.len(), 1);
        assert_eq!(logical[0].record_type, LocalRecordType::Toefl);
        assert_eq!(logical[0].completion_status, "COMPLETED");
        cleanup_fixture(root);
    }

    #[test]
    fn completed_export_classifies_same_identity_files_as_stale_terminal_recovery() {
        let (root, paths) = fixture("stale-terminal-classification");
        let session_id = "stale-terminal";
        insert_recovery_fixture(&paths, session_id);
        complete_recovery_fixture(&paths, session_id);
        fs::write(
            paths
                .recovery_root()
                .join(format!("{session_id}.events.jsonl")),
            "{\"seq\":1}\n",
        )
        .expect("recovery events");
        publish_toefl_fixture(&paths, session_id, "COMPLETED");

        let logical = scan_records_at(&paths)
            .expect("scan")
            .into_iter()
            .filter(|record| record.session_id == session_id)
            .collect::<Vec<_>>();
        assert_eq!(logical.len(), 1);
        assert_eq!(logical[0].record_type, LocalRecordType::Toefl);
        assert_eq!(
            logical[0].recovery_classification.as_deref(),
            Some(STALE_TERMINAL_RECOVERY)
        );
        assert_eq!(logical[0].recovery_artifact_count, 2);
        cleanup_fixture(root);
    }

    #[test]
    fn completed_but_not_exported_session_remains_live_and_retryable() {
        let (root, paths) = fixture("completed-export-failed");
        let session_id = "completed-export-failed";
        insert_recovery_fixture(&paths, session_id);
        complete_recovery_fixture(&paths, session_id);

        let recovery = scan_records_at(&paths)
            .expect("export-failed scan")
            .into_iter()
            .find(|record| record.session_id == session_id)
            .expect("terminal Recovery remains visible");
        assert_eq!(recovery.record_type, LocalRecordType::Recovery);
        assert_eq!(recovery.completion_status, "COMPLETED");
        assert_eq!(recovery.export_status, "RETRYABLE");
        assert_eq!(
            recovery.recovery_classification.as_deref(),
            Some(LIVE_RECOVERY)
        );
        assert!(paths
            .recovery_root()
            .join(format!("{session_id}.json"))
            .is_file());
        cleanup_fixture(root);
    }

    #[test]
    fn terminal_cleanup_requires_verified_export_and_removes_only_recovery_files() {
        let (root, paths) = fixture("terminal-cleanup");
        let session_id = "terminal-cleanup";
        insert_recovery_fixture(&paths, session_id);
        complete_recovery_fixture(&paths, session_id);
        fs::write(
            paths
                .recovery_root()
                .join(format!("{session_id}.events.jsonl")),
            "{\"seq\":1}\n",
        )
        .expect("recovery events");
        let relative = publish_toefl_fixture(&paths, session_id, "COMPLETED");

        let removed = cleanup_terminal_recovery_for_paths(&paths, session_id, &relative, None)
            .expect("verified cleanup");
        assert_eq!(removed, 2);
        assert!(!paths
            .recovery_root()
            .join(format!("{session_id}.json"))
            .exists());
        assert!(!paths
            .recovery_root()
            .join(format!("{session_id}.events.jsonl"))
            .exists());
        assert!(paths
            .records_root
            .join("Mock.01.A.1")
            .join(format!("2026-07-19_09-00-00_{session_id}"))
            .join("answers.json")
            .is_file());
        let conn = Connection::open(paths.database_path()).expect("database");
        let row_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM practice_sessions WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .expect("terminal row");
        assert_eq!(row_count, 1, "terminal SQLite history must be retained");
        drop(conn);
        cleanup_fixture(root);
    }

    #[test]
    fn completed_toefl_trash_is_one_logical_entry_with_preserved_metadata() {
        let (root, paths) = fixture("terminal-trash");
        let session_id = "terminal-trash";
        insert_recovery_fixture(&paths, session_id);
        complete_recovery_fixture(&paths, session_id);
        let relative = publish_toefl_fixture(&paths, session_id, "COMPLETED");
        move_one_to_trash(&paths, &toefl_reference(&relative, session_id), None)
            .expect("trash logical TOEFL");

        let logical = scan_records_at(&paths)
            .expect("scan")
            .into_iter()
            .filter(|record| record.session_id == session_id)
            .collect::<Vec<_>>();
        assert_eq!(
            logical.len(),
            1,
            "Trash must not expose a retryable duplicate"
        );
        let trash = &logical[0];
        assert_eq!(trash.record_type, LocalRecordType::Trash);
        assert_eq!(trash.original_record_type, Some(LocalRecordType::Toefl));
        assert_eq!(trash.package_id.as_deref(), Some("Mock.01.A.1"));
        assert_eq!(trash.mode.as_deref(), Some("practice"));
        assert_eq!(trash.completion_status, "COMPLETED");
        assert_eq!(trash.export_status, "EXPORTED");
        assert_eq!(trash.schema_version.as_deref(), Some("practice-session-v5"));
        assert_eq!(trash.app_version.as_deref(), Some("test"));
        cleanup_fixture(root);
    }

    #[test]
    fn permanent_delete_of_toefl_logical_identity_removes_sqlite_and_live_files() {
        let (root, paths) = fixture("terminal-permanent-delete");
        let session_id = "terminal-permanent-delete";
        insert_recovery_fixture(&paths, session_id);
        complete_recovery_fixture(&paths, session_id);
        let relative = publish_toefl_fixture(&paths, session_id, "COMPLETED");
        let trashed = move_one_to_trash(&paths, &toefl_reference(&relative, session_id), None)
            .expect("trash logical identity");
        permanently_delete_one(
            &paths,
            &RecordReference {
                record_id: "TRASH:terminal-permanent-delete".to_string(),
                record_type: LocalRecordType::Trash,
                session_id: session_id.to_string(),
                relative_path: trashed,
            },
        )
        .expect("permanent delete");

        assert!(!paths
            .recovery_root()
            .join(format!("{session_id}.json"))
            .exists());
        let conn = Connection::open(paths.database_path()).expect("database");
        let row_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM practice_sessions WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .expect("deleted terminal row");
        assert_eq!(row_count, 0);
        drop(conn);
        assert!(!scan_records_at(&paths)
            .expect("scan")
            .iter()
            .any(|record| record.session_id == session_id));
        cleanup_fixture(root);
    }

    #[test]
    fn r0072_1_full_disposable_lifecycle_converges_to_zero_artifacts() {
        let (root, paths) = fixture("r0072-1-full-lifecycle");
        let session_id = "r0072-1-full-lifecycle";

        insert_recovery_fixture(&paths, session_id);
        let saved = scan_records_at(&paths)
            .expect("save-close scan")
            .into_iter()
            .filter(|record| record.session_id == session_id)
            .collect::<Vec<_>>();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].record_type, LocalRecordType::Recovery);
        assert_eq!(
            saved[0].recovery_classification.as_deref(),
            Some(LIVE_RECOVERY)
        );

        let conn = Connection::open(paths.database_path()).expect("continue database");
        let continued: String = conn
            .query_row(
                "SELECT snapshot_json FROM practice_sessions WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .expect("Continue snapshot");
        assert!(continued.contains(session_id));
        drop(conn);

        complete_recovery_fixture(&paths, session_id);
        fs::write(
            paths
                .recovery_root()
                .join(format!("{session_id}.events.jsonl")),
            "{\"seq\":1}\n",
        )
        .expect("terminal events");
        let relative = publish_toefl_fixture(&paths, session_id, "COMPLETED");
        assert_eq!(
            cleanup_terminal_recovery_for_paths(&paths, session_id, &relative, None)
                .expect("terminal cleanup"),
            2
        );
        let exported = scan_records_at(&paths)
            .expect("post-export scan")
            .into_iter()
            .filter(|record| record.session_id == session_id)
            .collect::<Vec<_>>();
        assert_eq!(exported.len(), 1);
        assert_eq!(exported[0].record_type, LocalRecordType::Toefl);
        assert_eq!(exported[0].recovery_classification, None);

        let first_trash = move_one_to_trash(&paths, &toefl_reference(&relative, session_id), None)
            .expect("first Trash");
        let in_trash = scan_records_at(&paths)
            .expect("Trash scan")
            .into_iter()
            .filter(|record| record.session_id == session_id)
            .collect::<Vec<_>>();
        assert_eq!(in_trash.len(), 1);
        assert_eq!(in_trash[0].record_type, LocalRecordType::Trash);

        let restored = restore_one_from_trash(
            &paths,
            &RecordReference {
                record_id: "TRASH:r0072-1-first".to_string(),
                record_type: LocalRecordType::Trash,
                session_id: session_id.to_string(),
                relative_path: first_trash,
            },
        )
        .expect("restore TOEFL");
        let after_restore = scan_records_at(&paths)
            .expect("restore scan")
            .into_iter()
            .filter(|record| record.session_id == session_id)
            .collect::<Vec<_>>();
        assert_eq!(after_restore.len(), 1);
        assert_eq!(after_restore[0].record_type, LocalRecordType::Toefl);

        let second_trash = move_one_to_trash(&paths, &toefl_reference(&restored, session_id), None)
            .expect("second Trash");
        permanently_delete_one(
            &paths,
            &RecordReference {
                record_id: "TRASH:r0072-1-second".to_string(),
                record_type: LocalRecordType::Trash,
                session_id: session_id.to_string(),
                relative_path: second_trash,
            },
        )
        .expect("permanent delete");
        assert!(!scan_records_at(&paths)
            .expect("final scan")
            .iter()
            .any(|record| record.session_id == session_id));
        assert!(existing_recovery_paths(&paths, session_id)
            .expect("final recovery artifacts")
            .is_empty());
        let conn = Connection::open(paths.database_path()).expect("final database");
        let sqlite_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM practice_sessions WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .expect("final SQLite identity count");
        assert_eq!(sqlite_count, 0);
        drop(conn);
        cleanup_fixture(root);
    }

    #[test]
    fn terminal_cleanup_failure_and_active_guard_preserve_export_and_recovery_for_retry() {
        let (root, paths) = fixture("terminal-cleanup-failure");
        let session_id = "terminal-cleanup-failure";
        insert_recovery_fixture(&paths, session_id);
        complete_recovery_fixture(&paths, session_id);
        let relative = publish_toefl_fixture(&paths, session_id, "COMPLETED");
        let export_file = paths
            .records_root
            .join("Mock.01.A.1")
            .join(format!("2026-07-19_09-00-00_{session_id}"))
            .join("answers.json");

        assert!(cleanup_terminal_recovery_for_paths_with_fault(
            &paths, session_id, &relative, None, true
        )
        .is_err());
        assert!(export_file.is_file());
        assert!(paths
            .recovery_root()
            .join(format!("{session_id}.json"))
            .is_file());
        assert!(cleanup_terminal_recovery_for_paths(
            &paths,
            session_id,
            &relative,
            Some(session_id)
        )
        .is_err());
        assert!(paths
            .recovery_root()
            .join(format!("{session_id}.json"))
            .is_file());
        assert_eq!(
            cleanup_terminal_recovery_for_paths(&paths, session_id, &relative, None)
                .expect("cleanup retry"),
            1
        );
        assert_eq!(
            cleanup_terminal_recovery_for_paths(&paths, session_id, &relative, None)
                .expect("idempotent cleanup retry"),
            0
        );
        assert!(export_file.is_file());
        cleanup_fixture(root);
    }

    #[test]
    fn physical_trash_manifest_hides_recovery_even_if_sqlite_marker_was_not_published() {
        let (root, paths) = fixture("trash-marker-crash");
        let session_id = "trash-marker-crash";
        insert_recovery_fixture(&paths, session_id);
        complete_recovery_fixture(&paths, session_id);
        let relative = publish_toefl_fixture(&paths, session_id, "COMPLETED");
        let trashed = move_one_to_trash(&paths, &toefl_reference(&relative, session_id), None)
            .expect("Trash publish");
        let conn = Connection::open(paths.database_path()).expect("database");
        conn.execute(
            "DELETE FROM record_trash WHERE session_id = ?1",
            params![session_id],
        )
        .expect("simulate crash before SQLite marker");
        drop(conn);

        let logical = scan_records_at(&paths)
            .expect("crash-recovery scan")
            .into_iter()
            .filter(|record| record.session_id == session_id)
            .collect::<Vec<_>>();
        assert_eq!(logical.len(), 1);
        assert_eq!(logical[0].record_type, LocalRecordType::Trash);
        restore_one_from_trash(
            &paths,
            &RecordReference {
                record_id: "TRASH:marker-crash".to_string(),
                record_type: LocalRecordType::Trash,
                session_id: session_id.to_string(),
                relative_path: trashed,
            },
        )
        .expect("marker-idempotent restore");
        let restored = scan_records_at(&paths)
            .expect("restored scan")
            .into_iter()
            .filter(|record| record.session_id == session_id)
            .collect::<Vec<_>>();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].record_type, LocalRecordType::Toefl);
        cleanup_fixture(root);
    }

    #[test]
    fn incomplete_recovery_trash_and_restore_do_not_touch_another_session() {
        let (root, paths) = fixture("incomplete-recovery-trash");
        insert_recovery_fixture(&paths, "recovery-target");
        insert_recovery_fixture(&paths, "recovery-other");
        let trashed = move_one_to_trash(
            &paths,
            &RecordReference {
                record_id: "RECOVERY:recovery-target".to_string(),
                record_type: LocalRecordType::Recovery,
                session_id: "recovery-target".to_string(),
                relative_path: "data/recovery/recovery-target.json".to_string(),
            },
            None,
        )
        .expect("Trash incomplete recovery");
        let records = scan_records_at(&paths).expect("Trash scan");
        assert_eq!(
            records
                .iter()
                .filter(|record| record.session_id == "recovery-target")
                .count(),
            1
        );
        assert!(records.iter().any(|record| {
            record.session_id == "recovery-other" && record.record_type == LocalRecordType::Recovery
        }));

        restore_one_from_trash(
            &paths,
            &RecordReference {
                record_id: "TRASH:recovery-target".to_string(),
                record_type: LocalRecordType::Trash,
                session_id: "recovery-target".to_string(),
                relative_path: trashed,
            },
        )
        .expect("restore incomplete recovery");
        let restored = scan_records_at(&paths).expect("restored recovery scan");
        assert!(restored.iter().any(|record| {
            record.session_id == "recovery-target"
                && record.record_type == LocalRecordType::Recovery
                && record.completion_status == "INCOMPLETE"
        }));
        assert!(restored.iter().any(|record| {
            record.session_id == "recovery-other" && record.record_type == LocalRecordType::Recovery
        }));
        cleanup_fixture(root);
    }

    #[test]
    fn unrelated_typing_and_recovery_with_same_session_text_are_not_coalesced() {
        let (root, paths) = fixture("unrelated-type-identity");
        let session_id = "same-text-different-type";
        insert_recovery_fixture(&paths, session_id);
        let relative = format!("typing_records/2026-07/{session_id}");
        let files = vec![SessionExportFile {
            name: "final_text.txt".to_string(),
            content: "typing".to_string(),
        }];
        let index = typing_index(session_id, &relative, vec!["final_text.txt".to_string()]);
        export_typing_bundle_atomic_for_paths(&paths, &relative, &files, &index)
            .expect("Typing fixture");

        let logical = scan_records_at(&paths)
            .expect("identity scan")
            .into_iter()
            .filter(|record| record.session_id == session_id)
            .collect::<Vec<_>>();
        assert_eq!(logical.len(), 2);
        assert!(logical
            .iter()
            .any(|record| record.record_type == LocalRecordType::Typing));
        assert!(logical
            .iter()
            .any(|record| record.record_type == LocalRecordType::Recovery));
        cleanup_fixture(root);
    }

    #[test]
    fn legacy_trash_manifest_without_optional_metadata_remains_listable_and_restorable() {
        let (root, paths) = fixture("legacy-trash-manifest");
        let entry = paths.trash_root.join("records").join("legacy-trash");
        fs::create_dir_all(entry.join("payload")).expect("legacy Trash payload");
        fs::write(entry.join("payload").join("answers.json"), "{}").expect("legacy Trash record");
        fs::write(
            entry.join("manifest.json"),
            r#"{
              "trash_id": "legacy-trash",
              "original_relative_path": "records/legacy/session",
              "trashed_relative_path": "trash/records/legacy-trash",
              "record_type": "TOEFL",
              "trashed_at": "2026-07-19T09:00:00Z",
              "session_id": "session",
              "schema_version": null
            }"#,
        )
        .expect("legacy manifest");

        let trash = scan_records_at(&paths)
            .expect("legacy Trash scan")
            .into_iter()
            .find(|record| record.trash_id.as_deref() == Some("legacy-trash"))
            .expect("legacy Trash remains listable");
        assert_eq!(trash.completion_status, "UNKNOWN");
        assert!(trash
            .diagnostic
            .as_deref()
            .unwrap_or_default()
            .contains("Legacy Trash manifest"));
        restore_one_from_trash(
            &paths,
            &RecordReference {
                record_id: trash.record_id,
                record_type: LocalRecordType::Trash,
                session_id: trash.session_id,
                relative_path: trash.relative_path,
            },
        )
        .expect("legacy Trash restore");
        assert!(paths
            .records_root
            .join("legacy")
            .join("session")
            .join("answers.json")
            .is_file());
        cleanup_fixture(root);
    }

    #[test]
    fn incomplete_toefl_supersedes_same_session_live_recovery() {
        let (root, paths) = fixture("incomplete-supersedes-recovery");
        let session_id = "recovered-incomplete";
        insert_recovery_fixture(&paths, session_id);
        let relative = format!("records/Mock.01.A.1/2026-07-19_09-00-00_{session_id}");
        let directory = paths
            .records_root
            .join("Mock.01.A.1")
            .join(format!("2026-07-19_09-00-00_{session_id}"));
        fs::create_dir_all(&directory).expect("record directory");
        fs::write(
            directory.join("record-index.json"),
            serde_json::to_string_pretty(&toefl_index(session_id, &relative, "INCOMPLETE", vec![]))
                .expect("index json"),
        )
        .expect("record index");

        let records = scan_records_at(&paths).expect("scan");
        let logical = records
            .iter()
            .filter(|record| record.session_id == session_id)
            .collect::<Vec<_>>();
        assert_eq!(logical.len(), 1);
        assert_eq!(logical[0].record_type, LocalRecordType::Toefl);
        assert_eq!(logical[0].completion_status, "INCOMPLETE");
        cleanup_fixture(root);
    }

    #[test]
    fn malformed_final_index_does_not_hide_valid_recovery_or_abort_scan() {
        let (root, paths) = fixture("malformed-index-keeps-recovery");
        let session_id = "recoverable-after-invalid-index";
        insert_recovery_fixture(&paths, session_id);
        let directory = paths
            .records_root
            .join("Mock.01.A.1")
            .join(format!("2026-07-19_09-00-00_{session_id}"));
        fs::create_dir_all(&directory).expect("record directory");
        fs::write(directory.join("record-index.json"), "{malformed").expect("bad index");

        let records = scan_records_at(&paths).expect("malformed index must be isolated");
        let recovery = records
            .iter()
            .find(|record| record.session_id == session_id)
            .expect("recovery remains visible");
        assert_eq!(recovery.record_type, LocalRecordType::Recovery);
        cleanup_fixture(root);
    }

    #[test]
    fn wrong_type_and_traversal_indexes_are_isolated_without_hiding_recovery() {
        let (root, paths) = fixture("invalid-index-isolation");
        for (session_id, invalid_kind) in [
            ("recovery-under-wrong-type", "wrong-type"),
            ("recovery-under-traversal", "traversal"),
        ] {
            insert_recovery_fixture(&paths, session_id);
            let relative = format!("records/Mock.01.A.1/2026-07-19_09-00-00_{session_id}");
            let directory = paths
                .records_root
                .join("Mock.01.A.1")
                .join(format!("2026-07-19_09-00-00_{session_id}"));
            fs::create_dir_all(&directory).expect("record directory");
            let mut index = toefl_index(session_id, &relative, "COMPLETED", vec![]);
            if invalid_kind == "wrong-type" {
                index.record_type = LocalRecordType::Typing;
                index.record_id = format!("TYPING:{session_id}");
            } else {
                index.relative_path = "records/Mock.01.A.1/../../outside".to_string();
            }
            fs::write(
                directory.join("record-index.json"),
                serde_json::to_string_pretty(&index).expect("index json"),
            )
            .expect("record index");
        }

        let records = scan_records_at(&paths).expect("invalid indexes must be isolated");
        for session_id in ["recovery-under-wrong-type", "recovery-under-traversal"] {
            let logical = records
                .iter()
                .filter(|record| record.session_id == session_id)
                .collect::<Vec<_>>();
            assert_eq!(logical.len(), 1);
            assert_eq!(logical[0].record_type, LocalRecordType::Recovery);
        }
        cleanup_fixture(root);
    }

    #[test]
    fn rejects_parent_and_absolute_record_paths() {
        let (root, paths) = fixture("unsafe");
        assert!(
            resolve_record_existing(&paths, &toefl_reference("records/pkg/../outside", "s"))
                .is_err()
        );
        assert!(
            resolve_record_existing(&paths, &toefl_reference(r"E:\outside\session", "s")).is_err()
        );
        cleanup_fixture(root);
    }

    #[test]
    fn moves_to_trash_with_manifest_and_restores() {
        let (root, paths) = fixture("move");
        let session = paths.records_root.join("套题.01").join("会话.01");
        fs::create_dir_all(&session).expect("session");
        fs::write(session.join("answers.json"), "{}").expect("record");
        let reference = toefl_reference("records/套题.01/会话.01", "会话.01");
        let trashed = move_one_to_trash(&paths, &reference, None).expect("trash");
        assert!(!session.exists());
        let trash_reference = RecordReference {
            record_id: "TRASH:test".to_string(),
            record_type: LocalRecordType::Trash,
            session_id: reference.session_id.clone(),
            relative_path: trashed,
        };
        restore_one_from_trash(&paths, &trash_reference).expect("restore");
        assert!(session.join("answers.json").is_file());
        cleanup_fixture(root);
    }

    #[test]
    fn trash_summary_exposes_the_original_primary_type() {
        let (root, paths) = fixture("trash-original-type");
        let session = paths.records_root.join("pkg").join("session");
        fs::create_dir_all(&session).expect("session");
        fs::write(session.join("answers.json"), "{}").expect("record");
        let reference = toefl_reference("records/pkg/session", "session");
        move_one_to_trash(&paths, &reference, None).expect("trash");
        let records = scan_records_at(&paths).expect("scan");
        let trash = records
            .iter()
            .find(|record| record.record_type == LocalRecordType::Trash)
            .expect("trash summary");
        let json = serde_json::to_value(trash).expect("summary json");
        assert_eq!(json["original_record_type"], "TOEFL");
        cleanup_fixture(root);
    }

    #[test]
    fn restore_uses_safe_suffix_on_conflict() {
        let (root, paths) = fixture("conflict");
        let session = paths.records_root.join("pkg").join("session");
        fs::create_dir_all(&session).expect("session");
        fs::write(session.join("answers.json"), "old").expect("record");
        let reference = toefl_reference("records/pkg/session", "session");
        let trashed = move_one_to_trash(&paths, &reference, None).expect("trash");
        fs::create_dir_all(&session).expect("conflict");
        fs::write(session.join("answers.json"), "new").expect("conflict record");
        let restored = restore_one_from_trash(
            &paths,
            &RecordReference {
                record_id: "TRASH:test".to_string(),
                record_type: LocalRecordType::Trash,
                session_id: "session".to_string(),
                relative_path: trashed,
            },
        )
        .expect("restore");
        assert!(restored.contains("-restored-1_"));
        assert_eq!(
            fs::read_to_string(session.join("answers.json")).expect("existing"),
            "new"
        );
        cleanup_fixture(root);
    }

    #[test]
    fn structured_restore_conflict_keeps_a_valid_rewritten_index() {
        let (root, paths) = fixture("structured-conflict");
        let session_id = "structured-session";
        let relative = format!("records/pkg/2026-07-19_09-00-00_{session_id}");
        let session = paths
            .records_root
            .join("pkg")
            .join(format!("2026-07-19_09-00-00_{session_id}"));
        fs::create_dir_all(&session).expect("session");
        fs::write(session.join("answers.json"), "old").expect("record");
        fs::write(
            session.join("record-index.json"),
            serde_json::to_string_pretty(&toefl_index(
                session_id,
                &relative,
                "COMPLETED",
                vec!["answers.json".to_string()],
            ))
            .expect("index"),
        )
        .expect("index file");
        let reference = toefl_reference(&relative, session_id);
        let trashed = move_one_to_trash(&paths, &reference, None).expect("trash");
        fs::create_dir_all(&session).expect("conflict");
        fs::write(session.join("answers.json"), "new").expect("conflict record");

        let restored = restore_one_from_trash(
            &paths,
            &RecordReference {
                record_id: "TRASH:structured".to_string(),
                record_type: LocalRecordType::Trash,
                session_id: session_id.to_string(),
                relative_path: trashed,
            },
        )
        .expect("restore");
        assert!(restored.contains("-restored-1_"));
        let restored_directory = paths.app_root.join(restored.replace('/', "\\"));
        let restored_index = read_bounded_json::<LocalRecordSummary>(
            &restored_directory.join("record-index.json"),
            64 * 1024,
        )
        .expect("rewritten index");
        assert_eq!(restored_index.relative_path, restored);
        assert!(restored_index.directory_size_bytes > 0);
        assert_eq!(
            restored_index.directory_size_bytes,
            directory_size_without_links(&restored_directory).expect("restored directory size")
        );
        assert!(valid_scanned_export_index(
            &restored_index,
            LocalRecordType::Toefl,
            &restored,
            &restored_directory
        ));
        assert_eq!(
            fs::read_to_string(session.join("answers.json")).expect("existing"),
            "new"
        );
        cleanup_fixture(root);
    }

    #[test]
    fn active_session_is_never_moved() {
        let (root, paths) = fixture("active");
        let session = paths.records_root.join("pkg").join("session");
        fs::create_dir_all(&session).expect("session");
        let reference = toefl_reference("records/pkg/session", "session");
        assert!(move_one_to_trash(&paths, &reference, Some("session")).is_err());
        assert!(session.exists());
        cleanup_fixture(root);
    }

    #[test]
    fn permanent_delete_requires_confirmation_at_command_boundary() {
        let reference = RecordReference {
            record_id: "TRASH:test".to_string(),
            record_type: LocalRecordType::Trash,
            session_id: "test".to_string(),
            relative_path: "trash/records/test".to_string(),
        };
        let results = permanently_delete_trash_records(vec![reference], false);
        assert!(!results[0].ok);
    }

    #[test]
    fn batch_reports_unrelated_success_and_failure_independently() {
        let (root, paths) = fixture("batch");
        let session = paths.records_root.join("pkg").join("one");
        fs::create_dir_all(&session).expect("session");
        let results = [
            toefl_reference("records/pkg/one", "one"),
            toefl_reference("records/pkg/missing", "missing"),
        ]
        .into_iter()
        .map(|record| action_result(&record, move_one_to_trash(&paths, &record, None)))
        .collect::<Vec<_>>();
        assert!(results[0].ok);
        assert!(!results[1].ok);
        cleanup_fixture(root);
    }

    #[test]
    fn scanning_legacy_record_reads_summary_not_answers_body() {
        let (root, paths) = fixture("scan");
        let session = paths
            .records_root
            .join("pkg")
            .join("2026-07-13_12-00-00_session");
        fs::create_dir_all(&session).expect("session");
        fs::write(
            session.join("answers.json"),
            "THIS IS NOT JSON AND MUST NOT BE READ",
        )
        .expect("body");
        fs::write(
            session.join("session_summary.md"),
            "# Summary\n\n- Session ID：session\n- 模式：practice\n- 总有效时间：00:01.0\n",
        )
        .expect("summary");
        let records = scan_records_at(&paths).expect("scan");
        let item = records
            .iter()
            .find(|item| item.record_type == LocalRecordType::Toefl)
            .expect("record");
        assert_eq!(item.active_time_ms, 1_000);
        cleanup_fixture(root);
    }

    #[test]
    fn scans_typing_and_recovery_from_lightweight_metadata() {
        let (root, paths) = fixture("typing-recovery-scan");
        let typing = paths.typing_records_root.join("2026-07").join("typing-one");
        fs::create_dir_all(&typing).expect("typing directory");
        fs::write(
            typing.join("typing_session.json"),
            "LARGE OR INVALID BODY MUST NOT BE PARSED FOR LISTING",
        )
        .expect("typing body");

        let snapshot = r#"{
          "session_schema_version": 5,
          "current_section_id": "Writing",
          "current_scope_id": "WRITING_EMAIL",
          "current_task_id": "WRITING_EMAIL",
          "questions": [{"section_id": "Writing"}]
        }"#;
        let conn = Connection::open(paths.database_path()).expect("database");
        conn.execute(
            r#"
            INSERT INTO practice_sessions(
              session_id, package_id, source_path, mode, timing_profile_id,
              timing_profile_version, created_at, started_at, active_ms, paused_ms, snapshot_json
            ) VALUES (?1, ?2, 'readonly', 'practice', 'profile', '1.0', ?3, ?3, 1200, 300, ?4)
            "#,
            params![
                "recovery-one",
                "Mock.01.A.1",
                "2026-07-13T00:00:00Z",
                snapshot
            ],
        )
        .expect("recovery row");
        drop(conn);
        fs::write(paths.recovery_root().join("recovery-one.json"), snapshot)
            .expect("recovery file");

        let records = scan_records_at(&paths).expect("scan");
        assert!(records.iter().any(|item| {
            item.record_type == LocalRecordType::Typing && item.session_id == "typing-one"
        }));
        let recovery = records
            .iter()
            .find(|item| item.record_type == LocalRecordType::Recovery)
            .expect("recovery summary");
        assert_eq!(recovery.current_section_id.as_deref(), Some("Writing"));
        assert_eq!(recovery.active_time_ms, 1200);
        cleanup_fixture(root);
    }

    #[test]
    fn file_only_recovery_remains_available_for_raw_diagnostics() {
        let (root, paths) = fixture("file-only-raw");
        let raw = "{broken but still exportable";
        fs::write(paths.recovery_root().join("orphan.json"), raw).expect("orphan snapshot");
        assert_eq!(read_file_only_recovery(&paths, "orphan").expect("raw"), raw);
        assert!(read_file_only_recovery(&paths, "../orphan").is_err());
        cleanup_fixture(root);
    }

    #[test]
    fn raw_recovery_export_bypasses_business_validation_and_copies_events_with_manifest() {
        let (root, paths) = fixture("raw-bypass");
        let snapshot = "{malformed json retained byte-for-byte";
        let events = "{\"seq\":1,\"event_type\":\"synthetic\"}\n";
        let source_snapshot = paths.recovery_root().join("raw-session.json");
        let source_events = paths.recovery_root().join("raw-session.events.jsonl");
        fs::write(&source_snapshot, snapshot).expect("snapshot fixture");
        fs::write(&source_events, events).expect("events fixture");

        let relative =
            export_recovery_raw_for_paths(&paths, "raw-session", 123).expect("raw export");
        let exported = paths
            .records_root
            .join("recovery-diagnostics")
            .join("raw-session-123");
        assert_eq!(relative, "records/recovery-diagnostics/raw-session-123");
        assert_eq!(
            fs::read_to_string(exported.join("snapshot.json")).unwrap(),
            snapshot
        );
        assert_eq!(
            fs::read_to_string(exported.join("events.jsonl")).unwrap(),
            events
        );
        let manifest: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(exported.join("diagnostic-manifest.json")).unwrap(),
        )
        .expect("diagnostic manifest");
        assert_eq!(manifest["session_id"], "raw-session");
        assert_eq!(manifest["snapshot_copied"], true);
        assert_eq!(manifest["events_copied"], true);
        assert_eq!(fs::read_to_string(source_snapshot).unwrap(), snapshot);
        assert_eq!(fs::read_to_string(source_events).unwrap(), events);
        cleanup_fixture(root);
    }

    #[cfg(windows)]
    #[test]
    fn symlink_escape_is_rejected_when_platform_allows_fixture() {
        use std::os::windows::fs::symlink_dir;
        let (root, paths) = fixture("symlink");
        let outside = root.join("outside");
        fs::create_dir_all(&outside).expect("outside");
        let group = paths.records_root.join("pkg");
        fs::create_dir_all(&group).expect("group");
        let link = group.join("session");
        if symlink_dir(&outside, &link).is_ok() {
            assert!(resolve_record_existing(
                &paths,
                &toefl_reference("records/pkg/session", "session")
            )
            .is_err());
        }
        cleanup_fixture(root);
    }
}
