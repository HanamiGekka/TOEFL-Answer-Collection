import { describe, expect, it } from 'vitest';
import { PACKAGE_ID_PATTERN } from '../../constants';

describe('package id pattern', () => {
  it('accepts official package ids with multiple dots', () => {
    expect(PACKAGE_ID_PATTERN.test('01.21.A.2')).toBe(true);
  });

  it('accepts safe mock fixture package ids', () => {
    expect(PACKAGE_ID_PATTERN.test('Mock.01.A.1')).toBe(true);
  });

  it('rejects traversal-like ids', () => {
    expect(PACKAGE_ID_PATTERN.test('..\\01.21.A.1')).toBe(false);
  });
});
