import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackageSummary, PracticeSession } from '../../types';
import { enterTask, markSpeakingTask, startSpeakingTask } from '../../lib/taskRuntime';
import { createActivityTimer } from '../../lib/timeLedger';
import { markQuestionEncountered } from '../../lib/sessionEngine';
import { saveSessionSnapshot } from '../../lib/storage';
import { useAppStore } from '../appStore';
import { startLegacySessionForTest } from '../../test/legacySession';

vi.mock('../../lib/storage', () => ({
  scanPackages: vi.fn(async () => []), appendEvent: vi.fn(async () => undefined),
  saveSessionSnapshot: vi.fn(async () => undefined), exportSessionTextAtomic: vi.fn(async () => undefined),
  exportTextAtomic: vi.fn(async () => undefined), openSessionExportDirectory: vi.fn(async () => undefined),
  openTypingExportDirectory: vi.fn(async () => undefined)
}));

const pkg: PackageSummary = { package_id: 'Mock.01.A.1', source_path: 'readonly', modules: [] };
let now = 0;

beforeEach(() => {
  vi.clearAllMocks();
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  useAppStore.setState({
    packages: [pkg], selectedPackage: pkg, mode: 'practice', selectedSections: ['Writing'],
    session: undefined, events: [], eventSeq: 0, timer: undefined, activeMs: 0, pausedMs: 0,
    questionActiveMs: 0, scopeActiveMs: 0, taskActiveMs: 0, taskRemainingMs: null,
    isPaused: false, navigationLockedUntil: 0, saveStatus: 'idle', exportStatus: 'idle', sessionNotice: undefined
  });
});

