import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TypingMinuteSample, TypingSnapshot } from '../../types';
import { exportTypingRecord } from '../exporters';
import type { LocalRecordSummary } from '../recordManager';

const storageMocks = vi.hoisted(() => ({
  exportTypingBundleAtomic: vi.fn<(
    directory: string,
    files: Array<{ name: string; content: string }>,
    index: LocalRecordSummary
  ) => Promise<void>>(async () => undefined),
  exportTextAtomic: vi.fn(async () => undefined),
  writeRecordIndex: vi.fn(async () => undefined)
}));

vi.mock('../storage', () => ({
  exportSessionBundleAtomic: vi.fn(async () => undefined),
  exportSessionTextAtomic: vi.fn(async () => undefined),
  exportTypingBundleAtomic: storageMocks.exportTypingBundleAtomic,
  exportTextAtomic: storageMocks.exportTextAtomic,
  writeRecordIndex: storageMocks.writeRecordIndex
}));

const snapshot: TypingSnapshot = {
  text: 'R006 three retry proof with paste and undo.',
  active_ms: 65_000,
  paused_ms: 2_500,
  retained_letters: 32,
  retained_words: 8,
  retained_characters: 43,
  retained_typed_characters: 43,
  retained_spaces: 7,
  retained_line_breaks: 0,
  retained_typed_letters: 32,
  keyboard_inserted_characters: 49,
  keyboard_inserted_letters: 38,
  deleted_characters: 6,
  deleted_letters: 6,
  pasted_characters: 5,
  pasted_letters: 5,
  paste_count: 1,
  retention_accuracy: 84.2,
  net_cpm: 39.7,
  gross_cpm: 45.2,
  actual_wpm: 7.4,
  standard_wpm: 7.9
};

const sample: TypingMinuteSample = {
  active_minute_index: 'FINAL', timestamp: '2026-07-22T05:00:00.000Z', active_ms: 65_000,
  retained_letters_cumulative: 32, retained_letters_delta: 32,
  retained_words_cumulative: 8, retained_words_delta: 8,
  retained_characters_cumulative: 43, retained_characters_delta: 43,
  keyboard_inserted_characters_cumulative: 49, keyboard_inserted_characters_delta: 49,
  keyboard_inserted_letters_cumulative: 38, keyboard_inserted_letters_delta: 38,
  deleted_characters_cumulative: 6, deleted_characters_delta: 6,
  deleted_letters_cumulative: 6, deleted_letters_delta: 6,
  pasted_characters_cumulative: 5, pasted_characters_delta: 5,
  pasted_letters_cumulative: 5, pasted_letters_delta: 5,
  retention_accuracy: 84.2, net_cpm: 39.7, gross_cpm: 45.2, actual_wpm: 7.4, standard_wpm: 7.9
};

beforeEach(() => vi.clearAllMocks());

describe('R006.3 Typing atomic export retry', () => {
  it('retries one atomic bundle with stable identity and internally consistent files', async () => {
    storageMocks.exportTypingBundleAtomic
      .mockRejectedValueOnce(new Error('R006.3 one-shot publish fault'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await expect(exportTypingRecord('typing-r0063-stable', snapshot, [sample]))
      .rejects.toThrow('one-shot publish fault');
    const retryDirectory = await exportTypingRecord('typing-r0063-stable', snapshot, [sample]);
    const idempotentDirectory = await exportTypingRecord('typing-r0063-stable', snapshot, [sample]);

    expect(retryDirectory).toBe(idempotentDirectory);
    expect(storageMocks.exportTypingBundleAtomic).toHaveBeenCalledTimes(3);
    expect(storageMocks.exportTextAtomic).not.toHaveBeenCalled();
    expect(storageMocks.writeRecordIndex).not.toHaveBeenCalled();

    const calls = storageMocks.exportTypingBundleAtomic.mock.calls;
    expect(calls.map(([directory, , index]) => ({
      directory,
      record_id: index.record_id,
      session_id: index.session_id,
      relative_path: index.relative_path
    }))).toEqual(Array.from({ length: 3 }, () => ({
      directory: retryDirectory,
      record_id: 'TYPING:typing-r0063-stable',
      session_id: 'typing-r0063-stable',
      relative_path: retryDirectory
    })));

    const files = Object.fromEntries(calls[1][1].map((file) => [file.name, file.content]));
    expect(files['final_text.txt']).toBe(snapshot.text);
    expect(JSON.parse(files['typing_session.json']).snapshot).toMatchObject({
      text: snapshot.text, active_ms: 65_000, paused_ms: 2_500,
      deleted_characters: 6, pasted_characters: 5
    });
    expect(files['typing_summary.md']).toContain(snapshot.text);
    expect(files['minute_samples.csv']).toContain('FINAL');
  });
});
