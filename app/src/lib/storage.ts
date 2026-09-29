import { invoke } from '@tauri-apps/api/core';
import type { EventLogEntry, PackageSummary, PracticeSession } from '../types';
import { BROWSER_PREVIEW_APP_ROOT } from '../constants';
import { serializeEventForPersistence, serializeSessionForPersistence, toPersistedMilliseconds } from './persistedTime';
import type { LocalRecordSummary, RecordActionResult } from './recordManager';
import type { BlueprintOverride } from './blueprint';

export interface AppPaths {
  app_root: string;
  source_root: string;
  records_root: string;
  typing_records_root: string;
  trash_root: string;
}

export interface AppPathsPreview {
  ok: boolean;
  paths: AppPaths;
  creates: string[];
  warnings: string[];
  errors: string[];
  migrates_existing_data: boolean;
  writable: boolean;
  inside_app_root: boolean;
  source_status: 'UNCONFIGURED' | 'VALID' | 'INVALID';
  source_package_count: number;
}

export interface RuntimeMode {
  fixture_mode: boolean;
  banner?: string;
  startup_notice_code?: RuntimeNoticeCode;
  startup_notice?: string;
}

export type RuntimeNoticeCode =
  | 'APP_ROOT_DEFAULT_CHANGED_WITH_LEGACY_DATA'
  | 'APP_PATHS_FALLBACK_LAST_KNOWN_GOOD'
  | 'LEGACY_PATH_SETTINGS_LOADED_READ_ONLY'
  | 'APP_PATHS_FALLBACK_USER_DEFAULT';

export interface AppConfigurationContext {
  app_root: string;
  generation: number;
}

export interface RecordReference {
  record_id: string;
  record_type: LocalRecordSummary['record_type'];
  session_id: string;
  relative_path: string;
}

export interface SessionExportFilePayload {
  name: string;
  content: string;
}

export type PersistenceReason = 'RUNTIME' | 'AUTOSAVE' | 'WINDOW_CLOSE';

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let appConfigurationMutationTail: Promise<void> = Promise.resolve();
let pendingAppConfigurationMutations = 0;

function enqueueAppConfigurationMutation<T>(mutation: () => Promise<T>): Promise<T> {
  pendingAppConfigurationMutations += 1;
  const result = appConfigurationMutationTail
    .catch(() => undefined)
    .then(mutation);
  appConfigurationMutationTail = result.then(
    () => { pendingAppConfigurationMutations -= 1; },
    () => { pendingAppConfigurationMutations -= 1; }
  );
  return result;
}

export function hasPendingAppConfigurationMutations(): boolean {
  return pendingAppConfigurationMutations > 0;
}

export async function flushAppConfigurationMutations(): Promise<void> {
  await appConfigurationMutationTail;
}

export async function ensureDataDirs(): Promise<void> {
  if (inTauri()) await invoke('ensure_data_dirs');
}

export async function initDatabase(): Promise<void> {
  if (inTauri()) await invoke('init_database');
}

export async function scanPackages(): Promise<PackageSummary[]> {
  if (inTauri()) {
    return invoke<PackageSummary[]>('scan_packages');
  }
  return [];
}

export async function saveSessionSnapshot(
  session: PracticeSession,
  reason: PersistenceReason = 'RUNTIME'
): Promise<void> {
  const persisted = serializeSessionForPersistence(session);
  if (inTauri()) {
    await invoke('save_session_snapshot', { session: persisted, reason });
  } else {
    localStorage.setItem(`session:${persisted.session_id}`, JSON.stringify(persisted));
  }
}

export async function appendEvent(entry: EventLogEntry): Promise<void> {
  const persisted = serializeEventForPersistence(entry);
  if (inTauri()) {
    await invoke('append_event', { entry: persisted });
  }
}

export async function exportTextAtomic(relativePath: string, content: string): Promise<void> {
  if (inTauri()) {
    await invoke('export_text_atomic', { relativePath, content });
  }
}

export async function exportSessionTextAtomic(relativePath: string, content: string): Promise<void> {
  if (inTauri()) {
    await invoke('export_session_text_atomic', { relativePath, content });
  }
}

