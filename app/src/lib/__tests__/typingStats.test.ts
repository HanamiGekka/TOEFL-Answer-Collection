import { describe, expect, it } from 'vitest';
import { TypingStatsAccumulator, countCharacters, countEnglishWords, diffText } from '../typingStats';

describe('typing statistics', () => {
  it('tokenizes English words with apostrophes and hyphens', () => {
    expect(countEnglishWords("I'm testing long-term memory.")).toBe(4);
  });

  it('computes inserted and removed text delta', () => {
    expect(diffText('abcdef', 'abXYef')).toEqual({ start: 2, removed: 'cd', inserted: 'XY' });
  });

  it('does not count paste as keyboard typing speed', () => {
    const stats = new TypingStatsAccumulator();
    stats.applyTextChange('', 'abc', 'insertText');
    stats.applyTextChange('abc', 'abc pasted', 'insertFromPaste');
    const snapshot = stats.snapshot(60_000, 0);
    expect(snapshot.keyboard_inserted_letters).toBe(3);
    expect(snapshot.pasted_letters).toBe(6);
    expect(snapshot.retained_typed_letters).toBe(3);
    expect(snapshot.net_cpm).toBe(3);
    expect(snapshot.gross_cpm).toBe(3);
  });

  it('counts actual deleted letters from selected content', () => {
    const stats = new TypingStatsAccumulator();
    stats.applyTextChange('', 'abcdef', 'insertText');
    stats.applyTextChange('abcdef', 'abef', 'deleteContentBackward');
    const snapshot = stats.snapshot(60_000, 0);
    expect(snapshot.deleted_letters).toBe(2);
    expect(snapshot.retained_typed_letters).toBe(4);
    expect(snapshot.retention_accuracy).toBeCloseTo(66.666, 2);
  });

  it('writes minute and final samples without 10 Hz persistence', () => {
    const stats = new TypingStatsAccumulator();
    stats.applyTextChange('', 'hello world', 'insertText');
    expect(stats.sample(30_000, 0, 't0')).toBeNull();
    const minute = stats.sample(60_001, 0, 't1');
    expect(minute?.active_minute_index).toBe(1);
    const final = stats.sample(65_000, 0, 't2', true);
    expect(final?.active_minute_index).toBe('FINAL');
    expect(stats.getSamples()).toHaveLength(2);
  });

  it('preserves and counts normal English Writing characters including Space and Enter', () => {
    const text = "Hello, world!\nIt's 2026—ready? (Yes): 100% / $5 & e-mail.\n";
    const stats = new TypingStatsAccumulator();
    stats.applyTextChange('', text, 'insertText');
    const snapshot = stats.snapshot(60_000, 0);

    expect(snapshot.text).toBe(text);
    expect(snapshot.retained_characters).toBe(countCharacters(text));
    expect(snapshot.retained_spaces).toBe((text.match(/ /g) ?? []).length);
    expect(snapshot.retained_line_breaks).toBe(2);
    expect(snapshot.keyboard_inserted_characters).toBe(countCharacters(text));
    expect(snapshot.net_cpm).toBe(countCharacters(text));
  });

  it('handles a 5000-word practice payload without truncation', () => {
    const text = Array.from({ length: 5_000 }, (_, index) => `word${index}`).join(' ');
    const stats = new TypingStatsAccumulator();
    stats.applyTextChange('', text, 'insertText');
    const snapshot = stats.snapshot(3_600_000, 0);

    expect(snapshot.text).toBe(text);
    expect(snapshot.retained_words).toBe(5_000);
    expect(snapshot.retained_characters).toBe(countCharacters(text));
  });

  it('counts pasted whitespace and punctuation as characters while keeping letter metrics separate', () => {
    const pasted = '  !?\n';
    const stats = new TypingStatsAccumulator();
    stats.applyTextChange('', pasted, 'insertFromPaste');
    const snapshot = stats.snapshot(60_000, 0);

    expect(snapshot.pasted_characters).toBe(5);
    expect(snapshot.pasted_letters).toBe(0);
    expect(snapshot.paste_count).toBe(1);
  });

  it('does not inflate typing or deletion counters for undo and redo', () => {
    const stats = new TypingStatsAccumulator();
    stats.applyTextChange('', 'abc', 'insertText');
    stats.applyTextChange('abc', 'ab', 'historyUndo');
    stats.applyTextChange('ab', 'abc', 'historyRedo');
    const snapshot = stats.snapshot(60_000, 0);

    expect(snapshot.keyboard_inserted_characters).toBe(3);
    expect(snapshot.deleted_characters).toBe(0);
    expect(snapshot.text).toBe('abc');
  });

  it('deletes a Unicode code point without corrupting tracked character indexes', () => {
    const stats = new TypingStatsAccumulator();
    stats.applyTextChange('', 'A🙂B', 'insertText');
    stats.applyTextChange('A🙂B', 'AB', 'deleteContentBackward');
    const snapshot = stats.snapshot(60_000, 0);

    expect(snapshot.text).toBe('AB');
    expect(snapshot.deleted_characters).toBe(1);
    expect(snapshot.deleted_letters).toBe(0);
  });

  it('serializes and restores an unfinished tracker without losing origins or samples', () => {
    const stats = new TypingStatsAccumulator();
    stats.applyTextChange('', 'typed ', 'insertText');
    stats.applyTextChange('typed ', 'typed pasted', 'insertFromPaste');
    stats.sample(60_001, 0, 'minute-1');

    const restored = TypingStatsAccumulator.fromState(stats.serializeState());
    restored.applyTextChange('typed pasted', 'typed pasted!', 'insertText');
    const snapshot = restored.snapshot(65_000, 0);

    expect(snapshot.text).toBe('typed pasted!');
    expect(snapshot.keyboard_inserted_characters).toBe(7);
    expect(snapshot.pasted_characters).toBe(6);
    expect(restored.getSamples()).toHaveLength(1);
  });
});
