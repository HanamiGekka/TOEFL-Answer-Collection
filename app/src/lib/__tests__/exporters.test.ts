import { describe, expect, it } from 'vitest';
import { buildTypingExportFiles, csvEscape, exportTypingRecord, typingSamplesToCsv } from '../exporters';
import type { TypingMinuteSample, TypingSnapshot } from '../../types';

const snapshot: TypingSnapshot = {
  text: 'final typed text',
  active_ms: 65_000,
  paused_ms: 1_000,
  retained_letters: 14,
  retained_words: 3,
  retained_characters: 16,
  retained_typed_characters: 16,
  retained_spaces: 2,
  retained_line_breaks: 0,
  retained_typed_letters: 14,
  keyboard_inserted_characters: 16,
  keyboard_inserted_letters: 14,
  deleted_characters: 0,
  deleted_letters: 0,
  pasted_characters: 0,
  pasted_letters: 0,
  paste_count: 0,
  retention_accuracy: 100,
  net_cpm: 12,
  gross_cpm: 12,
  actual_wpm: 2,
  standard_wpm: 2.4
};

const sample: TypingMinuteSample = {
  active_minute_index: 'FINAL',
  timestamp: 'now',
  active_ms: 65_000,
  retained_letters_cumulative: 14,
  retained_letters_delta: 14,
  retained_words_cumulative: 3,
  retained_words_delta: 3,
  retained_characters_cumulative: 16,
  retained_characters_delta: 16,
  keyboard_inserted_characters_cumulative: 16,
  keyboard_inserted_characters_delta: 16,
  keyboard_inserted_letters_cumulative: 14,
  keyboard_inserted_letters_delta: 14,
  deleted_letters_cumulative: 0,
  deleted_letters_delta: 0,
  deleted_characters_cumulative: 0,
  deleted_characters_delta: 0,
  pasted_characters_cumulative: 0,
  pasted_characters_delta: 0,
  pasted_letters_cumulative: 0,
  pasted_letters_delta: 0,
  retention_accuracy: 100,
  net_cpm: 12,
  gross_cpm: 12,
  actual_wpm: 2,
  standard_wpm: 2.4
};

describe('CSV exporters', () => {
  it('escapes comma, quote and line break', () => {
    expect(csvEscape('a,"b"\nc')).toBe('"a,""b""\nc"');
  });

  it('exports typing samples with a stable header', () => {
    const csv = typingSamplesToCsv([sample]);
    expect(csv).toContain('active_minute_index,timestamp,active_ms');
    expect(csv).toContain('FINAL');
  });

  it('builds all typing export files under typing_records', () => {
    const result = buildTypingExportFiles('typing:session', snapshot, [sample], '2026-07');
    expect(result.relativeBase).toBe('typing_records/2026-07/typing_session');
    expect(result.files.map((file) => file.name).sort()).toEqual([
      'final_text.txt',
      'minute_samples.csv',
      'typing_session.json',
      'typing_summary.md'
    ]);
    expect(result.files.every((file) => file.relativePath.startsWith('typing_records/'))).toBe(true);
    expect(result.files.find((file) => file.name === 'final_text.txt')?.content).toBe('final typed text');
  });

  it('surfaces typing export writer failures', async () => {
    await expect(
      exportTypingRecord('typing-session', snapshot, [sample], async () => {
        throw new Error('disk full');
      })
    ).rejects.toThrow('disk full');
  });

  it('keeps a large Writing-style text byte-for-byte in every full-text export', () => {
    const text = buildFiveThousandWordWritingPayload();
    const largeSnapshot = { ...snapshot, text, retained_characters: countCodePoints(text) };
    const plan = buildTypingExportFiles('typing-large', largeSnapshot, [sample], '2026-07');
    const json = plan.files.find((file) => file.name === 'typing_session.json')?.content ?? '{}';
    const markdown = plan.files.find((file) => file.name === 'typing_summary.md')?.content ?? '';

    expect(plan.files.find((file) => file.name === 'final_text.txt')?.content).toBe(text);
    expect(JSON.parse(json).snapshot.text).toBe(text);
    expect(markdown).toContain(text);
  });
});

function countCodePoints(value: string): number {
  return [...value].length;
}

function buildFiveThousandWordWritingPayload(): string {
  const asciiPrintable = Array.from({ length: 0x7f - 0x20 }, (_, index) =>
    String.fromCharCode(0x20 + index)
  ).join('');
  const words = Array.from({ length: 5_000 }, (_, index) => {
    const word = `word${index}`;
    const punctuation = index % 50 === 49 ? '.\n' : index % 17 === 16 ? ', ' : ' ';
    return `${word}${punctuation}`;
  }).join('');
  return `${asciiPrintable}\n‘apostrophe’ “quotes” – dash — em dash … ellipsis\n${words}`;
}
