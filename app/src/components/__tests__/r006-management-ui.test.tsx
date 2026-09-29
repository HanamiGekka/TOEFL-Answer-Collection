import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultShortcutBindings } from '../../lib/shortcutRegistry';
import {
  moveRecordsToTrash,
  previewAppPaths,
  saveAppPaths,
  saveAppSetting
} from '../../lib/storage';
import { useAppStore } from '../../store/appStore';
import { PathSettings } from '../PathSettings';
import { RecordManager } from '../RecordManager';
import { RecoveryPanel } from '../RecoveryPanel';
import { ShortcutSettings } from '../ShortcutSettings';

const paths = {
  app_root: 'E:\\Answer_Collection', source_root: 'E:\\TOEFL_Source',
  records_root: 'E:\\Answer_Collection\\records',
  typing_records_root: 'E:\\Answer_Collection\\typing_records',
  trash_root: 'E:\\Answer_Collection\\trash'
};

vi.mock('../../lib/storage', () => ({
  scanPackages: vi.fn(async () => []), appendEvent: vi.fn(async () => undefined),
  saveSessionSnapshot: vi.fn(async () => undefined), exportSessionTextAtomic: vi.fn(async () => undefined),
  writeRecordIndex: vi.fn(async () => undefined), openSessionExportDirectory: vi.fn(async () => undefined),
  getAppSetting: vi.fn(async () => undefined), saveAppSetting: vi.fn(async () => undefined),
  loadBlueprintOverride: vi.fn(async () => undefined),
  listLocalRecords: vi.fn(async () => [
    {
      record_id: 'TOEFL:session-1', record_type: 'TOEFL', session_id: 'session-1', package_id: 'Mock.01.A.1',
      created_at: '2026-07-13T00:00:00Z', mode: 'practice', profile_id: 'profile', selected_sections: ['Reading'],
      active_time_ms: 1000, pause_time_ms: 0, completion_status: 'COMPLETED', export_status: 'EXPORTED',
      schema_version: 'practice-session-v5', app_version: '1.0-dev', directory_size_bytes: 12,
      relative_path: 'records/Mock.01.A.1/session-1', file_names: ['answers.json']
    },
    {
      record_id: 'RECOVERY:recovery-session', record_type: 'RECOVERY', session_id: 'recovery-session', package_id: 'Mock.01.A.1',
      created_at: '2026-07-17T01:11:07.244Z', mode: 'practice', profile_id: 'profile', selected_sections: ['Writing'],
      active_time_ms: 3003, pause_time_ms: 0, completion_status: 'INCOMPLETE', export_status: 'RETRYABLE',
      schema_version: 'practice-session-v5', app_version: '1.0-dev', directory_size_bytes: 12,
      relative_path: 'data/recovery/recovery-session.json', file_names: ['recovery-session.json']
    },
    {
      record_id: 'TOEFL:stale-terminal', record_type: 'TOEFL', session_id: 'stale-terminal', package_id: 'Mock.01.A.1',
      created_at: '2026-07-18T01:11:07.244Z', mode: 'practice', profile_id: 'profile', selected_sections: ['Reading'],
      active_time_ms: 4000, pause_time_ms: 100, completion_status: 'COMPLETED', export_status: 'EXPORTED',
      schema_version: 'practice-session-v5', app_version: '1.0-dev', directory_size_bytes: 20,
      relative_path: 'records/Mock.01.A.1/stale-terminal', file_names: ['answers.json'],
      recovery_classification: 'STALE_TERMINAL_RECOVERY', recovery_artifact_count: 2
    }
  ]),
  moveRecordsToTrash: vi.fn(async () => [{ record_id: 'TOEFL:session-1', ok: true }]),
  restoreTrashRecords: vi.fn(async () => []), permanentlyDeleteTrashRecords: vi.fn(async () => []),
  cleanupTerminalRecovery: vi.fn(async () => 2),
  openRecordDirectory: vi.fn(async () => undefined), exportRecoveryRaw: vi.fn(async () => ''),
  loadRecoverySnapshot: vi.fn(async () => ''), getRecoveryEventSeq: vi.fn(async () => 0),
  getAppPaths: vi.fn(async () => ({
    app_root: 'E:\\Answer_Collection', source_root: 'E:\\TOEFL_Source',
    records_root: 'E:\\Answer_Collection\\records', typing_records_root: 'E:\\Answer_Collection\\typing_records',
    trash_root: 'E:\\Answer_Collection\\trash'
  })),
  getDefaultAppRoot: vi.fn(async () => 'E:\\Answer_Collection'),
  previewAppPaths: vi.fn(async () => ({
    ok: true,
    paths: {
      app_root: 'E:\\Answer_Collection', source_root: 'E:\\TOEFL_Source',
      records_root: 'E:\\Answer_Collection\\records', typing_records_root: 'E:\\Answer_Collection\\typing_records',
      trash_root: 'E:\\Answer_Collection\\trash'
    },
    creates: [], warnings: ['No automatic migration.'], errors: [], migrates_existing_data: false
  })),
  saveAppPaths: vi.fn(async () => ({
    app_root: 'E:\\Answer_Collection', source_root: 'E:\\TOEFL_Source',
    records_root: 'E:\\Answer_Collection\\records', typing_records_root: 'E:\\Answer_Collection\\typing_records',
    trash_root: 'E:\\Answer_Collection\\trash'
  }))
}));

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ session: undefined, shortcutBindings: defaultShortcutBindings() });
});

