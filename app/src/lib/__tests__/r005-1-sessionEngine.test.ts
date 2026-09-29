import { describe, expect, it, vi } from 'vitest';
import type { PracticeSession, RuntimeScopeId, SectionName } from '../../types';
import {
  buildInitialSessionRuntime,
  canNavigateBackward,
  createDefaultQuestions,
  enterQuestion,
  finalizeCurrentScope,
  getCurrentQuestion,
  getQuestionNavItems,
  markQuestionEncountered,
  migratePracticeSession,
  previousQuestionInSession,
  shouldQuestionBeOvertime,
  skipAndAdvance,
  upsertAnswer
} from '../sessionEngine';
import { renderQuestionState } from '../answerState';

function session(sections: SectionName[] = ['Reading', 'Listening']): PracticeSession {
  const questions = createDefaultQuestions(sections);
  return buildInitialSessionRuntime({
    session_schema_version: 2,
    session_id: 'r005-1-test',
    package_id: 'Mock.01.A.1',
    source_path: 'readonly',
    mode: 'practice',
    timing_profile_id: 'toefl-2026-practice',
    timing_profile_version: '1.0.0',
    created_at: '2026-07-10T00:00:00.000Z',
    started_at: '2026-07-10T00:00:00.000Z',
    active_ms: 0,
    paused_ms: 0,
    current_section: sections[0],
    current_question_index: 0,
    questions,
    answers: {},
    modules: [],
    view: 'PRACTICE'
  });
}

function visitCurrentScope(value: PracticeSession): PracticeSession {
  return value.active_scope_question_ids.reduce(
    (current, questionId) => markQuestionEncountered(current, questionId, '2026-07-10T00:00:01.000Z'),
    value
  );
}

async function completeScope(value: PracticeSession, persist = vi.fn(async () => undefined)) {
  return finalizeCurrentScope(visitCurrentScope(value), 1_000, persist, '2026-07-10T00:01:00.000Z');
}

