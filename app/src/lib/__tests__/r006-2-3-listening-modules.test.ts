import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleRuntimeState, PracticeMode, PracticeSession } from '../../types';
import {
  DEFAULT_BLUEPRINT,
  createQuestionsFromBlueprint,
  validateBlueprint,
  type ToeflBlueprint
} from '../blueprint';
import { exportSessionRecord } from '../exporters';
import { prepareRecoverySession } from '../recovery';
import {
  advanceFromCurrent,
  buildInitialSessionRuntime,
  finalizeCurrentScope,
  markQuestionEncountered,
  previousQuestionInSession,
  upsertAnswer
} from '../sessionEngine';
import { buildSessionExportBundle } from '../sessionExport';

const storageMocks = vi.hoisted(() => ({
  writeRecordIndex: vi.fn(async () => undefined)
}));

vi.mock('../storage', () => ({
  exportSessionBundleAtomic: vi.fn(async () => undefined),
  exportSessionTextAtomic: vi.fn(async () => undefined),
  exportTextAtomic: vi.fn(async () => undefined),
  writeRecordIndex: storageMocks.writeRecordIndex
}));

const LEGACY_1_2_BLUEPRINT: ToeflBlueprint = (() => {
  const blueprint = structuredClone(DEFAULT_BLUEPRINT);
  blueprint.version = '1.2.0';
  const listening = blueprint.sections.find((section) => section.section_id === 'Listening');
  if (!listening) throw new Error('missing Listening section');
  listening.modules[0].question_numbers = [1, 35];
  listening.modules[1].question_numbers = [36, 47];
  listening.question_slots = listening.question_slots.map((slot) => ({
    ...slot,
    module_id: slot.number <= 35 ? 'LISTENING_MODULE_1' : 'LISTENING_MODULE_2'
  }));
  return blueprint;
})();

function listeningSession(mode: PracticeMode = 'practice'): PracticeSession {
  const questions = createQuestionsFromBlueprint(LEGACY_1_2_BLUEPRINT, ['Listening']);
  const listening = LEGACY_1_2_BLUEPRINT.sections.find((section) => section.section_id === 'Listening');
  if (!listening) throw new Error('missing Listening section');
  const modules: ModuleRuntimeState[] = listening.modules.map((module, index) => ({
    id: module.module_id,
    section: 'Listening',
    kind: module.kind,
    label: module.label,
    status: index === 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
    questionIds: questions.filter((question) => question.module_id === module.module_id).map((question) => question.id),
    activeTimeMs: 0,
    isOvertime: false,
    startedAt: index === 0 ? '2026-07-22T00:00:00.000Z' : null,
    finalizedAt: null
  }));
  return buildInitialSessionRuntime({
    session_schema_version: 5,
    session_id: `r006-2-3-${mode}`,
    package_id: 'Mock.01.A.1',
    source_path: 'readonly-fixture',
    mode,
    timing_profile_id: mode === 'practice' ? 'toefl-2026-practice' : 'toefl-2026-exam-simulation',
    timing_profile_version: '1.0.0',
    blueprint_id: LEGACY_1_2_BLUEPRINT.blueprint_id,
    blueprint_version: LEGACY_1_2_BLUEPRINT.version,
    created_at: '2026-07-22T00:00:00.000Z',
    started_at: '2026-07-22T00:00:00.000Z',
    active_ms: 0,
    paused_ms: 0,
    questions,
    answers: {},
    modules,
    view: 'PRACTICE'
  });
}

function encounterCurrentScope(session: PracticeSession): PracticeSession {
  return session.active_scope_question_ids.reduce(
    (current, questionId) => markQuestionEncountered(current, questionId, '2026-07-22T00:00:01.000Z'),
    session
  );
}

function advanceBy(session: PracticeSession, count: number): PracticeSession {
  let current = session;
  for (let index = 0; index < count; index += 1) {
    current = advanceFromCurrent(current, 100).session;
  }
  return current;
}

function completedListeningSession(): PracticeSession {
  const base = listeningSession();
  const answered = base.questions.reduce(
    (current, question) => upsertAnswer(current, question, 'A', 100, false, '2026-07-22T00:00:02.000Z'),
    base
  );
  return {
    ...answered,
    completed_at: '2026-07-22T00:10:00.000Z',
    completed_sections: ['Listening'],
    active_ms: 4_700,
    view: 'SESSION_SUMMARY',
    modules: answered.modules.map((module) => ({
      ...module,
      status: 'FINALIZED',
      activeTimeMs: module.questionIds.length * 100,
      finalizedAt: '2026-07-22T00:10:00.000Z'
    }))
  };
}

