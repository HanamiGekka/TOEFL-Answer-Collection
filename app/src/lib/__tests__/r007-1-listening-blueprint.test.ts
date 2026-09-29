import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleRuntimeState, PracticeMode, PracticeSession } from '../../types';
import { DEFAULT_BLUEPRINT, createQuestionsFromBlueprint, validateBlueprint } from '../blueprint';
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

function listeningSession(mode: PracticeMode = 'practice'): PracticeSession {
  return buildInitialSessionRuntime({
    session_schema_version: 5,
    session_id: `r007-1-${mode}`,
    package_id: 'Mock.01.A.1',
    source_path: 'readonly-fixture',
    mode,
    timing_profile_id: mode === 'practice' ? 'toefl-2026-practice' : 'toefl-2026-exam-simulation',
    timing_profile_version: '1.0.0',
    blueprint_id: DEFAULT_BLUEPRINT.blueprint_id,
    blueprint_version: DEFAULT_BLUEPRINT.version,
    created_at: '2026-07-25T00:00:00.000Z',
    started_at: '2026-07-25T00:00:00.000Z',
    active_ms: 0,
    paused_ms: 0,
    questions: createQuestionsFromBlueprint(DEFAULT_BLUEPRINT, ['Listening']),
    answers: {},
    modules: [],
    view: 'PRACTICE'
  });
}

function encounterCurrentScope(session: PracticeSession): PracticeSession {
  return session.active_scope_question_ids.reduce(
    (current, questionId) => markQuestionEncountered(current, questionId, '2026-07-25T00:00:01.000Z'),
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
    (current, question) => upsertAnswer(current, question, 'A', 100, false, '2026-07-25T00:00:02.000Z'),
    base
  );
  return {
    ...answered,
    completed_at: '2026-07-25T00:10:00.000Z',
    completed_sections: ['Listening'],
    active_ms: 4_700,
    view: 'SESSION_SUMMARY',
    modules: answered.modules.map((module) => ({
      ...module,
      status: 'FINALIZED',
      activeTimeMs: module.questionIds.length * 100,
      finalizedAt: '2026-07-25T00:10:00.000Z'
    }))
  };
}

function legacyListeningSnapshot(version: '1.1.0' | '1.2.0'): PracticeSession {
  const current = listeningSession();
  const firstModuleIds = current.questions
    .filter((question) => question.number <= 35)
    .map((question) => question.id);
  const secondModuleIds = current.questions
    .filter((question) => question.number >= 36)
    .map((question) => question.id);
  const allQuestionIds = current.questions.map((question) => question.id);
  const singleModule = version === '1.1.0';
  const questions = current.questions.map((question) => ({
    ...question,
    module_id: singleModule
      ? 'LISTENING_SECTION' as const
      : question.number <= 35
        ? 'LISTENING_MODULE_1' as const
        : 'LISTENING_MODULE_2' as const,
    encountered: question.number <= 35,
    visit_count: question.number <= 35 ? 1 : 0
  }));
  const modules: ModuleRuntimeState[] = singleModule
    ? [{
        id: 'LISTENING_SECTION',
        section: 'Listening',
        kind: 'SECTION',
        label: 'Listening',
        status: 'IN_PROGRESS',
        questionIds: allQuestionIds,
        activeTimeMs: 1_234,
        isOvertime: true,
        startedAt: current.started_at ?? null,
        finalizedAt: null
      }]
    : [
        {
          id: 'LISTENING_MODULE_1',
          section: 'Listening',
          kind: 'MODULE',
          label: 'Listening Module 1',
          status: 'FINALIZED',
          questionIds: firstModuleIds,
          activeTimeMs: 1_234,
          isOvertime: true,
          startedAt: current.started_at ?? null,
          finalizedAt: '2026-07-24T00:05:00.000Z'
        },
        {
          id: 'LISTENING_MODULE_2',
          section: 'Listening',
          kind: 'MODULE',
          label: 'Listening Module 2',
          status: 'IN_PROGRESS',
          questionIds: secondModuleIds,
          activeTimeMs: 0,
          isOvertime: false,
          startedAt: '2026-07-24T00:05:00.000Z',
          finalizedAt: null
        }
      ];
  const priorAnswer = upsertAnswer(current, current.questions[34], 'B', 1_234).answers['Listening-35'];
  const currentQuestionId = singleModule ? 'Listening-35' : 'Listening-36';
  const activeQuestionIds = singleModule ? allQuestionIds : secondModuleIds;
  return {
    ...current,
    session_id: `legacy-listening-${version}`,
    blueprint_version: version,
    active_ms: 1_234,
    current_section_id: 'Listening',
    current_section: 'Listening',
    current_module_id: singleModule ? 'LISTENING_SECTION' : 'LISTENING_MODULE_2',
    current_scope_id: singleModule ? 'LISTENING_SECTION' : 'LISTENING_MODULE_2',
    current_question_id: currentQuestionId,
    current_question_index: singleModule ? 34 : 35,
    active_scope_question_ids: activeQuestionIds,
    active_module_question_ids: activeQuestionIds,
    active_section_question_ids: allQuestionIds,
    all_session_question_ids: allQuestionIds,
    questions,
    answers: {
      'Listening-35': {
        ...priorAnswer,
        is_skipped: true,
        is_uncertain: true,
        marked_review: true,
        is_overtime: true
      }
    },
    modules
  };
}

