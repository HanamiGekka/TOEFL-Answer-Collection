use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock, RwLock},
};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct AppPaths {
    pub app_root: PathBuf,
    #[serde(default)]
    pub source_root: PathBuf,
    pub records_root: PathBuf,
    pub typing_records_root: PathBuf,
    pub trash_root: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppPathsPreview {
    pub ok: bool,
    pub paths: AppPaths,
    pub creates: Vec<PathBuf>,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub migrates_existing_data: bool,
    pub writable: bool,
    pub inside_app_root: bool,
}

#[derive(Debug, Clone)]
struct PathLocations {
    default_app_root: PathBuf,
    config_dir: PathBuf,
}

#[derive(Debug, Clone)]
struct RuntimeState {
    paths: AppPaths,
    default_app_root: PathBuf,
    config_dir: PathBuf,
    generation: u64,
    fixture_mode: bool,
    banner: Option<String>,
    startup_notice_code: Option<RuntimeNoticeCode>,
    startup_notice: Option<String>,
    #[cfg(debug_assertions)]
    r0063_scenario: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeMode {
    pub fixture_mode: bool,
    pub banner: Option<String>,
    pub startup_notice_code: Option<RuntimeNoticeCode>,
    pub startup_notice: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RuntimeNoticeCode {
    AppPathsFallbackLastKnownGood,

    AppPathsFallbackUserDefault,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AppConfigurationContext {
    pub app_root: PathBuf,
    pub generation: u64,
}

#[derive(Debug)]
struct BootstrapLoad {
    paths: AppPaths,
    notice: Option<RuntimeNoticeCode>,
}

static ACTIVE_STATE: OnceLock<RwLock<RuntimeState>> = OnceLock::new();
static CONFIGURATION_MUTATION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

impl AppPaths {
    pub fn for_root(app_root: &Path, source_root: &Path) -> Self {
        Self {
            app_root: app_root.to_path_buf(),
            source_root: source_root.to_path_buf(),
            records_root: app_root.join("records"),
            typing_records_root: app_root.join("typing_records"),
            trash_root: app_root.join("trash"),
        }
    }

    pub fn recovery_root(&self) -> PathBuf {
        self.app_root.join("data/recovery")
    }

    pub fn database_path(&self) -> PathBuf {
        self.app_root.join("data/answer_collection.sqlite3")
    }
}

pub fn current_app_paths() -> AppPaths {
    runtime_state()
        .read()
        .expect("app paths lock poisoned")
        .paths
        .clone()
}

fn configuration_mutation_lock() -> &'static Mutex<()> {
    CONFIGURATION_MUTATION_LOCK.get_or_init(|| Mutex::new(()))
}

fn context_for_state(state: &RuntimeState) -> AppConfigurationContext {
    AppConfigurationContext {
        app_root: state.paths.app_root.clone(),
        generation: state.generation,
    }
}

fn require_configuration_context(
    state: &RuntimeState,
    expected_app_root: &Path,
    expected_generation: u64,
) -> Result<(), String> {
    if state.generation != expected_generation
        || state.paths.app_root != normalize_lexical(expected_app_root)
    {
        return Err("STALE_APP_CONFIGURATION: APP_ROOT generation no longer matches".to_string());
    }
    Ok(())
}

fn replace_paths_for_context(
    state: &mut RuntimeState,
    expected_app_root: &Path,
    expected_generation: u64,
    paths: AppPaths,
) -> Result<(), String> {
    require_configuration_context(state, expected_app_root, expected_generation)?;
    state.paths = paths;
    state.generation = state
        .generation
        .checked_add(1)
        .ok_or_else(|| "APP_CONFIGURATION_GENERATION: generation overflow".to_string())?;
    state.startup_notice_code = None;
    state.startup_notice = None;
    Ok(())
}

pub fn with_bound_app_paths<T>(
    expected_app_root: &Path,
    expected_generation: u64,
    operation: impl FnOnce(&AppPaths) -> Result<T, String>,
) -> Result<T, String> {
    let _mutation = configuration_mutation_lock()
        .lock()
        .map_err(|_| "APP_CONFIGURATION_LOCK: mutation lock is unavailable".to_string())?;
    let state = runtime_state()
        .read()
        .map_err(|_| "APP_CONFIGURATION_STATE: path state is unavailable".to_string())?;
    require_configuration_context(&state, expected_app_root, expected_generation)?;
    operation(&state.paths)
}

fn runtime_state() -> &'static RwLock<RuntimeState> {
    #[cfg(test)]
    {
        ACTIVE_STATE.get_or_init(|| {
            let root = std::env::temp_dir().join(format!("toefl-rust-test-{}", std::process::id()));
            RwLock::new(initial_runtime_state(PathLocations {
                default_app_root: root.join("app"),
                config_dir: root.join("config"),
            }))
        })
    }
    #[cfg(not(test))]
    {
        ACTIVE_STATE
            .get()
            .expect("runtime paths must be initialized in Tauri setup")
    }
}

pub fn initialize_runtime_paths(
    config_dir: PathBuf,
    default_app_root: PathBuf,
) -> Result<(), String> {
    if !config_dir.is_absolute() || !default_app_root.is_absolute() {
        return Err("Tauri user configuration and data directories must be absolute".to_string());
    }
    let locations = PathLocations {
        default_app_root,
        config_dir,
    };
    ACTIVE_STATE
        .set(RwLock::new(initial_runtime_state(locations)))
        .map_err(|_| "runtime paths have already been initialized".to_string())
}

fn initial_runtime_state(locations: PathLocations) -> RuntimeState {
    #[cfg(debug_assertions)]
    if let Some(root) =
        std::env::var_os("TOEFL_R0063_FIXTURE_ROOT").filter(|value| !value.is_empty())
    {
        return r0063_fixture_runtime_state(PathBuf::from(root));
    }
    if let Some(root) =
        std::env::var_os("TOEFL_R0062_FIXTURE_ROOT").filter(|value| !value.is_empty())
    {
        return fixture_runtime_state(PathBuf::from(root));
    }
    let loaded = load_bootstrap_paths(&locations);
    RuntimeState {
        paths: loaded.paths,
        default_app_root: locations.default_app_root,
        config_dir: locations.config_dir,
        generation: 0,
        fixture_mode: false,
        banner: None,
        startup_notice_code: loaded.notice,
        startup_notice: None,
        #[cfg(debug_assertions)]
        r0063_scenario: None,
    }
}

fn fixture_runtime_state(root: PathBuf) -> RuntimeState {
    let normalized = normalize_lexical(&root);
    let paths = AppPaths::for_root(&normalized, Path::new(""));
    let notice = validate_controlled_roots(&paths)
        .err()
        .map(|_| "测试数据目录无效；为保护正式目录，本进程不会写入数据。".to_string());
    RuntimeState {
        paths,
        default_app_root: normalized.clone(),
        config_dir: normalized.join("config"),
        generation: 0,
        fixture_mode: true,
        banner: Some("测试数据模式 · 关闭后恢复正式数据目录".to_string()),
        startup_notice_code: None,
        startup_notice: notice,
        #[cfg(debug_assertions)]
        r0063_scenario: None,
    }
}

#[cfg(debug_assertions)]
#[derive(Deserialize)]
struct R0063FixtureMarker {
    fixture_id: String,
    root: PathBuf,
}

#[cfg(debug_assertions)]
fn r0063_fixture_runtime_state(root: PathBuf) -> RuntimeState {
    let scenario = std::env::var("TOEFL_R0063_SCENARIO").unwrap_or_default();
    r0063_fixture_runtime_state_with_scenario(root, scenario)
}

#[cfg(debug_assertions)]
fn r0063_fixture_runtime_state_with_scenario(root: PathBuf, scenario: String) -> RuntimeState {
    let normalized = normalize_lexical(&root);
    let marker_path = normalized.join(".r0063-fixture-root.json");
    let source_root = normalized.join("source");
    let app_root = normalized.join("app");
    let allowed_scenario = matches!(
        scenario.as_str(),
        "typing-retry" | "save-close-retry" | "verification"
    );
    let marker = fs::symlink_metadata(&normalized)
        .ok()
        .filter(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
        .and_then(|_| fs::symlink_metadata(&marker_path).ok())
        .filter(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
        .and_then(|_| fs::read_to_string(&marker_path).ok())
        .and_then(|content| serde_json::from_str::<R0063FixtureMarker>(&content).ok());
    let valid = marker.as_ref().is_some_and(|value| {
        value.fixture_id == "R006.3" && normalize_lexical(&value.root) == normalized
    }) && safe_fixture_directory(&normalized, &source_root)
        && safe_fixture_directory(&normalized, &app_root)
        && allowed_scenario;
    let paths = if valid {
        AppPaths::for_root(&app_root, &source_root)
    } else {
        // Deliberately overlap source and data so every persistence command is rejected.
        let rejected_root = normalized.join("app");
        AppPaths::for_root(&rejected_root, &rejected_root)
    };
    RuntimeState {
        paths,
        default_app_root: app_root,
        config_dir: normalized.join("config"),
        generation: 0,
        fixture_mode: true,
        banner: Some(if valid {
            format!("R006.3 TEST MODE · {scenario} · 一次性故障注入 · 临时数据")
        } else {
            "R006.3 TEST MODE 已拒绝：fixture marker 或 scenario 无效".to_string()
        }),
        startup_notice_code: None,
        startup_notice: (!valid).then(|| {
            "R006.3 fixture marker/scenario 校验失败；本进程拒绝写入，也不会回退到正式数据目录。".to_string()
        }),
        r0063_scenario: valid.then_some(scenario),
    }
}

#[cfg(debug_assertions)]
fn safe_fixture_directory(root: &Path, child: &Path) -> bool {
    let root_metadata = fs::symlink_metadata(root).ok();
    let child_metadata = fs::symlink_metadata(child).ok();
    if !root_metadata.is_some_and(|value| value.is_dir() && !value.file_type().is_symlink())
        || !child_metadata.is_some_and(|value| value.is_dir() && !value.file_type().is_symlink())
    {
        return false;
    }
    root.canonicalize()
        .ok()
        .zip(child.canonicalize().ok())
        .is_some_and(|(canonical_root, canonical_child)| {
            path_is_within(&canonical_child, &canonical_root)
        })
}

#[cfg(debug_assertions)]
pub fn consume_r0063_fault(point: &str) -> bool {
    static CONSUMED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    let scenario = runtime_state()
        .read()
        .ok()
        .and_then(|state| state.r0063_scenario.clone());
    let matches_point = matches!(
        (scenario.as_deref(), point),
        (Some("typing-retry"), "typing_export_publish")
            | (Some("save-close-retry"), "recovery_window_close")
    );
    if !matches_point {
        return false;
    }
    CONSUMED
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .map(|mut consumed| consumed.insert(format!("{}:{point}", scenario.unwrap_or_default())))
        .unwrap_or(false)
}

#[cfg(not(debug_assertions))]
pub fn consume_r0063_fault(_point: &str) -> bool {
    false
}

#[tauri::command]
pub fn get_app_paths() -> AppPaths {
    current_app_paths()
}

#[tauri::command]
pub fn get_default_app_root() -> PathBuf {
    runtime_state()
        .read()
        .expect("app paths lock poisoned")
        .default_app_root
        .clone()
}

#[tauri::command]
pub fn get_app_configuration_context() -> AppConfigurationContext {
    let state = runtime_state().read().expect("app paths lock poisoned");
    context_for_state(&state)
}

#[tauri::command]
pub fn get_runtime_mode() -> RuntimeMode {
    let state = runtime_state()
        .read()
        .expect("app paths lock poisoned")
        .clone();
    RuntimeMode {
        fixture_mode: state.fixture_mode,
        banner: state.banner,
        startup_notice_code: state.startup_notice_code,
        startup_notice: state.startup_notice,
    }
}

#[tauri::command]
pub fn preview_app_paths(paths: AppPaths) -> AppPathsPreview {
    validate_app_paths(
        &derive_user_paths(&paths.app_root, &paths.source_root),
        true,
    )
}

#[tauri::command]
pub fn save_app_paths(
    paths: AppPaths,
    confirmed: bool,
    expected_app_root: PathBuf,
    expected_generation: u64,
) -> Result<AppPaths, String> {
    if !confirmed {
        return Err("APP_PATHS_CONFIRMATION_REQUIRED".to_string());
    }
    let _mutation = configuration_mutation_lock()
        .lock()
        .map_err(|_| "APP_CONFIGURATION_LOCK: mutation lock is unavailable".to_string())?;
    let current = runtime_state()
        .read()
        .map_err(|_| "APP_PATHS_STATE_UNAVAILABLE".to_string())?
        .clone();
    require_configuration_context(&current, &expected_app_root, expected_generation)?;
    if current.fixture_mode {
        return Err("APP_PATHS_FIXTURE_WRITE_REFUSED".to_string());
    }
    let paths = derive_user_paths(&paths.app_root, &paths.source_root);
    let preview = validate_app_paths(&paths, true);
    if !preview.ok {
        return Err(preview.errors.join("; "));
    }
    crate::ensure_data_dirs_for_paths(&paths)?;
    let content = serde_json::to_string_pretty(&paths).map_err(|error| error.to_string())?;
    let bootstrap = current.config_dir.join("app-settings.local.json");
    if let Some(parent) = bootstrap.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    persist_settings_with(&bootstrap, &content, crate::atomic_write)?;
    let last_known_good = current.config_dir.join("app-settings.last-known-good.json");
    let _ = persist_settings_with(&last_known_good, &content, crate::atomic_write);
    let lock = runtime_state();
    let mut state = lock
        .write()
        .map_err(|_| "APP_PATHS_STATE_UNAVAILABLE".to_string())?;
    replace_paths_for_context(
        &mut state,
        &expected_app_root,
        expected_generation,
        paths.clone(),
    )?;
    Ok(paths)
}

fn persist_settings_with<F>(path: &Path, content: &str, writer: F) -> Result<(), String>
where
    F: FnOnce(&Path, &str) -> Result<(), String>,
{
    writer(path, content)
}

fn derive_user_paths(app_root: &Path, source_root: &Path) -> AppPaths {
    AppPaths::for_root(
        &normalize_lexical(app_root),
        &normalize_lexical(source_root),
    )
}

pub fn validate_app_paths(paths: &AppPaths, probe_writable: bool) -> AppPathsPreview {
    let mut errors = validate_controlled_roots(paths)
        .err()
        .into_iter()
        .collect::<Vec<_>>();
    let mut warnings = Vec::new();
    let mut creates = Vec::new();
    let data_roots = [
        &paths.records_root,
        &paths.typing_records_root,
        &paths.trash_root,
    ];
    for root in data_roots {
        if !root.exists() {
            creates.push(root.to_path_buf());
        }
    }
    let mut writable = errors.is_empty();
    if errors.is_empty() && probe_writable {
        let unique: HashSet<_> = [
            paths.app_root.join("data"),
            paths.records_root.clone(),
            paths.typing_records_root.clone(),
            paths.trash_root.clone(),
        ]
        .into_iter()
        .collect();
        for root in unique {
            if let Err(error) = probe_root_writable(&root) {
                let _ = error;
                writable = false;
                errors.push("APP_ROOT_NOT_WRITABLE".to_string());
            }
        }
    }
    warnings.push("APP_PATHS_NO_MIGRATION".to_string());
    let inside_app_root = controlled_roots_are_inside(paths);
    AppPathsPreview {
        ok: errors.is_empty(),
        paths: paths.clone(),
        creates,
        warnings,
        errors,
        migrates_existing_data: false,
        writable,
        inside_app_root,
    }
}

pub fn validate_controlled_roots(paths: &AppPaths) -> Result<(), String> {
    if !paths.app_root.is_absolute() {
        return Err("APP_PATHS_ABSOLUTE_REQUIRED".to_string());
    }
    let data_roots = [
        ("Records root", &paths.records_root),
        ("Typing records root", &paths.typing_records_root),
        ("Trash root", &paths.trash_root),
    ];
    for (_, root) in data_roots {
        if !root.is_absolute() {
            return Err("CONTROLLED_ROOT_INVALID".to_string());
        }
        if !path_is_within(root, &paths.app_root) {
            return Err("CONTROLLED_ROOT_INVALID".to_string());
        }
    }
    for (index, (_, left)) in data_roots.iter().enumerate() {
        for (_, right) in data_roots.iter().skip(index + 1) {
            if paths_contain_each_other(left, right) {
                return Err("CONTROLLED_ROOT_INVALID".to_string());
            }
        }
    }
    let canonical_root = canonicalize_with_missing_tail(&paths.app_root)?;
    for root in [
        paths.records_root.clone(),
        paths.typing_records_root.clone(),
        paths.trash_root.clone(),
        paths.recovery_root(),
        paths.app_root.join("logs"),
        paths.app_root.join("config"),
        paths.app_root.join("data"),
    ] {
        let canonical_child = canonicalize_with_missing_tail(&root)?;
        if !path_is_within(&canonical_child, &canonical_root) {
            return Err("CONTROLLED_ROOT_INVALID".to_string());
        }
    }
    Ok(())
}

fn canonicalize_with_missing_tail(path: &Path) -> Result<PathBuf, String> {
    let mut existing = path;
    let mut missing = Vec::new();
    while !existing.exists() {
        let name = existing
            .file_name()
            .ok_or_else(|| "APP_ROOT_UNRESOLVABLE".to_string())?;
        missing.push(name.to_os_string());
        existing = existing
            .parent()
            .ok_or_else(|| "APP_ROOT_UNRESOLVABLE".to_string())?;
    }
    let mut canonical = existing
        .canonicalize()
        .map_err(|_| "APP_ROOT_UNRESOLVABLE".to_string())?;
    for name in missing.into_iter().rev() {
        canonical.push(name);
    }
    Ok(canonical)
}

fn controlled_roots_are_inside(paths: &AppPaths) -> bool {
    paths.app_root.is_absolute()
        && [
            &paths.records_root,
            &paths.typing_records_root,
            &paths.trash_root,
        ]
        .into_iter()
        .all(|root| path_is_within(root, &paths.app_root))
}

fn normalize_lexical(path: &Path) -> PathBuf {
    path.components().collect()
}

#[cfg(windows)]
fn comparable_components(path: &Path) -> Vec<String> {
    normalize_lexical(path)
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_lowercase())
        .collect()
}

#[cfg(not(windows))]
fn comparable_components(path: &Path) -> Vec<String> {
    normalize_lexical(path)
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect()
}

fn same_path(left: &Path, right: &Path) -> bool {
    comparable_components(left) == comparable_components(right)
}

fn path_is_within(path: &Path, parent: &Path) -> bool {
    let path = comparable_components(path);
    let parent = comparable_components(parent);
    path.len() > parent.len() && path.starts_with(&parent)
}

fn paths_contain_each_other(left: &Path, right: &Path) -> bool {
    same_path(left, right) || path_is_within(left, right) || path_is_within(right, left)
}

fn probe_root_writable(root: &Path) -> Result<(), String> {
    let probe_root = if root.exists() {
        root
    } else {
        root.ancestors()
            .find(|candidate| candidate.exists())
            .ok_or_else(|| "no existing parent is available for a write probe".to_string())?
    };
    if !probe_root.is_dir() {
        return Err("write-probe target is not a directory".to_string());
    }
    let probe = probe_root.join(format!(".r006-write-probe-{}", std::process::id()));
    fs::write(&probe, b"probe").map_err(|error| error.to_string())?;
    fs::remove_file(&probe).map_err(|error| error.to_string())?;
    Ok(())
}

fn load_bootstrap_paths(locations: &PathLocations) -> BootstrapLoad {
    load_path_config_from(
        &locations.config_dir.join("app-settings.local.json"),
        &locations
            .config_dir
            .join("app-settings.last-known-good.json"),
        &locations.default_app_root,
    )
}

fn load_path_config_from(
    main: &Path,
    last_known_good: &Path,
    default_app_root: &Path,
) -> BootstrapLoad {
    if let Some(paths) = read_valid_persisted_paths(main) {
        return BootstrapLoad {
            paths,
            notice: None,
        };
    }
    if let Some(paths) = read_valid_persisted_paths(last_known_good) {
        return BootstrapLoad {
            paths,
            notice: Some(RuntimeNoticeCode::AppPathsFallbackLastKnownGood),
        };
    }
    BootstrapLoad {
        paths: AppPaths::for_root(default_app_root, Path::new("")),
        notice: (main.exists() || last_known_good.exists())
            .then_some(RuntimeNoticeCode::AppPathsFallbackUserDefault),
    }
}

fn read_valid_persisted_paths(path: &Path) -> Option<AppPaths> {
    let content = fs::read_to_string(path).ok()?;
    let paths: AppPaths = serde_json::from_str(&content).ok()?;
    let derived = AppPaths::for_root(&normalize_lexical(&paths.app_root), &paths.source_root);
    if paths != derived || validate_controlled_roots(&paths).is_err() {
        return None;
    }
    Some(paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn r009_data_root_ignores_legacy_source_and_derives_controlled_paths() {
        let root = std::env::temp_dir().join(format!(
            "r009-synthetic-data-root-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let legacy = AppPaths::for_root(&root, &root.join("old-source"));
        assert!(validate_controlled_roots(&legacy).is_ok());
        let changed = derive_user_paths(&root.join("new"), &legacy.source_root);
        assert_eq!(changed.records_root, root.join("new/records"));
        assert_eq!(changed.typing_records_root, root.join("new/typing_records"));
        assert_eq!(changed.trash_root, root.join("new/trash"));
        assert_eq!(changed.recovery_root(), root.join("new/data/recovery"));
        assert_eq!(
            changed.database_path(),
            root.join("new/data/answer_collection.sqlite3")
        );
        assert_eq!(changed.source_root, legacy.source_root);
        assert!(!root.join("new/records").exists());
        fs::create_dir_all(&legacy.records_root).expect("old records");
        fs::write(legacy.records_root.join("synthetic.txt"), b"old data").expect("old record");
        crate::ensure_data_dirs_for_paths(&changed).expect("new data root");
        assert_eq!(
            fs::read(legacy.records_root.join("synthetic.txt")).expect("old data retained"),
            b"old data"
        );
        assert!(!changed.records_root.join("synthetic.txt").exists());
        fs::remove_dir_all(root).expect("synthetic fixture cleanup");
    }

    #[test]
    fn r009_old_and_new_path_settings_deserialize() {
        let old = r#"{"app_root":"C:\\Synthetic\\Data","source_root":"C:\\Synthetic\\Source","records_root":"C:\\Synthetic\\Data\\records","typing_records_root":"C:\\Synthetic\\Data\\typing_records","trash_root":"C:\\Synthetic\\Data\\trash"}"#;
        let loaded: AppPaths = serde_json::from_str(old).expect("legacy settings");
        assert_eq!(loaded.source_root, Path::new(r"C:\Synthetic\Source"));
        let current = old.replace(",\"source_root\":\"C:\\\\Synthetic\\\\Source\"", "");
        let loaded_current: AppPaths = serde_json::from_str(&current).expect("current settings");
        assert!(loaded_current.source_root.as_os_str().is_empty());
    }

    #[test]
    fn r0086_public_path_errors_have_stable_codes() {
        let relative = AppPaths::for_root(Path::new("relative-app"), Path::new(""));
        assert_eq!(
            validate_controlled_roots(&relative),
            Err("APP_PATHS_ABSOLUTE_REQUIRED".to_string())
        );
        assert_eq!(
            save_app_paths(relative, false, PathBuf::new(), 0),
            Err("APP_PATHS_CONFIRMATION_REQUIRED".to_string())
        );
    }

    #[cfg(windows)]
    #[test]
    fn r0083_1_tracked_path_example_matches_persisted_app_paths_contract() {
        let raw = include_str!("../../../config/app-settings.example.json");
        let value: serde_json::Value = serde_json::from_str(raw).expect("valid example JSON");
        let paths: AppPaths =
            serde_json::from_value(value.clone()).expect("example must deserialize as AppPaths");
        let mut keys = value
            .as_object()
            .expect("example object")
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "app_root",
                "records_root",
                "trash_root",
                "typing_records_root",
            ]
        );
        assert_eq!(
            paths,
            AppPaths::for_root(&paths.app_root, &paths.source_root)
        );
        for root in [
            &paths.app_root,
            &paths.records_root,
            &paths.typing_records_root,
            &paths.trash_root,
        ] {
            assert!(
                root.to_string_lossy().starts_with("C:\\Synthetic\\"),
                "example paths must be synthetic"
            );
        }
        assert!(paths.source_root.as_os_str().is_empty());
    }

    #[test]
    fn stale_app_root_generation_is_rejected_before_a_mutation() {
        let mut state = RuntimeState {
            paths: AppPaths::for_root(Path::new(r"E:\temporary-root"), Path::new("")),
            default_app_root: PathBuf::from(r"E:\default-root"),
            config_dir: PathBuf::from(r"E:\synthetic-config"),
            generation: 7,
            fixture_mode: false,
            banner: None,
            startup_notice_code: None,
            startup_notice: None,
            #[cfg(debug_assertions)]
            r0063_scenario: None,
        };
        assert!(require_configuration_context(&state, Path::new(r"E:\temporary-root"), 7,).is_ok());
        assert!(
            require_configuration_context(&state, Path::new(r"E:\temporary-root"), 6,)
                .expect_err("stale generation")
                .starts_with("STALE_APP_CONFIGURATION")
        );
        assert!(
            require_configuration_context(&state, Path::new(r"E:\default-root"), 7,)
                .expect_err("wrong root")
                .starts_with("STALE_APP_CONFIGURATION")
        );
        let default_paths = AppPaths::for_root(Path::new(r"E:\default-root"), Path::new(""));
        replace_paths_for_context(
            &mut state,
            Path::new(r"E:\temporary-root"),
            7,
            default_paths,
        )
        .expect("root switch");
        assert_eq!(state.generation, 8);
        assert_eq!(state.paths.app_root, Path::new(r"E:\default-root"));
        assert!(
            require_configuration_context(&state, Path::new(r"E:\temporary-root"), 7,)
                .expect_err("old root is stale after switch")
                .starts_with("STALE_APP_CONFIGURATION")
        );
    }

    #[test]
    fn app_paths_reject_data_outside_application_root() {
        let root = std::env::temp_dir().join(format!("r006-paths-{}", std::process::id()));
        let source = root.join("source");
        fs::create_dir_all(&source).expect("source fixture");
        let mut paths = AppPaths::for_root(&root.join("app"), &source);
        paths.records_root = root.join("outside");
        let preview = validate_app_paths(&paths, false);
        assert!(!preview.ok);
        assert!(preview
            .errors
            .iter()
            .any(|error| error == "CONTROLLED_ROOT_INVALID"));
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn app_paths_accept_chinese_and_dotted_subdirectories() {
        let root = std::env::temp_dir().join(format!("r006-paths-unicode-{}", std::process::id()));
        let app = root.join("答案.目录");
        let source = root.join("只读资料");
        fs::create_dir_all(&source).expect("source fixture");
        let paths = AppPaths::for_root(&app, &source);
        assert!(validate_app_paths(&paths, true).ok);
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn app_paths_reject_overlapping_controlled_roots() {
        let root = std::env::temp_dir().join(format!("r006-paths-overlap-{}", std::process::id()));
        let source = root.join("source");
        fs::create_dir_all(&source).expect("source fixture");
        let mut paths = AppPaths::for_root(&root.join("app"), &source);
        paths.trash_root = paths.records_root.join("trash");
        assert!(validate_controlled_roots(&paths).is_err());
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn user_app_root_always_rederives_controlled_roots_and_keeps_source() {
        let current = AppPaths::for_root(Path::new(r"E:\old-root"), Path::new(r"E:\formal-source"));
        let derived = derive_user_paths(Path::new(r"E:\新目录.测试\"), &current.source_root);
        assert_eq!(derived.app_root, Path::new(r"E:\新目录.测试"));
        assert_eq!(derived.records_root, Path::new(r"E:\新目录.测试\records"));
        assert_eq!(derived.source_root, current.source_root);
    }

    #[test]
    fn windows_case_and_trailing_separator_do_not_break_containment() {
        assert!(path_is_within(
            Path::new(r"e:\DATA.Root\records\"),
            Path::new(r"E:\data.root")
        ));
    }

    #[test]
    fn invalid_persisted_settings_fall_back_to_last_known_good_with_notice() {
        let root = std::env::temp_dir().join(format!("r006-lkg-{}", std::process::id()));
        fs::create_dir_all(&root).expect("fixture root");
        let source = root.join("source");
        fs::create_dir_all(&source).expect("synthetic source root");
        let main = root.join("app-settings.local.json");
        let lkg = root.join("app-settings.last-known-good.json");
        fs::write(&main, b"{broken").expect("invalid main");
        let good = AppPaths::for_root(&root.join("app"), &source);
        fs::write(&lkg, serde_json::to_vec(&good).expect("serialize LKG")).expect("write LKG");

        let loaded = load_path_config_from(&main, &lkg, &root.join("default"));
        assert_eq!(loaded.paths, good);
        assert_eq!(
            loaded.notice,
            Some(RuntimeNoticeCode::AppPathsFallbackLastKnownGood)
        );
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn failed_atomic_settings_write_preserves_old_bytes() {
        let root = std::env::temp_dir().join(format!("r006-atomic-{}", std::process::id()));
        fs::create_dir_all(&root).expect("fixture root");
        let main = root.join("app-settings.local.json");
        fs::write(&main, b"old-valid-settings").expect("old settings");
        let attempted = persist_settings_with(&main, "new-settings", |_path, _content| {
            Err("simulated atomic replace failure".to_string())
        });
        assert!(attempted.is_err());
        assert_eq!(
            fs::read(&main).expect("settings remain readable"),
            b"old-valid-settings"
        );
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn fixture_environment_path_is_process_only() {
        let root = std::env::temp_dir().join(format!("r006-fixture-env-{}", std::process::id()));
        let settings = root.join("app-settings.local.json");
        fs::create_dir_all(&root).expect("fixture root");
        let before = b"normal settings";
        fs::File::create(&settings)
            .and_then(|mut file| file.write_all(before))
            .expect("normal settings baseline");
        let state = fixture_runtime_state(root.join("runtime-fixture"));
        assert!(state.fixture_mode);
        assert_eq!(fs::read(&settings).expect("settings unchanged"), before);
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn r0063_fixture_requires_matching_marker_and_never_falls_back_to_normal_roots() {
        let root =
            std::env::temp_dir().join(format!("r0063-fixture-marker-{}", std::process::id()));
        fs::create_dir_all(root.join("source")).expect("fixture source");
        fs::create_dir_all(root.join("app")).expect("fixture app root");
        fs::write(
            root.join(".r0063-fixture-root.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "fixture_id": "R006.3",
                "root": root
            }))
            .expect("fixture marker json"),
        )
        .expect("fixture marker");

        let valid =
            r0063_fixture_runtime_state_with_scenario(root.clone(), "typing-retry".to_string());
        assert!(valid.fixture_mode);
        assert_eq!(valid.paths.app_root, normalize_lexical(&root).join("app"));
        assert_eq!(
            valid.paths.source_root,
            normalize_lexical(&root).join("source")
        );
        assert!(valid
            .banner
            .as_deref()
            .unwrap_or_default()
            .contains("typing-retry"));
        assert!(valid.startup_notice.is_none());

        let invalid =
            r0063_fixture_runtime_state_with_scenario(root.clone(), "not-allowed".to_string());
        assert!(invalid.fixture_mode);
        assert_eq!(invalid.paths.app_root, normalize_lexical(&root).join("app"));
        assert_eq!(
            invalid.paths.source_root,
            normalize_lexical(&root).join("app")
        );
        assert_ne!(invalid.paths.app_root, root);
        assert!(invalid.startup_notice.is_some());
        assert!(validate_controlled_roots(&invalid.paths).is_ok());
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn r0083_unconfigured_source_does_not_block_local_data_roots() {
        let app_root = std::env::temp_dir().join(format!("r0083-no-source-{}", std::process::id()));
        let paths = AppPaths::for_root(&app_root, Path::new(""));
        assert!(validate_controlled_roots(&paths).is_ok());
        assert!(validate_app_paths(&paths, false).ok);
    }

    #[test]
    fn r0083_fresh_config_uses_injected_user_data_root_with_no_source() {
        let root = std::env::temp_dir().join(format!("r0083-fresh-{}", std::process::id()));
        let loaded = load_path_config_from(
            &root.join("missing-main"),
            &root.join("missing-lkg"),
            &root.join("user-data"),
        );
        assert_eq!(loaded.paths.app_root, root.join("user-data"));
        assert!(loaded.paths.source_root.as_os_str().is_empty());
        assert!(validate_controlled_roots(&loaded.paths).is_ok());
    }
}