function legacyListeningSnapshot(): PracticeSession {
  const current = listeningSession();
  const questions = current.questions.map((question) => ({
    ...question,
    module_id: 'LISTENING_SECTION' as const,
    encountered: question.number <= 35,
    visit_count: question.number <= 35 ? 1 : 0
  }));
  const answer = upsertAnswer(current, current.questions[34], 'B', 1_234).answers['Listening-35'];
  return {
    ...current,
    session_id: 'legacy-listening-1-1-0',
    blueprint_version: '1.1.0',
    active_ms: 1_234,
    current_section_id: 'Listening',
    current_section: 'Listening',
    current_module_id: 'LISTENING_SECTION',
    current_scope_id: 'LISTENING_SECTION',
    current_question_id: 'Listening-35',
    current_question_index: 34,
    active_scope_question_ids: questions.map((question) => question.id),
    active_module_question_ids: questions.map((question) => question.id),
    active_section_question_ids: questions.map((question) => question.id),
    all_session_question_ids: questions.map((question) => question.id),
    questions,
    answers: {
      'Listening-35': {
        ...answer,
        is_skipped: true,
        is_uncertain: true,
        marked_review: true,
        is_overtime: true
      }
    },
    modules: [{
      id: 'LISTENING_SECTION',
      section: 'Listening',
      kind: 'SECTION',
      label: 'Listening',
      status: 'IN_PROGRESS',
      questionIds: questions.map((question) => question.id),
      activeTimeMs: 1_234,
      isOvertime: true,
      startedAt: current.started_at ?? null,
      finalizedAt: null
    }]
  };
}

beforeEach(() => vi.clearAllMocks());

