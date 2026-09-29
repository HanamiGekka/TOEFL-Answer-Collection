import { describe, expect, it } from 'vitest';
import {
  analyzeWritingChange,
  calculateKeyboardCpm,
  countCharacters,
  countEnglishWords
} from '../writingStats';

describe('R005.4 Writing statistics', () => {
  it.each([
    ['simple words', 'one two three', 3],
    ['multiple spaces and lines', '  one   two\n\nthree  ', 3],
    ['contractions', "It's don't learners' choices", 4],
    ['hyphenated words', 'state-of-the-art email-based work', 3],
    ['numbers', '2026 has 1.5 changes and 45-second tasks', 7],
    ['punctuation', 'Hello, world! (Ready?) ... yes.', 4]
  ])('counts %s with stable offline tokenization', (_label, text, expected) => {
    expect(countEnglishWords(text)).toBe(expected);
  });

  it('counts Unicode code points rather than UTF-16 units without filtering Writing text', () => {
    expect(countCharacters('A🙂中\n')).toBe(4);
  });

  it('classifies keyboard insertion separately from paste', () => {
    expect(analyzeWritingChange('ab', 'ab c', 'insertText')).toMatchObject({
      keyboardCharacters: 2,
      pastedCharacters: 0,
      deletedCharacters: 0
    });
    expect(analyzeWritingChange('ab', 'ab pasted', 'insertFromPaste')).toMatchObject({
      keyboardCharacters: 0,
      pastedCharacters: 7,
      pasteCount: 1
    });
  });

  it('tracks cut and deletion without treating them as keyboard insertion', () => {
    expect(analyzeWritingChange('hello world', 'hello', 'deleteByCut')).toMatchObject({
      keyboardCharacters: 0,
      deletedCharacters: 6,
      cutCount: 1
    });
  });

  it('counts Undo/Redo operations without duplicating keyboard or deletion totals', () => {
    expect(analyzeWritingChange('hello', 'hell', 'historyUndo')).toMatchObject({
      keyboardCharacters: 0,
      deletedCharacters: 0,
      undoCount: 1,
      redoCount: 0
    });
    expect(analyzeWritingChange('hell', 'hello', 'historyRedo')).toMatchObject({
      keyboardCharacters: 0,
      deletedCharacters: 0,
      undoCount: 0,
      redoCount: 1
    });
  });

  it('calculates Keyboard CPM from keyboard characters only', () => {
    expect(calculateKeyboardCpm(210, 60_000)).toBe(210);
    expect(calculateKeyboardCpm(210, 0)).toBe(0);
  });
});