export async function exportSessionBundleAtomic(
  relativeDirectory: string,
  files: SessionExportFilePayload[],
  index: LocalRecordSummary
): Promise<void> {
  if (inTauri()) {
    await invoke('export_session_bundle_atomic', { relativeDirectory, files, index });
    return;
  }
  for (const file of files) {
    await exportSessionTextAtomic(`${relativeDirectory}/${file.name}`, file.content);
  }
  await writeRecordIndex(index);
}

export async function exportTypingBundleAtomic(
  relativeDirectory: string,
  files: SessionExportFilePayload[],
  index: LocalRecordSummary
): Promise<void> {
  if (inTauri()) {
    await invoke('export_typing_bundle_atomic', { relativeDirectory, files, index });
    return;
  }
  for (const file of files) {
    await exportTextAtomic(`${relativeDirectory}/${file.name}`, file.content);
  }
  await writeRecordIndex(index);
}

export async function openSessionExportDirectory(relativePath: string): Promise<void> {
  if (inTauri()) {
    await invoke('open_session_export_directory', { relativePath });
  }
}

export async function openTypingExportDirectory(relativePath: string): Promise<void> {
  if (inTauri()) {
    await invoke('open_typing_export_directory', { relativePath });
  }
}

export async function listLocalRecords(): Promise<LocalRecordSummary[]> {
  return inTauri() ? invoke<LocalRecordSummary[]>('list_local_records') : [];
}

export async function openRecordDirectory(record: RecordReference): Promise<void> {
  if (inTauri()) await invoke('open_record_directory', { record });
}

export async function moveRecordsToTrash(
  records: RecordReference[],
  activeSessionId?: string
): Promise<RecordActionResult[]> {
  if (!inTauri()) return records.map((record) => ({ record_id: record.record_id, ok: false, error: 'Tauri required' }));
  return invoke<RecordActionResult[]>('move_records_to_trash', { records, activeSessionId });
}

export async function restoreTrashRecords(records: RecordReference[]): Promise<RecordActionResult[]> {
  if (!inTauri()) return records.map((record) => ({ record_id: record.record_id, ok: false, error: 'Tauri required' }));
  return invoke<RecordActionResult[]>('restore_trash_records', { records });
}

export async function permanentlyDeleteTrashRecords(
  records: RecordReference[],
  confirmed: boolean
): Promise<RecordActionResult[]> {
  if (!inTauri()) return records.map((record) => ({ record_id: record.record_id, ok: false, error: 'Tauri required' }));
  return invoke<RecordActionResult[]>('permanently_delete_trash_records', { records, confirmed });
}

export async function cleanupTerminalRecovery(
  sessionId: string,
  recordRelativePath: string,
  activeSessionId?: string
): Promise<number> {
  if (!inTauri()) throw new Error('Tauri is required to clean terminal recovery artifacts.');
  return invoke<number>('cleanup_terminal_recovery', {
    sessionId,
    recordRelativePath,
    activeSessionId
  });
}

export async function loadRecoverySnapshot(sessionId: string): Promise<string> {
  if (!inTauri()) return localStorage.getItem(`session:${sessionId}`) ?? '';
  return invoke<string>('load_recovery_snapshot', { sessionId });
}

export async function getRecoveryEventSeq(sessionId: string): Promise<number> {
  if (!inTauri()) return 0;
  return invoke<number>('get_recovery_event_seq', { sessionId });
}

export async function loadRecoveryEvents(sessionId: string): Promise<EventLogEntry[]> {
  if (!inTauri()) return [];
  return invoke<EventLogEntry[]>('load_recovery_events', { sessionId });
}

export async function exportRecoveryRaw(sessionId: string): Promise<string> {
  if (!inTauri()) throw new Error('Tauri is required to export a raw recovery snapshot.');
  return invoke<string>('export_recovery_raw', { sessionId });
}

