import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackageSummary } from '../../types';
import { enterTask, updateWritingText } from '../../lib/taskRuntime';
import { useAppStore } from '../../store/appStore';
import { startLegacySessionForTest } from '../../test/legacySession';
import { AnswerPanel } from '../AnswerPanel';
import { BottomBar } from '../BottomBar';

vi.mock('../../lib/storage', () => ({
  scanPackages: vi.fn(async () => []), appendEvent: vi.fn(async () => undefined),
  saveSessionSnapshot: vi.fn(async () => undefined), exportSessionTextAtomic: vi.fn(async () => undefined),
  exportTextAtomic: vi.fn(async () => undefined), openSessionExportDirectory: vi.fn(async () => undefined),
  openTypingExportDirectory: vi.fn(async () => undefined)
}));

const pkg: PackageSummary = { package_id: 'Mock.01.A.1', source_path: 'readonly', modules: [] };

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    packages: [pkg], selectedPackage: pkg, mode: 'practice', selectedSections: ['Writing'],
    session: undefined, events: [], eventSeq: 0, timer: undefined, activeMs: 0, pausedMs: 0,
    questionActiveMs: 0, scopeActiveMs: 0, taskActiveMs: 0, taskRemainingMs: null,
    isPaused: false, navigationLockedUntil: 0, saveStatus: 'idle', exportStatus: 'idle', sessionNotice: undefined
  });
});

afterEach(cleanup);

function moveTo(taskId: string): void {
    startLegacySessionForTest();
  const session = useAppStore.getState().session;
  if (!session) throw new Error('missing session');
  useAppStore.setState({ session: enterTask(session, taskId) });
}

describe('R005.4 task UI', () => {
  it('renders a long Writing editor and all four edit tools with live statistics', () => {
    moveTo('WRITING_EMAIL');
    render(<AnswerPanel />);
    expect(screen.getByRole('textbox', { name: /Email 写作输入区/ })).toHaveAttribute('spellcheck', 'false');
    for (const name of ['Cut', 'Paste', 'Undo', 'Redo']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByText(/Word count/)).toBeInTheDocument();
    expect(screen.getByText(/Keyboard CPM/)).toBeInTheDocument();
  });

  it('keeps Writing focus while statistics refresh', () => {
    moveTo('WRITING_EMAIL');
    render(<AnswerPanel />);
    const editor = screen.getByRole('textbox', { name: /Email 写作输入区/ });
    editor.focus();
    fireEvent.change(editor, { target: { value: 'Focused text' } });
    expect(editor).toHaveFocus();
  });

  it('applies Cut/Paste buttons to the current selection and restores a reasonable caret', async () => {
    moveTo('WRITING_EMAIL');
    const current = useAppStore.getState().session;
    if (!current) throw new Error('missing session');
    useAppStore.setState({ session: updateWritingText(current, 'hello world', 'insertText') });
    const writeText = vi.fn(async () => undefined);
    const readText = vi.fn(async () => 'Hi');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, readText } });
    render(<AnswerPanel />);
    const editor = screen.getByRole('textbox', { name: /Email 写作输入区/ }) as HTMLTextAreaElement;
    editor.setSelectionRange(0, 5);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cut' })));
    expect(writeText).toHaveBeenCalledWith('hello');
    await waitFor(() => expect(editor).toHaveValue(' world'));
    expect(editor.selectionStart).toBe(0);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Paste' })));
    await waitFor(() => expect(editor).toHaveValue('Hi world'));
    expect(editor.selectionStart).toBe(2);
  });

  it('shows Clipboard API failures without exposing clipboard content', async () => {
    moveTo('WRITING_EMAIL');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn(async () => { throw new Error('permission denied'); }) }
    });
    render(<AnswerPanel />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Paste' })));
    expect(screen.getByRole('alert')).toHaveTextContent('permission denied');
  });

  it('keeps Practice Writing editable at overtime and freezes exam simulation', () => {
    moveTo('WRITING_EMAIL');
    let session = useAppStore.getState().session;
    if (!session) throw new Error('missing session');
    session = { ...session, tasks: session.tasks.map((task) => task.task_id === 'WRITING_EMAIL' ? { ...task, remaining_ms: 0, is_overtime: true } : task) };
    useAppStore.setState({ session, taskRemainingMs: 0 });
    const { unmount } = render(<AnswerPanel />);
    expect(screen.getByRole('textbox', { name: /Email 写作输入区/ })).toBeEnabled();
    unmount();
    useAppStore.setState({ session: { ...session, mode: 'exam_simulation' } });
    render(<AnswerPanel />);
    expect(screen.getByRole('textbox', { name: /Email 写作输入区/ })).toBeDisabled();
    expect(screen.getByText(/时间结束/)).toBeInTheDocument();
  });

  it('shows Listen and Repeat start gating and the local-profile disclaimer', () => {
    useAppStore.setState({ selectedSections: ['Speaking'] });
    startLegacySessionForTest();
    render(<AnswerPanel />);
    expect(screen.getByRole('button', { name: '开始 Listen and Repeat' })).toBeInTheDocument();
    expect(screen.getByText(/2:00.*本项目练习配置/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '标记完成' })).not.toBeInTheDocument();
  });

  it('shows Interview start, complete, retry and zero-preparation semantics', async () => {
    useAppStore.setState({ selectedSections: ['Speaking'] });
    moveTo('SI1');
    render(<AnswerPanel />);
    expect(screen.getByText(/无准备倒计时/)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始本题' })));
    expect(screen.getByRole('button', { name: '完成' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '需重练' })).toBeInTheDocument();
  });

  it('uses a task-specific BottomBar without generic skip or uncertainty actions in Speaking', () => {
    useAppStore.setState({ selectedSections: ['Speaking'] });
    startLegacySessionForTest();
    render(<BottomBar />);
    expect(screen.queryByRole('button', { name: '跳过' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '不确定' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument();
  });
});
