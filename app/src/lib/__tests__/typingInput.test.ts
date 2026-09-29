import { describe, expect, it } from 'vitest';
import { filterTypingInput } from '../typingInput';

describe('TypingPractice English input allowlist', () => {
  it('keeps Latin letters, numbers, Space, Enter, ASCII punctuation, and English typography', () => {
    const asciiPrintable = Array.from({ length: 0x7f - 0x20 }, (_, index) =>
      String.fromCharCode(0x20 + index)
    ).join('');
    const text = `${asciiPrintable}\nLatin café naïve — “ready”… ‘yes’–done`;
    expect(filterTypingInput(text)).toEqual({ text, rejectedCount: 0 });
  });

  it('rejects CJK, Japanese, Korean, emoji, and illegal controls without logging content', () => {
    const result = filterTypingInput('A中あ한🙂B\u0001C');
    expect(result).toEqual({ text: 'ABC', rejectedCount: 5 });
  });

  it('filters mixed paste without truncating legal text after rejected characters', () => {
    expect(filterTypingInput('before 中文 after🙂!').text).toBe('before  after!');
  });

  it('normalizes CRLF and Tab while keeping a 5000-word payload intact', () => {
    const words = Array.from({ length: 5_000 }, (_, index) => `word${index}`).join(' ');
    const result = filterTypingInput(`${words}\r\nnext\tline`);
    expect(result.text).toBe(`${words}\nnext    line`);
    expect(result.rejectedCount).toBe(0);
  });
});
