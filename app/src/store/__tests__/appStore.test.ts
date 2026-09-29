import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackageSummary } from '../../types';
import { useAppStore } from '../appStore';
import { startLegacySessionForTest } from '../../test/legacySession';
import { markQuestionEncountered } from '../../lib/sessionEngine';
import {
  cleanupTerminalRecovery,
  exportSessionBundleAtomic,
  exportSessionTextAtomic,
  openSessionExportDirectory,
  scanPackages,
  saveSessionSnapshot
} from '../../lib/storage';

vi.mock('../../lib/storage', () => ({
  scanPackages: vi.fn(async () => []),
  appendEvent: vi.fn(async () => undefined),
  cleanupTerminalRecovery: vi.fn(async () => 2),
  saveSessionSnapshot: vi.fn(async () => undefined),
  exportSessionTextAtomic: vi.fn(async () => undefined),
  exportSessionBundleAtomic: vi.fn(async () => undefined),
  writeRecordIndex: vi.fn(async () => undefined),
  openSessionExportDirectory: vi.fn(async () => undefined),
  openTypingExportDirectory: vi.fn(async () => undefined)
}));

const packageSummary: PackageSummary = {
  package_id: '01.21.A.1',
  source_path: 'readonly',
  modules: []
};

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
    hideTimes: false,
    navigationLockedUntil: 0,
    saveStatus: 'idle',
    exportStatus: 'idle',
    exportError: undefined,
    exportDirectory: undefined,
    sessionNotice: undefined
  });
  vi.mocked(saveSessionSnapshot).mockResolvedValue(undefined);
  vi.mocked(exportSessionTextAtomic).mockResolvedValue(undefined);
  vi.mocked(exportSessionBundleAtomic).mockResolvedValue(undefined);
  vi.mocked(cleanupTerminalRecovery).mockResolvedValue(2);
}

