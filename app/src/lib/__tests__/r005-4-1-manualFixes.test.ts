import { describe, expect, it } from 'vitest';
import type { AnswerRecord, PracticeSession, SectionName } from '../../types';
import {
  buildInitialSessionRuntime,
  createDefaultQuestions,
  finalizeQuestion,
  migratePracticeSession,
  shouldQuestionBeOvertime
} from '../sessionEngine';
import { buildSessionExportBundle } from '../sessionExport';
import { deriveTimingLedger } from '../timeLedger';
import {
  addCurrentTaskPause,
  applyTaskActivityDelta,
  enterTask,
  getCurrentTask,
  getTaskTimingState,
  isWritingTaskEditable,
  markSpeakingTask,
  startSpeakingTask
} from '../taskRuntime';

function session(sections: SectionName[], mode: 'practice' | 'exam_simulation' = 'practice'): PracticeSession {
  const now = '2026-07-12T00:00:00.000Z';
  return buildInitialSessionRuntime({
    session_schema_version: 4,
    session_id: 'r005-4-1-fixture',
    package_id: 'Mock.01.A.1',
    source_path: 'readonly',
    mode,
    timing_profile_id: `toefl-2026-${mode}`,
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

function taskAt(taskId: string) {
  const value = enterTask(session(['Writing']), taskId);
  const task = getCurrentTask(value);
  if (!task) throw new Error(`missing ${taskId}`);
  return task;
}

function answer(questionId: string, activeMs: number): AnswerRecord {
  const now = '2026-07-12T00:00:00.000Z';
  return {
    question_id: questionId,
    answer_value: null,
    progress_status: 'ENCOUNTERED_UNANSWERED',
    status: 'ENCOUNTERED_UNANSWERED',
    is_overtime: false,
    is_skipped: false,
    is_uncertain: false,
    active_time_ms: activeMs,
    total_active_ms: activeMs,
    modification_count: 0,
    revision_count: 0,
    marked_review: false,
    last_changed_at: now,
    updated_at: now
  };
}

describe('R005.4.1 single Task timing source', () => {
  it.each([
    [419_999, false, 1],
    [420_000, true, 0],
    [420_001, true, 0]
  ])('uses the Email boundary at %ims', (activeMs, isOvertime, remainingMs) => {
    expect(getTaskTimingState(taskAt('WRITING_EMAIL'), activeMs)).toMatchObject({
      active_time_ms: activeMs,
      remaining_ms: remainingMs,
      is_overtime: isOvertime
    });
  });

  it.each([
    [599_999, false, 1],
    [600_000, true, 0]
  ])('uses the Discussion boundary at %ims', (activeMs, isOvertime, remainingMs) => {
    expect(getTaskTimingState(taskAt('WRITING_ACADEMIC_DISCUSSION'), activeMs)).toMatchObject({
      active_time_ms: activeMs,
      remaining_ms: remainingMs,
      is_overtime: isOvertime
    });
  });

  it('ignores a restored legacy 450000ms Question threshold for Email', () => {
    let value = enterTask(session(['Writing']), 'WRITING_EMAIL');
    value = {
      ...value,
      questions: value.questions.map((question) => question.id === 'Writing-11'
        ? { ...question, time_limit_ms: 450_000 }
        : question)
    };
    const question = value.questions.find((item) => item.id === 'Writing-11');
    if (!question) throw new Error('missing Email question');
    expect(shouldQuestionBeOvertime(value, question, 419_999)).toBe(false);
    expect(shouldQuestionBeOvertime(value, question, 420_000)).toBe(true);
  });

  it('does not advance active time when only pause time is added', () => {
    const value = enterTask(session(['Writing']), 'WRITING_EMAIL');
    const paused = addCurrentTaskPause(value, 30_000);
    expect(getCurrentTask(paused)).toMatchObject({ active_time_ms: 0, pause_time_ms: 30_000, is_overtime: false });
  });

  it('keeps practice Writing editable at the exact limit', () => {
    let value = enterTask(session(['Writing']), 'WRITING_EMAIL');
    value = applyTaskActivityDelta(value, 'Writing-11', 420_000);
    expect(isWritingTaskEditable(value, getCurrentTask(value)!)).toBe(true);
  });

  it('freezes exam Writing at the exact limit', () => {
    let value = enterTask(session(['Writing'], 'exam_simulation'), 'WRITING_EMAIL');
    value = applyTaskActivityDelta(value, 'Writing-11', 420_001);
    expect(getCurrentTask(value)).toMatchObject({ active_time_ms: 420_000, remaining_ms: 0, is_overtime: true });
    expect(isWritingTaskEditable(value, getCurrentTask(value)!)).toBe(false);
  });

  it('keeps Task, compatible Question, JSON, CSV and Markdown overtime equal', () => {
    let value = enterTask(session(['Writing']), 'WRITING_EMAIL');
    value = applyTaskActivityDelta(value, 'Writing-11', 420_000);
    const bundle = buildSessionExportBundle(value, []);
    const json = JSON.parse(bundle.files['answers.json']) as {
      tasks: Array<{ task_id: string; is_overtime: boolean }>;
      questions: Array<{ question_id: string; is_overtime: boolean }>;
    };
    expect(getCurrentTask(value)?.is_overtime).toBe(true);
    expect(value.answers['Writing-11'].is_overtime).toBe(true);
    expect(json.tasks.find((item) => item.task_id === 'WRITING_EMAIL')?.is_overtime).toBe(true);
    expect(json.questions.find((item) => item.question_id === 'Writing-11')?.is_overtime).toBe(true);
    expect(bundle.files['task_metrics.csv']).toContain('WRITING_EMAIL');
    expect(bundle.files['Writing.md']).toMatch(/Email[\s\S]*Overtime：true/);
  });

  it.each([4, 5])('restores schema v%i without reintroducing the legacy Question limit', (schemaVersion) => {
    const current = enterTask(session(['Writing']), 'WRITING_EMAIL');
    const restored = migratePracticeSession({
      ...current,
      session_schema_version: schemaVersion,
      questions: current.questions.map((question) => question.id === 'Writing-11'
        ? { ...question, time_limit_ms: 450_000 }
        : question)
    });
    const emailQuestion = restored.questions.find((question) => question.id === 'Writing-11')!;
    expect(shouldQuestionBeOvertime(restored, emailQuestion, 420_000)).toBe(true);
  });

  it('preserves legacy skip and uncertain flags for reading and export', () => {
    const current = enterTask(session(['Writing']), 'WRITING_EMAIL');
    const legacy = {
      ...current,
      answers: {
        ...current.answers,
        'Writing-11': { ...answer('Writing-11', 1_000), is_skipped: true, is_uncertain: true }
      }
    };
    const restored = migratePracticeSession(legacy);
    const bundle = buildSessionExportBundle(restored, []);
    expect(restored.answers['Writing-11']).toMatchObject({ is_skipped: true, is_uncertain: true });
    expect(bundle.files['question_metrics.csv']).toMatch(/Writing-11[^\n]*true,true/);
  });
});

describe('R005.4.1 timing ledger manual baselines', () => {
  it('preserves Writing 12065 + 558805 + 246276 = 817146', () => {
    let value = session(['Writing']);
    value = { ...value, answers: { ...value.answers, 'Writing-1': answer('Writing-1', 12_065) } };
    value = applyTaskActivityDelta(value, 'Writing-11', 558_805);
    value = applyTaskActivityDelta(value, 'Writing-12', 246_276);
    const ledger = deriveTimingLedger(value);
    expect(ledger.sections.Writing).toBe(817_146);
    expect(ledger.unattributedActiveMs).toBe(0);
  });

  it('preserves Speaking 57457 + 21713 = 79170', () => {
    let value = startSpeakingTask(enterTask(session(['Speaking']), 'SR1'), 'SR1');
    value = applyTaskActivityDelta(value, 'Speaking-1', 57_457);
    value = markSpeakingTask(value, 'SR1', 'COMPLETED');
    value = startSpeakingTask(enterTask(value, 'SI1'), 'SI1');
    value = applyTaskActivityDelta(value, 'Speaking-8', 21_713);
    const ledger = deriveTimingLedger(value);
    expect(ledger.sections.Speaking).toBe(79_170);
    expect(ledger.unattributedActiveMs).toBe(0);
  });

  it('preserves four-section 28310 + 20736 + 5397 + 3002 = 57445', () => {
    let value = session(['Reading', 'Listening', 'Writing', 'Speaking']);
    const reading = value.questions.find((question) => question.id === 'Reading-1')!;
    const listening = value.questions.find((question) => question.id === 'Listening-1')!;
    value = finalizeQuestion(value, reading, 28_310, false);
    value = finalizeQuestion(value, listening, 20_736, false);
    value = applyTaskActivityDelta(value, 'Writing-1', 5_397);
    value = startSpeakingTask(enterTask(value, 'SR1'), 'SR1');
    value = applyTaskActivityDelta(value, 'Speaking-1', 3_002);
    const ledger = deriveTimingLedger(value);
    expect(ledger.sessionActiveMs).toBe(57_445);
    expect(ledger.unattributedActiveMs).toBe(0);
    expect(Object.values(ledger.sections).every(Number.isSafeInteger)).toBe(true);
  });
});
