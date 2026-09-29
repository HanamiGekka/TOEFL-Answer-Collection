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

function resetStore() {
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
    exportError: undefined,
    exportDirectory: undefined,
    sessionNotice: undefined
  });
}

describe('R005.2 Store timing ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    resetStore();
  });

  it('settles before navigation once and accumulates a revisited question', () => {
    startLegacySessionForTest();
    now = 1_000;
    useAppStore.getState().nextQuestion();
    useAppStore.setState({ navigationLockedUntil: 0 });
    now = 1_500;
    useAppStore.getState().previousQuestion();
    now = 1_750;
    useAppStore.getState().tick();

    expect(useAppStore.getState().session?.answers['Reading-1']?.active_time_ms).toBe(1_000);
    expect(useAppStore.getState().questionActiveMs).toBe(1_250);
    expect(useAppStore.getState().activeMs).toBe(1_750);
  });

  it('settles before pause, excludes paused time, and resumes with a new anchor', async () => {
    startLegacySessionForTest();
    now = 1_000;
    useAppStore.getState().togglePause();
    now = 11_000;
    useAppStore.getState().tick();
    expect(useAppStore.getState().activeMs).toBe(1_000);
    useAppStore.getState().togglePause();
    now = 12_000;
    useAppStore.getState().tick();

    expect(useAppStore.getState().activeMs).toBe(2_000);
    expect(useAppStore.getState().pausedMs).toBe(10_000);
    expect(useAppStore.getState().questionActiveMs).toBe(2_000);
    await useAppStore.getState().persist();
    expect(useAppStore.getState().session?.paused_ms).toBe(10_000);
    expect(vi.mocked(saveSessionSnapshot).mock.calls.at(-1)?.[0].paused_ms).toBe(10_000);
  });

  it('does not lose Scope time after an unencountered finalize attempt', async () => {
    startLegacySessionForTest();
    now = 1_000;
    useAppStore.getState().tick();
    await useAppStore.getState().finalizeCurrentScope();

    const session = useAppStore.getState().session;
    if (!session) throw new Error('missing session');
    const visited = session.active_scope_question_ids.reduce(
      (current, id) => markQuestionEncountered(current, id),
      session
    );
    useAppStore.setState({ session: visited });
    now = 5_000;
    useAppStore.getState().tick();
    await useAppStore.getState().finalizeCurrentScope();

    const completed = useAppStore.getState().session;
    const scope = completed?.modules.find((item) => item.id === 'READING_MODULE_1');
    const questionSum = scope?.questionIds.reduce(
      (sum, id) => sum + (completed?.answers[id]?.active_time_ms ?? 0),
      0
    );
    expect(scope?.activeTimeMs).toBe(questionSum);
    expect(scope?.activeTimeMs).toBe(5_000);
  });

  it('settles before persistence and saves the same aggregate ledger', async () => {
    startLegacySessionForTest();
    now = 2_500;
    await useAppStore.getState().persist();
    const saved = vi.mocked(saveSessionSnapshot).mock.calls.at(-1)?.[0];

    expect(saved?.answers['Reading-1'].active_time_ms).toBe(2_500);
    expect(saved?.modules[0].activeTimeMs).toBe(2_500);
    expect(saved?.active_ms).toBe(2_500);
  });

  it('starts Module 2 and Listening at zero and stops old Scopes from growing', async () => {
    useAppStore.setState({ selectedSections: ['Reading', 'Listening'] });
    startLegacySessionForTest();
    now = 1_000;
    useAppStore.getState().tick();
    let session = useAppStore.getState().session;
    if (!session) throw new Error('missing session');
    useAppStore.setState({
      session: session.active_scope_question_ids.reduce(
        (current, id) => markQuestionEncountered(current, id),
        session
      )
    });
    await useAppStore.getState().finalizeCurrentScope();
    expect(useAppStore.getState().session?.current_scope_id).toBe('READING_MODULE_2');
    expect(useAppStore.getState().scopeActiveMs).toBe(0);

    now = 1_500;
    useAppStore.getState().tick();
    session = useAppStore.getState().session;
    if (!session) throw new Error('missing module 2');
    useAppStore.setState({
      session: session.active_scope_question_ids.reduce(
        (current, id) => markQuestionEncountered(current, id),
        session
      )
    });
    await useAppStore.getState().finalizeCurrentScope();
    expect(useAppStore.getState().session?.current_scope_id).toBe('LISTENING_MODULE_1');
    expect(useAppStore.getState().scopeActiveMs).toBe(0);

    now = 2_000;
    useAppStore.getState().tick();
    const current = useAppStore.getState().session;
    expect(current?.modules.find((scope) => scope.id === 'READING_MODULE_1')?.activeTimeMs).toBe(1_000);
    expect(current?.modules.find((scope) => scope.id === 'READING_MODULE_2')?.activeTimeMs).toBe(500);
    expect(useAppStore.getState().scopeActiveMs).toBe(500);
  });
});