beforeEach(() => vi.clearAllMocks());

describe('R007.1 Listening 32+15 Blueprint', () => {
  it('defines Blueprint 1.3.0 as two complete, contiguous Listening modules', () => {
    expect(DEFAULT_BLUEPRINT.version).toBe('1.3.0');
    expect(validateBlueprint(DEFAULT_BLUEPRINT).ok).toBe(true);

    const listening = DEFAULT_BLUEPRINT.sections.find((section) => section.section_id === 'Listening');
    if (!listening) throw new Error('missing Listening section');
    expect(listening.declared_question_count).toBe(47);
    expect(listening.modules.map((module) => [module.module_id, module.question_numbers])).toEqual([
      ['LISTENING_MODULE_1', [1, 32]],
      ['LISTENING_MODULE_2', [33, 47]]
    ]);
    expect(listening.question_slots.filter((slot) => slot.module_id === 'LISTENING_MODULE_1').map((slot) => slot.slot_id))
      .toEqual(Array.from({ length: 32 }, (_, index) => `Listening-${index + 1}`));
    expect(listening.question_slots.filter((slot) => slot.module_id === 'LISTENING_MODULE_2').map((slot) => slot.slot_id))
      .toEqual(Array.from({ length: 15 }, (_, index) => `Listening-${index + 33}`));
    expect(listening.question_slots.map((slot) => slot.slot_id))
      .toEqual(Array.from({ length: 47 }, (_, index) => `Listening-${index + 1}`));
    expect(new Set(listening.question_slots.map((slot) => slot.slot_id)).size).toBe(47);
    expect(listening.question_slots.every((slot) => slot.type_label === 'External Audio Question')).toBe(true);
    expect(listening.question_slots.every((slot) => slot.confirmation_status === 'NEEDS_USER_CONFIRMATION')).toBe(true);
  });

  it.each(['practice', 'exam_simulation'] as const)(
    'moves L32 to L33, isolates finalized Module 1, and completes at L47 in %s mode',
    async (mode) => {
      const atL32 = advanceBy(encounterCurrentScope(listeningSession(mode)), 31);
      expect(atL32.current_question_id).toBe('Listening-32');
      expect(advanceFromCurrent(atL32, 100)).toMatchObject({
        completedSession: false,
        session: { current_question_id: 'Listening-32', current_scope_id: 'LISTENING_MODULE_1' }
      });

      const module1 = await finalizeCurrentScope(atL32, 100, async () => undefined);
      expect(module1).toMatchObject({
        ok: true,
        next: 'NEXT_MODULE',
        finalizedScopeId: 'LISTENING_MODULE_1',
        session: { current_question_id: 'Listening-33', current_scope_id: 'LISTENING_MODULE_2', view: 'PRACTICE' }
      });
      expect(previousQuestionInSession(module1.session).current_question_id).toBe('Listening-33');
      expect(module1.session.active_scope_question_ids[0]).toBe('Listening-33');
      expect(module1.session.active_scope_question_ids).toHaveLength(15);

      const atL47 = advanceBy(encounterCurrentScope(module1.session), 14);
      expect(atL47.current_question_id).toBe('Listening-47');
      const completed = await finalizeCurrentScope(atL47, 100, async () => undefined);
      expect(completed).toMatchObject({
        ok: true,
        next: 'SESSION_SUMMARY',
        finalizedScopeId: 'LISTENING_MODULE_2',
        session: { view: 'SESSION_SUMMARY', completed_sections: ['Listening'] }
      });
    }
  );

  it('exports 32+15 from persisted Session modules and records Blueprint 1.3.0', async () => {
    const session = completedListeningSession();
    const bundle = buildSessionExportBundle(session, []);
    const answers = JSON.parse(bundle.files['answers.json']) as {
      blueprint_version: string;
      active_time_ms: number;
      sections: Array<{
        section_id: string;
        active_time_ms: number;
        modules: Array<{ module_id: string; active_time_ms: number; question_ids: string[] }>;
      }>;
    };
    const listening = answers.sections.find((section) => section.section_id === 'Listening');
    expect(answers.blueprint_version).toBe('1.3.0');
    expect(listening?.modules.map((module) => [module.module_id, module.question_ids.length])).toEqual([
      ['LISTENING_MODULE_1', 32],
      ['LISTENING_MODULE_2', 15]
    ]);
    expect(listening?.active_time_ms).toBe(4_700);
    expect(listening?.modules.reduce((sum, module) => sum + module.active_time_ms, 0)).toBe(4_700);
    expect(bundle.files['session_summary.md']).toMatch(/Listening \| Listening Module 1 \| FINALIZED \|.*\| 32 \|/);
    expect(bundle.files['session_summary.md']).toMatch(/Listening \| Listening Module 2 \| FINALIZED \|.*\| 15 \|/);
    expect(bundle.files['Listening.md']).toContain('| L32 | LISTENING_MODULE_1 |');
    expect(bundle.files['Listening.md']).toContain('| L33 | LISTENING_MODULE_2 |');
    expect(bundle.files['question_metrics.csv']).toContain('Listening,LISTENING_MODULE_1,Listening-32');
    expect(bundle.files['question_metrics.csv']).toContain('Listening,LISTENING_MODULE_2,Listening-33');

    await exportSessionRecord(session, [], async () => undefined);
    expect(storageMocks.writeRecordIndex).toHaveBeenLastCalledWith(expect.objectContaining({
      session_id: session.session_id,
      blueprint_version: '1.3.0'
    }));
  });

  it('preserves a Blueprint 1.2.0 35+12 Recovery and re-export without default Blueprint rewriting', () => {
    const prepared = prepareRecoverySession(legacyListeningSnapshot('1.2.0'), [DEFAULT_BLUEPRINT.blueprint_id]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.migrated).toBe(false);
    expect(prepared.session.blueprint_version).toBe('1.2.0');
    expect(prepared.session.modules.map((module) => [module.id, module.questionIds.length])).toEqual([
      ['LISTENING_MODULE_1', 35],
      ['LISTENING_MODULE_2', 12]
    ]);
    expect(prepared.session.current_question_id).toBe('Listening-36');
    expect(prepared.session.answers['Listening-35']).toMatchObject({
      answer_value: 'B',
      active_time_ms: 1_234,
      is_skipped: true,
      is_uncertain: true,
      is_overtime: true
    });

    const bundle = buildSessionExportBundle(prepared.session, []);
    const answers = JSON.parse(bundle.files['answers.json']) as {
      blueprint_version: string;
      sections: Array<{ section_id: string; modules: Array<{ question_ids: string[] }> }>;
    };
    expect(answers.blueprint_version).toBe('1.2.0');
    expect(answers.sections[0].modules.map((module) => module.question_ids.length)).toEqual([35, 12]);
    expect(bundle.files['Listening.md']).toContain('| L35 | LISTENING_MODULE_1 |');
    expect(bundle.files['Listening.md']).toContain('| L36 | LISTENING_MODULE_2 |');
  });

  it('preserves a Blueprint 1.1.0 single Listening scope', () => {
    const prepared = prepareRecoverySession(legacyListeningSnapshot('1.1.0'), [DEFAULT_BLUEPRINT.blueprint_id]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.session.blueprint_version).toBe('1.1.0');
    expect(prepared.session.modules.map((module) => [module.id, module.questionIds.length]))
      .toEqual([['LISTENING_SECTION', 47]]);
    expect(prepared.session.questions.every((question) => question.module_id === 'LISTENING_SECTION')).toBe(true);
  });
});
