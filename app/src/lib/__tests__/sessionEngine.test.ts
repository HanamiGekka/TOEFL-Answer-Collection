import { describe, expect, it } from 'vitest';
import type { PracticeSession, ReadingModuleId } from '../../types';
import {
  buildInitialSessionRuntime,
  createDefaultQuestions,
  enterQuestion,
  finalizeModule,
  getCurrentModule,
  getCurrentQuestion,
  getQuestionNavItems,
  goToQuestionByIndex,
  markQuestionEncountered,
  migratePracticeSession,
  previousQuestionInSession,
  skipAndAdvance,
  skipQuestion,
  upsertAnswer
} from '../sessionEngine';

function session(): PracticeSession {
  return buildInitialSessionRuntime({
    session_id: 's1',
    package_id: '01.21.A.1',
    source_path: 'readonly',
    mode: 'practice',
    timing_profile_id: 'toefl-2026-practice',
    timing_profile_version: '1.0.0',
    created_at: 'now',
    active_ms: 0,
    paused_ms: 0,
    current_section: 'Reading',
    current_question_index: 0,
    questions: createDefaultQuestions(['Reading']),
    answers: {}
  });
}

function encounterModule(base: PracticeSession, moduleId: ReadingModuleId): PracticeSession {
  const module = base.modules.find((item) => item.id === moduleId);
  if (!module) throw new Error(`missing module ${moduleId}`);
  return module.questionIds.reduce((sessionState, questionId) => markQuestionEncountered(sessionState, questionId), base);
}