describe('app store critical session flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  afterEach(() => vi.restoreAllMocks());

  it('keeps local settings usable when SOURCE_ROOT is unconfigured', async () => {
    vi.mocked(scanPackages).mockRejectedValueOnce(new Error('尚未配置资料目录'));
    await useAppStore.getState().initialize();
    expect(useAppStore.getState().packages).toEqual([]);
    expect(useAppStore.getState().packageLoadError).toContain('尚未配置资料目录');
    expect(useAppStore.getState().blueprintStatus).toBe('ready');
    expect(useAppStore.getState().shortcutBindings).toBeDefined();
  });

  it('freezes all mutating actions while paused at the Store layer', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(1_000);
    startLegacySessionForTest();
    const beforePause = useAppStore.getState().session;
    expect(beforePause?.current_question_index).toBe(0);

    useAppStore.getState().togglePause();
    expect(useAppStore.getState().isPaused).toBe(true);
    const pausedBaseline = useAppStore.getState().session;

    useAppStore.getState().answerCurrent('A');
    useAppStore.getState().goToQuestion(10);
    useAppStore.getState().skipCurrent();
    useAppStore.getState().toggleReview();
    await useAppStore.getState().finalizeCurrentModule();

    const paused = useAppStore.getState().session;
    expect(paused?.current_question_index).toBe(0);
    expect(paused).toEqual(pausedBaseline);
    expect(paused?.modules.find((item) => item.id === 'READING_MODULE_1')?.status).toBe('IN_PROGRESS');

    useAppStore.getState().togglePause();
    useAppStore.getState().answerCurrent('A');
    expect(useAppStore.getState().session?.answers['Reading-1']?.answer_value).toBe('A');
  });

  it('keeps the current module open and shows an error when finalize persistence fails', async () => {
    startLegacySessionForTest();
    const session = useAppStore.getState().session;
    if (!session) throw new Error('session should exist');
    const encountered = session.modules
      .find((item) => item.id === 'READING_MODULE_1')
      ?.questionIds.reduce((state, questionId) => markQuestionEncountered(state, questionId), session);
    if (!encountered) throw new Error('module should exist');

    useAppStore.setState({ session: encountered, activeMs: 35_000 });
    vi.mocked(saveSessionSnapshot).mockRejectedValueOnce(new Error('snapshot failed'));

    await useAppStore.getState().finalizeCurrentModule();

    const after = useAppStore.getState().session;
    expect(after?.current_module_id).toBe('READING_MODULE_1');
    expect(after?.modules.find((item) => item.id === 'READING_MODULE_1')?.status).toBe('IN_PROGRESS');
    expect(useAppStore.getState().sessionNotice).toMatchObject({ kind: 'error' });
    expect(useAppStore.getState().sessionNotice?.message).toContain('snapshot failed');
  });

  it('shows unencountered items and jumps to the first one without finalizing', async () => {
    startLegacySessionForTest();

    await useAppStore.getState().finalizeCurrentModule();

    const state = useAppStore.getState();
    expect(state.session?.current_module_id).toBe('READING_MODULE_1');
    expect(state.session?.modules.find((item) => item.id === 'READING_MODULE_1')?.status).toBe('IN_PROGRESS');
    expect(state.sessionNotice).toMatchObject({ kind: 'warning' });
    expect(state.sessionNotice?.questionIds?.[0]).toBe('Reading-2');

    useAppStore.getState().goToFirstUnencountered();
    expect(useAppStore.getState().session?.current_question_index).toBe(1);
    expect(useAppStore.getState().session?.questions[1].encountered).toBe(true);
  });

  it('persists finalized module state before switching to Module 2', async () => {
    startLegacySessionForTest();
    const session = useAppStore.getState().session;
    if (!session) throw new Error('session should exist');
    const encountered = session.modules
      .find((item) => item.id === 'READING_MODULE_1')
      ?.questionIds.reduce((state, questionId) => markQuestionEncountered(state, questionId), session);
    if (!encountered) throw new Error('module should exist');

    useAppStore.setState({ session: encountered, activeMs: 35_000 });
    await useAppStore.getState().finalizeCurrentModule();

    expect(useAppStore.getState().session?.current_module_id).toBe('READING_MODULE_2');
    const savedSession = vi.mocked(saveSessionSnapshot).mock.calls.at(-1)?.[0];
    expect(savedSession?.current_module_id).toBe('READING_MODULE_2');
    expect(savedSession?.modules.find((item) => item.id === 'READING_MODULE_1')?.status).toBe('FINALIZED');
    expect(savedSession?.questions[35].encountered).toBe(true);
  });

  it('does not pause when the window loses focus', () => {
    startLegacySessionForTest();
    window.dispatchEvent(new Event('blur'));
    expect(useAppStore.getState().isPaused).toBe(false);
  });

  it('routes next, previous, answer-card, and unencountered jumps through enterQuestion', async () => {
    startLegacySessionForTest();

    useAppStore.getState().nextQuestion();
    expect(useAppStore.getState().session?.current_question_id).toBe('Reading-2');
    expect(useAppStore.getState().session?.questions[1]).toMatchObject({ encountered: true, visit_count: 1 });

    useAppStore.getState().previousQuestion();
    expect(useAppStore.getState().session?.current_question_id).toBe('Reading-1');
    expect(useAppStore.getState().session?.questions[0].visit_count).toBe(2);

    useAppStore.setState({ navigationLockedUntil: 0 });
    useAppStore.getState().goToQuestion(2);
    expect(useAppStore.getState().session?.current_question_id).toBe('Reading-3');
    expect(useAppStore.getState().session?.questions[2]).toMatchObject({ encountered: true, visit_count: 1 });

    await useAppStore.getState().finalizeCurrentScope();
    expect(useAppStore.getState().sessionNotice?.questionIds?.[0]).toBe('Reading-4');
    useAppStore.getState().goToFirstUnencountered();
    expect(useAppStore.getState().session?.current_question_id).toBe('Reading-4');
    expect(useAppStore.getState().session?.questions[3]).toMatchObject({ encountered: true, visit_count: 1 });
  });

  it('uses independent per-question active time and disables Listening overtime', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    useAppStore.setState({ selectedSections: ['Listening'] });
    startLegacySessionForTest();

    now = 10_000;
    useAppStore.getState().tick();
    useAppStore.getState().answerCurrent('A');
    now = 15_000;
    useAppStore.getState().tick();
    useAppStore.setState({ navigationLockedUntil: 0 });
    useAppStore.getState().nextQuestion();

    expect(useAppStore.getState().session?.answers['Listening-1']).toMatchObject({
      active_time_ms: 15_000,
      is_overtime: false
    });
    expect(useAppStore.getState().session?.current_question_id).toBe('Listening-2');

    now = 35_000;
    useAppStore.getState().tick();
    useAppStore.getState().answerCurrent('B');
    expect(useAppStore.getState().session?.answers['Listening-2']).toMatchObject({
      active_time_ms: 20_000,
      is_overtime: false
    });
  });

  it('keeps a completed session after automatic export failure and succeeds on retry', async () => {
    useAppStore.setState({ selectedSections: ['Listening'] });
    startLegacySessionForTest();
    const active = useAppStore.getState().session;
    if (!active) throw new Error('session should exist');
    const visited = active.active_scope_question_ids.reduce(
      (current, questionId) => markQuestionEncountered(current, questionId),
      active
    );
    useAppStore.setState({ session: visited, activeMs: 10_000 });
    await useAppStore.getState().finalizeCurrentScope();
    const module2 = useAppStore.getState().session;
    if (!module2) throw new Error('Listening Module 2 should exist');
    useAppStore.setState({
      session: module2.active_scope_question_ids.reduce(
        (current, questionId) => markQuestionEncountered(current, questionId),
        module2
      )
    });
    vi.mocked(exportSessionBundleAtomic).mockRejectedValueOnce(new Error('export denied'));
    await useAppStore.getState().finalizeCurrentScope();
    expect(useAppStore.getState().session?.view).toBe('SESSION_SUMMARY');
    expect(useAppStore.getState().exportStatus).toBe('error');
    expect(useAppStore.getState().exportError).toContain('export denied');

    await useAppStore.getState().exportSession();
    expect(useAppStore.getState().session?.view).toBe('SESSION_SUMMARY');
    expect(useAppStore.getState().exportStatus).toBe('exported');
    expect(useAppStore.getState().exportDirectory).toMatch(/^records\/01\.21\.A\.1\//);
  });

  it('coalesces concurrent export requests and ignores repeats after success', async () => {
    startLegacySessionForTest();
    const session = useAppStore.getState().session;
    if (!session) throw new Error('session should exist');
    useAppStore.setState({
      session: {
        ...session,
        view: 'SESSION_SUMMARY',
        completed_at: '2026-08-03T00:00:00.000Z'
      }
    });
    let finishExport!: () => void;
    vi.mocked(exportSessionBundleAtomic).mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishExport = resolve;
    }));

    const first = useAppStore.getState().exportSession();
    const concurrent = useAppStore.getState().exportSession();
    expect(exportSessionBundleAtomic).toHaveBeenCalledTimes(1);

    finishExport();
    await Promise.all([first, concurrent]);
    await useAppStore.getState().exportSession();

    expect(exportSessionBundleAtomic).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().events.filter((event) => event.event_type === 'session_export_started')).toHaveLength(1);
    expect(useAppStore.getState().events.filter((event) => event.event_type === 'session_exported')).toHaveLength(1);
  });

  it('passes the exact relative Session directory to the root-specific opener', async () => {
    const directory = 'records/01.21.A.1/2026-07-11_12-00-00_session.01';
    useAppStore.setState({ exportDirectory: directory });
    await useAppStore.getState().openCurrentExportDirectory();
    expect(openSessionExportDirectory).toHaveBeenCalledWith(directory);
  });

  it('keeps the formal export and offers cleanup-only retry when terminal cleanup fails', async () => {
    startLegacySessionForTest();
    const session = useAppStore.getState().session;
    if (!session) throw new Error('session should exist');
    useAppStore.setState({
      session: {
        ...session,
        view: 'SESSION_SUMMARY',
        completed_at: '2026-07-27T00:00:00.000Z'
      }
    });
    vi.mocked(cleanupTerminalRecovery).mockRejectedValueOnce(new Error('cleanup denied'));

    await useAppStore.getState().exportSession();

    expect(useAppStore.getState().exportStatus).toBe('exported');
    expect(useAppStore.getState().exportDirectory).toMatch(/^records\/01\.21\.A\.1\//);
    expect(useAppStore.getState().sessionNotice).toMatchObject({
      kind: 'error',
      retryAction: 'CLEANUP_TERMINAL_RECOVERY'
    });
    expect(useAppStore.getState().sessionNotice?.messageKey).toBe('notice.cleanupFailed');
    expect(exportSessionBundleAtomic).toHaveBeenCalledTimes(1);

    await useAppStore.getState().retryTerminalRecoveryCleanup();

    expect(cleanupTerminalRecovery).toHaveBeenCalledTimes(2);
    expect(exportSessionBundleAtomic).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().sessionNotice).toBeUndefined();
  });
});
