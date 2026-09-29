import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackageSummary } from '../../types';
import { markQuestionEncountered } from '../../lib/sessionEngine';
import { saveSessionSnapshot } from '../../lib/storage';
import { useAppStore } from '../appStore';
import { startLegacySessionForTest } from '../../test/legacySession';

vi.mock('../../lib/storage', () => ({
  scanPackages: vi.fn(async () => []),
  appendEvent: vi.fn(async () => undefined),
  saveSessionSnapshot: vi.fn(async () => undefined),
  exportSessionTextAtomic: vi.fn(async () => undefined),
  openSessionExportDirectory: vi.fn(async () => undefined),
  openTypingExportDirectory: vi.fn(async () => undefined)
}));

const packageSummary: PackageSummary = { package_id: '01.21.A.1', source_path: 'readonly', modules: [] };
let now = 0;

describe('R005.2.1 finalize persistence transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    useAppStore.setState({
      packages: [packageSummary],
      selectedPackage: packageSummary,
      mode: 'practice',
      selectedSections: ['Reading'],
      session: undefined,
      events: [],
      eventSeq: 0,
      timer: undefined,
      activeMs: 0,
      pausedMs: 0,
      questionActiveMs: 0,
      scopeActiveMs: 0,
      isPaused: false,
      navigationLockedUntil: 0,
      saveStatus: 'idle',
      exportStatus: 'idle',
      sessionNotice: undefined
    });
  });

  it('passes a real integer DTO before switching Scope', async () => {
    prepareEncounteredScope();
    now = 22_790.29999999702;
    await useAppStore.getState().finalizeCurrentScope();
    const saved = vi.mocked(saveSessionSnapshot).mock.calls.at(-1)?.[0];

    expect(saved?.answers['Reading-1'].active_time_ms).toBe(22_790);
    expect(saved?.modules[0].activeTimeMs).toBe(22_790);
    expect(saved?.active_ms).toBe(22_790);
    expect(saved?.current_scope_id).toBe('READING_MODULE_2');
    expect(useAppStore.getState().session?.current_scope_id).toBe('READING_MODULE_2');
  });

  it('keeps Scope and answers on save failure and retry does not add time twice', async () => {
    prepareEncounteredScope();
    vi.mocked(saveSessionSnapshot).mockRejectedValueOnce(new Error('fixture save failure'));
    now = 22_790.29999999702;
    await useAppStore.getState().finalizeCurrentScope();

    expect(useAppStore.getState().session?.current_scope_id).toBe('READING_MODULE_1');
    expect(useAppStore.getState().session?.answers['Reading-1'].active_time_ms).toBeCloseTo(22_790.29999999702);
    expect(useAppStore.getState().sessionNotice?.message).toContain('fixture save failure');

    await useAppStore.getState().finalizeCurrentScope();
    expect(useAppStore.getState().session?.current_scope_id).toBe('READING_MODULE_2');
    expect(useAppStore.getState().session?.modules[0].activeTimeMs).toBe(22_790);
    expect(vi.mocked(saveSessionSnapshot)).toHaveBeenCalledTimes(2);
  });
});

function prepareEncounteredScope(): void {
    startLegacySessionForTest();
  const session = useAppStore.getState().session;
  if (!session) throw new Error('missing fixture session');
  useAppStore.setState({
    session: session.active_scope_question_ids.reduce(
      (current, questionId) => markQuestionEncountered(current, questionId),
      session
    )
  });
  vi.mocked(saveSessionSnapshot).mockClear();
}