function activeSession(): PracticeSession {
  const session = useAppStore.getState().session;
  if (!session) throw new Error('expected session');
  return session;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function completeCurrentScope(): Promise<void> {
  const session = activeSession();
  useAppStore.setState({
    session: session.active_scope_question_ids.reduce(
      (current, questionId) => markQuestionEncountered(current, questionId),
      session
    )
  });
  await useAppStore.getState().finalizeCurrentScope();
}

async function moveToEmail(): Promise<void> {
    startLegacySessionForTest();
  await flush();
  await completeCurrentScope();
  vi.mocked(saveSessionSnapshot).mockClear();
}

describe('R005.4 Store Task transactions', () => {
  it('starts Email and Discussion on independent zero-based timers', async () => {
    await moveToEmail();
    expect(activeSession().current_task_id).toBe('WRITING_EMAIL');
    expect(useAppStore.getState()).toMatchObject({ taskActiveMs: 0, taskRemainingMs: 420_000 });
    now = 2_000;
    useAppStore.getState().updateWritingText('Email', 'insertText');
    expect(activeSession().tasks.find((task) => task.task_id === 'WRITING_EMAIL')?.active_time_ms).toBe(2_000);
    await completeCurrentScope();
    expect(activeSession().current_task_id).toBe('WRITING_ACADEMIC_DISCUSSION');
    expect(useAppStore.getState()).toMatchObject({ taskActiveMs: 0, taskRemainingMs: 600_000 });
  });

  it('does not switch Writing Task when integer snapshot persistence fails', async () => {
    await moveToEmail();
    useAppStore.getState().updateWritingText('Keep me', 'insertText');
    vi.mocked(saveSessionSnapshot).mockRejectedValueOnce(new Error('disk full'));
    await useAppStore.getState().finalizeCurrentScope();
    expect(activeSession().current_task_id).toBe('WRITING_EMAIL');
    expect(activeSession().tasks.find((task) => task.task_id === 'WRITING_EMAIL')?.text).toBe('Keep me');
    expect(useAppStore.getState().sessionNotice?.message).toContain('disk full');
  });

  it('keeps practice Writing text editable after overtime', async () => {
    await moveToEmail();
    now = 420_100;
    useAppStore.getState().updateWritingText('After timeout', 'insertText');
    expect(activeSession().tasks.find((task) => task.task_id === 'WRITING_EMAIL')).toMatchObject({
      text: 'After timeout', is_overtime: true, remaining_ms: 0
    });
  });

  it('freezes exam Writing edits at zero without clearing existing text', async () => {
    useAppStore.setState({ mode: 'exam_simulation' });
    await moveToEmail();
    useAppStore.getState().updateWritingText('Before timeout', 'insertText');
    now = 420_100;
    useAppStore.getState().updateWritingText('Should not replace', 'insertText');
    expect(activeSession().tasks.find((task) => task.task_id === 'WRITING_EMAIL')).toMatchObject({
      text: 'Before timeout', is_overtime: true, remaining_ms: 0, active_time_ms: 420_000
    });
    expect(useAppStore.getState().timer?.currentActivityStartedAtMonotonic).toBeNull();
  });

  it('does not count Speaking time before explicit start', () => {
    useAppStore.setState({ selectedSections: ['Speaking'] });
    startLegacySessionForTest();
    now = 10_000;
    useAppStore.getState().tick();
    expect(useAppStore.getState()).toMatchObject({ taskActiveMs: 0, scopeActiveMs: 0 });
    expect(useAppStore.getState().timer?.currentActivityStartedAtMonotonic).toBeNull();
  });

  it('starts Listen and Repeat, freezes on global pause, and attributes task pause', () => {
    useAppStore.setState({ selectedSections: ['Speaking'] });
    startLegacySessionForTest();
    useAppStore.getState().startSpeakingCurrent();
    now = 1_000;
    useAppStore.getState().togglePause();
    now = 3_000;
    useAppStore.getState().togglePause();
    const task = activeSession().tasks.find((item) => item.task_id === 'SR1');
    expect(task).toMatchObject({ active_time_ms: 1_000, pause_time_ms: 2_000, status: 'ACTIVE' });
    expect(useAppStore.getState().pausedMs).toBe(2_000);
  });

  it('persists a Speaking result before switching to the next item', async () => {
    useAppStore.setState({ selectedSections: ['Speaking'] });
    startLegacySessionForTest();
    await flush();
    vi.mocked(saveSessionSnapshot).mockClear();
    await useAppStore.getState().startSpeakingCurrent();
    vi.mocked(saveSessionSnapshot).mockClear();
    now = 750;
    await useAppStore.getState().markSpeakingCurrent('COMPLETED');
    expect(vi.mocked(saveSessionSnapshot).mock.calls[0][0].current_task_id).toBe('SR1');
    expect(vi.mocked(saveSessionSnapshot).mock.calls[0][0].tasks.find((task) => task.task_id === 'SR1')?.status).toBe('COMPLETED');
    expect(activeSession().current_task_id).toBe('SR2');
    expect(activeSession().tasks.find((task) => task.task_id === 'SR2')?.status).toBe('ACTIVE');
  });

  it('keeps the current Speaking item when persistence fails', async () => {
    useAppStore.setState({ selectedSections: ['Speaking'] });
    startLegacySessionForTest();
    await flush();
    await useAppStore.getState().startSpeakingCurrent();
    vi.mocked(saveSessionSnapshot).mockRejectedValueOnce(new Error('save rejected'));
    now = 750;
    await useAppStore.getState().markSpeakingCurrent('NEEDS_RETRY');
    expect(activeSession().current_task_id).toBe('SR1');
    expect(activeSession().tasks.find((task) => task.task_id === 'SR1')?.needs_retry).toBe(true);
    expect(useAppStore.getState().sessionNotice?.message).toContain('save rejected');
  });

  it('keeps old attempt events and appends retry with a higher attempt_count', async () => {
    useAppStore.setState({ selectedSections: ['Speaking'] });
    startLegacySessionForTest();
    let session = enterTask(activeSession(), 'SI1');
    useAppStore.setState({ session, timer: createActivityTimer('Speaking-8', now) });
    await useAppStore.getState().startSpeakingCurrent();
    now = 750;
    await useAppStore.getState().markSpeakingCurrent('NEEDS_RETRY');
    session = enterTask(activeSession(), 'SI1');
    useAppStore.setState({ session, timer: createActivityTimer('Speaking-8', now) });
    now = 800;
    await useAppStore.getState().retrySpeakingCurrent();
    const events = useAppStore.getState().events.filter((event) => event.event_type.startsWith('speaking_task_'));
    expect(events.some((event) => event.event_type === 'speaking_task_result')).toBe(true);
    expect(events.at(-1)).toMatchObject({ event_type: 'speaking_task_retried', payload: { attempt_count: 2 } });
  });

  it('moves through completed Listen and Repeat history without rewriting results or attempts', async () => {
    useAppStore.setState({ selectedSections: ['Speaking'] });
    startLegacySessionForTest();
    let session = startSpeakingTask(activeSession(), 'SR1');
    session = markSpeakingTask(session, 'SR1', 'COMPLETED');
    session = startSpeakingTask(enterTask(session, 'SR2'), 'SR2');
    session = markSpeakingTask(session, 'SR2', 'COMPLETED');
    session = enterTask(session, 'SR1');
    useAppStore.setState({ session, timer: createActivityTimer('Speaking-1', now) });
    const resultEvents = useAppStore.getState().events.filter((event) => event.event_type === 'speaking_task_result').length;

    await useAppStore.getState().advanceSpeakingCurrent();
    expect(activeSession().current_task_id).toBe('SR2');
    expect(activeSession().tasks.find((task) => task.task_id === 'SR2')).toMatchObject({ status: 'COMPLETED', attempt_count: 1 });
    expect(useAppStore.getState().events.filter((event) => event.event_type === 'speaking_task_result')).toHaveLength(resultEvents);

    await useAppStore.getState().advanceSpeakingCurrent();
    expect(activeSession().current_task_id).toBe('SR3');
    expect(activeSession().tasks.find((task) => task.task_id === 'SR3')).toMatchObject({ status: 'ACTIVE', attempt_count: 1 });
  });

  it('moves through completed Interview history and leaves the next unstarted item gated', async () => {
    useAppStore.setState({ selectedSections: ['Speaking'] });
    startLegacySessionForTest();
    let session = startSpeakingTask(enterTask(activeSession(), 'SI1'), 'SI1');
    session = markSpeakingTask(session, 'SI1', 'COMPLETED');
    session = startSpeakingTask(enterTask(session, 'SI2'), 'SI2');
    session = markSpeakingTask(session, 'SI2', 'COMPLETED');
    session = enterTask(session, 'SI1');
    useAppStore.setState({ session, timer: createActivityTimer('Speaking-8', now) });

    await useAppStore.getState().advanceSpeakingCurrent();
    expect(activeSession().current_task_id).toBe('SI2');
    expect(activeSession().tasks.find((task) => task.task_id === 'SI2')?.status).toBe('COMPLETED');

    await useAppStore.getState().advanceSpeakingCurrent();
    expect(activeSession().current_task_id).toBe('SI3');
    expect(activeSession().tasks.find((task) => task.task_id === 'SI3')).toMatchObject({ status: 'NOT_STARTED', attempt_count: 0 });
  });
});
