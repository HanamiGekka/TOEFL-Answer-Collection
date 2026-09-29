import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackageSummary } from '../../types';
import { buildSessionExportBundle } from '../../lib/sessionExport';
import { upsertAnswer } from '../../lib/sessionEngine';
import { defaultShortcutBindings } from '../../lib/shortcutRegistry';
import { enterTask, getCurrentTask } from '../../lib/taskRuntime';
import { useAppStore } from '../../store/appStore';
import { startLegacySessionForTest } from '../../test/legacySession';
import { AnswerPanel } from '../AnswerPanel';

vi.mock('../../lib/storage', () => ({
  appendEvent: vi.fn(async () => undefined),
  saveSessionSnapshot: vi.fn(async () => undefined),
  exportSessionTextAtomic: vi.fn(async () => undefined),
  exportSessionBundleAtomic: vi.fn(async () => undefined),
  getAppPaths: vi.fn(async () => ({ app_root: 'E:\\synthetic' })),
  loadBlueprintOverride: vi.fn(async () => undefined)
}));

const pkg: PackageSummary = {
  package_id: 'Synthetic.01.A.1',
  source_path: 'readonly-fixture',
  modules: []
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useAppStore.setState({
    packages: [pkg], selectedPackage: pkg, selectedSections: ['Writing'], mode: 'practice',
    session: undefined, events: [], eventSeq: 0, timer: undefined, activeMs: 0, pausedMs: 0,
    questionActiveMs: 0, scopeActiveMs: 0, taskActiveMs: 0, taskRemainingMs: null,
    speakingTransitionPending: false, isPaused: false, navigationLockedUntil: 0,
    windowClosePhase: 'IDLE', sessionNotice: undefined, saveStatus: 'idle',
    exportStatus: 'idle', exportError: undefined, exportDirectory: undefined,
    shortcutBindings: defaultShortcutBindings()
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

function startWriting(taskId: 'WRITING_BUILD_SENTENCE' | 'WRITING_EMAIL' | 'WRITING_ACADEMIC_DISCUSSION') {
    startLegacySessionForTest();
  const session = useAppStore.getState().session;
  if (!session) throw new Error('missing Writing session');
  useAppStore.setState({ session: enterTask(session, taskId) });
}

describe.each([
  ['WRITING_EMAIL', /Email 写作输入区/],
  ['WRITING_ACADEMIC_DISCUSSION', /Academic Discussion 写作输入区/]
] as const)('R006.2.1 %s keyboard history', (taskId, editorName) => {
  it('routes Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z through the same Task history without inflating edit-source counters', () => {
    startWriting(taskId);
    render(<AnswerPanel />);
    const editor = screen.getByRole('textbox', { name: editorName });
    fireEvent.change(editor, { target: { value: 'one' } });
    fireEvent.change(editor, { target: { value: 'one two' } });
    const before = getCurrentTask(useAppStore.getState().session!);

    expect(fireEvent.keyDown(editor, { key: 'z', ctrlKey: true })).toBe(false);
    expect(editor).toHaveValue('one');
    expect(fireEvent.keyDown(editor, { key: 'y', ctrlKey: true })).toBe(false);
    expect(editor).toHaveValue('one two');
    expect(fireEvent.keyDown(editor, { key: 'z', ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(editor, { key: 'z', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(editor).toHaveValue('one two');

    expect(getCurrentTask(useAppStore.getState().session!)).toMatchObject({
      undo_count: 2,
      redo_count: 2,
      keyboard_inserted_characters: before?.keyboard_inserted_characters,
      pasted_characters: before?.pasted_characters,
      deleted_characters: before?.deleted_characters,
      cut_count: before?.cut_count,
      paste_count: before?.paste_count
    });
  });

  it('keeps toolbar buttons and keyboard shortcuts on the same Store history', () => {
    startWriting(taskId);
    render(<AnswerPanel />);
    const editor = screen.getByRole('textbox', { name: editorName });
    fireEvent.change(editor, { target: { value: 'one' } });
    fireEvent.change(editor, { target: { value: 'one two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(editor).toHaveValue('one');
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(editor).toHaveValue('one two');
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    expect(editor).toHaveValue('one');
    fireEvent.keyDown(editor, { key: 'y', ctrlKey: true });
    expect(editor).toHaveValue('one two');
  });
});

describe('R006.2.1 Build a Sentence per-question keyboard history', () => {
  it('keeps history isolated by Question ID and preserves it after navigating away and back', async () => {
    startWriting('WRITING_BUILD_SENTENCE');
    render(<AnswerPanel />);
    let editor = screen.getByRole('textbox', { name: /Build a Sentence 写作输入区/ });
    fireEvent.change(editor, { target: { value: 'First' } });
    fireEvent.change(editor, { target: { value: 'First two' } });
    expect(fireEvent.keyDown(editor, { key: 'z', ctrlKey: true })).toBe(false);
    expect(editor).toHaveValue('First');

    await act(async () => {
      useAppStore.getState().nextQuestion();
      await Promise.resolve();
    });
    editor = screen.getByRole('textbox', { name: /Build a Sentence 写作输入区/ });
    expect(editor).toHaveValue('');
    fireEvent.change(editor, { target: { value: 'Second' } });
    expect(fireEvent.keyDown(editor, { key: 'z', ctrlKey: true })).toBe(false);
    expect(editor).toHaveValue('');

    act(() => useAppStore.setState({ navigationLockedUntil: 0 }));
    await act(async () => {
      useAppStore.getState().previousQuestion();
      await Promise.resolve();
    });
    editor = screen.getByRole('textbox', { name: /Build a Sentence 写作输入区/ });
    expect(editor).toHaveValue('First');
    expect(fireEvent.keyDown(editor, { key: 'y', ctrlKey: true })).toBe(false);
    expect(editor).toHaveValue('First two');
    expect(useAppStore.getState().session?.answers['Writing-2']?.answer_value).toBe('');
  });

  it('clears redo after a new edit and never restores rejected text', () => {
    startWriting('WRITING_BUILD_SENTENCE');
    render(<AnswerPanel />);
    const editor = screen.getByRole('textbox', { name: /Build a Sentence 写作输入区/ });
    fireEvent.change(editor, { target: { value: 'Safe' } });
    fireEvent.change(editor, { target: { value: 'Safe中文🙂 text' } });
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    expect(editor).toHaveValue('Safe');
    fireEvent.change(editor, { target: { value: 'New valid' } });
    expect(fireEvent.keyDown(editor, { key: 'y', ctrlKey: true })).toBe(true);
    expect(editor).toHaveValue('New valid');
    expect(JSON.stringify(useAppStore.getState().session)).not.toMatch(/中文|🙂/u);
  });

  it('exports the current keyboard-history result without changing navigation or flags', () => {
    startWriting('WRITING_BUILD_SENTENCE');
    const sessionBefore = useAppStore.getState().session!;
    render(<AnswerPanel />);
    const editor = screen.getByRole('textbox', { name: /Build a Sentence 写作输入区/ });
    fireEvent.change(editor, { target: { value: 'Export first' } });
    fireEvent.change(editor, { target: { value: 'Export final' } });
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    const current = useAppStore.getState().session!;
    const bundle = buildSessionExportBundle(current, []);
    expect(bundle.files['answers.json']).toContain('Export first');
    expect(bundle.files['Writing.md']).toContain('Export first');
    expect(bundle.files['question_metrics.csv']).toContain('Writing-1');
    expect(current.current_question_id).toBe(sessionBefore.current_question_id);
    expect(current.answers['Writing-1']).toMatchObject({ is_skipped: false, is_uncertain: false });
  });

  it('initializes recovered rejected text safely and cannot undo back to the legacy value', () => {
    startWriting('WRITING_BUILD_SENTENCE');
    const session = useAppStore.getState().session!;
    const question = session.questions.find((item) => item.id === 'Writing-1')!;
    useAppStore.setState({ session: upsertAnswer(session, question, '历史中文🙂', 0) });
    render(<AnswerPanel />);
    const editor = screen.getByRole('textbox', { name: /Build a Sentence 写作输入区/ });
    expect(editor).toHaveValue('历史中文🙂');
    fireEvent.change(editor, { target: { value: '历史中文🙂Safe' } });
    expect(editor).toHaveValue('Safe');
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    expect(editor).toHaveValue('');
    expect(JSON.stringify(useAppStore.getState().session)).not.toMatch(/历史中文|🙂/u);
  });
});

describe('R006.2.1 local editor guard and composition behavior', () => {
  it('does not handle history during composition, pause, modal, close hold, repeat or AltGraph', () => {
    startWriting('WRITING_EMAIL');
    render(<AnswerPanel />);
    const editor = screen.getByRole('textbox', { name: /Email 写作输入区/ });
    fireEvent.change(editor, { target: { value: 'one' } });
    fireEvent.change(editor, { target: { value: 'one two' } });
    fireEvent.compositionStart(editor);
    expect(fireEvent.keyDown(editor, { key: 'z', ctrlKey: true, isComposing: true })).toBe(true);
    fireEvent.compositionEnd(editor, { data: '' });
    expect(fireEvent.keyDown(editor, { key: 'z', ctrlKey: true, repeat: true })).toBe(true);
    expect(fireEvent.keyDown(editor, { key: 'z', ctrlKey: true, altKey: true })).toBe(true);
    act(() => useAppStore.setState({ isPaused: true }));
    expect(fireEvent.keyDown(editor, { key: 'z', ctrlKey: true })).toBe(true);
    act(() => useAppStore.setState({ isPaused: false, windowClosePhase: 'SAVING' }));
    expect(fireEvent.keyDown(editor, { key: 'z', ctrlKey: true })).toBe(true);
    act(() => useAppStore.setState({ windowClosePhase: 'IDLE', sessionNotice: { kind: 'warning', message: 'modal fixture' } }));
    expect(fireEvent.keyDown(editor, { key: 'z', ctrlKey: true })).toBe(true);
    expect(editor).toHaveValue('one two');
  });

  it.each(['a', 'c', 'x', 'v'])('keeps Ctrl+%s native and does not consume it', (key) => {
    startWriting('WRITING_EMAIL');
    render(<AnswerPanel />);
    const editor = screen.getByRole('textbox', { name: /Email 写作输入区/ });
    expect(fireEvent.keyDown(editor, { key, ctrlKey: true })).toBe(true);
  });

  it('normalizes CRLF exactly and preserves a legal Latin composition commit', () => {
    startWriting('WRITING_EMAIL');
    render(<AnswerPanel />);
    const editor = screen.getByRole('textbox', { name: /Email 写作输入区/ });
    fireEvent.change(editor, { target: { value: 'First line.\r\nSecond line.' } });
    expect(editor).toHaveValue('First line.\nSecond line.');
    fireEvent.compositionStart(editor);
    fireEvent.change(editor, { target: { value: 'Café' } });
    fireEvent.compositionEnd(editor, { data: 'Café' });
    expect(editor).toHaveValue('Café');
  });
});
