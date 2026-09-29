import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TypingSnapshot } from '../../types';
import { exportTypingRecord } from '../../lib/exporters';
import { getAppPaths, openTypingExportDirectory } from '../../lib/storage';
import { loadTypingDraft, saveTypingDraft } from '../../lib/typingDraft';
import { TypingStatsAccumulator } from '../../lib/typingStats';
import {
  beginWindowCloseParticipantHold,
  cancelWindowCloseParticipantHold
} from '../../lib/windowClose';
import { TypingPractice } from '../TypingPractice';

vi.mock('../../lib/exporters', () => ({
  exportTypingRecord: vi.fn(async () => 'typing_records/2026-07/typing-test')
}));

vi.mock('../../lib/storage', () => ({
  getAppPaths: vi.fn(async () => ({
    app_root: 'E:\\custom-app',
    source_root: 'E:\\source',
    records_root: 'E:\\custom-app\\records',
    typing_records_root: 'E:\\自定义 根\\typing.records',
    trash_root: 'E:\\custom-app\\trash'
  })),
  openTypingExportDirectory: vi.fn(async () => undefined)
}));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(exportTypingRecord).mockClear();
  vi.mocked(exportTypingRecord).mockResolvedValue('typing_records/2026-07/typing-test');
  vi.mocked(getAppPaths).mockClear();
  vi.mocked(openTypingExportDirectory).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

