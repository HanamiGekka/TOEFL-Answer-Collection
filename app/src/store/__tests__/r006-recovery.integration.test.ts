import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventLogEntry, PackageSummary, PracticeSession } from '../../types';
import { DEFAULT_BLUEPRINT } from '../../lib/blueprint';
import { exportIncompleteRecovery } from '../../lib/recoveryExport';
import { buildInitialSessionRuntime, createDefaultQuestions } from '../../lib/sessionEngine';
import { appendEvent, exportSessionBundleAtomic, saveSessionSnapshot } from '../../lib/storage';
import { useAppStore } from '../appStore';

let recoveryRaw = '';
const recoveryStorageState = vi.hoisted(() => ({ eventSeq: 41, events: [] as EventLogEntry[] }));

vi.mock('../../lib/storage', () => ({
  scanPackages: vi.fn(async () => []),
  appendEvent: vi.fn(async (entry: EventLogEntry) => {
    recoveryStorageState.eventSeq = entry.seq;
    recoveryStorageState.events.push(entry);
  }),
  saveSessionSnapshot: vi.fn(async () => undefined),
  exportSessionTextAtomic: vi.fn(async () => undefined),
  exportSessionBundleAtomic: vi.fn(async () => undefined),
  writeRecordIndex: vi.fn(async () => undefined),
  openSessionExportDirectory: vi.fn(async () => undefined),
  getAppSetting: vi.fn(async () => undefined),
  saveAppSetting: vi.fn(async () => undefined),
  loadBlueprintOverride: vi.fn(async () => undefined),
  loadRecoverySnapshot: vi.fn(async () => recoveryRaw),
  getRecoveryEventSeq: vi.fn(async () => recoveryStorageState.eventSeq),
  loadRecoveryEvents: vi.fn(async () => [...recoveryStorageState.events])
}));

const packageSummary: PackageSummary = { package_id: 'Mock.01.A.1', source_path: 'readonly', modules: [] };

function snapshot(): PracticeSession {
  const session = buildInitialSessionRuntime({
    session_schema_version: 5,
    session_id: 'recovery-session',
    package_id: packageSummary.package_id,
    source_path: packageSummary.source_path,
    mode: 'practice',
    timing_profile_id: 'toefl-2026-practice',
    timing_profile_version: '1.0.0',
    blueprint_id: DEFAULT_BLUEPRINT.blueprint_id,
    blueprint_version: DEFAULT_BLUEPRINT.version,
    created_at: '2026-07-13T00:00:00.000Z',
    started_at: '2026-07-13T00:00:00.000Z',
    active_ms: 12_345,
    paused_ms: 600,
    questions: createDefaultQuestions(['Writing', 'Speaking']),
    answers: {}, modules: [], view: 'PRACTICE'
  });
  session.tasks.find((task) => task.task_id === 'WRITING_EMAIL')!.text = '完整 Writing 全文';
  session.tasks.find((task) => task.task_id === 'SR1')!.attempt_count = 3;
  session.answers['Writing-12'] = {
    question_id: 'Writing-12', answer_value: 'x', progress_status: 'ANSWERED', status: 'ANSWERED',
    is_overtime: false, is_skipped: false, is_uncertain: false,
    first_answer_elapsed_ms: null, first_answer_at: '2026-07-17T01:52:56.517Z',
    active_time_ms: 3_003, total_active_ms: 3_003, modification_count: 1, revision_count: 1,
    marked_review: false, last_changed_at: '2026-07-17T01:52:56.517Z', updated_at: '2026-07-17T01:52:56.517Z'
  } as PracticeSession['answers'][string];
  return session;
}

