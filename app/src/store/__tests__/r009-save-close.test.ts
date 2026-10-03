import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDynamicItem, createDynamicSession } from '../../lib/dynamicSession';
import { getItemTypePreset } from '../../lib/itemTypeRegistry';
import { createActivityTimer } from '../../lib/timeLedger';
import { saveSessionSnapshot } from '../../lib/storage';
import { useAppStore } from '../appStore';

vi.mock('../../lib/storage', () => ({
  saveSessionSnapshot: vi.fn(async () => undefined), appendEvent: vi.fn(async () => undefined)
}));

beforeEach(async () => {
  await useAppStore.getState().persist();
  vi.clearAllMocks();
  const session = createDynamicItem(createDynamicSession({ session_id: 'synthetic-close',
    package_id: 'Synthetic close', mode: 'practice', selected_sections: ['Reading'],
    created_at: '2026-10-03T00:00:00.000Z' }), 'Reading',
  getItemTypePreset('Reading', 'reading_single_choice')).session;
  useAppStore.setState({ session, timer: createActivityTimer('R1', 0),
    isPaused: false, activeMs: 0, pausedMs: 0, events: [], eventSeq: 0,
    preCloseRuntimeState: undefined, windowClosePhase: 'IDLE', dynamicItemDialog: undefined });
});
afterEach(() => vi.restoreAllMocks());

it('holds current v6 timing during close and resumes only an originally active session', async () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(500);
  const hold = useAppStore.getState().beginWindowCloseHold();
  expect(hold.kind).toBe('ACTIVE_SESSION');
  expect(useAppStore.getState().session?.active_ms).toBe(500);
  clock.mockReturnValue(3500);
  useAppStore.getState().tick();
  expect(useAppStore.getState().session?.active_ms).toBe(500);
  useAppStore.getState().cancelWindowCloseHold(hold);
  await useAppStore.getState().persist();
  expect(useAppStore.getState().session?.questions[0].pause_time_ms).toBe(3000);
  expect(useAppStore.getState().timer?.currentActivityStartedAtMonotonic).toBe(3500);
  useAppStore.getState().togglePause();
  const pausedHold = useAppStore.getState().beginWindowCloseHold();
  expect(pausedHold.kind).toBe('PAUSED_SESSION');
  clock.mockReturnValue(5000);
  useAppStore.getState().cancelWindowCloseHold(pausedHold);
  await useAppStore.getState().persist();
  expect(useAppStore.getState().isPaused).toBe(true);
  expect(useAppStore.getState().timer?.currentActivityStartedAtMonotonic).toBeNull();
});

it('queues the newest v6 answer behind an in-flight autosave and keeps close-save priority', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(1000);
  let release!: () => void;
  vi.mocked(saveSessionSnapshot).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  const first = useAppStore.getState().persist('AUTOSAVE');
  useAppStore.getState().answerCurrent('B');
  useAppStore.getState().beginWindowCloseHold();
  useAppStore.getState().setWindowClosePhase('SAVING');
  const latest = useAppStore.getState().persist('WINDOW_CLOSE');
  release();
  await Promise.all([first, latest]);
  const last = vi.mocked(saveSessionSnapshot).mock.calls.at(-1)!;
  expect(last[1]).toBe('WINDOW_CLOSE');
  expect(last[0].answers.R1.answer_value).toBe('B');
  expect(last[0].active_ms).toBe(1000);
  expect(useAppStore.getState().timer?.currentActivityStartedAtMonotonic).toBeNull();
});

it('retains the v6 answer after a failed save and retries the same identity', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(1000);
  useAppStore.getState().answerCurrent('C');
  await useAppStore.getState().persist();
  vi.mocked(saveSessionSnapshot).mockRejectedValueOnce(new Error('synthetic disk full'));
  await useAppStore.getState().persist('WINDOW_CLOSE');
  expect(useAppStore.getState().saveStatus).toBe('error');
  expect(useAppStore.getState().session?.answers.R1.answer_value).toBe('C');
  await useAppStore.getState().persist('WINDOW_CLOSE');
  expect(useAppStore.getState().saveStatus).toBe('saved');
  expect(vi.mocked(saveSessionSnapshot).mock.calls.at(-1)![0].session_id).toBe('synthetic-close');
});
