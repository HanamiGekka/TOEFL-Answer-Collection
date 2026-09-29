import { describe, expect, it } from 'vitest';
import { validateShortcuts } from '../shortcuts';

describe('shortcut validation', () => {
  it('rejects duplicates', () => {
    const result = validateShortcuts({ a: 'Ctrl+Alt+P', b: 'Alt+Ctrl+P' });
    expect(result.ok).toBe(false);
  });

  it('rejects Alt+Shift combinations', () => {
    const result = validateShortcuts({ switch: 'Alt+Shift+S' });
    expect(result.ok).toBe(false);
  });
});
