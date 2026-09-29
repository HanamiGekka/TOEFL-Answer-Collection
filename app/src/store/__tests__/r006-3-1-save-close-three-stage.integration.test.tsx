import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoveryPanel } from '../../components/RecoveryPanel';
import { DEFAULT_BLUEPRINT, createQuestionsFromBlueprint } from '../../lib/blueprint';
import type { LocalRecordSummary } from '../../lib/recordManager';
import { buildInitialSessionRuntime, markUncertain, upsertAnswer } from '../../lib/sessionEngine';
import { createActivityTimer } from '../../lib/timeLedger';
import { createWindowCloseCoordinator } from '../../lib/windowClose';
import type { EventLogEntry, PackageSummary, PracticeSession } from '../../types';
import { useAppStore } from '../appStore';
import {
  appendEvent,
  getRecoveryEventSeq,
  listLocalRecords,
  loadRecoveryEvents,
  loadRecoverySnapshot,
  saveSessionSnapshot
} from '../../lib/storage';

const backend = vi.hoisted(() => ({
  snapshot: undefined as PracticeSession | undefined,
  events: [] as EventLogEntry[],
  windowCloseFaults: 0
}));

vi.mock('../../lib/storage', () => ({
  appendEvent: vi.fn(async (entry: EventLogEntry) => {
    if (!backend.events.some((event) => event.seq === entry.seq)) backend.events.push(entry);
  }),
  getRecoveryEventSeq: vi.fn(async () => Math.max(0, ...backend.events.map((event) => event.seq))),
  getAppSetting: vi.fn(async () => undefined),
  getAppPaths: vi.fn(async () => ({ source_root: 'fixture-source' })),
  listLocalRecords: vi.fn(async () => []),
  loadBlueprintOverride: vi.fn(async () => null),
  loadRecoveryEvents: vi.fn(async () => [...backend.events]),
  loadRecoverySnapshot: vi.fn(async () => JSON.stringify(backend.snapshot)),
  saveSessionSnapshot: vi.fn(async (session: PracticeSession, reason = 'RUNTIME') => {
    if (reason === 'WINDOW_CLOSE' && backend.windowCloseFaults > 0) {
      backend.windowCloseFaults -= 1;
      throw new Error('R006.3.1 one-shot close fault');
    }
    backend.snapshot = structuredClone(session);
  }),
  scanPackages: vi.fn(async () => []),
  exportSessionTextAtomic: vi.fn(async () => undefined),
  exportTextAtomic: vi.fn(async () => undefined),
  openSessionExportDirectory: vi.fn(async () => undefined),
  openTypingExportDirectory: vi.fn(async () => undefined)
}));

const pkg: PackageSummary = {
  package_id: 'Mock.01.A.1',
  source_path: 'fixture-source/Mock.01.A.1',
  modules: [{ module_name: 'PackageFiles', file_names: [] }]
};
const realRecoverSession = useAppStore.getState().recoverSession;

function fictionalSession(): PracticeSession {
  const initial = buildInitialSessionRuntime({
    session_schema_version: 5,
    session_id: 'Mock.01.A.1-r00631-three-stage',
    package_id: pkg.package_id,
    source_path: pkg.source_path,
    mode: 'practice',
    timing_profile_id: 'toefl-2026-practice',
    timing_profile_version: '1.0.0',
    blueprint_id: DEFAULT_BLUEPRINT.blueprint_id,
    blueprint_version: DEFAULT_BLUEPRINT.version,
    created_at: '2026-07-22T08:00:00.000Z',
    started_at: '2026-07-22T08:00:00.000Z',
    active_ms: 13_909,
    paused_ms: 26_924,
    current_section_id: 'Reading',
    current_module_id: 'READING_MODULE_1',
    current_scope_id: 'READING_MODULE_1',
    current_question_id: 'Reading-1',
    current_question_index: 0,
    questions: createQuestionsFromBlueprint(DEFAULT_BLUEPRINT, ['Reading']),
    answers: {},
    modules: [],
    view: 'PRACTICE'
  });
  const question = initial.questions[0];
  return markUncertain(
    upsertAnswer(initial, question, 'a', 13_909, false, '2026-07-22T08:00:13.909Z'),
    question.id,
    true,
    '2026-07-22T08:00:13.910Z'
  );
}

