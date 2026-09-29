import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackageSummary, PracticeSession } from '../../types';
import { DEFAULT_BLUEPRINT, createQuestionsFromBlueprint } from '../../lib/blueprint';
import { buildInitialSessionRuntime } from '../../lib/sessionEngine';
import { markUncertain, upsertAnswer } from '../../lib/sessionEngine';
import { prepareRecoverySession } from '../../lib/recovery';
import { createActivityTimer } from '../../lib/timeLedger';
import { createWindowCloseCoordinator } from '../../lib/windowClose';
import { saveSessionSnapshot } from '../../lib/storage';
import { useAppStore } from '../appStore';

vi.mock('../../lib/storage', () => ({
  appendEvent: vi.fn(async () => undefined),
  saveSessionSnapshot: vi.fn(async () => undefined),
  scanPackages: vi.fn(async () => []),
  exportSessionTextAtomic: vi.fn(async () => undefined),
  exportTextAtomic: vi.fn(async () => undefined),
  openSessionExportDirectory: vi.fn(async () => undefined),
  openTypingExportDirectory: vi.fn(async () => undefined)
}));

const pkg: PackageSummary = { package_id: 'Mock.01.A.1', source_path: 'fixture-source', modules: [] };

function session(): PracticeSession {
  return buildInitialSessionRuntime({
    session_schema_version: 5,
    session_id: 'r0063-save-close',
    package_id: pkg.package_id,
    source_path: pkg.source_path,
    mode: 'practice',
    timing_profile_id: 'toefl-2026-practice',
    timing_profile_version: '1.0.0',
    blueprint_id: DEFAULT_BLUEPRINT.blueprint_id,
    blueprint_version: DEFAULT_BLUEPRINT.version,
    created_at: '2026-07-22T05:00:00.000Z',
    started_at: '2026-07-22T05:00:00.000Z',
    active_ms: 0,
    paused_ms: 0,
    questions: createQuestionsFromBlueprint(DEFAULT_BLUEPRINT, ['Reading']),
    answers: {}, modules: [], view: 'PRACTICE'
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(performance, 'now').mockReturnValue(1_000);
  const value = session();
  useAppStore.setState({
    packages: [pkg], selectedPackage: pkg, session: value,
    timer: createActivityTimer(value.current_question_id, 0),
    events: [], eventSeq: 0, activeMs: 0, pausedMs: 0,
    questionActiveMs: 0, scopeActiveMs: 0, taskActiveMs: 0, taskRemainingMs: null,
    isPaused: false, windowClosePhase: 'IDLE', preCloseRuntimeState: undefined,
    speakingTransitionPending: false, saveStatus: 'idle', saveError: undefined
  });
});

function closeEvent() {
  return { preventDefault: vi.fn() };
}

describe('R006.3 save-close persistence fault', () => {
  it.each(['title-bar X', 'Alt+F4'])('keeps %s open after one close-only failure and succeeds on retry', async (source) => {
    const current = useAppStore.getState().session!;
    const question = current.questions[0];
    useAppStore.setState({
      session: markUncertain(
        upsertAnswer(current, question, 'A', 750, false, '2026-07-22T05:00:01.000Z'),
        question.id,
        true,
        '2026-07-22T05:00:02.000Z'
      ),
      eventSeq: 3
    });
    vi.mocked(saveSessionSnapshot)
      .mockRejectedValueOnce(new Error('R006.3 one-shot Recovery fault'))
      .mockResolvedValueOnce(undefined);
    const destroy = vi.fn(async () => undefined);
    const coordinator = createWindowCloseCoordinator({
      hasPendingWork: () => true,
      beginHold: () => useAppStore.getState().beginWindowCloseHold(),
      cancelHold: (state) => useAppStore.getState().cancelWindowCloseHold(state),
      persist: async () => {
        await useAppStore.getState().persist('WINDOW_CLOSE');
        const state = useAppStore.getState();
        if (state.saveStatus === 'error') throw new Error(state.saveError);
      },
      destroy,
      onStateChange: (state) => useAppStore.getState().setWindowClosePhase(state.phase)
    });

    coordinator.requestClose(closeEvent(), source);
    await coordinator.saveAndClose();
    expect(coordinator.getState()).toMatchObject({ phase: 'FAILED' });
    expect(destroy).not.toHaveBeenCalled();
    expect(saveSessionSnapshot).toHaveBeenLastCalledWith(expect.anything(), 'WINDOW_CLOSE');

    await coordinator.retry();
    expect(destroy).toHaveBeenCalledOnce();
    expect(saveSessionSnapshot).toHaveBeenCalledTimes(2);
    const saved = vi.mocked(saveSessionSnapshot).mock.calls[1][0];
    expect(saved.answers[question.id]).toMatchObject({ answer_value: 'A', is_uncertain: true });
    const prepared = prepareRecoverySession(saved, [DEFAULT_BLUEPRINT.blueprint_id]);
    expect(prepared).toMatchObject({
      ok: true,
      resume_policy: { paused: true, reuse_monotonic_anchor: false }
    });
  });

  it('restores the active pre-close state on cancel without counting dialog dwell as active', async () => {
    vi.mocked(saveSessionSnapshot).mockRejectedValueOnce(new Error('fault'));
    const coordinator = createWindowCloseCoordinator({
      hasPendingWork: () => true,
      beginHold: () => useAppStore.getState().beginWindowCloseHold(),
      cancelHold: (state) => useAppStore.getState().cancelWindowCloseHold(state),
      persist: async () => {
        await useAppStore.getState().persist('WINDOW_CLOSE');
        if (useAppStore.getState().saveStatus === 'error') throw new Error('fault');
      },
      destroy: vi.fn(async () => undefined),
      onStateChange: (state) => useAppStore.getState().setWindowClosePhase(state.phase)
    });
    coordinator.requestClose(closeEvent(), 'title-bar X');
    await coordinator.saveAndClose();
    vi.spyOn(performance, 'now').mockReturnValue(11_000);
    coordinator.cancel();

    expect(useAppStore.getState()).toMatchObject({ isPaused: false, windowClosePhase: 'IDLE' });
    expect(useAppStore.getState().activeMs).toBe(1_000);
    expect(useAppStore.getState().pausedMs).toBe(10_000);
  });

  it('waits for an older autosave and then persists the newest close snapshot', async () => {
    let releaseAutosave: (() => void) | undefined;
    vi.mocked(saveSessionSnapshot)
      .mockImplementationOnce(() => new Promise<void>((resolve) => { releaseAutosave = resolve; }))
      .mockResolvedValueOnce(undefined);

    const autosave = useAppStore.getState().persist('AUTOSAVE');
    await vi.waitFor(() => expect(saveSessionSnapshot).toHaveBeenCalledTimes(1));
    const current = useAppStore.getState().session!;
    const question = current.questions[0];
    useAppStore.setState({
      session: upsertAnswer(current, question, 'LATEST-CLOSE-ANSWER', 900, false)
    });
    const closeSave = useAppStore.getState().persist('WINDOW_CLOSE');
    releaseAutosave?.();
    await Promise.all([autosave, closeSave]);

    expect(saveSessionSnapshot).toHaveBeenCalledTimes(2);
    expect(vi.mocked(saveSessionSnapshot).mock.calls.map((call) => call[1]))
      .toEqual(['AUTOSAVE', 'WINDOW_CLOSE']);
    expect(vi.mocked(saveSessionSnapshot).mock.calls[1][0].answers[question.id])
      .toMatchObject({ answer_value: 'LATEST-CLOSE-ANSWER' });
  });
});
