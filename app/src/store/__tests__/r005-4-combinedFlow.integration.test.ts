import { describe, expect, it } from 'vitest';
import type { PracticeSession, SectionName } from '../../types';
import {
  buildInitialSessionRuntime,
  createDefaultQuestions,
  finalizeCurrentScope,
  markQuestionEncountered
} from '../../lib/sessionEngine';
import {
  advanceAfterSpeakingTask,
  getCurrentTask,
  markSpeakingTask,
  startSpeakingTask
} from '../../lib/taskRuntime';
import { deriveTimingLedger } from '../../lib/timeLedger';
import { serializeSessionForPersistence } from '../../lib/persistedTime';

function session(sections: SectionName[]): PracticeSession {
  const now = '2026-07-11T16:00:00.000Z';
  return buildInitialSessionRuntime({
    session_schema_version: 4,
    session_id: `combined-${sections.join('-')}`,
    package_id: 'Mock.01.A.1',
    source_path: 'readonly',
    mode: 'practice',
    timing_profile_id: 'toefl-2026-practice',
    timing_profile_version: '1.0.0',
    created_at: now,
    started_at: now,
    active_ms: 0,
    paused_ms: 0,
    current_section: sections[0],
    current_question_index: 0,
    questions: createDefaultQuestions(sections),
    answers: {},
    modules: [],
    view: 'PRACTICE'
  });
}

async function finishScope(value: PracticeSession): Promise<PracticeSession> {
  const visited = value.active_scope_question_ids.reduce(
    (current, questionId) => markQuestionEncountered(current, questionId),
    value
  );
  const result = await finalizeCurrentScope(visited, 0, async () => undefined);
  if (!result.ok) throw new Error(result.reason);
  return result.session;
}

function finishSpeakingItems(value: PracticeSession): PracticeSession {
  let current = value;
  for (let step = 0; step < 11; step += 1) {
    const task = getCurrentTask(current);
    if (!task || task.section_id !== 'Speaking') return current;
    current = startSpeakingTask(current, task.task_id);
    current = markSpeakingTask(current, task.task_id, task.task_id === 'SR3' ? 'NEEDS_RETRY' : 'COMPLETED');
    const advanced = advanceAfterSpeakingTask(current);
    if (advanced.current_task_id === current.current_task_id) return current;
    current = advanced;
  }
  throw new Error('Speaking item traversal exceeded the expected task count.');
}

async function finishAll(value: PracticeSession): Promise<PracticeSession> {
  let current = value;
  while (current.view !== 'SESSION_SUMMARY') {
    if (current.current_section_id === 'Speaking') current = finishSpeakingItems(current);
    current = await finishScope(current);
  }
  return current;
}

describe('R005.4 combined Section flows', () => {
  it('completes Writing-only through three independent Task scopes', async () => {
    const completed = await finishAll(session(['Writing']));
    expect(completed.view).toBe('SESSION_SUMMARY');
    expect(completed.modules.map((scope) => scope.status)).toEqual(['FINALIZED', 'FINALIZED', 'FINALIZED']);
    expect(completed.completed_sections).toEqual(['Writing']);
  });

  it('completes Speaking-only with SR1–SR7 then SI1–SI4', async () => {
    const completed = await finishAll(session(['Speaking']));
    expect(completed.view).toBe('SESSION_SUMMARY');
    expect(completed.tasks.filter((task) => task.section_id === 'Speaking')).toHaveLength(11);
    expect(completed.tasks.find((task) => task.task_id === 'SR3')).toMatchObject({ needs_retry: true, status: 'NEEDS_RETRY' });
    expect(completed.tasks.find((task) => task.task_id === 'SI4')?.status).toBe('COMPLETED');
  });

  it('completes Writing + Speaking and keeps task identities isolated', async () => {
    const completed = await finishAll(session(['Writing', 'Speaking']));
    expect(completed.completed_sections).toEqual(['Writing', 'Speaking']);
    expect(completed.tasks.filter((task) => task.section_id === 'Writing')).toHaveLength(3);
    expect(completed.tasks.filter((task) => task.section_id === 'Speaking')).toHaveLength(11);
  });

  it('completes Reading → Listening → Writing → Speaking with exact integer hierarchy', async () => {
    const completed = serializeSessionForPersistence(await finishAll(session(['Reading', 'Listening', 'Writing', 'Speaking'])));
    const ledger = deriveTimingLedger(completed);
    expect(completed.completed_sections).toEqual(['Reading', 'Listening', 'Writing', 'Speaking']);
    expect(ledger.sessionActiveMs).toBe(ledger.attributedActiveMs + ledger.unattributedActiveMs);
    expect(Object.values(ledger.tasks).every(Number.isSafeInteger)).toBe(true);
    expect(Object.values(ledger.scopes).every(Number.isSafeInteger)).toBe(true);
    expect(Object.values(ledger.sections).every(Number.isSafeInteger)).toBe(true);
  });
});