function legacyListeningSnapshot(): PracticeSession {
  const current = buildInitialSessionRuntime({
    session_schema_version: 5,
    session_id: 'legacy-listening-recovery',
    package_id: packageSummary.package_id,
    source_path: packageSummary.source_path,
    mode: 'practice',
    timing_profile_id: 'toefl-2026-practice',
    timing_profile_version: '1.0.0',
    blueprint_id: DEFAULT_BLUEPRINT.blueprint_id,
    blueprint_version: DEFAULT_BLUEPRINT.version,
    created_at: '2026-07-22T00:00:00.000Z',
    active_ms: 900,
    paused_ms: 100,
    questions: createDefaultQuestions(['Listening']),
    answers: {}, modules: [], view: 'PRACTICE'
  });
  const questionIds = current.questions.map((question) => question.id);
  return {
    ...current,
    blueprint_version: '1.1.0',
    current_module_id: 'LISTENING_SECTION',
    current_scope_id: 'LISTENING_SECTION',
    questions: current.questions.map((question) => ({ ...question, module_id: 'LISTENING_SECTION' })),
    active_scope_question_ids: questionIds,
    active_module_question_ids: questionIds,
    modules: [{
      id: 'LISTENING_SECTION', section: 'Listening', kind: 'SECTION', label: 'Listening',
      status: 'IN_PROGRESS', questionIds, activeTimeMs: 900, isOvertime: false,
      startedAt: current.started_at ?? null, finalizedAt: null
    }],
    answers: {
      'Listening-1': {
        question_id: 'Listening-1', answer_value: 'A', progress_status: 'ANSWERED', status: 'ANSWERED',
        is_overtime: false, is_skipped: true, is_uncertain: true,
        active_time_ms: 900, total_active_ms: 900, modification_count: 0, revision_count: 0,
        marked_review: true, last_changed_at: '2026-07-22T00:00:01.000Z', updated_at: '2026-07-22T00:00:01.000Z'
      }
    }
  };
}

function legacyListening120Snapshot(): PracticeSession {
  const current = buildInitialSessionRuntime({
    session_schema_version: 5,
    session_id: 'legacy-listening-recovery-1-2-0',
    package_id: packageSummary.package_id,
    source_path: packageSummary.source_path,
    mode: 'practice',
    timing_profile_id: 'toefl-2026-practice',
    timing_profile_version: '1.0.0',
    blueprint_id: DEFAULT_BLUEPRINT.blueprint_id,
    blueprint_version: DEFAULT_BLUEPRINT.version,
    created_at: '2026-07-24T00:00:00.000Z',
    active_ms: 3_500,
    paused_ms: 200,
    questions: createDefaultQuestions(['Listening']),
    answers: {},
    modules: [],
    view: 'PRACTICE'
  });
  const firstModuleIds = current.questions
    .filter((question) => question.number <= 35)
    .map((question) => question.id);
  const secondModuleIds = current.questions
    .filter((question) => question.number >= 36)
    .map((question) => question.id);
  const allQuestionIds = current.questions.map((question) => question.id);
  return {
    ...current,
    blueprint_version: '1.2.0',
    current_module_id: 'LISTENING_MODULE_2',
    current_scope_id: 'LISTENING_MODULE_2',
    current_question_id: 'Listening-36',
    current_question_index: 35,
    questions: current.questions.map((question) => ({
      ...question,
      module_id: question.number <= 35 ? 'LISTENING_MODULE_1' : 'LISTENING_MODULE_2',
      encountered: question.number <= 36,
      visit_count: question.number <= 36 ? 1 : 0
    })),
    active_scope_question_ids: secondModuleIds,
    active_module_question_ids: secondModuleIds,
    active_section_question_ids: allQuestionIds,
    all_session_question_ids: allQuestionIds,
    modules: [
      {
        id: 'LISTENING_MODULE_1',
        section: 'Listening',
        kind: 'MODULE',
        label: 'Listening Module 1',
        status: 'FINALIZED',
        questionIds: firstModuleIds,
        activeTimeMs: 3_500,
        isOvertime: false,
        startedAt: current.started_at ?? null,
        finalizedAt: '2026-07-24T00:05:00.000Z'
      },
      {
        id: 'LISTENING_MODULE_2',
        section: 'Listening',
        kind: 'MODULE',
        label: 'Listening Module 2',
        status: 'IN_PROGRESS',
        questionIds: secondModuleIds,
        activeTimeMs: 0,
        isOvertime: false,
        startedAt: '2026-07-24T00:05:00.000Z',
        finalizedAt: null
      }
    ]
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  recoveryStorageState.eventSeq = 41;
  recoveryStorageState.events = [{
    session_id: 'recovery-session', seq: 41, monotonic_elapsed_ms: 12_345,
    wall_clock: '2026-07-13T00:00:12.345Z', event_type: 'synthetic_pre_recovery',
    payload: {}, schema_version: '1.0.0'
  }];
  recoveryRaw = JSON.stringify(snapshot());
  useAppStore.setState({
    packages: [packageSummary], selectedPackage: packageSummary,
    blueprint: DEFAULT_BLUEPRINT, blueprintStatus: 'ready', blueprintErrors: [],
    session: undefined, events: [], eventSeq: 0, timer: undefined,
    activeMs: 0, pausedMs: 0, questionActiveMs: 0, scopeActiveMs: 0,
    taskActiveMs: 0, taskRemainingMs: null, isPaused: false,
    speakingTransitionPending: false, speakingTransitionGuardUntil: 0,
    windowClosePhase: 'IDLE', preCloseRuntimeState: undefined,
    saveStatus: 'idle', exportStatus: 'idle'
  });
});