function seedStore(session: PracticeSession | undefined): void {
  useAppStore.setState({
    packages: [pkg],
    selectedPackage: pkg,
    blueprint: DEFAULT_BLUEPRINT,
    blueprintStatus: 'ready',
    blueprintErrors: [],
    session,
    timer: session ? createActivityTimer(session.current_question_id, 1_000, session.paused_ms) : undefined,
    events: session ? [...backend.events] : [],
    eventSeq: session ? Math.max(0, ...backend.events.map((event) => event.seq)) : 0,
    activeMs: session?.active_ms ?? 0,
    pausedMs: session?.paused_ms ?? 0,
    questionActiveMs: session?.answers['Reading-1']?.active_time_ms ?? 0,
    scopeActiveMs: session?.active_ms ?? 0,
    taskActiveMs: 0,
    taskRemainingMs: null,
    isPaused: false,
    windowClosePhase: 'IDLE',
    preCloseRuntimeState: undefined,
    saveStatus: 'idle',
    saveError: undefined,
    sessionNotice: undefined,
    recoverSession: realRecoverSession
  });
}

function closeCoordinator(destroy: () => Promise<void>) {
  return createWindowCloseCoordinator({
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
}

function requestClose(coordinator: ReturnType<typeof closeCoordinator>, source: string): void {
  coordinator.requestClose({ preventDefault: vi.fn() }, source);
}

const recoverySummary: LocalRecordSummary = {
  record_id: 'RECOVERY:Mock.01.A.1-r00631-three-stage',
  record_type: 'RECOVERY',
  session_id: 'Mock.01.A.1-r00631-three-stage',
  package_id: pkg.package_id,
  mode: 'practice',
  active_time_ms: 13_909,
  pause_time_ms: 26_924,
  completion_status: 'INCOMPLETE',
  export_status: 'RETRYABLE',
  schema_version: 'practice-session-v5',
  directory_size_bytes: 27_276,
  relative_path: 'data/recovery/Mock.01.A.1-r00631-three-stage.json',
  file_names: ['Mock.01.A.1-r00631-three-stage.json'],
  current_section_id: 'Reading',
  current_scope_id: 'READING_MODULE_1',
  selected_sections: ['Reading'],
  needs_migration: false
};

beforeEach(() => {
  vi.clearAllMocks();
  backend.snapshot = undefined;
  backend.events = [
    { session_id: 'Mock.01.A.1-r00631-three-stage', seq: 1, monotonic_elapsed_ms: 0, wall_clock: '2026-07-22T08:00:00.000Z', event_type: 'session_started', payload: {}, schema_version: '1.0.0' },
    { session_id: 'Mock.01.A.1-r00631-three-stage', seq: 2, monotonic_elapsed_ms: 0, wall_clock: '2026-07-22T08:00:00.000Z', event_type: 'question_entered', payload: { question_id: 'Reading-1' }, schema_version: '1.0.0' },
    { session_id: 'Mock.01.A.1-r00631-three-stage', seq: 3, monotonic_elapsed_ms: 2_133, wall_clock: '2026-07-22T08:00:02.133Z', event_type: 'answer_changed', payload: { question_id: 'Reading-1' }, schema_version: '1.0.0' }
  ];
  backend.windowCloseFaults = 0;
  vi.spyOn(performance, 'now').mockReturnValue(1_000);
  seedStore(fictionalSession());
});

afterEach(() => cleanup());

describe('R006.3.1 disposable save-close three-stage contract', () => {
  it('runs cancel, same-root Continue/retry, and third-start verification without changing identity', async () => {
    backend.windowCloseFaults = 1;
    const firstDestroy = vi.fn(async () => undefined);
    const first = closeCoordinator(firstDestroy);
    requestClose(first, 'title-bar X');
    await first.saveAndClose();
    expect(first.getState().phase).toBe('FAILED');
    expect(firstDestroy).not.toHaveBeenCalled();
    first.cancel();
    expect(useAppStore.getState()).toMatchObject({ isPaused: false, windowClosePhase: 'IDLE' });
    requestClose(first, 'title-bar X');
    await first.saveAndClose();
    expect(firstDestroy).toHaveBeenCalledOnce();
    expect(backend.snapshot?.answers['Reading-1']).toMatchObject({ answer_value: 'a', is_uncertain: true });

    seedStore(undefined);
    backend.windowCloseFaults = 1;
    const secondStart = await useAppStore.getState().recoverSession('Mock.01.A.1-r00631-three-stage');
    expect(secondStart).toEqual({ ok: true });
    expect(useAppStore.getState()).toMatchObject({ isPaused: true, activeMs: 13_909 });
    expect(useAppStore.getState().session).toMatchObject({
      session_id: 'Mock.01.A.1-r00631-three-stage',
      view: 'PRACTICE',
      current_section_id: 'Reading',
      current_module_id: 'READING_MODULE_1',
      current_scope_id: 'READING_MODULE_1',
      current_question_id: 'Reading-1',
      current_question_index: 0
    });
    expect(useAppStore.getState().session?.answers['Reading-1']).toMatchObject({ answer_value: 'a', is_uncertain: true });
    useAppStore.getState().togglePause();
    const secondDestroy = vi.fn(async () => undefined);
    const second = closeCoordinator(secondDestroy);
    requestClose(second, 'Alt+F4');
    await second.saveAndClose();
    expect(second.getState().phase).toBe('FAILED');
    expect(secondDestroy).not.toHaveBeenCalled();
    await second.retry();
    expect(secondDestroy).toHaveBeenCalledOnce();

    seedStore(undefined);
    const thirdStart = await useAppStore.getState().recoverSession('Mock.01.A.1-r00631-three-stage');
    expect(thirdStart).toEqual({ ok: true });
    expect(useAppStore.getState()).toMatchObject({ isPaused: true });
    expect(useAppStore.getState().session).toMatchObject({
      session_id: 'Mock.01.A.1-r00631-three-stage',
      current_question_id: 'Reading-1',
      view: 'PRACTICE'
    });
    expect(new Set(backend.events.map((event) => event.seq)).size).toBe(backend.events.length);
    expect(backend.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('shows an immediate pending state and prevents duplicate Continue actions', async () => {
    vi.mocked(listLocalRecords).mockResolvedValueOnce([recoverySummary]);
    let finish: ((value: { ok: true }) => void) | undefined;
    const recoverSession = vi.fn(() => new Promise<{ ok: true }>((resolve) => { finish = resolve; }));
    useAppStore.setState({ session: undefined, recoverSession });
    render(<RecoveryPanel />);
    const button = await screen.findByRole('button', { name: '继续练习' });
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/正在校验并恢复/)).not.toBeNull();
    fireEvent.click(button);
    expect(recoverSession).toHaveBeenCalledOnce();
    await act(async () => {
      finish?.({ ok: true });
      await Promise.resolve();
    });
  });

  it('identifies which Recovery load step failed without exposing answer content', async () => {
    backend.snapshot = fictionalSession();
    vi.mocked(loadRecoveryEvents).mockRejectedValueOnce(new Error('database is locked'));
    seedStore(undefined);
    const result = await useAppStore.getState().recoverSession('Mock.01.A.1-r00631-three-stage');
    expect(result).toEqual({
      ok: false,
      error: 'RECOVERY_EVENTS_LOAD_FAILED: database is locked'
    });
    expect(result.error).not.toContain('answer_value');
    expect(loadRecoverySnapshot).toHaveBeenCalledOnce();
    expect(getRecoveryEventSeq).toHaveBeenCalledOnce();
    expect(appendEvent).not.toHaveBeenCalled();
    expect(saveSessionSnapshot).not.toHaveBeenCalled();
  });
});
