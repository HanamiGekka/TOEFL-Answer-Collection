import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackageSummary, PracticeMode, PracticeSession } from '../../types';
import { DEFAULT_BLUEPRINT, createQuestionsFromBlueprint } from '../../lib/blueprint';
import { buildInitialSessionRuntime } from '../../lib/sessionEngine';
import {
  advanceAfterSpeakingTask,
  enterTask,
  markSpeakingTask,
  retrySpeakingTask,
  speakingRetryTaskIdsInCurrentScope,
  startSpeakingTask
} from '../../lib/taskRuntime';
import { createActivityTimer } from '../../lib/timeLedger';
import { useAppStore } from '../appStore';
import { PracticeShell } from '../../components/PracticeShell';

vi.mock('../../lib/storage', () => ({
  appendEvent: vi.fn(async () => undefined), saveSessionSnapshot: vi.fn(async () => undefined),
  scanPackages: vi.fn(async () => []), exportSessionTextAtomic: vi.fn(async () => undefined),
  exportTextAtomic: vi.fn(async () => undefined), openSessionExportDirectory: vi.fn(async () => undefined),
  openTypingExportDirectory: vi.fn(async () => undefined)
}));

const pkg: PackageSummary = { package_id: 'Mock.01.A.1', source_path: 'fixture-source', modules: [] };

function completedListenRepeat(mode: PracticeMode, retryIds: string[]): PracticeSession {
  let value = buildInitialSessionRuntime({
    session_schema_version: 5, session_id: `r0063-speaking-${mode}`,
    package_id: pkg.package_id, source_path: pkg.source_path, mode,
    timing_profile_id: mode === 'practice' ? 'toefl-2026-practice' : 'toefl-2026-exam-simulation',
    timing_profile_version: '1.0.0', blueprint_id: DEFAULT_BLUEPRINT.blueprint_id,
    blueprint_version: DEFAULT_BLUEPRINT.version, created_at: '2026-07-22T05:00:00.000Z',
    started_at: '2026-07-22T05:00:00.000Z', active_ms: 0, paused_ms: 0,
    questions: createQuestionsFromBlueprint(DEFAULT_BLUEPRINT, ['Speaking']), answers: {}, modules: [], view: 'PRACTICE'
  });
  for (const taskId of ['SR1', 'SR2', 'SR3', 'SR4', 'SR5', 'SR6', 'SR7']) {
    value = startSpeakingTask(enterTask(value, taskId), taskId);
    value = markSpeakingTask(value, taskId, retryIds.includes(taskId) ? 'NEEDS_RETRY' : 'COMPLETED');
    value = advanceAfterSpeakingTask(value);
  }
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(performance, 'now').mockReturnValue(0);
});

describe.each(['practice', 'exam_simulation'] as const)('R006.3 Speaking NEEDS_RETRY policy in %s', (mode) => {
  it('centralizes one retry and preserves attempt/time when it later becomes COMPLETED', () => {
    const value = completedListenRepeat(mode, ['SR4']);
    expect(speakingRetryTaskIdsInCurrentScope(value)).toEqual(['SR4']);
    const before = value.tasks.find((task) => task.task_id === 'SR4')!;
    const retried = retrySpeakingTask(value, 'SR4', '2026-07-22T05:01:00.000Z');
    const completed = markSpeakingTask(retried, 'SR4', 'COMPLETED', '2026-07-22T05:01:01.000Z');
    expect(completed.tasks.find((task) => task.task_id === 'SR4')).toMatchObject({
      status: 'COMPLETED',
      needs_retry: false,
      attempt_count: before.attempt_count + 1,
      active_time_ms: before.active_time_ms
    });
  });

  it('offers first-retry or explicit completion and never rewrites NEEDS_RETRY', async () => {
    const value = completedListenRepeat(mode, ['SR2', 'SR5']);
    expect(speakingRetryTaskIdsInCurrentScope(value)).toEqual(['SR2', 'SR5']);
    useAppStore.setState({
      packages: [pkg], selectedPackage: pkg, session: value,
      timer: { ...createActivityTimer(value.current_question_id, 0), currentActivityStartedAtMonotonic: null },
      events: [], eventSeq: 0, activeMs: 0, pausedMs: 0, questionActiveMs: 0, scopeActiveMs: 0,
      taskActiveMs: 0, taskRemainingMs: null, isPaused: false, windowClosePhase: 'IDLE',
      speakingTransitionPending: false, saveStatus: 'idle', exportStatus: 'idle', sessionNotice: undefined
    });

    await useAppStore.getState().finalizeCurrentScope();
    expect(useAppStore.getState().session?.modules[0].status).not.toBe('FINALIZED');
    expect(useAppStore.getState().sessionNotice).toMatchObject({
      retryAction: 'CONFIRM_SPEAKING_RETRIES', taskIds: ['SR2', 'SR5']
    });

    render(createElement(PracticeShell));
    const dialog = screen.getByRole('dialog', { name: '完成前提示' });
    expect(within(dialog).getByText(/2 个需重练项目/)).toBeTruthy();
    expect(within(dialog).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('button', { name: '前往第一个需重练项目' }));
    expect(useAppStore.getState().session?.current_task_id).toBe('SR2');
    expect(useAppStore.getState().session?.tasks.find((task) => task.task_id === 'SR2')?.status).toBe('NEEDS_RETRY');
    cleanup();

    const confirmValue = completedListenRepeat(mode, ['SR2', 'SR5']);
    useAppStore.setState({
      session: confirmValue,
      timer: { ...createActivityTimer(confirmValue.current_question_id, 0), currentActivityStartedAtMonotonic: null },
      sessionNotice: undefined
    });
    await useAppStore.getState().finalizeCurrentScope();
    await useAppStore.getState().confirmFinalizeWithSpeakingRetries();
    const finalized = useAppStore.getState().session;
    expect(finalized?.modules[0].status).toBe('FINALIZED');
    expect(finalized?.tasks.filter((task) => task.needs_retry).map((task) => [task.task_id, task.status]))
      .toEqual([['SR2', 'NEEDS_RETRY'], ['SR5', 'NEEDS_RETRY']]);
    expect(useAppStore.getState().events.filter((event) => event.event_type === 'scope_finalized')).toHaveLength(1);
  });
});