describe('R005.1 scoped session runtime', () => {
  it('builds structured, globally unique question identities', () => {
    const value = session(['Reading', 'Listening', 'Writing', 'Speaking']);
    expect(new Set(value.all_session_question_ids).size).toBe(value.questions.length);
    expect(value.questions.every((question) => question.section_id === question.section)).toBe(true);
    expect(value.questions.every((question) => Boolean(question.module_id))).toBe(true);
  });

  it('starts with an atomic Reading Module 1 scope', () => {
    const value = session();
    expect(value).toMatchObject({
      current_section_id: 'Reading',
      current_module_id: 'READING_MODULE_1',
      current_scope_id: 'READING_MODULE_1',
      current_question_id: 'Reading-1'
    });
    expect(value.active_scope_question_ids).toHaveLength(35);
    expect(value.active_section_question_ids).toHaveLength(50);
    expect(value.questions[0]).toMatchObject({ encountered: true, visit_count: 1 });
  });

  it('renders only the active scope in the answer card', () => {
    const items = getQuestionNavItems(session());
    expect(items).toHaveLength(35);
    expect(items.every((item) => item.section === 'Reading')).toBe(true);
    expect(items.some((item) => item.id.startsWith('Listening-'))).toBe(false);
  });

  it('rejects direct navigation outside the active scope', () => {
    const value = session();
    expect(enterQuestion(value, 'Listening-1')).toBe(value);
    expect(enterQuestion(value, 'Reading-36')).toBe(value);
  });

  it('uses one enter operation for encountered, visit count, first seen, and current identity', () => {
    const first = enterQuestion(session(), 'Reading-2', '2026-07-10T00:00:02.000Z');
    const second = enterQuestion(first, 'Reading-2', '2026-07-10T00:00:03.000Z');
    expect(second).toMatchObject({ current_question_id: 'Reading-2', current_section_id: 'Reading' });
    expect(getCurrentQuestion(second)).toMatchObject({
      encountered: true,
      visit_count: 2,
      first_seen_at: '2026-07-10T00:00:02.000Z',
      last_entered_at: '2026-07-10T00:00:03.000Z'
    });
  });

  it('marks the previous-question target encountered through the same enter operation', () => {
    const atSecond = enterQuestion(session(), 'Reading-2');
    const back = previousQuestionInSession(atSecond);
    expect(back.current_question_id).toBe('Reading-1');
    expect(getCurrentQuestion(back)?.visit_count).toBe(2);
  });

  it('keeps R35 skip at the explicit finalize boundary', () => {
    const atBoundary = enterQuestion(session(), 'Reading-35');
    const result = skipAndAdvance(atBoundary, 900);
    expect(result.session.current_question_id).toBe('Reading-35');
    expect(result.session.current_scope_id).toBe('READING_MODULE_1');
    expect(result.session.answers['Reading-35']).toMatchObject({ is_skipped: true, answer_value: null });
  });

  it('validates unencountered questions only in the current scope', async () => {
    const result = await finalizeCurrentScope(session(), 500, async () => undefined);
    expect(result).toMatchObject({ ok: false, reason: 'UNENCOUNTERED_ITEMS' });
    if (result.ok || result.reason !== 'UNENCOUNTERED_ITEMS') return;
    expect(result.questionIds[0]).toBe('Reading-2');
    expect(result.questionIds.at(-1)).toBe('Reading-35');
    expect(result.questionIds.some((id) => id.startsWith('Listening-'))).toBe(false);
  });

  it('moves Reading Module 1 to Module 2 after persistence', async () => {
    const persist = vi.fn(async () => undefined);
    const result = await completeScope(session(), persist);
    expect(result.ok).toBe(true);
    expect(result.session).toMatchObject({
      current_section_id: 'Reading',
      current_scope_id: 'READING_MODULE_2',
      current_question_id: 'Reading-36'
    });
    expect(persist).toHaveBeenCalledOnce();
    expect(result.session.active_scope_question_ids).toHaveLength(15);
  });

  it('moves Reading Module 2 to an isolated Listening scope', async () => {
    const module1 = await completeScope(session());
    const module2 = await completeScope(module1.session);
    expect(module2.ok).toBe(true);
    expect(module2.session).toMatchObject({
      current_section_id: 'Listening',
      current_scope_id: 'LISTENING_MODULE_1',
      current_question_id: 'Listening-1'
    });
    expect(module2.session.active_scope_question_ids).toHaveLength(32);
    expect(module2.session.active_scope_question_ids.every((id) => id.startsWith('Listening-'))).toBe(true);
  });

  it('finishes the last selected scope at Session Summary', async () => {
    const module1 = await completeScope(session());
    const module2 = await completeScope(module1.session);
    const listeningModule1 = await completeScope(module2.session);
    expect(listeningModule1).toMatchObject({
      ok: true,
      next: 'NEXT_MODULE',
      session: { current_scope_id: 'LISTENING_MODULE_2', current_question_id: 'Listening-33' }
    });
    const listeningModule2 = await completeScope(listeningModule1.session);
    expect(listeningModule2).toMatchObject({ ok: true, next: 'SESSION_SUMMARY' });
    expect(listeningModule2.session.view).toBe('SESSION_SUMMARY');
    expect(listeningModule2.session.completed_sections).toEqual(['Reading', 'Listening']);
  });

  it('uses the same generic finalize path for Writing and Speaking task groups', async () => {
    const buildSentence = await completeScope(session(['Writing', 'Speaking']));
    expect(buildSentence.session).toMatchObject({
      current_section_id: 'Writing',
      current_scope_id: 'WRITING_EMAIL',
      current_question_id: 'Writing-11'
    });
    const email = await completeScope(buildSentence.session);
    expect(email.session).toMatchObject({
      current_section_id: 'Writing',
      current_scope_id: 'WRITING_ACADEMIC_DISCUSSION',
      current_question_id: 'Writing-12'
    });
    const discussion = await completeScope(email.session);
    expect(discussion.session).toMatchObject({
      current_section_id: 'Speaking',
      current_scope_id: 'SPEAKING_LISTEN_REPEAT',
      current_question_id: 'Speaking-1'
    });
    const listenRepeat = await completeScope(discussion.session);
    expect(listenRepeat.session).toMatchObject({
      current_section_id: 'Speaking',
      current_scope_id: 'SPEAKING_INTERVIEW',
      current_question_id: 'Speaking-8'
    });
    const interview = await completeScope(listenRepeat.session);
    expect(interview).toMatchObject({ ok: true, next: 'SESSION_SUMMARY' });
  });

  it('keeps Listening back-navigation policy separate from overtime policy', () => {
    const practice = session(['Listening']);
    expect(canNavigateBackward(practice)).toBe(true);
    expect(canNavigateBackward({ ...practice, mode: 'exam_simulation' })).toBe(false);
    expect(shouldQuestionBeOvertime(practice, practice.questions[0], 600_000)).toBe(false);
  });

  it('does not switch scope when candidate snapshot persistence fails', async () => {
    const ready = visitCurrentScope(session());
    const result = await finalizeCurrentScope(ready, 500, async () => {
      throw new Error('disk full');
    });
    expect(result).toMatchObject({ ok: false, reason: 'PERSISTENCE_ERROR' });
    expect(result.session.current_scope_id).toBe('READING_MODULE_1');
    expect(result.session.modules.find((scope) => scope.id === 'READING_MODULE_1')?.status).toBe('IN_PROGRESS');
  });

  it('keeps Listening overtime disabled even for a long per-question active time', () => {
    const question = createDefaultQuestions(['Listening'])[0];
    expect(question.time_limit_ms).toBeUndefined();
    expect(shouldQuestionBeOvertime(session(['Listening']), question, 600_000)).toBe(false);
  });
});