export async function writeRecordIndex(index: LocalRecordSummary): Promise<void> {
  const persistedIndex = {
    ...index,
    active_time_ms: toPersistedMilliseconds(index.active_time_ms, 'record_index.active_time_ms'),
    pause_time_ms: toPersistedMilliseconds(index.pause_time_ms, 'record_index.pause_time_ms')
  };
  if (inTauri()) await invoke('write_record_index', { index: persistedIndex });
}

export async function getAppPaths(): Promise<AppPaths> {
  if (inTauri()) return invoke<AppPaths>('get_app_paths');
  return {
    app_root: BROWSER_PREVIEW_APP_ROOT,
    source_root: '',
    records_root: `${BROWSER_PREVIEW_APP_ROOT}\\records`,
    typing_records_root: `${BROWSER_PREVIEW_APP_ROOT}\\typing_records`,
    trash_root: `${BROWSER_PREVIEW_APP_ROOT}\\trash`
  };
}

export async function getDefaultAppRoot(): Promise<string> {
  if (inTauri()) return invoke<string>('get_default_app_root');
  return BROWSER_PREVIEW_APP_ROOT;
}

export async function getAppConfigurationContext(): Promise<AppConfigurationContext> {
  if (inTauri()) return invoke<AppConfigurationContext>('get_app_configuration_context');
  return { app_root: BROWSER_PREVIEW_APP_ROOT, generation: 0 };
}

export async function selectAppRootDirectory(defaultPath: string, title: string): Promise<string | null> {
  if (!inTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath,
    title
  });
  return typeof selected === 'string' ? selected : null;
}

export async function selectSourceRootDirectory(defaultPath: string, title: string): Promise<string | null> {
  if (!inTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    directory: true,
    multiple: false,
    ...(defaultPath ? { defaultPath } : {}),
    title
  });
  return typeof selected === 'string' ? selected : null;
}

export async function getRuntimeMode(): Promise<RuntimeMode> {
  if (!inTauri()) return { fixture_mode: false };
  return invoke<RuntimeMode>('get_runtime_mode');
}

export async function previewAppPaths(paths: AppPaths): Promise<AppPathsPreview> {
  if (inTauri()) return invoke<AppPathsPreview>('preview_app_paths', { paths });
  return {
    ok: true,
    paths,
    creates: [],
    warnings: [],
    errors: [],
    migrates_existing_data: false,
    writable: true,
    inside_app_root: true,
    source_status: paths.source_root ? 'VALID' : 'UNCONFIGURED',
    source_package_count: 0
  };
}

export async function saveAppPaths(paths: AppPaths, confirmed: boolean): Promise<AppPaths> {
  if (inTauri()) {
    return enqueueAppConfigurationMutation(async () => {
      const context = await getAppConfigurationContext();
      return invoke<AppPaths>('save_app_paths', {
        paths,
        confirmed,
        expectedAppRoot: context.app_root,
        expectedGeneration: context.generation
      });
    });
  }
  if (!confirmed) throw new Error('Path changes require confirmation.');
  return paths;
}

export async function getAppSetting<T>(key: string): Promise<T | undefined> {
  if (inTauri()) return (await invoke<T | null>('get_app_setting', { key })) ?? undefined;
  const raw = localStorage.getItem(`app-setting:${key}`);
  return raw ? JSON.parse(raw) as T : undefined;
}

export async function saveAppSetting(key: string, value: unknown): Promise<void> {
  if (inTauri()) {
    await enqueueAppConfigurationMutation(async () => {
      const context = await getAppConfigurationContext();
      await invoke('save_app_setting', {
        key,
        value,
        expectedAppRoot: context.app_root,
        expectedGeneration: context.generation
      });
    });
  }
  else localStorage.setItem(`app-setting:${key}`, JSON.stringify(value));
}

export async function loadBlueprintOverride(packageId: string): Promise<BlueprintOverride | undefined> {
  if (!inTauri()) return undefined;
  return (await invoke<BlueprintOverride | null>('load_blueprint_override', { packageId })) ?? undefined;
}

/** @deprecated Use a root-specific open function. */
export const openExportDirectory = openSessionExportDirectory;