describe('typing practice UI', () => {
  it('holds active Typing time during close confirmation and resumes from a fresh cancel anchor', () => {
    vi.useFakeTimers();
    let monotonic = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => monotonic);
    render(<TypingPractice />);
    fireEvent.click(screen.getByRole('button', { name: '开始' }));

    monotonic = 11_000;
    act(() => vi.advanceTimersByTime(10_000));
    let preClose: ReturnType<typeof beginWindowCloseParticipantHold>;
    act(() => { preClose = beginWindowCloseParticipantHold(); });
    expect(preClose).toEqual({ kind: 'TYPING_ACTIVE' });

    monotonic = 26_000;
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByText('有效时间：00:10.0')).toBeInTheDocument();
    expect(screen.getByText('暂停时间：00:15.0')).toBeInTheDocument();

    act(() => cancelWindowCloseParticipantHold(preClose));
    monotonic = 31_000;
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText('有效时间：00:15.0')).toBeInTheDocument();
    expect(screen.getByText('暂停时间：00:15.0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '暂停' })).toBeEnabled();
  });

  it('preserves a manually paused Typing anchor when close confirmation is cancelled', () => {
    vi.useFakeTimers();
    let monotonic = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => monotonic);
    render(<TypingPractice />);
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    monotonic = 2_000;
    act(() => vi.advanceTimersByTime(1_000));
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));

    const preClose = beginWindowCloseParticipantHold();
    expect(preClose).toEqual({ kind: 'TYPING_PAUSED' });
    monotonic = 17_000;
    act(() => vi.advanceTimersByTime(15_000));
    act(() => cancelWindowCloseParticipantHold(preClose));
    monotonic = 22_000;
    act(() => vi.advanceTimersByTime(5_000));

    expect(screen.getByText('有效时间：00:01.0')).toBeInTheDocument();
    expect(screen.getByText('暂停时间：00:20.0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续' })).toBeEnabled();
  });

  it('updates paused time live, settles it once, and accumulates a second pause for export', async () => {
    vi.useFakeTimers();
    let monotonic = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => monotonic);
    render(<TypingPractice />);
    fireEvent.click(screen.getByRole('button', { name: '开始' }));

    monotonic = 2_000;
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText('有效时间：00:01.0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));

    monotonic = 7_000;
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText('有效时间：00:01.0')).toBeInTheDocument();
    expect(screen.getByText('暂停时间：00:05.0')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    monotonic = 8_000;
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText('暂停时间：00:05.0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));

    monotonic = 11_000;
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.getByText('暂停时间：00:08.0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '结束练习' }));
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await act(async () => undefined);
    const exported = vi.mocked(exportTypingRecord).mock.calls[0][1];
    expect(exported.paused_ms).toBe(8_000);
    expect(exported.active_ms).toBe(2_000);
  });

  it('preserves native history input semantics without inflating typing or deletion counters', () => {
    render(<TypingPractice />);
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    const textarea = screen.getByRole('textbox', { name: '单词盲打输入区' });
    fireEvent.input(textarea, { target: { value: 'abc' }, inputType: 'insertText' });
    fireEvent.input(textarea, { target: { value: 'ab' }, inputType: 'historyUndo' });
    expect(screen.getByText('总字符：2')).toBeInTheDocument();
    expect(screen.getByText('键盘输入字符：3')).toBeInTheDocument();
    expect(screen.getByText('删除字符：0')).toBeInTheDocument();
    fireEvent.input(textarea, { target: { value: 'abc' }, inputType: 'historyRedo' });
    expect(screen.getByText('总字符：3')).toBeInTheDocument();
    expect(screen.getByText('键盘输入字符：3')).toBeInTheDocument();
    expect(screen.getByText('删除字符：0')).toBeInTheDocument();
  });

  it('focuses the editor and accepts Writing punctuation, Space, and Enter without filtering', () => {
    render(<TypingPractice />);
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    const textarea = screen.getByRole('textbox', { name: '单词盲打输入区' }) as HTMLTextAreaElement;
    const text = "Hello, world!\nIt's ready.";
    fireEvent.change(textarea, { target: { value: text } });

    expect(textarea).toHaveFocus();
    expect(textarea).toHaveValue(text);
    expect(screen.getByText(`总字符：${[...text].length}`)).toBeInTheDocument();
    expect(screen.getByText('Space：2')).toBeInTheDocument();
    expect(screen.getByText('Enter：1')).toBeInTheDocument();
    textarea.setSelectionRange(text.length, text.length);
    fireEvent.keyDown(textarea, { key: 'Tab' });
    expect(textarea).toHaveValue(`${text}    `);
  });

  it('classifies a paste synchronously instead of counting it as keyboard typing', () => {
    render(<TypingPractice />);
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    const textarea = screen.getByRole('textbox', { name: '单词盲打输入区' });
    fireEvent.paste(textarea);
    fireEvent.change(textarea, { target: { value: ' !\n' } });

    expect(screen.getByText('粘贴字符：3')).toBeInTheDocument();
    expect(screen.getByText('键盘输入字符：0')).toBeInTheDocument();
  });

  it('protects an active session from Start/Reset and exports the exact ended text', async () => {
    render(<TypingPractice />);
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    const textarea = screen.getByRole('textbox', { name: '单词盲打输入区' });
    fireEvent.change(textarea, { target: { value: 'retain this text' } });
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));

    expect(screen.getByRole('button', { name: '开始' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重置' })).toBeDisabled();
    expect(textarea).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '结束练习' }));
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() => expect(exportTypingRecord).toHaveBeenCalledOnce());
    const exportedSnapshot = vi.mocked(exportTypingRecord).mock.calls[0][1] as TypingSnapshot;
    expect(exportedSnapshot.text).toBe('retain this text');
    await waitFor(() =>
      expect(screen.getByText('导出成功：E:\\自定义 根\\typing.records\\2026-07\\typing-test')).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: '打开本次导出目录' }));
    await waitFor(() =>
      expect(openTypingExportDirectory).toHaveBeenCalledWith('typing_records/2026-07/typing-test')
    );
    cleanup();
    expect(loadTypingDraft()).toBeNull();
  });

  it('restores an unfinished local draft as paused', () => {
    const tracker = new TypingStatsAccumulator();
    tracker.applyTextChange('', 'recovered words\n', 'insertText');
    saveTypingDraft({
      schema_version: 1,
      session_id: 'typing-recovery',
      status: 'running',
      active_ms: 25_000,
      paused_ms: 2_000,
      saved_at: '2026-07-10T00:00:00.000Z',
      tracker_state: tracker.serializeState()
    });

    render(<TypingPractice />);
    expect(screen.getByText('已暂停')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '单词盲打输入区' })).toHaveValue('recovered words\n');
    expect(screen.getByText(/已恢复上次未结束的盲打草稿/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续' })).toBeEnabled();
  });

  it('filters mixed input without truncating later English characters', () => {
    render(<TypingPractice />);
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    const textarea = screen.getByRole('textbox', { name: '单词盲打输入区' });
    fireEvent.change(textarea, { target: { value: 'before 中🙂 after!' } });

    expect(textarea).toHaveValue('before  after!');
    expect(screen.getByText(/本次已拒绝字符：2/)).toBeInTheDocument();
  });

  it('does not disrupt composition before commit and filters the committed value once', () => {
    render(<TypingPractice />);
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    const textarea = screen.getByRole('textbox', { name: '单词盲打输入区' });
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: '中' } });
    expect(textarea).toHaveValue('中');
    expect(screen.getByText(/本次已拒绝字符：0/)).toBeInTheDocument();

    fireEvent.compositionEnd(textarea, { data: '中' });
    expect(textarea).toHaveValue('');
    expect(screen.getByText(/本次已拒绝字符：1/)).toBeInTheDocument();
  });

  it('keeps a 5000-word controlled editor value and exports it without truncation', async () => {
    const text = Array.from({ length: 5_000 }, (_, index) => `word${index}`).join(' ') +
      '\n“Final Writing line — ready…”';
    render(<TypingPractice />);
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    const textarea = screen.getByRole('textbox', { name: '单词盲打输入区' });
    fireEvent.change(textarea, { target: { value: text } });

    expect(textarea).toHaveValue(text);
    expect(screen.getByText(`总字符：${[...text].length}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '结束练习' }));
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() => expect(exportTypingRecord).toHaveBeenCalledOnce());
    expect(vi.mocked(exportTypingRecord).mock.calls[0][1].text).toBe(text);
  });

  it('keeps the ended draft after export failure and clears it only after a successful retry', async () => {
    let monotonic = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => monotonic);
    vi.mocked(exportTypingRecord)
      .mockRejectedValueOnce(new Error('synthetic i64 rejection'))
      .mockResolvedValueOnce('typing_records/2026-07/typing-retry');
    render(<TypingPractice />);
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    const textarea = screen.getByRole('textbox', { name: '单词盲打输入区' });
    fireEvent.input(textarea, {
      target: { value: 'R006 three draft must survive export failure' },
      inputType: 'insertText'
    });
    fireEvent.paste(textarea);
    fireEvent.input(textarea, {
      target: { value: 'R006 three draft must survive export failure pasted' },
      inputType: 'insertFromPaste'
    });
    fireEvent.input(textarea, {
      target: { value: 'R006 three draft must survive export failure paste' },
      inputType: 'deleteContentBackward'
    });
    fireEvent.input(textarea, {
      target: { value: 'R006 three draft must survive export failure pasted' },
      inputType: 'historyUndo'
    });
    fireEvent.input(textarea, {
      target: { value: 'R006 three draft must survive export failure paste' },
      inputType: 'historyRedo'
    });
    monotonic = 6_000;
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    monotonic = 8_000;
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    monotonic = 11_000;
    fireEvent.click(screen.getByRole('button', { name: '结束练习' }));
    const endedDraftBefore = JSON.stringify(loadTypingDraft());

    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() => expect(screen.getByText(/synthetic i64 rejection.*草稿仍保留/)).toBeInTheDocument());
    expect(textarea).toHaveValue('R006 three draft must survive export failure paste');
    expect(JSON.stringify(loadTypingDraft())).toBe(endedDraftBefore);
    const failedSnapshot = vi.mocked(exportTypingRecord).mock.calls[0][1];
    expect(failedSnapshot).toMatchObject({
      text: 'R006 three draft must survive export failure paste',
      active_ms: 8_000,
      paused_ms: 2_000,
      deleted_characters: 1,
      paste_count: 1
    });

    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() => expect(screen.getByText(/导出成功/)).toBeInTheDocument());
    expect(exportTypingRecord).toHaveBeenCalledTimes(2);
    expect(vi.mocked(exportTypingRecord).mock.calls[1]).toEqual(
      vi.mocked(exportTypingRecord).mock.calls[0]
    );
    expect(loadTypingDraft()).toBeNull();
  });
});
