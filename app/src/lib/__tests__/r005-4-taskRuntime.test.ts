import { describe, expect, it } from 'vitest';
import type { PracticeMode, PracticeSession, SectionName } from '../../types';
import {
  CURRENT_SESSION_SCHEMA_VERSION,
  buildInitialSessionRuntime,
  createDefaultQuestions,
  migratePracticeSession
} from '../sessionEngine';
import { deriveTimingLedger } from '../timeLedger';
import { serializeSessionForPersistence } from '../persistedTime';
import {
  TASK_RUNTIME_PROFILES,
  addCurrentTaskPause,
  applyTaskActivityDelta,
  enterTask,
  getCurrentTask,
  getListenRepeatGroupTiming,
  markSpeakingTask,
  retrySpeakingTask,
  startSpeakingTask,
  updateWritingText,
  undoWritingText,
  redoWritingText
} from '../taskRuntime';

function session(sections: SectionName[], mode: PracticeMode = 'practice'): PracticeSession {
  const now = '2026-07-11T15:00:00.000Z';
  return buildInitialSessionRuntime({
    session_schema_version: 4,
    session_id: 'r005-4-fixture',
    package_id: 'Mock.01.A.1',
    source_path: 'readonly',
    mode,
    timing_profile_id: mode === 'practice' ? 'toefl-2026-practice' : 'toefl-2026-exam-simulation',
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

describe('R005.4 schema v5 Task runtime', () => {
  it('upgrades the current schema and creates three Writing plus eleven Speaking leaf tasks', () => {
    const value = session(['Writing', 'Speaking']);
    expect(CURRENT_SESSION_SCHEMA_VERSION).toBe(5);
    expect(value.session_schema_version).toBe(5);
    expect(value.tasks.map((task) => task.task_id)).toEqual([
      'WRITING_BUILD_SENTENCE',
      'WRITING_EMAIL',
      'WRITING_ACADEMIC_DISCUSSION',
      'SR1', 'SR2', 'SR3', 'SR4', 'SR5', 'SR6', 'SR7',
      'SI1', 'SI2', 'SI3', 'SI4'
    ]);
  });

  it('uses independent Writing scopes and task identities', () => {
    const value = session(['Writing']);
    expect(value.modules.map((scope) => scope.id)).toEqual([
      'WRITING_BUILD_SENTENCE',
      'WRITING_EMAIL',
      'WRITING_ACADEMIC_DISCUSSION'
    ]);
    expect(value.tasks[0].question_ids).toEqual(Array.from({ length: 10 }, (_, index) => `Writing-${index + 1}`));
    expect(value.tasks[1].question_ids).toEqual(['Writing-11']);
    expect(value.tasks[2].question_ids).toEqual(['Writing-12']);
  });

  it('centralizes the required local profile limits and timeout edit policy', () => {
    expect(TASK_RUNTIME_PROFILES.practice).toMatchObject({
      writingEmailMs: 420_000,
      writingAcademicDiscussionMs: 600_000,
      listenRepeatGroupMs: 120_000,
      interviewResponseMs: 45_000,
      interviewPreparationMs: 0,
      writingEditableAfterTimeout: true
    });
    expect(TASK_RUNTIME_PROFILES.exam_simulation.writingEditableAfterTimeout).toBe(false);
  });

  it('keeps Email and Discussion text and statistics independent', () => {
    let value = enterTask(session(['Writing']), 'WRITING_EMAIL');
    value = updateWritingText(value, 'Email text', 'insertText');
    value = enterTask(value, 'WRITING_ACADEMIC_DISCUSSION');
    value = updateWritingText(value, 'Discussion text', 'insertFromPaste');
    const email = value.tasks.find((task) => task.task_id === 'WRITING_EMAIL');
    const discussion = value.tasks.find((task) => task.task_id === 'WRITING_ACADEMIC_DISCUSSION');
    expect(email).toMatchObject({ text: 'Email text', keyboard_inserted_characters: 10, pasted_characters: 0 });
    expect(discussion).toMatchObject({ text: 'Discussion text', keyboard_inserted_characters: 0, pasted_characters: 15 });
    expect(value.answers['Writing-11'].answer_value).toBe('Email text');
    expect(value.answers['Writing-12'].answer_value).toBe('Discussion text');
  });

  it('keeps allowed English Writing characters and removes CJK/emoji before Store mutation', () => {
    const text = 'English 中文 🙂\nCurly “quotes” — and apostrophe\'s.';
    const value = updateWritingText(enterTask(session(['Writing']), 'WRITING_EMAIL'), text, 'insertText');
    expect(getCurrentTask(value)?.text).toBe('English  \nCurly “quotes” — and apostrophe\'s.');
    expect(value.answers['Writing-11'].answer_value).toBe('English  \nCurly “quotes” — and apostrophe\'s.');
  });

  it('supports deterministic button Undo/Redo history without duplicate keyboard counts', () => {
    let value = enterTask(session(['Writing']), 'WRITING_EMAIL');
    value = updateWritingText(value, 'one', 'insertText');
    value = updateWritingText(value, 'one two', 'insertText');
    const keyboardCount = getCurrentTask(value)?.keyboard_inserted_characters;
    value = undoWritingText(value);
    expect(getCurrentTask(value)).toMatchObject({ text: 'one', undo_count: 1, keyboard_inserted_characters: keyboardCount });
    value = redoWritingText(value);
    expect(getCurrentTask(value)).toMatchObject({ text: 'one two', redo_count: 1, keyboard_inserted_characters: keyboardCount });
  });

  it('derives Task → Scope → Section → Session from the same activity delta', () => {
    let value = enterTask(session(['Writing']), 'WRITING_EMAIL');
    value = applyTaskActivityDelta(value, value.current_question_id, 1_234.4);
    const ledger = deriveTimingLedger(value);
    expect(ledger.tasks.WRITING_EMAIL).toBeCloseTo(1_234.4);
    expect(ledger.scopes.WRITING_EMAIL).toBeCloseTo(1_234.4);
    expect(ledger.sections.Writing).toBeCloseTo(1_234.4);
    expect(ledger.sessionActiveMs).toBeCloseTo(1_234.4);
  });

  it('attributes global pause to the current task without adding active time', () => {
    let value = enterTask(session(['Writing']), 'WRITING_EMAIL');
    value = applyTaskActivityDelta(value, value.current_question_id, 2_000);
    value = addCurrentTaskPause(value, 1_500);
    expect(getCurrentTask(value)).toMatchObject({ active_time_ms: 2_000, pause_time_ms: 1_500 });
  });

  it('does not start Listen and Repeat until the user explicitly starts it', () => {
    const value = session(['Speaking']);
    expect(getCurrentTask(value)).toMatchObject({ task_id: 'SR1', status: 'NOT_STARTED', active_time_ms: 0 });
    expect(getListenRepeatGroupTiming(value)).toMatchObject({ active_time_ms: 0, remaining_ms: 120_000 });
  });

  it('starts one SR item and preserves completed, needs retry, and overtime as independent facts', () => {
    let value = startSpeakingTask(session(['Speaking']), 'SR1');
    expect(getCurrentTask(value)).toMatchObject({ status: 'ACTIVE', attempt_count: 1 });
    value = applyTaskActivityDelta(value, 'Speaking-1', 121_000);
    value = markSpeakingTask(value, 'SR1', 'NEEDS_RETRY');
    expect(value.tasks.find((task) => task.task_id === 'SR1')).toMatchObject({
      status: 'NEEDS_RETRY',
      needs_retry: true,
      is_overtime: true
    });
  });

  it('creates four Interview tasks with 45 seconds and zero preparation', () => {
    const value = session(['Speaking']);
    const interviews = value.tasks.filter((task) => task.task_id.startsWith('SI'));
    expect(interviews).toHaveLength(4);
    expect(interviews.every((task) => task.timer_limit_ms === 45_000 && task.remaining_ms === 45_000)).toBe(true);
    expect(TASK_RUNTIME_PROFILES.practice.interviewPreparationMs).toBe(0);
  });

  it('allows only one ACTIVE Interview at a time', () => {
    let value = enterTask(session(['Speaking']), 'SI1');
    value = startSpeakingTask(value, 'SI1');
    const unchanged = startSpeakingTask(value, 'SI2');
    expect(unchanged.tasks.find((task) => task.task_id === 'SI1')?.status).toBe('ACTIVE');
    expect(unchanged.tasks.find((task) => task.task_id === 'SI2')?.status).toBe('NOT_STARTED');
  });

  it('marks Interview overtime at zero without losing state', () => {
    let value = startSpeakingTask(enterTask(session(['Speaking']), 'SI1'), 'SI1');
    value = applyTaskActivityDelta(value, 'Speaking-8', 45_100);
    expect(value.tasks.find((task) => task.task_id === 'SI1')).toMatchObject({
      remaining_ms: 0,
      is_overtime: true,
      status: 'OVERTIME'
    });
  });

  it('increments attempt_count on retry while retaining cumulative active time', () => {
    let value = startSpeakingTask(enterTask(session(['Speaking']), 'SI1'), 'SI1');
    value = applyTaskActivityDelta(value, 'Speaking-8', 12_000);
    value = markSpeakingTask(value, 'SI1', 'NEEDS_RETRY');
    value = retrySpeakingTask(value, 'SI1');
    expect(value.tasks.find((task) => task.task_id === 'SI1')).toMatchObject({
      status: 'ACTIVE',
      attempt_count: 2,
      active_time_ms: 12_000,
      remaining_ms: 45_000,
      needs_retry: false
    });
  });

  it('non-destructively migrates a schema v4 Writing answer and duration into v5 tasks', () => {
    const current = session(['Writing']);
    const raw = {
      ...current,
      session_schema_version: 4,
      tasks: undefined,
      modules: [{
        ...current.modules[0],
        id: 'WRITING_TASK_GROUP',
        questionIds: current.questions.map((question) => question.id),
        activeTimeMs: 9_876
      }],
      answers: {
        'Writing-11': {
          question_id: 'Writing-11', answer_value: 'Preserved email', progress_status: 'ANSWERED', status: 'ANSWERED',
          is_overtime: false, is_skipped: false, is_uncertain: false, active_time_ms: 9_876,
          total_active_ms: 9_876, modification_count: 2, revision_count: 2, marked_review: false,
          last_changed_at: '2026-07-11T15:01:00.000Z', updated_at: '2026-07-11T15:01:00.000Z'
        }
      }
    };
    const migrated = migratePracticeSession(raw);
    expect(migrated.session_schema_version).toBe(5);
    expect(migrated.answers['Writing-11'].answer_value).toBe('Preserved email');
    expect(migrated.tasks.find((task) => task.task_id === 'WRITING_EMAIL')).toMatchObject({
      text: 'Preserved email',
      active_time_ms: 9_876
    });
  });

  it('serializes every formal Task duration as an integer and keeps Task → Scope equality', () => {
    let value = enterTask(session(['Writing']), 'WRITING_EMAIL');
    value = applyTaskActivityDelta(value, value.current_question_id, 2_279.6);
    value = addCurrentTaskPause(value, 411.7);
    const persisted = serializeSessionForPersistence(value);
    const email = persisted.tasks.find((task) => task.task_id === 'WRITING_EMAIL');
    const scope = persisted.modules.find((item) => item.id === 'WRITING_EMAIL');
    expect(email).toMatchObject({ active_time_ms: 2_280, pause_time_ms: 412 });
    expect(Number.isSafeInteger(email?.remaining_ms)).toBe(true);
    expect(scope?.activeTimeMs).toBe(email?.active_time_ms);
    expect(persisted.active_ms).toBe(scope?.activeTimeMs);
  });
});
