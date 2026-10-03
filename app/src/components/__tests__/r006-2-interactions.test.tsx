import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalRecordSummary } from '../../lib/recordManager';
import { defaultShortcutBindings } from '../../lib/shortcutRegistry';
import { getAppSetting, listLocalRecords, saveAppSetting } from '../../lib/storage';
import { useAppStore } from '../../store/appStore';
import { createDynamicItem, createDynamicSession } from '../../lib/dynamicSession';
import { getItemTypePreset } from '../../lib/itemTypeRegistry';
import { GlobalShortcutController } from '../GlobalShortcutController';
import { ReviewPanel } from '../ReviewPanel';
import { RecordManager } from '../RecordManager';
import { ShortcutSettings } from '../ShortcutSettings';
import { TypingPractice } from '../TypingPractice';

vi.mock('../../lib/storage', () => ({
  appendEvent: vi.fn(async () => undefined),
  saveSessionSnapshot: vi.fn(async () => undefined),
  exportSessionTextAtomic: vi.fn(async () => undefined),
  exportSessionBundleAtomic: vi.fn(async () => undefined),
  exportTypingBundleAtomic: vi.fn(async () => undefined),
  writeRecordIndex: vi.fn(async () => undefined),
  openSessionExportDirectory: vi.fn(async () => undefined),
  openTypingExportDirectory: vi.fn(async () => undefined),
  getAppPaths: vi.fn(async () => ({ typing_records_root: 'E:\\synthetic\\typing_records' })),
  getAppSetting: vi.fn(async () => undefined),
  saveAppSetting: vi.fn(async () => undefined),
  listLocalRecords: vi.fn(async () => []),
  moveRecordsToTrash: vi.fn(async () => []),
  restoreTrashRecords: vi.fn(async () => []),
  permanentlyDeleteTrashRecords: vi.fn(async () => []),
  openRecordDirectory: vi.fn(async () => undefined),
  exportRecoveryRaw: vi.fn(async () => 'synthetic-export.json')
}));

const pkg = { package_id: 'Synthetic.01.A.1' };
function startCurrentSessionForTest() {
 const state=useAppStore.getState();
 const section=state.selectedSections[0];
 const session=createDynamicSession({session_id: 'synthetic-interactions', package_id: pkg.package_id, mode: state.mode, selected_sections:[section]});
 useAppStore.setState({session: createDynamicItem(session,section,getItemTypePreset(section,section==='Writing' ? 'writing_build_sentence' : 'reading_single_choice')).session});
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn()
  });
  useAppStore.setState({
    trainingName: pkg.package_id, selectedSections: ['Reading'], mode: 'practice',
    session: undefined, events: [], eventSeq: 0, timer: undefined, activeMs: 0, pausedMs: 0,
    questionActiveMs: 0, scopeActiveMs: 0,
    isPaused: false, navigationLockedUntil: 0,
    windowClosePhase: 'IDLE', sessionNotice: undefined, saveStatus: 'idle',
    exportStatus: 'idle', exportError: undefined, exportDirectory: undefined,
    shortcutBindings: defaultShortcutBindings()
  });
});

afterEach(cleanup);

describe('R006.2.1 removed Review shortcut', () => {
  it('leaves Alt+R unbound while preserving the visible answer card and Session state', () => {
    startCurrentSessionForTest();
    const before = structuredClone(useAppStore.getState().session);
    render(<><GlobalShortcutController homePage="home" /><ReviewPanel /></>);
    const current = screen.getByRole('button', { current: true });
    fireEvent.keyDown(window, { key: 'r', altKey: true });
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(current).not.toHaveFocus();
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(useAppStore.getState().session).toEqual(before);
  });

  it('does not show a Review action in shortcut settings', () => {
    render(<ShortcutSettings />);
    expect(screen.queryByText('open_review')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('打开答题卡 快捷键')).not.toBeInTheDocument();
  });

  it('drops legacy open_review while preserving F1 and saves only current actions', async () => {
    vi.mocked(getAppSetting).mockResolvedValueOnce({ open_review: 'Alt+R', toggle_pause: 'F1' });
    await act(async () => { await useAppStore.getState().initialize(); });
    const migrated = useAppStore.getState().shortcutBindings as unknown as Record<string, string>;
    expect(migrated.toggle_pause).toBe('F1');
    expect(migrated).not.toHaveProperty('open_review');
    await act(async () => { await useAppStore.getState().saveShortcutBindings(useAppStore.getState().shortcutBindings); });
    expect(saveAppSetting).toHaveBeenCalledWith('shortcuts', expect.not.objectContaining({ open_review: expect.anything() }));
  });
});

describe('R006.2 Typing pause shortcut', () => {
  it('uses the configured toggle_pause action while the Typing textarea has focus', () => {
    useAppStore.setState({
      shortcutBindings: { ...defaultShortcutBindings(), toggle_pause: 'F1' }
    });
    render(<><GlobalShortcutController homePage="home" /><TypingPractice /></>);
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    const editor = screen.getByRole('textbox', { name: '单词盲打输入区' });
    editor.focus();
    fireEvent.keyDown(editor, { key: 'F8' });
    expect(screen.getByText('进行中')).toBeVisible();
    fireEvent.keyDown(editor, { key: 'F1' });
    expect(screen.getByText('已暂停')).toBeVisible();
    fireEvent.keyDown(window, { key: 'F1' });
    expect(screen.getByText('进行中')).toBeVisible();
  });
});

function record(index: number): LocalRecordSummary {
  const sessionId = `synthetic-${String(index).padStart(2, '0')}`;
  return {
    record_id: `TOEFL:${sessionId}`,
    record_type: 'TOEFL',
    session_id: sessionId,
    package_id: 'Synthetic.R0062',
    created_at: `2026-01-${String(index).padStart(2, '0')}T12:00:00.000Z`,
    mode: 'practice',
    profile_id: 'synthetic',
    selected_sections: ['Reading'],
    active_time_ms: 1_000,
    pause_time_ms: 0,
    completion_status: 'COMPLETED',
    export_status: 'EXPORTED',
    schema_version: 'practice-session-v6',
    app_version: 'R006.2-fixture',
    directory_size_bytes: 128,
    relative_path: `records/Synthetic.R0062/${sessionId}`,
    file_names: ['fixture-summary.txt']
  };
}

describe('R006.2 Record Manager pagination UI', () => {
  it('shows 21 records as three pages and clears hidden selections on page change', async () => {
    vi.mocked(listLocalRecords).mockResolvedValueOnce(
      Array.from({ length: 21 }, (_, index) => record(index + 1))
    );
    render(<RecordManager />);
    await screen.findByText('第 1 / 3 页');
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(screen.getByText('已选 1 项')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(screen.getByText('已选 0 项')).toBeVisible());
    expect(screen.getByRole('button', { name: '批量移至 Trash' })).toBeDisabled();
    expect(screen.getByText('第 2 / 3 页')).toBeVisible();
  });
});
