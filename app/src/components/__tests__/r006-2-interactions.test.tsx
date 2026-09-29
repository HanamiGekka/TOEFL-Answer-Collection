import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackageSummary } from '../../types';
import type { LocalRecordSummary } from '../../lib/recordManager';
import { defaultShortcutBindings } from '../../lib/shortcutRegistry';
import { getAppSetting, listLocalRecords, saveAppSetting } from '../../lib/storage';
import { enterTask } from '../../lib/taskRuntime';
import { useAppStore } from '../../store/appStore';
import { startLegacySessionForTest } from '../../test/legacySession';
import { AnswerPanel } from '../AnswerPanel';
import { GlobalShortcutController } from '../GlobalShortcutController';
import { ReviewPanel } from '../ReviewPanel';
import { RecordManager } from '../RecordManager';
import { ShortcutSettings } from '../ShortcutSettings';
import { TypingPractice } from '../TypingPractice';

vi.mock('../../lib/storage', () => ({
  scanPackages: vi.fn(async () => []),
  appendEvent: vi.fn(async () => undefined),
  saveSessionSnapshot: vi.fn(async () => undefined),
  exportSessionTextAtomic: vi.fn(async () => undefined),
  exportSessionBundleAtomic: vi.fn(async () => undefined),
  exportTypingBundleAtomic: vi.fn(async () => undefined),
  writeRecordIndex: vi.fn(async () => undefined),
  openSessionExportDirectory: vi.fn(async () => undefined),
  openTypingExportDirectory: vi.fn(async () => undefined),
  getAppPaths: vi.fn(async () => ({ typing_records_root: 'E:\\synthetic\\typing_records' })),
  loadBlueprintOverride: vi.fn(async () => undefined),
  getAppSetting: vi.fn(async () => undefined),
  saveAppSetting: vi.fn(async () => undefined),
  listLocalRecords: vi.fn(async () => []),
  moveRecordsToTrash: vi.fn(async () => []),
  restoreTrashRecords: vi.fn(async () => []),
  permanentlyDeleteTrashRecords: vi.fn(async () => []),
  openRecordDirectory: vi.fn(async () => undefined),
  exportRecoveryRaw: vi.fn(async () => 'synthetic-export.json')
}));

const pkg: PackageSummary = { package_id: 'Synthetic.01.A.1', source_path: 'readonly-fixture', modules: [] };

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn()
  });
  useAppStore.setState({
    packages: [pkg], selectedPackage: pkg, selectedSections: ['Reading'], mode: 'practice',
    session: undefined, events: [], eventSeq: 0, timer: undefined, activeMs: 0, pausedMs: 0,
    questionActiveMs: 0, scopeActiveMs: 0, taskActiveMs: 0, taskRemainingMs: null,
    speakingTransitionPending: false, isPaused: false, navigationLockedUntil: 0,
    windowClosePhase: 'IDLE', sessionNotice: undefined, saveStatus: 'idle',
    exportStatus: 'idle', exportError: undefined, exportDirectory: undefined,
    shortcutBindings: defaultShortcutBindings()
  });
});

afterEach(cleanup);

describe('R006.2.1 removed Review shortcut', () => {
  it('leaves Alt+R unbound while preserving the visible answer card and Session state', () => {
    startLegacySessionForTest();
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

describe('R006.2 Writing input policy UI', () => {
  it('sanitizes mixed Build a Sentence input and shows a non-blocking notice', () => {
    useAppStore.setState({ selectedSections: ['Writing'] });
    startLegacySessionForTest();
    render(<AnswerPanel />);
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: 'Build 中文🙂 sentence.' } });
    expect(editor).toHaveValue('Build  sentence.');
    expect(screen.getByText('Writing 仅保留英文与常用英文标点。')).toBeVisible();
  });

  it('does not commit IME text until composition ends, then removes the illegal commit', () => {
    useAppStore.setState({ selectedSections: ['Writing'] });
    startLegacySessionForTest();
    const session = useAppStore.getState().session;
    if (!session) throw new Error('missing session');
    useAppStore.setState({ session: enterTask(session, 'WRITING_EMAIL') });
    render(<AnswerPanel />);
    const editor = screen.getByRole('textbox', { name: /Email 写作输入区/ });
    fireEvent.compositionStart(editor);
    fireEvent.change(editor, { target: { value: '中文' } });
    expect(useAppStore.getState().session?.tasks.find((task) => task.task_id === 'WRITING_EMAIL')?.text).toBe('');
    fireEvent.compositionEnd(editor, { data: '中文' });
    expect(editor).toHaveValue('');
    expect(screen.getByText('Writing 仅保留英文与常用英文标点。')).toBeVisible();
  });

  it('keeps allowed paste text, removes CJK/emoji and preserves a usable caret', () => {
    useAppStore.setState({ selectedSections: ['Writing'] });
    startLegacySessionForTest();
    const session = useAppStore.getState().session;
    if (!session) throw new Error('missing session');
    useAppStore.setState({ session: enterTask(session, 'WRITING_ACADEMIC_DISCUSSION') });
    render(<AnswerPanel />);
    const editor = screen.getByRole('textbox', { name: /Academic Discussion 写作输入区/ }) as HTMLTextAreaElement;
    fireEvent.paste(editor, { clipboardData: { getData: () => 'Keep中文🙂 this.' } });
    expect(editor).toHaveValue('Keep this.');
    expect(editor.selectionStart).toBe(10);
  });

  it('sanitizes drop and direct Store mutation paths', () => {
    useAppStore.setState({ selectedSections: ['Writing'] });
    startLegacySessionForTest();
    const session = useAppStore.getState().session;
    if (!session) throw new Error('missing session');
    useAppStore.getState().answerCurrent('Direct中文🙂 answer');
    expect(useAppStore.getState().session?.answers['Writing-1']?.answer_value).toBe('Direct answer');
    useAppStore.setState({ session: enterTask(useAppStore.getState().session ?? session, 'WRITING_EMAIL') });
    useAppStore.getState().updateWritingText('Store中文🙂 text', 'insertText');
    expect(useAppStore.getState().session?.tasks.find((task) => task.task_id === 'WRITING_EMAIL')?.text).toBe('Store text');
    render(<AnswerPanel />);
    const editor = screen.getByRole('textbox', { name: /Email 写作输入区/ }) as HTMLTextAreaElement;
    editor.setSelectionRange(editor.value.length, editor.value.length);
    fireEvent.drop(editor, { dataTransfer: { getData: () => ' Drop中文🙂.' } });
    expect(editor).toHaveValue('Store text Drop.');
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
    schema_version: 'practice-session-v5',
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
