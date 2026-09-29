import { describe, expect, it } from 'vitest';
import {
  canMutateRecord,
  filterAndPageRecords,
  formatLocalTimestamp,
  summarizeBatchResults,
  validateControlledRelativePath,
  type LocalRecordSummary
} from '../recordManager';

function record(overrides: Partial<LocalRecordSummary> = {}): LocalRecordSummary {
  return {
    record_id: 'TOEFL:session-1',
    record_type: 'TOEFL',
    session_id: 'session-1',
    package_id: 'Mock.01.A.1',
    created_at: '2026-07-13T01:00:00.000Z',
    mode: 'practice',
    profile_id: 'toefl-2026-practice',
    selected_sections: ['Reading'],
    active_time_ms: 1_000,
    pause_time_ms: 0,
    completion_status: 'COMPLETED',
    export_status: 'EXPORTED',
    schema_version: 'practice-session-v5',
    app_version: '1.0-dev',
    directory_size_bytes: 256,
    relative_path: 'records/Mock.01.A.1/session-1',
    file_names: ['answers.json'],
    ...overrides
  };
}

describe('R006 record manager contracts', () => {
  it('filters TOEFL records by type', () => {
    const result = filterAndPageRecords([
      record(),
      record({ record_id: 'TYPING:t1', record_type: 'TYPING', session_id: 't1', relative_path: 'typing_records/2026-07/t1' })
    ], { type: 'TOEFL', page: 1 });
    expect(result.items.map((item) => item.record_type)).toEqual(['TOEFL']);
  });

  it('searches package ids case-insensitively', () => {
    const result = filterAndPageRecords([record()], { search: 'mock.01', page: 1 });
    expect(result.total).toBe(1);
  });

  it('filters incomplete recovery records', () => {
    const result = filterAndPageRecords([
      record(),
      record({ record_id: 'RECOVERY:s2', record_type: 'RECOVERY', session_id: 's2', completion_status: 'INCOMPLETE', relative_path: 'data/recovery/s2.json' })
    ], { completion: 'INCOMPLETE', page: 1 });
    expect(result.items[0].record_type).toBe('RECOVERY');
  });

  it('sorts newest records first by default', () => {
    const result = filterAndPageRecords([
      record(),
      record({ record_id: 'TOEFL:new', session_id: 'new', created_at: '2026-07-14T01:00:00.000Z' })
    ], { page: 1 });
    expect(result.items[0].session_id).toBe('new');
  });

  it('formats the same UTC timestamp in the requested operating-system timezone without mutating it', () => {
    const utc = '2026-07-17T01:11:07.244Z';
    expect(formatLocalTimestamp(utc, 'Asia/Shanghai')).toBe('2026-07-17 09:11:07');
    expect(formatLocalTimestamp(utc, 'Asia/Tokyo')).toBe('2026-07-17 10:11:07');
    expect(utc).toBe('2026-07-17T01:11:07.244Z');
  });

  it('sorts by parsed epoch rather than the displayed or source string', () => {
    const result = filterAndPageRecords([
      record({ record_id: 'TOEFL:earlier', session_id: 'earlier', created_at: '2026-07-17T09:00:00+08:00' }),
      record({ record_id: 'TOEFL:later', session_id: 'later', created_at: '2026-07-17T02:00:00Z' })
    ], { sort: 'NEWEST', page: 1 });
    expect(result.items.map((item) => item.session_id)).toEqual(['later', 'earlier']);
  });

  it('uses a clear fallback for invalid and absent timestamps', () => {
    expect(formatLocalTimestamp('not-a-date', 'Asia/Shanghai')).toBe('无效时间');
    expect(formatLocalTimestamp(undefined, 'Asia/Shanghai')).toBe('—');
  });

  it('uses the fixed ten-record page size and clamps oversized page requests', () => {
    const records = Array.from({ length: 21 }, (_, index) => record({
      record_id: `TOEFL:${index}`,
      session_id: String(index),
      created_at: `2026-07-${String(index + 1).padStart(2, '0')}T01:00:00.000Z`
    }));
    const result = filterAndPageRecords(records, { page: 99, page_size: 25 });
    expect(result).toMatchObject({ total: 21, page: 3, page_size: 10, total_pages: 3 });
    expect(result.items).toHaveLength(1);
  });

  it.each([
    [0, 0], [1, 1], [10, 1], [11, 2], [20, 2], [21, 3]
  ])('derives %i records as %i pages', (count, totalPages) => {
    const records = Array.from({ length: count }, (_, index) => record({
      record_id: `TOEFL:${index}`,
      session_id: String(index)
    }));
    expect(filterAndPageRecords(records, { page: 1 }).total_pages).toBe(totalPages);
  });

  it('sorts deterministically before slicing across pages', () => {
    const records = Array.from({ length: 11 }, (_, index) => record({
      record_id: `TOEFL:${String(index).padStart(2, '0')}`,
      session_id: String(index).padStart(2, '0'),
      created_at: '2026-07-19T01:00:00.000Z'
    })).reverse();
    const first = filterAndPageRecords(records, { page: 1 });
    const second = filterAndPageRecords(records, { page: 2 });
    expect([...first.items, ...second.items].map((item) => item.record_id)).toEqual(
      Array.from({ length: 11 }, (_, index) => `TOEFL:${String(index).padStart(2, '0')}`)
    );
  });

  it('blocks mutation of the current active Session', () => {
    expect(canMutateRecord(record(), 'session-1')).toMatchObject({ ok: false, reason: 'ACTIVE_SESSION' });
  });

  it('allows mutation of an unrelated completed Session', () => {
    expect(canMutateRecord(record(), 'different')).toEqual({ ok: true });
  });

  it('reports batch partial failures per item', () => {
    expect(summarizeBatchResults([
      { record_id: 'one', ok: true },
      { record_id: 'two', ok: false, error: 'locked' }
    ])).toEqual({ succeeded: 1, failed: 1, failures: [{ record_id: 'two', error: 'locked' }] });
  });

  it('accepts Chinese and dotted controlled record paths', () => {
    expect(validateControlledRelativePath('records/套题.01/会话.01', 'TOEFL')).toEqual({ ok: true });
  });

  it('rejects parent traversal', () => {
    expect(validateControlledRelativePath('records/pkg/../outside', 'TOEFL').ok).toBe(false);
  });

  it('rejects absolute record paths', () => {
    expect(validateControlledRelativePath('E:\\outside\\session', 'TOEFL').ok).toBe(false);
  });

  it('rejects a relative path under the wrong root', () => {
    expect(validateControlledRelativePath('typing_records/month/session', 'TOEFL').ok).toBe(false);
  });
});
