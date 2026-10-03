import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PracticeSession } from '../../types';
import { exportSessionRecord } from '../exporters';
import { createDynamicSession } from '../dynamicSession';
import { buildSessionExportDirectory } from '../sessionExport';
import type { LocalRecordSummary } from '../recordManager';

const storageMocks = vi.hoisted(() => ({
  writeRecordIndex: vi.fn<(index: LocalRecordSummary) => Promise<void>>().mockResolvedValue(undefined),
  exportSessionBundleAtomic: vi.fn<(
    directory: string,
    files: Array<{ name: string; content: string }>,
    index: LocalRecordSummary
  ) => Promise<void>>().mockResolvedValue(undefined)
}));

vi.mock('../storage', () => ({
  exportSessionTextAtomic: vi.fn(async () => undefined),
  exportSessionBundleAtomic: storageMocks.exportSessionBundleAtomic,
  exportTextAtomic: vi.fn(async () => undefined),
  writeRecordIndex: storageMocks.writeRecordIndex
}));

function session(): PracticeSession {
  return createDynamicSession({ session_id: 'synthetic-idempotent-session', package_id: 'Synthetic.01.A.1', mode: 'practice', selected_sections: ['Reading'], created_at: '2026-07-19T01:00:00.000Z' });
}

beforeEach(() => vi.clearAllMocks());

describe('R006.1.2 Session export idempotency', () => {
  it('uses one stable directory before and after final completion', () => {
    const incomplete = session();
    const completed = { ...incomplete, completed_at: '2026-07-19T02:30:00.000Z', view: 'SESSION_SUMMARY' as const };
    expect(buildSessionExportDirectory(completed)).toBe(buildSessionExportDirectory(incomplete));
  });

  it('reuses record_type + session_id and the same directory on repeated incomplete exports', async () => {
    const value = session();
    const writer = vi.fn(async () => undefined);
    const first = await exportSessionRecord(value, [], writer);
    const second = await exportSessionRecord(value, [], writer);
    expect(second).toBe(first);
    expect(storageMocks.writeRecordIndex).toHaveBeenCalledTimes(2);
    expect(storageMocks.writeRecordIndex.mock.calls.map(([index]) => ({
      record_id: index.record_id,
      relative_path: index.relative_path,
      completion_status: index.completion_status
    }))).toEqual([
      { record_id: 'TOEFL:synthetic-idempotent-session', relative_path: first, completion_status: 'INCOMPLETE' },
      { record_id: 'TOEFL:synthetic-idempotent-session', relative_path: first, completion_status: 'INCOMPLETE' }
    ]);
  });

  it('atomically updates the same logical record from INCOMPLETE to COMPLETED', async () => {
    const incomplete = session();
    const completed = { ...incomplete, completed_at: '2026-07-19T02:30:00.000Z', view: 'SESSION_SUMMARY' as const };
    const first = await exportSessionRecord(incomplete, []);
    const second = await exportSessionRecord(completed, []);
    expect(second).toBe(first);
    expect(storageMocks.exportSessionBundleAtomic.mock.calls.map(([directory, , index]) => ({
      directory,
      record_id: index.record_id,
      completion_status: index.completion_status
    }))).toEqual([
      { directory: first, record_id: 'TOEFL:synthetic-idempotent-session', completion_status: 'INCOMPLETE' },
      { directory: first, record_id: 'TOEFL:synthetic-idempotent-session', completion_status: 'COMPLETED' }
    ]);
  });

  it('does not write a new index when a file export fails and remains retryable', async () => {
    const writer = vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined);
    writer.mockRejectedValueOnce(new Error('synthetic export failure'));
    await expect(exportSessionRecord(session(), [], writer)).rejects.toThrow('synthetic export failure');
    expect(storageMocks.writeRecordIndex).not.toHaveBeenCalled();

    writer.mockResolvedValue(undefined);
    await expect(exportSessionRecord(session(), [], writer)).resolves.toMatch(/synthetic-idempotent-session$/);
    expect(storageMocks.writeRecordIndex).toHaveBeenCalledOnce();
  });
});