describe('session engine', () => {
  it('records first answer and revisions separately', () => {
    const base = session();
    const question = base.questions[0];
    const once = upsertAnswer(base, question, 'abc', 1200);
    const twice = upsertAnswer(once, question, 'abcd', 1800);
    expect(twice.answers[question.id].first_answer_elapsed_ms).toBe(1200);
    expect(twice.answers[question.id].revision_count).toBe(1);
  });

  it('stores skip status outside answer text', () => {
    const base = session();
    const question = base.questions[0];
    const skipped = skipQuestion(base, question, 900);
    expect(skipped.answers[question.id].answer_value).toBeNull();
    expect(skipped.answers[question.id].progress_status).toBe('ENCOUNTERED_UNANSWERED');
    expect(skipped.answers[question.id].is_skipped).toBe(true);
  });

  it('initializes Reading in Module 1 with R1 encountered', () => {
    const base = session();
    const currentModule = getCurrentModule(base);
    expect(base.session_schema_version).toBe(5);
    expect(base.current_module_id).toBe('READING_MODULE_1');
    expect(currentModule).toMatchObject({ id: 'READING_MODULE_1', status: 'IN_PROGRESS' });
    expect(currentModule?.questionIds).toHaveLength(35);
    expect(currentModule?.questionIds[0]).toBe('Reading-1');
    expect(currentModule?.questionIds[34]).toBe('Reading-35');
    expect(base.modules.find((item) => item.id === 'READING_MODULE_2')?.questionIds).toEqual(
      Array.from({ length: 15 }, (_, index) => `Reading-${index + 36}`)
    );
    expect(base.questions[0].encountered).toBe(true);
  });

  it('returns exact unencountered item ids instead of silently finishing a module', async () => {
    const result = await finalizeModule(session(), 3_000, async () => undefined);
    expect(result).toMatchObject({ ok: false, reason: 'UNENCOUNTERED_ITEMS' });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'UNENCOUNTERED_ITEMS') {
      expect(result.questionIds[0]).toBe('Reading-2');
      expect(result.questionIds.at(-1)).toBe('Reading-35');
      expect(result.questionIds).toHaveLength(34);
    }
    expect(result.session.current_module_id).toBe('READING_MODULE_1');
    expect(result.session.modules.find((item) => item.id === 'READING_MODULE_1')?.status).toBe('IN_PROGRESS');
  });

  it('finalizes Module 1 after all items are encountered even when unanswered', async () => {
    const base = encounterModule(session(), 'READING_MODULE_1');
    const result = await finalizeModule(base, 35_000, async () => undefined);
    expect(result).toMatchObject({ ok: true, next: 'NEXT_MODULE' });
    expect(result.session.current_module_id).toBe('READING_MODULE_2');
    expect(result.session.current_question_index).toBe(35);
    expect(getCurrentQuestion(result.session)?.id).toBe('Reading-36');
    expect(result.session.modules.find((item) => item.id === 'READING_MODULE_1')?.status).toBe('FINALIZED');
    expect(result.session.modules.find((item) => item.id === 'READING_MODULE_2')?.status).toBe('IN_PROGRESS');
    expect(result.session.questions[35].encountered).toBe(true);
  });

  it('locks Module 1 after entering Module 2', async () => {
    const result = await finalizeModule(encounterModule(session(), 'READING_MODULE_1'), 35_000, async () => undefined);
    const inModule2 = result.session;
    expect(inModule2.current_module_id).toBe('READING_MODULE_2');
    expect(previousQuestionInSession(inModule2).current_question_index).toBe(35);
    expect(goToQuestionByIndex(inModule2, 0).current_question_index).toBe(35);
  });

  it('enters summary after Module 2 when only Reading is selected', async () => {
    const module1 = await finalizeModule(encounterModule(session(), 'READING_MODULE_1'), 35_000, async () => undefined);
    const module2Ready = encounterModule(module1.session, 'READING_MODULE_2');
    const result = await finalizeModule(module2Ready, 50_000, async () => undefined);
    expect(result).toMatchObject({ ok: true, next: 'SESSION_SUMMARY' });
    expect(result.session.view).toBe('SESSION_SUMMARY');
    expect(result.session.completed_at).toBeTruthy();
    expect(result.session.current_question_id).toBe('Reading-36');
    expect(result.session.questions[50]).toBeUndefined();
  });

  it('moves from Reading Module 2 to the next selected section without creating R51', async () => {
    const withListening = buildInitialSessionRuntime({
      ...session(),
      questions: createDefaultQuestions(['Reading', 'Listening'])
    });
    const module1 = await finalizeModule(encounterModule(withListening, 'READING_MODULE_1'), 35_000, async () => undefined);
    const module2Ready = encounterModule(module1.session, 'READING_MODULE_2');
    const result = await finalizeModule(module2Ready, 50_000, async () => undefined);
    expect(result).toMatchObject({ ok: true, next: 'NEXT_SECTION' });
    expect(result.session.current_section).toBe('Listening');
    expect(result.session.current_question_index).toBe(50);
    expect(getCurrentQuestion(result.session)?.id).toBe('Listening-1');
    expect(result.session.questions.find((question) => question.id === 'Reading-51')).toBeUndefined();
  });

  it('skipAndAdvance advances immediately and records skipped time', () => {
    const base = session();
    const result = skipAndAdvance(base, 900);
    expect(result.session.current_question_index).toBe(1);
    expect(result.session.answers['Reading-1'].progress_status).toBe('ENCOUNTERED_UNANSWERED');
    expect(result.session.answers['Reading-1'].is_skipped).toBe(true);
    expect(result.session.answers['Reading-1'].total_active_ms).toBe(900);
  });

  it('R35 skip stays on the boundary and does not finalize Module 1', () => {
    const base = enterQuestion(encounterModule(session(), 'READING_MODULE_1'), 'Reading-35');
    const result = skipAndAdvance(base, 7_000);
    expect(result.session.current_question_index).toBe(34);
    expect(result.completedSession).toBe(false);
    expect(result.session.modules.find((item) => item.id === 'READING_MODULE_1')?.status).toBe('IN_PROGRESS');
    expect(result.session.answers['Reading-35'].progress_status).toBe('ENCOUNTERED_UNANSWERED');
    expect(result.session.answers['Reading-35'].is_skipped).toBe(true);
  });

  it('R50 skip stays on the boundary and does not finalize Module 2', async () => {
    const module1 = await finalizeModule(encounterModule(session(), 'READING_MODULE_1'), 35_000, async () => undefined);
    const base = goToQuestionByIndex(encounterModule(module1.session, 'READING_MODULE_2'), 49);
    const result = skipAndAdvance(base, 7_000);
    expect(result.session.current_question_index).toBe(49);
    expect(result.completedSession).toBe(false);
    expect(result.session.completed_at).toBeUndefined();
    expect(result.session.modules.find((item) => item.id === 'READING_MODULE_2')?.status).toBe('IN_PROGRESS');
    expect(result.session.answers['Reading-50'].progress_status).toBe('ENCOUNTERED_UNANSWERED');
    expect(result.session.answers['Reading-50'].is_skipped).toBe(true);
  });

  it('marks exactly one current question navigation item', () => {
    const base = enterQuestion(session(), 'Reading-11');
    const items = getQuestionNavItems(base);
    expect(items.filter((item) => item.isCurrent)).toHaveLength(1);
    expect(items[10]).toMatchObject({ label: 'R11', isCurrent: true, ariaCurrent: 'true' });
  });

  it('does not switch module when persistence fails during finalize', async () => {
    const base = encounterModule(session(), 'READING_MODULE_1');
    const result = await finalizeModule(base, 35_000, async () => {
      throw new Error('disk full');
    });
    expect(result).toMatchObject({ ok: false, reason: 'PERSISTENCE_ERROR' });
    expect(result.session.current_module_id).toBe('READING_MODULE_1');
    expect(result.session.modules.find((item) => item.id === 'READING_MODULE_1')?.status).toBe('IN_PROGRESS');
  });

  it('migrates R004 flat Reading snapshots without losing answers', () => {
    const flatQuestions = createDefaultQuestions(['Reading']).map((question) => {
      const clone = { ...question } as Partial<typeof question>;
      delete clone.encountered;
      return clone;
    });
    const oldSession = {
      ...session(),
      session_schema_version: undefined,
      modules: undefined,
      current_module_id: undefined,
      questions: flatQuestions,
      answers: {
        'Reading-1': {
          question_id: 'Reading-1',
          answer_value: 'A',
          status: 'ANSWERED',
          is_overtime: false,
          is_skipped: false,
          total_active_ms: 1200,
          revision_count: 0,
          marked_review: true,
          updated_at: 'old'
        },
        'Reading-35': {
          question_id: 'Reading-35',
          answer_value: null,
          status: 'SKIPPED',
          is_overtime: false,
          is_skipped: true,
          total_active_ms: 9000,
          revision_count: 0,
          marked_review: false,
          updated_at: 'old'
        }
      }
    };
    const migrated = migratePracticeSession(oldSession);
    expect(migrated.session_schema_version).toBe(5);
    expect(migrated.modules.find((item) => item.id === 'READING_MODULE_1')?.questionIds).toHaveLength(35);
    expect(migrated.modules.find((item) => item.id === 'READING_MODULE_2')?.questionIds).toHaveLength(15);
    expect(migrated.answers['Reading-1']).toMatchObject({ answer_value: 'A', marked_review: true, total_active_ms: 1200 });
    expect(migrated.answers['Reading-35']).toMatchObject({
      progress_status: 'ENCOUNTERED_UNANSWERED',
      is_skipped: true,
      total_active_ms: 9000
    });
    expect(migrated.questions[1].encountered).toBe(false);
  });
});
