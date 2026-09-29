import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackageSummary, PracticeSession } from '../../types';
import { createActivityTimer } from '../../lib/timeLedger';
import { enterTask } from '../../lib/taskRuntime';
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
    packages: [pkg], selectedPackage: pkg, mode: 'practice', selectedSections: ['Speaking'],
    session: undefined, events: [], eventSeq: 0, timer: undefined, activeMs: 0, pausedMs: 0,
    questionActiveMs: 0, scopeActiveMs: 0, taskActiveMs: 0, taskRemainingMs: null,
    isPaused: false, navigationLockedUntil: 0, saveStatus: 'idle', exportStatus: 'idle', sessionNotice: undefined,
    speakingTransitionPending: false, speakingTransitionGuardUntil: 0
  });
    startLegacySessionForTest();
});

function activeSession(): PracticeSession {
  const current = useAppStore.getState().session;
  if (!current) throw new Error('missing session');
  return current;
}

async function startAt(time = 0): Promise<void> {
  now = time;
  await useAppStore.getState().startSpeakingCurrent();
}

describe('R005.4.1 Store-level Speaking transition guard', () => {
  it.each(['COMPLETED', 'NEEDS_RETRY'] as const)('rejects %s at Start + 500ms', async (outcome) => {
    await startAt();
    now = 500;
    await useAppStore.getState().markSpeakingCurrent(outcome);
    expect(activeSession().tasks.find((task) => task.task_id === 'SR1')?.status).toBe('ACTIVE');
    expect(useAppStore.getState().events.filter((event) => event.event_type === 'speaking_task_result')).toHaveLength(0);
  });

  it('accepts Complete at Start + 750ms', async () => {
    await startAt();
    now = 750;
    await useAppStore.getState().markSpeakingCurrent('COMPLETED');
    expect(activeSession().tasks.find((task) => task.task_id === 'SR1')?.status).toBe('COMPLETED');
    expect(useAppStore.getState().events.filter((event) => event.event_type === 'speaking_task_result')).toHaveLength(1);
  });

  it('double Start creates one attempt and one event', async () => {
    const first = useAppStore.getState().startSpeakingCurrent();
    const second = useAppStore.getState().startSpeakingCurrent();
    await Promise.all([first, second]);
    expect(activeSession().tasks.find((task) => task.task_id === 'SR1')?.attempt_count).toBe(1);
    expect(useAppStore.getState().events.filter((event) => event.event_type === 'speaking_task_started')).toHaveLength(1);
  });

  it('rejects duplicate result actions while persistence is pending', async () => {
    await startAt();
    now = 750;
    let resolveSave!: () => void;
    vi.mocked(saveSessionSnapshot).mockImplementationOnce(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    const first = useAppStore.getState().markSpeakingCurrent('COMPLETED');
    const second = useAppStore.getState().markSpeakingCurrent('COMPLETED');
    expect(useAppStore.getState().speakingTransitionPending).toBe(true);
    resolveSave();
    await Promise.all([first, second]);
    expect(useAppStore.getState().events.filter((event) => event.event_type === 'speaking_task_result')).toHaveLength(1);
  });

  it('does not block global Pause inside the guard', async () => {
    await startAt();
    now = 500;
    useAppStore.getState().togglePause();
    expect(useAppStore.getState().isPaused).toBe(true);
    expect(activeSession().tasks.find((task) => task.task_id === 'SR1')?.status).toBe('PAUSED');
  });

  it('applies a fresh guard to a retry attempt', async () => {
    await startAt();
    now = 750;
    await useAppStore.getState().markSpeakingCurrent('NEEDS_RETRY');
    now = 800;
    await useAppStore.getState().retrySpeakingCurrent();
    now = 1_300;
    await useAppStore.getState().markSpeakingCurrent('COMPLETED');
    expect(activeSession().tasks.find((task) => task.task_id === 'SR1')).toMatchObject({ status: 'ACTIVE', attempt_count: 2 });
    now = 1_550;
    await useAppStore.getState().markSpeakingCurrent('COMPLETED');
    expect(activeSession().tasks.find((task) => task.task_id === 'SR1')?.status).toBe('COMPLETED');
  });

  it('cannot be bypassed by calling the Store action directly', async () => {
    await startAt();
    now = 1;
    await useAppStore.getState().markSpeakingCurrent('COMPLETED');
    expect(activeSession().current_task_id).toBe('SR1');
  });

  it('covers Interview with the same 750ms guard', async () => {
    const interview = enterTask(activeSession(), 'SI1');
    useAppStore.setState({ session: interview, timer: createActivityTimer('Speaking-8', now) });
    await startAt(10_000);
    now = 10_500;
    await useAppStore.getState().markSpeakingCurrent('COMPLETED');
    expect(activeSession().tasks.find((task) => task.task_id === 'SI1')?.status).toBe('ACTIVE');
    now = 10_750;
    await useAppStore.getState().markSpeakingCurrent('COMPLETED');
    expect(activeSession().tasks.find((task) => task.task_id === 'SI1')?.status).toBe('COMPLETED');
  });

  it('does not carry a monotonic guard through a new restored session', async () => {
    await startAt();
    expect(useAppStore.getState().speakingTransitionGuardUntil).toBe(750);
    useAppStore.getState().returnHome();
    useAppStore.setState({ selectedPackage: pkg, selectedSections: ['Speaking'] });
    now = 10_000;
    startLegacySessionForTest();
    expect(useAppStore.getState().speakingTransitionGuardUntil).toBe(0);
  });
});

describe('R005.4.1 overtime transition event', () => {
  it('emits exactly one Writing overtime event at 420000ms', () => {
    useAppStore.setState({ selectedSections: ['Writing'] });
    startLegacySessionForTest();
    const current = enterTask(activeSession(), 'WRITING_EMAIL');
    useAppStore.setState({ session: current, timer: createActivityTimer('Writing-11', 0) });
    now = 420_000;
    useAppStore.getState().tick();
    now = 420_001;
    useAppStore.getState().tick();
    expect(activeSession().tasks.find((task) => task.task_id === 'WRITING_EMAIL')?.is_overtime).toBe(true);
    expect(useAppStore.getState().events.filter((event) => event.event_type === 'task_overtime')).toHaveLength(1);
  });
});