describe('R005.1 independent answer state', () => {
  it('keeps answered and uncertain visible together', () => {
    expect(renderQuestionState('ANSWERED', { isSkipped: false, isUncertain: true, isOvertime: false })).toBe(
      '已作答 · 不确定'
    );
  });

  it('keeps unanswered, skipped, and uncertain visible together', () => {
    expect(
      renderQuestionState('ENCOUNTERED_UNANSWERED', {
        isSkipped: true,
        isUncertain: true,
        isOvertime: false
      })
    ).toBe('未作答 · 跳过 · 不确定');
  });

  it('clears current skipped state on answer without inserting a placeholder answer', () => {
    const value = session(['Listening']);
    const question = getCurrentQuestion(value)!;
    const skipped = skipAndAdvance(value, 1_000).session;
    const answered = upsertAnswer(skipped, question, 'B', 1_200);
    expect(answered.answers[question.id]).toMatchObject({
      answer_value: 'B',
      progress_status: 'ANSWERED',
      is_skipped: false
    });
  });

  it('migrates legacy marked and skipped fields without deleting the answer', () => {
    const base = session(['Reading']);
    const raw = {
      ...base,
      session_schema_version: 2,
      current_scope_id: undefined,
      current_section_id: undefined,
      current_question_id: undefined,
      active_scope_question_ids: undefined,
      active_module_question_ids: undefined,
      active_section_question_ids: undefined,
      all_session_question_ids: undefined,
      answers: {
        'Reading-1': {
          question_id: 'Reading-1',
          answer_value: 'A',
          status: 'SKIPPED',
          is_overtime: false,
          is_skipped: true,
          total_active_ms: 1200,
          revision_count: 2,
          marked_review: true,
          updated_at: '2026-07-10T00:00:00.000Z'
        }
      }
    };
    const migrated = migratePracticeSession(raw);
    expect(migrated.answers['Reading-1']).toMatchObject({
      answer_value: 'A',
      progress_status: 'ANSWERED',
      is_skipped: true,
      is_uncertain: true,
      modification_count: 2
    });
  });

  it('can mark a future question encountered without implying it was answered', () => {
    const value = markQuestionEncountered(session(), 'Reading-3');
    const question = value.questions.find((item) => item.id === 'Reading-3');
    expect(question?.encountered).toBe(true);
    expect(value.answers['Reading-3']).toBeUndefined();
  });

  it.each([
    'READING_MODULE_1',
    'READING_MODULE_2',
    'LISTENING_MODULE_1',
    'LISTENING_MODULE_2',
    'LISTENING_SECTION',
    'WRITING_BUILD_SENTENCE',
    'WRITING_EMAIL',
    'WRITING_ACADEMIC_DISCUSSION',
    'SPEAKING_LISTEN_REPEAT',
    'SPEAKING_INTERVIEW'
  ] satisfies RuntimeScopeId[])('uses a globally unambiguous runtime scope id: %s', (scopeId) => {
    expect(scopeId).toMatch(/^[A-Z0-9_]+$/);
  });
});