describe('R006 management UI', () => {
  it('opens the Recovery panel when an incomplete local recovery exists', async () => {
    render(<RecoveryPanel />);
    expect(await screen.findByRole('heading', { name: '可恢复练习' })).toBeVisible();
    expect(screen.getByText('recovery-session')).toBeVisible();
    expect(screen.getByRole('button', { name: '继续练习' })).toBeEnabled();
  });

  it('requires two confirmations before moving a record to Trash', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<RecordManager />);
    const session = await screen.findByText('session-1');
    const card = session.closest('.record-card');
    if (!card) throw new Error('missing TOEFL record card');
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '移至 Trash' }));
    await waitFor(() => expect(moveRecordsToTrash).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('offers cleanup rather than Continue for a stale terminal recovery attachment', async () => {
    render(<RecordManager />);
    const session = await screen.findByText('stale-terminal');
    const card = session.closest('.record-card');
    if (!card) throw new Error('missing stale terminal record card');
    expect(within(card as HTMLElement).getByText('已存在完成且导出的正式记录，此恢复快照属于终态残留')).toBeVisible();
    expect(within(card as HTMLElement).getByRole('button', { name: '清理残留恢复快照' })).toBeEnabled();
    expect(within(card as HTMLElement).queryByRole('button', { name: '继续练习' })).not.toBeInTheDocument();
  });

  it('does not persist untouched default Record Manager filters on mount', async () => {
    render(<RecordManager />);
    await screen.findByText('session-1');
    expect(saveAppSetting).not.toHaveBeenCalledWith('record_filters', expect.anything());
  });

  it('persists a Record Manager filter after the user changes it', async () => {
    render(<RecordManager />);
    await screen.findByText('session-1');
    fireEvent.change(screen.getByLabelText('日期'), { target: { value: 'OLDEST' } });
    await waitFor(() => expect(saveAppSetting).toHaveBeenCalledWith(
      'record_filters',
      expect.objectContaining({ sort: 'OLDEST' })
    ));
  });

  it('captures, validates, saves and restores shortcut defaults', async () => {
    render(<ShortcutSettings />);
    const nextInput = screen.getByLabelText('下一题 快捷键');
    fireEvent.keyDown(nextInput, { key: 'n', altKey: true });
    expect((nextInput as HTMLInputElement).value).toBe('ALT+N');
    fireEvent.click(screen.getByRole('button', { name: '保存快捷键' }));
    await waitFor(() => expect(saveAppSetting).toHaveBeenCalledWith('shortcuts', expect.objectContaining({ next_question: 'ALT+N' })));
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));
    expect((nextInput as HTMLInputElement).value).toBe('Alt+ArrowRight');
  });

  it('previews writable paths, declares no migration, then confirms before saving', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PathSettings />);
    await screen.findByDisplayValue(paths.app_root);
    fireEvent.click(screen.getByRole('button', { name: '校验并预览' }));
    await screen.findByText('自动迁移旧数据：否');
    expect(previewAppPaths).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }));
    await waitFor(() => expect(saveAppPaths).toHaveBeenCalledWith(paths, true));
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