describe('R006 recovery store integration', () => {
  it('keeps a Blueprint 1.2.0 35+12 Listening Snapshot and continues its event sequence', async () => {
    recoveryRaw = JSON.stringify(legacyListening120Snapshot());
    recoveryStorageState.eventSeq = 88;
    recoveryStorageState.events = [{
      session_id: 'legacy-listening-recovery-1-2-0',
      seq: 88,
      monotonic_elapsed_ms: 3_500,
      wall_clock: '2026-07-24T00:05:00.000Z',
      event_type: 'legacy_listening_1_2_event',
      payload: { module_id: 'LISTENING_MODULE_2' },
      schema_version: '1.0.0'
    }];

    expect(await useAppStore.getState().recoverSession('legacy-listening-recovery-1-2-0')).toEqual({ ok: true });
    const recovered = useAppStore.getState();
    expect(recovered.session?.blueprint_version).toBe('1.2.0');
    expect(recovered.session?.modules.map((module) => [module.id, module.questionIds.length])).toEqual([
      ['LISTENING_MODULE_1', 35],
      ['LISTENING_MODULE_2', 12]
    ]);
    expect(recovered.session?.current_question_id).toBe('Listening-36');
    expect(recovered.events.map((event) => event.seq)).toEqual([88, 89]);
    expect(recovered.eventSeq).toBe(89);
    expect(vi.mocked(appendEvent).mock.calls.at(-1)?.[0]).toMatchObject({
      seq: 89,
      event_type: 'session_recovered'
    });
  });

  it('keeps a Blueprint 1.1.0 Listening scope and continues its existing event sequence', async () => {
    recoveryRaw = JSON.stringify(legacyListeningSnapshot());
    recoveryStorageState.eventSeq = 73;
    recoveryStorageState.events = [{
      session_id: 'legacy-listening-recovery', seq: 73, monotonic_elapsed_ms: 900,
      wall_clock: '2026-07-22T00:00:01.000Z', event_type: 'legacy_listening_event',
      payload: { module_id: 'LISTENING_SECTION' }, schema_version: '1.0.0'
    }];

    expect(await useAppStore.getState().recoverSession('legacy-listening-recovery')).toEqual({ ok: true });
    const recovered = useAppStore.getState();
    expect(recovered.session?.blueprint_version).toBe('1.1.0');
    expect(recovered.session?.modules.map((module) => [module.id, module.questionIds.length]))
      .toEqual([['LISTENING_SECTION', 47]]);
    expect(recovered.session?.answers['Listening-1']).toMatchObject({
      answer_value: 'A', active_time_ms: 900, is_skipped: true, is_uncertain: true
    });
    expect(recovered.events.map((event) => event.seq)).toEqual([73, 74]);
    expect(recovered.eventSeq).toBe(74);
    expect(vi.mocked(appendEvent).mock.calls.at(-1)?.[0]).toMatchObject({
      seq: 74, event_type: 'session_recovered'
    });
  });

  it('restores paused, keeps full text/attempts, and appends after the old event sequence', async () => {
    const now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    expect(await useAppStore.getState().recoverSession('recovery-session')).toEqual({ ok: true });
    const recovered = useAppStore.getState();
    expect(recovered.isPaused).toBe(true);
    expect(recovered.timer).toMatchObject({ currentActivityStartedAtMonotonic: null, pausedAtMonotonic: 1_000 });
    expect(recovered.session?.tasks.find((task) => task.task_id === 'WRITING_EMAIL')?.text).toBe('完整 Writing 全文');
    expect(recovered.session?.tasks.find((task) => task.task_id === 'SR1')?.attempt_count).toBe(3);
    expect(recovered.session?.answers['Writing-12']).toMatchObject({
      answer_value: 'x', first_answer_elapsed_ms: null, active_time_ms: 3_003
    });
    expect(recovered.eventSeq).toBe(42);
    expect(recovered.events.map((event) => event.seq)).toEqual([41, 42]);
    expect(vi.mocked(appendEvent).mock.calls.at(-1)?.[0].seq).toBe(42);
    expect(saveSessionSnapshot).toHaveBeenCalled();
  });

  it('does not double-count paused time and starts a fresh anchor only after resume', async () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    await useAppStore.getState().recoverSession('recovery-session');
    const baseline = useAppStore.getState().activeMs;
    now = 50_000;
    useAppStore.getState().tick();
    expect(useAppStore.getState().activeMs).toBe(baseline);
    useAppStore.getState().togglePause();
    now = 50_500;
    useAppStore.getState().tick();
    expect(useAppStore.getState().activeMs).toBe(baseline + 500);
  });

  it('persists a 15-second default recovery pause without increasing active time', async () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    await useAppStore.getState().recoverSession('recovery-session');
    const baseline = useAppStore.getState();
    vi.mocked(saveSessionSnapshot).mockClear();

    now = 16_000;
    await useAppStore.getState().persist();
    const saved = vi.mocked(saveSessionSnapshot).mock.calls.at(-1)?.[0];
    expect(saved?.active_ms).toBe(baseline.activeMs);
    expect(saved?.paused_ms).toBe(baseline.pausedMs + 15_000);
  });

  it.each(['title-bar X', 'Alt+F4'])(
    'keeps a manually paused Session paused after cancelling %s and counts all dialog dwell as pause',
    async () => {
      let now = 1_000;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      await useAppStore.getState().recoverSession('recovery-session');
      const baseline = useAppStore.getState();
      const resumedEventsBefore = baseline.events.filter((event) => event.event_type === 'session_resumed').length;

      now = 11_000;
      useAppStore.getState().tick();
      const pausedAtBeforeClose = useAppStore.getState().timer?.pausedAtMonotonic;
      const preClose = useAppStore.getState().beginWindowCloseHold();
      useAppStore.getState().setWindowClosePhase('CONFIRMING');
      expect(preClose).toEqual({ kind: 'PAUSED_SESSION' });

      now = 26_000;
      useAppStore.getState().tick();
      useAppStore.getState().cancelWindowCloseHold(preClose);
      useAppStore.getState().setWindowClosePhase('IDLE');
      now = 31_000;
      useAppStore.getState().tick();

      const restored = useAppStore.getState();
      expect(restored.isPaused).toBe(true);
      expect(restored.timer?.currentActivityStartedAtMonotonic).toBeNull();
      expect(restored.timer?.pausedAtMonotonic).toBe(pausedAtBeforeClose);
      expect(restored.activeMs).toBe(baseline.activeMs);
      expect(restored.pausedMs).toBe(baseline.pausedMs + 30_000);
      expect(restored.events.filter((event) => event.event_type === 'session_resumed')).toHaveLength(resumedEventsBefore);
    }
  );

  it('holds an active Session during confirmation, then resumes from a fresh cancel anchor', async () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    await useAppStore.getState().recoverSession('recovery-session');
    const baseline = useAppStore.getState();
    useAppStore.getState().togglePause();

    now = 11_000;
    useAppStore.getState().tick();
    const beforeClose = useAppStore.getState();
    const closeEventCount = beforeClose.events.length;
    const preClose = beforeClose.beginWindowCloseHold();
    useAppStore.getState().setWindowClosePhase('CONFIRMING');
    expect(preClose).toEqual({ kind: 'ACTIVE_SESSION' });

    now = 26_000;
    useAppStore.getState().tick();
    expect(useAppStore.getState().activeMs).toBe(baseline.activeMs + 10_000);
    expect(useAppStore.getState().pausedMs).toBe(baseline.pausedMs + 15_000);

    useAppStore.getState().cancelWindowCloseHold(preClose);
    useAppStore.getState().setWindowClosePhase('IDLE');
    expect(useAppStore.getState().timer?.currentActivityStartedAtMonotonic).toBe(26_000);
    now = 31_000;
    useAppStore.getState().tick();

    expect(useAppStore.getState().activeMs).toBe(baseline.activeMs + 15_000);
    expect(useAppStore.getState().pausedMs).toBe(baseline.pausedMs + 15_000);
    expect(useAppStore.getState().events).toHaveLength(closeEventCount);
  });

  it('keeps an active Session held through close-save failure and resumes only after cancel', async () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    await useAppStore.getState().recoverSession('recovery-session');
    const baseline = useAppStore.getState();
    useAppStore.getState().togglePause();

    now = 11_000;
    useAppStore.getState().tick();
    const preClose = useAppStore.getState().beginWindowCloseHold();
    useAppStore.getState().setWindowClosePhase('CONFIRMING');
    now = 21_000;
    useAppStore.getState().setWindowClosePhase('SAVING');
    useAppStore.getState().setWindowClosePhase('FAILED');
    now = 26_000;
    useAppStore.getState().tick();

    expect(useAppStore.getState().timer?.currentActivityStartedAtMonotonic).toBeNull();
    expect(useAppStore.getState().activeMs).toBe(baseline.activeMs + 10_000);
    expect(useAppStore.getState().pausedMs).toBe(baseline.pausedMs + 15_000);

    useAppStore.getState().cancelWindowCloseHold(preClose);
    useAppStore.getState().setWindowClosePhase('IDLE');
    now = 28_000;
    useAppStore.getState().tick();
    expect(useAppStore.getState().activeMs).toBe(baseline.activeMs + 12_000);
    expect(useAppStore.getState().pausedMs).toBe(baseline.pausedMs + 15_000);
  });

  it('keeps a paused Session on its original anchor through failure UI and cancel', async () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    await useAppStore.getState().recoverSession('recovery-session');
    const baseline = useAppStore.getState();
    const originalPauseAnchor = baseline.timer?.pausedAtMonotonic;
    const preClose = baseline.beginWindowCloseHold();
    useAppStore.getState().setWindowClosePhase('CONFIRMING');
    now = 11_000;
    useAppStore.getState().setWindowClosePhase('SAVING');
    useAppStore.getState().setWindowClosePhase('FAILED');
    now = 16_000;
    useAppStore.getState().tick();
    useAppStore.getState().cancelWindowCloseHold(preClose);
    useAppStore.getState().setWindowClosePhase('IDLE');
    now = 21_000;
    useAppStore.getState().tick();

    const restored = useAppStore.getState();
    expect(restored.isPaused).toBe(true);
    expect(restored.timer?.pausedAtMonotonic).toBe(originalPauseAnchor);
    expect(restored.timer?.currentActivityStartedAtMonotonic).toBeNull();
    expect(restored.activeMs).toBe(baseline.activeMs);
    expect(restored.pausedMs).toBe(baseline.pausedMs + 20_000);
  });

  it('represents an empty runtime explicitly without creating a timer anchor', () => {
    useAppStore.setState({
      session: undefined,
      timer: undefined,
      preCloseRuntimeState: undefined
    });

    const preClose = useAppStore.getState().beginWindowCloseHold();

    expect(preClose).toEqual({ kind: 'NO_SESSION' });
    expect(useAppStore.getState().timer).toBeUndefined();
    useAppStore.getState().cancelWindowCloseHold(preClose);
    expect(useAppStore.getState().preCloseRuntimeState).toBeUndefined();
  });

  it('persists confirmation and save dwell as pause for an active Session', async () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    await useAppStore.getState().recoverSession('recovery-session');
    const baseline = useAppStore.getState();
    useAppStore.getState().togglePause();
    vi.mocked(saveSessionSnapshot).mockClear();

    now = 11_000;
    useAppStore.getState().tick();
    useAppStore.getState().beginWindowCloseHold();
    useAppStore.getState().setWindowClosePhase('CONFIRMING');
    now = 26_000;
    useAppStore.getState().setWindowClosePhase('SAVING');
    await useAppStore.getState().persist();

    const saved = vi.mocked(saveSessionSnapshot).mock.calls.at(-1)?.[0];
    expect(saved?.active_ms).toBe(baseline.activeMs + 10_000);
    expect(saved?.paused_ms).toBe(baseline.pausedMs + 15_000);
  });

  it('freezes a close-save snapshot after settling a 15-second Recovery pause', async () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    await useAppStore.getState().recoverSession('recovery-session');
    const baseline = useAppStore.getState();
    vi.mocked(saveSessionSnapshot).mockClear();

    useAppStore.getState().beginWindowCloseHold();
    useAppStore.getState().setWindowClosePhase('CONFIRMING');
    now = 16_000;
    useAppStore.getState().setWindowClosePhase('SAVING');
    await useAppStore.getState().persist();
    const saved = vi.mocked(saveSessionSnapshot).mock.calls.at(-1)?.[0];
    expect(saved?.active_ms).toBe(baseline.activeMs);
    expect(saved?.paused_ms).toBe(baseline.pausedMs + 15_000);

    now = 31_000;
    useAppStore.getState().tick();
    expect(useAppStore.getState().activeMs).toBe(baseline.activeMs);
    expect(useAppStore.getState().pausedMs).toBe(baseline.pausedMs + 15_000);
  });

  it('settles an active close exactly once and freezes active interaction during save latency', async () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    await useAppStore.getState().recoverSession('recovery-session');
    const baseline = useAppStore.getState();
    vi.mocked(saveSessionSnapshot).mockClear();

    now = 6_000;
    useAppStore.getState().togglePause();
    now = 16_000;
    useAppStore.getState().beginWindowCloseHold();
    useAppStore.getState().setWindowClosePhase('SAVING');
    const frozen = useAppStore.getState();
    expect(frozen.activeMs).toBe(baseline.activeMs + 10_000);
    expect(frozen.timer?.currentActivityStartedAtMonotonic).toBeNull();

    now = 46_000;
    useAppStore.getState().tick();
    useAppStore.getState().nextQuestion();
    useAppStore.getState().togglePause();
    await useAppStore.getState().persist();

    const saved = vi.mocked(saveSessionSnapshot).mock.calls.at(-1)?.[0];
    expect(saved?.active_ms).toBe(baseline.activeMs + 10_000);
    expect(useAppStore.getState().session?.current_question_id).toBe(frozen.session?.current_question_id);
    expect(useAppStore.getState().activeMs).toBe(frozen.activeMs);
    expect(useAppStore.getState().pausedMs).toBe(frozen.pausedMs + 30_000);
    expect(useAppStore.getState().isPaused).toBe(false);
  });

  it('keeps an active Session held after close persistence fails and resumes from cancel', async () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    await useAppStore.getState().recoverSession('recovery-session');
    const baseline = useAppStore.getState();

    now = 6_000;
    useAppStore.getState().togglePause();
    now = 16_000;
    const preClose = useAppStore.getState().beginWindowCloseHold();
    useAppStore.getState().setWindowClosePhase('SAVING');
    vi.mocked(saveSessionSnapshot).mockRejectedValueOnce(new Error('synthetic close failure'));
    await useAppStore.getState().persist();
    expect(useAppStore.getState().saveStatus).toBe('error');

    now = 46_000;
    useAppStore.getState().setWindowClosePhase('FAILED');
    expect(useAppStore.getState().timer?.currentActivityStartedAtMonotonic).toBeNull();
    now = 46_500;
    useAppStore.getState().tick();
    expect(useAppStore.getState().activeMs).toBe(baseline.activeMs + 10_000);
    useAppStore.getState().cancelWindowCloseHold(preClose);
    useAppStore.getState().setWindowClosePhase('IDLE');
    expect(useAppStore.getState().timer?.currentActivityStartedAtMonotonic).toBe(46_500);
    now = 47_000;
    useAppStore.getState().tick();
    expect(useAppStore.getState().activeMs).toBe(baseline.activeMs + 10_500);
  });

  it('settles pause-active-pause exactly once before persistence', async () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    await useAppStore.getState().recoverSession('recovery-session');
    const baseline = useAppStore.getState();

    now = 6_000;
    useAppStore.getState().togglePause();
    now = 16_000;
    useAppStore.getState().togglePause();
    now = 21_000;
    await useAppStore.getState().persist();
    const saved = vi.mocked(saveSessionSnapshot).mock.calls.at(-1)?.[0];
    expect(saved?.active_ms).toBe(baseline.activeMs + 10_000);
    expect(saved?.paused_ms).toBe(baseline.pausedMs + 10_000);
  });

  it('retains close-settled active/pause values on a second recovery without doubling them', async () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.mocked(saveSessionSnapshot).mockImplementation(async (value) => {
      recoveryRaw = JSON.stringify(value);
    });
    await useAppStore.getState().recoverSession('recovery-session');
    const baseline = useAppStore.getState();

    now = 6_000;
    useAppStore.getState().togglePause();
    now = 16_000;
    useAppStore.getState().togglePause();
    now = 21_000;
    await useAppStore.getState().persist();
    const closed = useAppStore.getState();
    expect(closed.activeMs).toBe(baseline.activeMs + 10_000);
    expect(closed.pausedMs).toBe(baseline.pausedMs + 10_000);

    now = 30_000;
    await useAppStore.getState().recoverSession('recovery-session');
    const recoveredAgain = useAppStore.getState();
    expect(recoveredAgain.activeMs).toBe(closed.activeMs);
    expect(recoveredAgain.pausedMs).toBe(closed.pausedMs);
    expect(recoveredAgain.timer).toMatchObject({
      currentActivityStartedAtMonotonic: null,
      pausedAtMonotonic: 30_000
    });
  });

  it('prevents an older concurrent autosave from overwriting the newer close snapshot', async () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    await useAppStore.getState().recoverSession('recovery-session');
    const baselinePause = useAppStore.getState().pausedMs;
    let persisted: PracticeSession | undefined;
    let resolveFirst: (() => void) | undefined;
    vi.mocked(saveSessionSnapshot)
      .mockImplementationOnce((value) => new Promise<void>((resolve) => {
        resolveFirst = () => { persisted = value; resolve(); };
      }))
      .mockImplementation(async (value) => { persisted = value; });

    now = 6_000;
    const autosave = useAppStore.getState().persist();
    await vi.waitFor(() => expect(resolveFirst).toBeDefined());
    now = 11_000;
    const closeSave = useAppStore.getState().persist();
    await Promise.resolve();
    resolveFirst?.();
    await Promise.all([autosave, closeSave]);

    expect(persisted?.paused_ms).toBe(baselinePause + 10_000);
  });

  it('continues event sequence without duplicating active time or attempts on a second recovery', async () => {
    vi.spyOn(performance, 'now').mockImplementation(() => 1_000);
    await useAppStore.getState().recoverSession('recovery-session');
    const first = useAppStore.getState();
    const firstActive = first.activeMs;
    const firstAttempts = first.session?.tasks.find((task) => task.task_id === 'SR1')?.attempt_count;

    await useAppStore.getState().recoverSession('recovery-session');
    const second = useAppStore.getState();
    expect(second.activeMs).toBe(firstActive);
    expect(second.session?.tasks.find((task) => task.task_id === 'SR1')?.attempt_count).toBe(firstAttempts);
    expect(second.eventSeq).toBe(43);
    expect(vi.mocked(appendEvent).mock.calls.map(([entry]) => entry.seq)).toEqual([42, 43]);
  });

  it('diagnoses corrupt JSON without replacing the current app state', async () => {
    recoveryRaw = '{broken';
    const result = await useAppStore.getState().recoverSession('recovery-session');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('CORRUPT_SNAPSHOT');
    expect(useAppStore.getState().session).toBeUndefined();
  });

  it('diagnoses a required package override that is no longer available', async () => {
    const value = snapshot();
    value.blueprint_override_package_id = 'Mock.01.A.1';
    recoveryRaw = JSON.stringify(value);
    const result = await useAppStore.getState().recoverSession('recovery-session');
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toContain('PACKAGE_OVERRIDE_MISSING');
    expect(useAppStore.getState().session).toBeUndefined();
  });

  it('exports an incomplete recovery record and updates its lightweight index', async () => {
    const value = snapshot();
    (value.questions[0] as unknown as Record<string, unknown>).time_limit_ms = null;
    (value.questions[0] as unknown as Record<string, unknown>).remaining_ms = null;
    recoveryRaw = JSON.stringify(value);
    const directory = await exportIncompleteRecovery('recovery-session');
    expect(directory).toMatch(/^records\/Mock\.01\.A\.1\//);
    expect(exportSessionBundleAtomic).toHaveBeenCalledWith(
      directory,
      expect.any(Array),
      expect.objectContaining({
      session_id: 'recovery-session', completion_status: 'INCOMPLETE', export_status: 'EXPORTED'
      })
    );
    const files = vi.mocked(exportSessionBundleAtomic).mock.calls.at(-1)?.[1];
    const answers = files?.find((file) => file.name === 'answers.json')?.content;
    expect(answers).toBeDefined();
    expect(JSON.parse(answers!)).toMatchObject({
      session_id: 'recovery-session',
      blueprint_id: DEFAULT_BLUEPRINT.blueprint_id,
      blueprint_version: DEFAULT_BLUEPRINT.version
    });
    const events = files?.find((file) => file.name === 'events.jsonl')?.content ?? '';
    expect(events).toContain('"seq":41');
  });
});