describe('R006.2.3 Listening 35+12 Blueprint boundary', () => {
  it('defines exactly two complete, non-overlapping Listening modules in Blueprint 1.2.0', () => {
    expect(LEGACY_1_2_BLUEPRINT.version).toBe('1.2.0');
    expect(validateBlueprint(LEGACY_1_2_BLUEPRINT).ok).toBe(true);

    const listening = LEGACY_1_2_BLUEPRINT.sections.find((section) => section.section_id === 'Listening');
    if (!listening) throw new Error('missing Listening section');
    expect(listening.declared_question_count).toBe(47);
    expect(listening.modules).toEqual([
      expect.objectContaining({
        module_id: 'LISTENING_MODULE_1',
        order: 1,
        kind: 'MODULE',
        label: 'Listening Module 1',
        question_numbers: [1, 35]
      }),
      expect.objectContaining({
        module_id: 'LISTENING_MODULE_2',
        order: 2,
        kind: 'MODULE',
        label: 'Listening Module 2',
        question_numbers: [36, 47]
      })
    ]);
    expect(listening.question_slots.filter((slot) => slot.module_id === 'LISTENING_MODULE_1').map((slot) => slot.slot_id))
      .toEqual(Array.from({ length: 35 }, (_, index) => `Listening-${index + 1}`));
    expect(listening.question_slots.filter((slot) => slot.module_id === 'LISTENING_MODULE_2').map((slot) => slot.slot_id))
      .toEqual(Array.from({ length: 12 }, (_, index) => `Listening-${index + 36}`));
    expect(new Set(listening.question_slots.map((slot) => slot.slot_id)).size).toBe(47);
    expect(listening.question_slots.every((slot) => slot.type_label === 'External Audio Question')).toBe(true);
    expect(listening.question_slots.every((slot) => slot.confirmation_status === 'NEEDS_USER_CONFIRMATION')).toBe(true);

    expect(Object.fromEntries(LEGACY_1_2_BLUEPRINT.sections.map((section) => [section.section_id, section.declared_question_count])))
      .toEqual({ Reading: 50, Listening: 47, Writing: 12, Speaking: 11 });
    expect(LEGACY_1_2_BLUEPRINT.sections.find((section) => section.section_id === 'Reading')?.modules.map((module) => module.question_numbers))
      .toEqual([[1, 35], [36, 50]]);
  });

  it('initializes a new Listening Session at L1 with two runtime modules', () => {
    const session = listeningSession();
    expect(session.blueprint_version).toBe('1.2.0');
    expect(session.modules.map((module) => module.id)).toEqual(['LISTENING_MODULE_1', 'LISTENING_MODULE_2']);
    expect(session.modules.map((module) => module.questionIds.length)).toEqual([35, 12]);
    expect(session.current_scope_id).toBe('LISTENING_MODULE_1');
    expect(session.current_module_id).toBe('LISTENING_MODULE_1');
    expect(session.current_question_id).toBe('Listening-1');
    expect(session.active_scope_question_ids.at(-1)).toBe('Listening-35');
    expect(session.active_section_question_ids).toHaveLength(47);
  });

  it.each(['practice', 'exam_simulation'] as const)(
    'uses the generic Module state machine at L35/L36/L47 in %s mode',
    async (mode) => {
      const module1Ready = encounterCurrentScope(listeningSession(mode));
      const atL35 = advanceBy(module1Ready, 34);
      expect(atL35.current_question_id).toBe('Listening-35');
      expect(advanceFromCurrent(atL35, 100)).toMatchObject({
        completedSession: false,
        session: { current_question_id: 'Listening-35', current_scope_id: 'LISTENING_MODULE_1' }
      });

      const module1 = await finalizeCurrentScope(atL35, 100, async () => undefined);
      expect(module1).toMatchObject({
        ok: true,
        next: 'NEXT_MODULE',
        finalizedScopeId: 'LISTENING_MODULE_1',
        session: { current_question_id: 'Listening-36', current_scope_id: 'LISTENING_MODULE_2', view: 'PRACTICE' }
      });
      expect(previousQuestionInSession(module1.session).current_question_id).toBe('Listening-36');
      expect(module1.session.modules.find((module) => module.id === 'LISTENING_MODULE_1')?.status).toBe('FINALIZED');

      const module2Ready = encounterCurrentScope(module1.session);
      const atL47 = advanceBy(module2Ready, 11);
      expect(atL47.current_question_id).toBe('Listening-47');
      expect(advanceFromCurrent(atL47, 100).completedSession).toBe(false);
      const completed = await finalizeCurrentScope(atL47, 100, async () => undefined);
      expect(completed).toMatchObject({
        ok: true,
        next: 'SESSION_SUMMARY',
        finalizedScopeId: 'LISTENING_MODULE_2',
        session: { view: 'SESSION_SUMMARY', completed_sections: ['Listening'] }
      });
    }
  );

  it('exports two Listening modules, closed timing, stable identity, and Blueprint 1.2.0', async () => {
    const session = completedListeningSession();
    const bundle = buildSessionExportBundle(session, []);
    const answers = JSON.parse(bundle.files['answers.json']) as {
      session_id: string;
      blueprint_version: string;
      active_time_ms: number;
      sections: Array<{
        section_id: string;
        active_time_ms: number;
        modules: Array<{ module_id: string; active_time_ms: number; question_ids: string[] }>;
      }>;
    };
    const listening = answers.sections.find((section) => section.section_id === 'Listening');
    expect(answers.session_id).toBe(session.session_id);
    expect(answers.blueprint_version).toBe('1.2.0');
    expect(listening?.modules.map((module) => [module.module_id, module.question_ids.length])).toEqual([
      ['LISTENING_MODULE_1', 35],
      ['LISTENING_MODULE_2', 12]
    ]);
    expect(listening?.active_time_ms).toBe(4_700);
    expect(listening?.modules.reduce((sum, module) => sum + module.active_time_ms, 0)).toBe(4_700);
    expect(answers.active_time_ms).toBe(4_700);
    expect(bundle.files['session_summary.md']).toMatch(/Listening \| Listening Module 1 \| FINALIZED \|.*\| 35 \|/);
    expect(bundle.files['session_summary.md']).toMatch(/Listening \| Listening Module 2 \| FINALIZED \|.*\| 12 \|/);
    expect(bundle.files['Listening.md']).toContain('| L35 | LISTENING_MODULE_1 |');
    expect(bundle.files['Listening.md']).toContain('| L36 | LISTENING_MODULE_2 |');
    expect(bundle.files['question_metrics.csv']).toContain('Listening,LISTENING_MODULE_1,Listening-35');
    expect(bundle.files['question_metrics.csv']).toContain('Listening,LISTENING_MODULE_2,Listening-36');

    const firstDirectory = await exportSessionRecord(session, [], async () => undefined);
    const secondDirectory = await exportSessionRecord(session, [], async () => undefined);
    expect(secondDirectory).toBe(firstDirectory);
    expect(storageMocks.writeRecordIndex).toHaveBeenLastCalledWith(expect.objectContaining({
      session_id: session.session_id,
      blueprint_version: '1.2.0'
    }));
  });

  it('preserves a schema v5 Blueprint 1.1.0 single-module Recovery without silent migration', () => {
    const prepared = prepareRecoverySession(legacyListeningSnapshot(), [DEFAULT_BLUEPRINT.blueprint_id]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.migrated).toBe(false);
    expect(prepared.session.blueprint_version).toBe('1.1.0');
    expect(prepared.session.modules.map((module) => [module.id, module.questionIds.length]))
      .toEqual([['LISTENING_SECTION', 47]]);
    expect(prepared.session.questions.every((question) => question.module_id === 'LISTENING_SECTION')).toBe(true);
    expect(prepared.session.answers['Listening-35']).toMatchObject({
      answer_value: 'B',
      active_time_ms: 1_234,
      is_skipped: true,
      is_uncertain: true,
      is_overtime: true
    });
  });
});
