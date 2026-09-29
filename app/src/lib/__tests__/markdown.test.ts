import { describe, expect, it } from 'vitest';
import { escapeMarkdownTableCell, fenceText } from '../markdown';

describe('markdown export helpers', () => {
  it('escapes table pipes and line breaks', () => {
    expect(escapeMarkdownTableCell('a|b\nc')).toBe('a\\|b<br>c');
  });

  it('prevents code fence break-out', () => {
    expect(fenceText('before ``` after')).toContain('`\\`\\`');
  });
});
