import type {
  AnswerMode,
  AnswerRecord,
  EventLogEntry,
  FinalizeScopeResult,
  InputControlKind,
  ModuleRuntimeState,
  PracticeMode,
  PracticeQuestion,
  PracticeSession,
  QuestionBlueprint,
  QuestionNavItem,
  QuestionProgressStatus,
  RuntimeScopeId,
  SectionName
} from '../types';
import { SCHEMA_VERSION } from '../constants';
import { inferAnswerStatus } from './answerState';
import { getNavigationRules } from './navigationPolicy';
import { serializeSessionForPersistence, toPersistedMilliseconds } from './persistedTime';
import {
  activateTaskForQuestion,
  completeCurrentTask,
  createPracticeTasks,
  getTaskTimingState,
  isLongWritingTask,
  scopeIdForTaskQuestion,
  synchronizeTaskTimingState,
  taskIdForQuestion
} from './taskRuntime';
import { createQuestionsFromBlueprint, DEFAULT_BLUEPRINT, type ToeflBlueprint } from './blueprint';
import { isDynamicSession } from './dynamicSession';

export const CURRENT_SESSION_SCHEMA_VERSION = 5;

export const TOEFL_2026_QUESTION_BLUEPRINT: QuestionBlueprint = {
  blueprint_id: DEFAULT_BLUEPRINT.blueprint_id,
  blueprint_version: DEFAULT_BLUEPRINT.version,
  sections: Object.fromEntries(DEFAULT_BLUEPRINT.sections.map((section) => [
    section.section_id,
    section.question_slots.map(({ number, type_label, answer_mode, option_count, time_limit_ms, listening_group_id, passage_group_id }) => ({
      number,
      type_label,
      answer_mode,
      ...(option_count === undefined ? {} : { option_count }),
      ...(time_limit_ms === undefined ? {} : { time_limit_ms }),
      ...(listening_group_id === undefined ? {} : { listening_group_id }),
      ...(passage_group_id === undefined ? {} : { passage_group_id })
    }))
  ])) as QuestionBlueprint['sections']
};

export interface NavigationResult {
  session: PracticeSession;
  completedSection?: SectionName;
  completedSession: boolean;
}

export type NavigationIntent = 'direct' | 'next' | 'previous' | 'answer_card' | 'restore';

export function getQuestionBlueprint(): QuestionBlueprint {
  return TOEFL_2026_QUESTION_BLUEPRINT;
}

export function createDefaultQuestions(sections: SectionName[]): PracticeQuestion[] {
  return createQuestionsFromConfiguredBlueprint(DEFAULT_BLUEPRINT, sections);
}

export function createQuestionsFromConfiguredBlueprint(
  blueprint: ToeflBlueprint,
  sections: SectionName[]
): PracticeQuestion[] {
  const questions = createQuestionsFromBlueprint(blueprint, sections);
  assertGloballyUniqueQuestionIds(questions);
  return questions;
}

export function buildInitialSessionRuntime(session: unknown): PracticeSession {
  const migrated = migratePracticeSession(session);
  if (migrated.view === 'SESSION_SUMMARY') return migrated;
  return enterQuestion(migrated, migrated.current_question_id, migrated.started_at ?? migrated.created_at);
}

export function migratePracticeSession(rawSession: unknown): PracticeSession {
  const input = (rawSession ?? {}) as Partial<PracticeSession> & Record<string, unknown>;
  validateExplicitRequiredMilliseconds(input);
  const preservePersistedScopes = shouldPreservePersistedScopes(input);
  const questions = normalizeQuestions((input.questions ?? []) as PracticeQuestion[], preservePersistedScopes);
  assertGloballyUniqueQuestionIds(questions);
  const modules = normalizeRuntimeScopes(
    input.modules,
    questions,
    input.started_at ?? input.created_at,
    preservePersistedScopes
  );
  const currentQuestion = selectCurrentQuestion(input, questions, modules);
  const currentScope =
    modules.find((scope) => scope.id === currentQuestion?.module_id) ??
    modules.find((scope) => scope.status === 'IN_PROGRESS') ??
    modules[0];
  if (!currentQuestion || !currentScope) {
    throw new Error('A practice session requires at least one question and one runtime scope.');
  }

  const normalizedQuestions = questions.map((question) => ({
    ...question,
    module_id: preservePersistedScopes ? question.module_id : scopeIdForTaskQuestion(question)
  }));
  const answers = normalizeAnswers(input.answers, normalizedQuestions);
  const tasks = createPracticeTasks(
    normalizedQuestions,
    answers,
    (input.mode ?? 'practice') as PracticeMode,
    (input.tasks ?? []) as PracticeSession['tasks'],
    (input.modules ?? []) as ModuleRuntimeState[]
  );
  const base = {
    ...input,
    session_schema_version: CURRENT_SESSION_SCHEMA_VERSION,
    session_id: String(input.session_id ?? ''),
    package_id: String(input.package_id ?? ''),
    source_path: String(input.source_path ?? ''),
    mode: (input.mode ?? 'practice') as PracticeMode,
    timing_profile_id: String(input.timing_profile_id ?? 'toefl-2026-practice'),
    timing_profile_version: String(input.timing_profile_version ?? '1.0.0'),
    created_at: String(input.created_at ?? new Date().toISOString()),
    active_ms: Number(input.active_ms ?? 0),
    paused_ms: Number(input.paused_ms ?? 0),
    unattributed_active_time_ms: Number(input.unattributed_active_time_ms ?? 0),
    questions: normalizedQuestions,
    answers,
    modules,
    tasks,
    current_task_id: input.current_task_id ?? taskIdForQuestion(currentQuestion),
    view: input.view ?? (input.completed_at ? 'SESSION_SUMMARY' : 'PRACTICE')
  } as PracticeSession;
  const synchronized = synchronizeCurrentIdentity(
    synchronizeTaskTimingState(base),
    currentScope.id,
    currentQuestion.id
  );
  return serializeSessionForPersistence(normalizeRestoredNavigation(synchronized));
}

export function answerModeToInputControl(mode: AnswerMode): InputControlKind {
  if (mode === 'single_choice') return 'single_choice_buttons';
  if (mode === 'multiple_choice') return 'multiple_choice_controls';
  if (mode === 'long_text') return 'multi_line_text';
  if (mode === 'order' || mode === 'order_input') return 'order_input';
  if (mode === 'speaking_timer') return 'speaking_completion';
  return 'single_line_text';
}

export function upsertAnswer(
  session: PracticeSession,
  question: PracticeQuestion,
  answerValue: unknown,
  activeTimeMs: number,
  isOvertime = false,
  nowIso = new Date().toISOString()
): PracticeSession {
  if (isQuestionInFinalizedScope(session, question.id)) return session;
  const encounteredSession = markQuestionEncountered(session, question.id, nowIso);
  const existing = encounteredSession.answers[question.id];
  const progressStatus = inferAnswerStatus(answerValue, question.answer_mode);
  const changed = Boolean(existing) && JSON.stringify(existing?.answer_value) !== JSON.stringify(answerValue);
  const modificationCount = (existing?.modification_count ?? existing?.revision_count ?? 0) + (changed ? 1 : 0);
  const firstAnswerAt =
    progressStatus === 'ANSWERED' || progressStatus === 'PARTIALLY_ANSWERED'
      ? existing?.first_answer_at ?? nowIso
      : existing?.first_answer_at;
  const nextAnswer = makeAnswerRecord({
    existing,
    questionId: question.id,
    answerValue,
    progressStatus,
    isOvertime: existing?.is_overtime || isOvertime,
    isSkipped: false,
    isUncertain: existing?.is_uncertain ?? existing?.marked_review ?? false,
    activeTimeMs,
    modificationCount,
    firstAnswerElapsedMs: existing?.first_answer_elapsed_ms ?? activeTimeMs,
    firstAnswerAt,
    nowIso
  });
  return {
    ...encounteredSession,
    answers: { ...encounteredSession.answers, [question.id]: nextAnswer }
  };
}

export function skipQuestion(
  session: PracticeSession,
  question: PracticeQuestion,
  activeTimeMs: number,
  nowIso = new Date().toISOString()
): PracticeSession {
  if (isQuestionInFinalizedScope(session, question.id)) return session;
  const encounteredSession = markQuestionEncountered(session, question.id, nowIso);
  const existing = encounteredSession.answers[question.id];
  const answerValue = existing?.answer_value ?? null;
  const progressStatus = getQuestionProgressStatus(
    encounteredSession.questions.find((item) => item.id === question.id) ?? question,
    existing
  );
  const nextAnswer = makeAnswerRecord({
    existing,
    questionId: question.id,
    answerValue,
    progressStatus,
    isOvertime: existing?.is_overtime || shouldQuestionBeOvertime(session, question, activeTimeMs),
    isSkipped: true,
    isUncertain: existing?.is_uncertain ?? existing?.marked_review ?? false,
    activeTimeMs,
    modificationCount: existing?.modification_count ?? existing?.revision_count ?? 0,
    firstAnswerElapsedMs: existing?.first_answer_elapsed_ms,
    firstAnswerAt: existing?.first_answer_at,
    nowIso
  });
  return {
    ...encounteredSession,
    answers: { ...encounteredSession.answers, [question.id]: nextAnswer }
  };
}

export function finalizeQuestion(
  session: PracticeSession,
  question: PracticeQuestion,
  activeTimeMs: number,
  isOvertime = false,
  nowIso = new Date().toISOString()
): PracticeSession {
  if (isQuestionInFinalizedScope(session, question.id)) return session;
  const encounteredSession = markQuestionEncountered(session, question.id, nowIso);
  const existing = encounteredSession.answers[question.id];
  const nextAnswer = makeAnswerRecord({
    existing,
    questionId: question.id,
    answerValue: existing?.answer_value ?? null,
    progressStatus: getQuestionProgressStatus(
      encounteredSession.questions.find((item) => item.id === question.id) ?? question,
      existing
    ),
    isOvertime: existing?.is_overtime || isOvertime,
    isSkipped: existing?.is_skipped ?? false,
    isUncertain: existing?.is_uncertain ?? existing?.marked_review ?? false,
    activeTimeMs,
    modificationCount: existing?.modification_count ?? existing?.revision_count ?? 0,
    firstAnswerElapsedMs: existing?.first_answer_elapsed_ms,
    firstAnswerAt: existing?.first_answer_at,
    nowIso
  });
  return {
    ...encounteredSession,
    answers: { ...encounteredSession.answers, [question.id]: nextAnswer }
  };
}

export function advanceFromCurrent(session: PracticeSession, activeTimeMs: number): NavigationResult {
  const question = getCurrentQuestion(session);
  if (!question) return { session, completedSession: session.view === 'SESSION_SUMMARY' };
  const settled = finalizeQuestion(
    session,
    question,
    activeTimeMs,
    shouldQuestionBeOvertime(session, question, activeTimeMs)
  );
  return moveWithinCurrentScope(settled);
}

export function skipAndAdvance(session: PracticeSession, activeTimeMs: number): NavigationResult {
  const question = getCurrentQuestion(session);
  if (!question) return { session, completedSession: session.view === 'SESSION_SUMMARY' };
  return moveWithinCurrentScope(skipQuestion(session, question, activeTimeMs));
}

export async function finalizeCurrentScope(
  session: PracticeSession,
  currentQuestionActiveMs: number,
  persistSnapshot: (session: PracticeSession) => Promise<void>,
  nowIso = new Date().toISOString()
): Promise<FinalizeScopeResult> {
  const currentScope = getCurrentModule(session);
  const question = getCurrentQuestion(session);
  if (!currentScope || !question) return persistenceError(session, 'No active runtime scope to finalize.');

  const settled = finalizeQuestion(
    session,
    question,
    currentQuestionActiveMs,
    shouldQuestionBeOvertime(session, question, currentQuestionActiveMs),
    nowIso
  );
  const unencountered = settled.active_scope_question_ids.filter(
    (questionId) => !settled.questions.find((item) => item.id === questionId)?.encountered
  );
  if (unencountered.length > 0) {
    try {
      await persistSnapshot(settled);
    } catch (error) {
      return persistenceError(settled, error instanceof Error ? error.message : String(error));
    }
    const failed: FinalizeScopeResult = {
      ok: false,
      reason: 'UNENCOUNTERED_ITEMS',
      questionIds: unencountered,
      session: settled
    };
    return { ...failed, session: { ...settled, last_finalize_error: failed } };
  }

  const scopeActiveTimeMs = currentScope.questionIds.reduce(
    (total, questionId) => total + (settled.answers[questionId]?.active_time_ms ?? 0),
    0
  );
  const finalizedScopeId = currentScope.id;
  const withCompletedTask = completeCurrentTask(settled, nowIso);
  const withFinalizedScope = updateScope(withCompletedTask, currentScope.id, {
    status: 'FINALIZED',
    activeTimeMs: Math.max(currentScope.activeTimeMs, scopeActiveTimeMs),
    isOvertime: currentScope.questionIds.some((questionId) => settled.answers[questionId]?.is_overtime),
    finalizedAt: nowIso
  });
  const transitioned = transitionAfterScopeFinalized(withFinalizedScope, currentScope.id, nowIso);
  const candidate = serializeSessionForPersistence(transitioned.session);
  const { next } = transitioned;

  try {
    await persistSnapshot(candidate);
  } catch (error) {
    return persistenceError(settled, error instanceof Error ? error.message : String(error));
  }
  return {
    ok: true,
    next,
    finalizedScopeId,
    session: { ...candidate, last_finalize_error: undefined }
  };
}

// R005 compatibility entry point. All sections now use finalizeCurrentScope.
export const finalizeModule = finalizeCurrentScope;

export function getQuestionNavItems(session: PracticeSession): QuestionNavItem[] {
  return session.active_scope_question_ids.flatMap((questionId) => {
    const index = session.questions.findIndex((question) => question.id === questionId);
    const question = session.questions[index];
    if (!question) return [];
    const answer = session.answers[question.id];
    const isCurrent = question.id === session.current_question_id;
    const isLocked = isQuestionInFinalizedScope(session, question.id);
    return [
      {
        id: question.id,
        index,
        label: `${question.section[0]}${question.number}`,
        section: question.section_id,
        moduleId: question.module_id,
        number: question.number,
        status: getQuestionProgressStatus(question, answer),
        isCurrent,
        isUncertain: answer?.is_uncertain ?? answer?.marked_review ?? false,
        isMarked: answer?.is_uncertain ?? answer?.marked_review ?? false,
        isSkipped: answer?.is_skipped ?? false,
        isOvertime: answer?.is_overtime ?? false,
        isDisabled:
          isLocked ||
          question.module_id !== session.current_scope_id ||
          !canNavigateToQuestion(session, question.id, 'answer_card'),
        isLocked,
        ariaCurrent: isCurrent ? 'true' : undefined
      }
    ];
  });
}

export function getQuestionProgressStatus(
  question: PracticeQuestion,
  answer?: AnswerRecord
): QuestionProgressStatus {
  if (!question.encountered) return 'NOT_ENCOUNTERED';
  if (answer?.progress_status && isProgressStatus(answer.progress_status)) return answer.progress_status;
  if (answer?.status && isProgressStatus(answer.status)) return answer.status;
  return answer ? inferAnswerStatus(answer.answer_value, question.answer_mode) : 'ENCOUNTERED_UNANSWERED';
}

export function isLastQuestionInSection(session: PracticeSession): boolean {
  const current = getCurrentQuestion(session);
  return Boolean(current && session.active_section_question_ids.at(-1) === current.id);
}

export function isLastQuestionInSession(session: PracticeSession): boolean {
  return session.modules.at(-1)?.questionIds.at(-1) === session.current_question_id;
}

export function isLastQuestionInCurrentModule(session: PracticeSession): boolean {
  return session.active_scope_question_ids.at(-1) === session.current_question_id;
}

export function currentScopeCompletesSection(session: PracticeSession): boolean {
  const currentIndex = session.modules.findIndex((scope) => scope.id === session.current_scope_id);
  const current = session.modules[currentIndex];
  const next = session.modules[currentIndex + 1];
  return Boolean(current && (!next || next.section !== current.section));
}

export function getCurrentModule(session: PracticeSession): ModuleRuntimeState | undefined {
  return session.modules.find((scope) => scope.id === session.current_scope_id);
}

export function getCurrentQuestion(session: PracticeSession): PracticeQuestion | undefined {
  return (
    session.questions.find((question) => question.id === session.current_question_id) ??
    session.questions[session.current_question_index]
  );
}

export function markQuestionEncountered(
  session: PracticeSession,
  questionId: string,
  nowIso = new Date().toISOString()
): PracticeSession {
  let changed = false;
  const questions = session.questions.map((question) => {
    if (question.id !== questionId || question.encountered) return question;
    changed = true;
    return {
      ...question,
      encountered: true,
      visit_count: Math.max(1, question.visit_count ?? 0),
      first_seen_at: question.first_seen_at ?? nowIso,
      last_entered_at: question.last_entered_at ?? nowIso
    };
  });
  return changed ? { ...session, questions } : session;
}

export function enterQuestion(
  session: PracticeSession,
  questionId: string,
  nowIso = new Date().toISOString(),
  intent: NavigationIntent = 'direct'
): PracticeSession {
  if (!canNavigateToQuestion(session, questionId, intent)) return session;
  const target = session.questions.find((question) => question.id === questionId);
  if (!target || target.module_id !== session.current_scope_id || isQuestionInFinalizedScope(session, questionId)) {
    return session;
  }
  const questions = session.questions.map((question) =>
    question.id === questionId
      ? {
          ...question,
          encountered: true,
          visit_count: (question.visit_count ?? 0) + 1,
          first_seen_at: question.first_seen_at ?? nowIso,
          last_entered_at: nowIso
        }
      : question
  );
  return activateTaskForQuestion(
    synchronizeCurrentIdentity({ ...session, questions }, target.module_id, questionId),
    questionId,
    nowIso
  );
}

export function goToQuestionByIndex(session: PracticeSession, index: number): PracticeSession {
  const target = session.questions[index];
  return target ? enterQuestion(session, target.id, new Date().toISOString(), 'answer_card') : session;
}

export function previousQuestionInSession(session: PracticeSession): PracticeSession {
  const currentIndex = session.active_scope_question_ids.indexOf(session.current_question_id);
  if (currentIndex < 0) return session;
  const targetId = session.active_scope_question_ids[Math.max(0, currentIndex - 1)];
  return enterQuestion(session, targetId, new Date().toISOString(), 'previous');
}

export function markUncertain(
  session: PracticeSession,
  questionId: string,
  uncertain: boolean,
  nowIso = new Date().toISOString()
): PracticeSession {
  if (isQuestionInFinalizedScope(session, questionId)) return session;
  const question = session.questions.find((item) => item.id === questionId);
  if (!question) return session;
  const encounteredSession = markQuestionEncountered(session, questionId, nowIso);
  const existing = encounteredSession.answers[questionId];
  const nextAnswer = makeAnswerRecord({
    existing,
    questionId,
    answerValue: existing?.answer_value ?? null,
    progressStatus: getQuestionProgressStatus(
      encounteredSession.questions.find((item) => item.id === questionId) ?? question,
      existing
    ),
    isOvertime: existing?.is_overtime ?? false,
    isSkipped: existing?.is_skipped ?? false,
    isUncertain: uncertain,
    activeTimeMs: existing?.active_time_ms ?? existing?.total_active_ms ?? 0,
    modificationCount: existing?.modification_count ?? existing?.revision_count ?? 0,
    firstAnswerElapsedMs: existing?.first_answer_elapsed_ms,
    firstAnswerAt: existing?.first_answer_at,
    nowIso
  });
  return {
    ...encounteredSession,
    answers: { ...encounteredSession.answers, [questionId]: nextAnswer }
  };
}

export const markReview = markUncertain;

export function shouldQuestionBeOvertime(
  session: Pick<PracticeSession, 'mode' | 'tasks'>,
  question: PracticeQuestion,
  activeTimeMs: number
): boolean {
  if (question.section_id === 'Listening' && !isDynamicSession(session as PracticeSession)) return false;
  const taskId = taskIdForQuestion(question);
  const task = taskId ? session.tasks.find((item) => item.task_id === taskId) : undefined;
  if (isLongWritingTask(task)) return getTaskTimingState(task, activeTimeMs).is_overtime;
  if (task) return task.is_overtime;
  return question.time_limit_ms != null && activeTimeMs >= question.time_limit_ms;
}

export function canNavigateBackward(session: PracticeSession): boolean {
  return session.current_section_id !== 'Listening' || getNavigationRules(session).listening_can_return;
}

export function canNavigateToQuestion(
  session: PracticeSession,
  questionId: string,
  intent: NavigationIntent = 'direct'
): boolean {
  if (session.view !== 'PRACTICE' || !session.active_scope_question_ids.includes(questionId)) return false;
  const target = session.questions.find((question) => question.id === questionId);
  if (!target || target.module_id !== session.current_scope_id || isQuestionInFinalizedScope(session, questionId)) {
    return false;
  }
  if (questionId === session.current_question_id) return true;
  if (session.current_section_id === 'Speaking') {
    const currentTask = session.tasks.find((task) => task.task_id === session.current_task_id);
    const targetTaskId = taskIdForQuestion(target);
    if (currentTask?.status === 'ACTIVE' && targetTaskId !== currentTask.task_id) return false;
  }
  if (session.current_section_id !== 'Listening') return true;

  const currentPosition = session.active_scope_question_ids.indexOf(session.current_question_id);
  const targetPosition = session.active_scope_question_ids.indexOf(questionId);
  if (currentPosition < 0 || targetPosition < 0) return false;
  if (intent === 'next') return targetPosition === currentPosition + 1;

  const rules = getNavigationRules(session);
  if (!rules.listening_can_return) return false;
  return target.encountered;
}

export function normalizeRestoredNavigation(session: PracticeSession): PracticeSession {
  if (
    session.view !== 'PRACTICE' ||
    session.current_section_id !== 'Listening' ||
    getNavigationRules(session).listening_can_return
  ) {
    return session;
  }
  const frontier = session.active_scope_question_ids.reduce((highest, questionId, index) => {
    const question = session.questions.find((item) => item.id === questionId);
    return question?.encountered ? Math.max(highest, index) : highest;
  }, 0);
  const frontierId = session.active_scope_question_ids[frontier];
  return frontierId ? synchronizeCurrentIdentity(session, session.current_scope_id, frontierId) : session;
}

export function createEvent(
  sessionId: string,
  seq: number,
  monotonicElapsedMs: number,
  eventType: string,
  payload: Record<string, unknown> = {}
): EventLogEntry {
  return {
    session_id: sessionId,
    seq,
    monotonic_elapsed_ms: monotonicElapsedMs,
    wall_clock: new Date().toISOString(),
    event_type: eventType,
    payload,
    schema_version: SCHEMA_VERSION
  };
}

function moveWithinCurrentScope(session: PracticeSession): NavigationResult {
  const currentPosition = session.active_scope_question_ids.indexOf(session.current_question_id);
  if (currentPosition < 0 || currentPosition >= session.active_scope_question_ids.length - 1) {
    return { session, completedSession: false };
  }
  const nextQuestionId = session.active_scope_question_ids[currentPosition + 1];
  return { session: enterQuestion(session, nextQuestionId, new Date().toISOString(), 'next'), completedSession: false };
}

function transitionAfterScopeFinalized(
  session: PracticeSession,
  scopeId: RuntimeScopeId,
  finalizedAt: string
): { session: PracticeSession; next: 'NEXT_MODULE' | 'NEXT_SECTION' | 'SESSION_SUMMARY' } {
  const scopeIndex = session.modules.findIndex((scope) => scope.id === scopeId);
  const currentScope = session.modules[scopeIndex];
  const nextScope = session.modules[scopeIndex + 1];
  const completesSection = !nextScope || nextScope.section !== currentScope.section;
  const completedSections = completesSection
    ? Array.from(new Set([...(session.completed_sections ?? []), currentScope.section]))
    : session.completed_sections;

  if (!nextScope) {
    return {
      next: 'SESSION_SUMMARY',
      session: {
        ...session,
        completed_sections: completedSections,
        completed_at: finalizedAt,
        view: 'SESSION_SUMMARY'
      }
    };
  }

  const activated = updateScope(session, nextScope.id, {
    status: nextScope.section === 'Speaking' ? 'NOT_STARTED' : 'IN_PROGRESS',
    startedAt: nextScope.section === 'Speaking' ? nextScope.startedAt : nextScope.startedAt ?? finalizedAt
  });
  const firstQuestionId = nextScope.questionIds[0];
  const synchronized = synchronizeCurrentIdentity(
    { ...activated, completed_sections: completedSections, view: 'PRACTICE' },
    nextScope.id,
    firstQuestionId
  );
  return {
    next: nextScope.section === currentScope.section ? 'NEXT_MODULE' : 'NEXT_SECTION',
    session: enterQuestion(synchronized, firstQuestionId, finalizedAt)
  };
}

function normalizeQuestions(rawQuestions: PracticeQuestion[], preservePersistedScopes = false): PracticeQuestion[] {
  return rawQuestions.map((rawQuestion) => {
    const section = (rawQuestion.section_id ?? rawQuestion.section) as SectionName;
    const normalized = { ...rawQuestion, section_id: section } as PracticeQuestion;
    return {
      ...rawQuestion,
      id: String(rawQuestion.id),
      section,
      section_id: section,
      module_id: preservePersistedScopes && rawQuestion.module_id
        ? rawQuestion.module_id
        : scopeIdForTaskQuestion(normalized),
      encountered: Boolean(rawQuestion.encountered),
      visit_count: Number(rawQuestion.visit_count ?? (rawQuestion.encountered ? 1 : 0))
    };
  });
}

function validateExplicitRequiredMilliseconds(input: Partial<PracticeSession> & Record<string, unknown>): void {
  for (const field of ['active_ms', 'paused_ms', 'unattributed_active_time_ms'] as const) {
    if (input[field] !== undefined) toPersistedMilliseconds(input[field], `session.${field}`);
  }
  Object.entries(input.answers ?? {}).forEach(([questionId, answer]) => {
    if (answer.active_time_ms !== undefined) {
      toPersistedMilliseconds(answer.active_time_ms, `answers.${questionId}.active_time_ms`);
    }
    if (answer.total_active_ms !== undefined) {
      toPersistedMilliseconds(answer.total_active_ms, `answers.${questionId}.total_active_ms`);
    }
  });
  (input.modules ?? []).forEach((scope, index) => {
    if (scope.activeTimeMs !== undefined) {
      toPersistedMilliseconds(scope.activeTimeMs, `modules.${index}.activeTimeMs`);
    }
  });
  (input.tasks ?? []).forEach((task, index) => {
    toPersistedMilliseconds(task.active_time_ms, `tasks.${index}.active_time_ms`);
    toPersistedMilliseconds(task.pause_time_ms, `tasks.${index}.pause_time_ms`);
  });
}

function normalizeRuntimeScopes(
  rawScopes: ModuleRuntimeState[] | undefined,
  questions: PracticeQuestion[],
  sessionStartedAt?: string,
  preservePersistedScopes = false
): ModuleRuntimeState[] {
  const existing = rawScopes ?? [];
  if (preservePersistedScopes) return normalizePersistedRuntimeScopes(existing, questions);
  const definitions = DEFAULT_BLUEPRINT.sections.flatMap((section) => section.modules.map((module) => ({
    id: module.module_id,
    section: section.section_id,
    kind: module.kind,
    label: module.label
  })));
  const scopes = definitions.flatMap((definition) => {
    const questionIds = questions
      .filter((question) => question.module_id === definition.id)
      .map((question) => question.id);
    if (questionIds.length === 0) return [];
    const legacyId = definition.section === 'Writing' ? 'WRITING_TASK_GROUP' :
      definition.section === 'Speaking' ? 'SPEAKING_TASK_GROUP' : null;
    const exactPrior = existing.find((scope) => scope.id === definition.id);
    const legacyPrior = legacyId ? existing.find((scope) => String(scope.id) === legacyId) : undefined;
    const prior = exactPrior ?? (legacyPrior?.status === 'FINALIZED' ? legacyPrior : undefined);
    return [
      {
        ...definition,
        status: prior?.status ?? 'NOT_STARTED',
        questionIds,
        activeTimeMs: Number(prior?.activeTimeMs ?? 0),
        isOvertime: Boolean(prior?.isOvertime),
        startedAt: prior?.startedAt ?? null,
        finalizedAt: prior?.finalizedAt ?? null
      } satisfies ModuleRuntimeState
    ];
  });
  if (!scopes.some((scope) => scope.status === 'IN_PROGRESS') && scopes.length > 0 && scopes[0].section !== 'Speaking') {
    scopes[0] = { ...scopes[0], status: 'IN_PROGRESS', startedAt: scopes[0].startedAt ?? sessionStartedAt ?? null };
  }
  return scopes;
}

function shouldPreservePersistedScopes(
  input: Partial<PracticeSession> & Record<string, unknown>
): boolean {
  return Number(input.session_schema_version) === CURRENT_SESSION_SCHEMA_VERSION &&
    typeof input.blueprint_version === 'string' &&
    input.blueprint_version !== DEFAULT_BLUEPRINT.version &&
    Array.isArray(input.modules) &&
    input.modules.length > 0;
}

function normalizePersistedRuntimeScopes(
  persistedScopes: ModuleRuntimeState[],
  questions: PracticeQuestion[]
): ModuleRuntimeState[] {
  const seenScopeIds = new Set<string>();
  const coveredQuestionIds = new Set<string>();
  const questionIds = new Set(questions.map((question) => question.id));
  const scopes = persistedScopes.map((scope) => {
    if (seenScopeIds.has(scope.id)) throw new Error(`Persisted runtime contains duplicate scope ${scope.id}.`);
    seenScopeIds.add(scope.id);
    const expectedQuestionIds = questions
      .filter((question) => question.module_id === scope.id)
      .map((question) => question.id);
    const persistedQuestionIds = (scope.questionIds ?? []).filter((questionId) => questionIds.has(questionId));
    if (
      expectedQuestionIds.length === 0 ||
      persistedQuestionIds.length !== expectedQuestionIds.length ||
      expectedQuestionIds.some((questionId) => !persistedQuestionIds.includes(questionId))
    ) {
      throw new Error(`Persisted runtime scope ${scope.id} does not match its Question membership.`);
    }
    persistedQuestionIds.forEach((questionId) => coveredQuestionIds.add(questionId));
    return {
      ...scope,
      questionIds: [...persistedQuestionIds],
      activeTimeMs: Number(scope.activeTimeMs ?? 0),
      isOvertime: Boolean(scope.isOvertime),
      startedAt: scope.startedAt ?? null,
      finalizedAt: scope.finalizedAt ?? null
    };
  });
  if (coveredQuestionIds.size !== questions.length) {
    throw new Error('Persisted runtime scopes do not cover every Session Question.');
  }
  return scopes;
}

function normalizeAnswers(
  rawAnswers: Record<string, AnswerRecord> | undefined,
  questions: PracticeQuestion[]
): Record<string, AnswerRecord> {
  const normalized: Record<string, AnswerRecord> = {};
  for (const [questionId, raw] of Object.entries(rawAnswers ?? {})) {
    const question = questions.find((item) => item.id === questionId);
    if (!question) continue;
    const legacyStatus = String((raw as unknown as { status?: string }).status ?? '');
    const progressStatus = isProgressStatus(raw.progress_status)
      ? raw.progress_status
      : isProgressStatus(legacyStatus)
        ? legacyStatus
        : inferAnswerStatus(raw.answer_value, question.answer_mode);
    const activeTimeMs = Number(raw.active_time_ms ?? raw.total_active_ms ?? 0);
    const modificationCount = Number(raw.modification_count ?? raw.revision_count ?? 0);
    const lastChangedAt = String(raw.last_changed_at ?? raw.updated_at ?? '');
    normalized[questionId] = makeAnswerRecord({
      existing: raw,
      questionId,
      answerValue: raw.answer_value,
      progressStatus:
        progressStatus === 'NOT_ENCOUNTERED' && question.encountered ? 'ENCOUNTERED_UNANSWERED' : progressStatus,
      isOvertime: Boolean(raw.is_overtime || legacyStatus === 'OVERTIME'),
      isSkipped: Boolean(raw.is_skipped || legacyStatus === 'SKIPPED'),
      isUncertain: Boolean(raw.is_uncertain ?? raw.marked_review),
      activeTimeMs,
      modificationCount,
      firstAnswerElapsedMs: raw.first_answer_elapsed_ms,
      firstAnswerAt: raw.first_answer_at,
      nowIso: lastChangedAt
    });
  }
  return normalized;
}

function selectCurrentQuestion(
  input: Partial<PracticeSession>,
  questions: PracticeQuestion[],
  scopes: ModuleRuntimeState[]
): PracticeQuestion | undefined {
  const byId = questions.find((question) => question.id === input.current_question_id);
  if (byId) return byId;
  const byIndex = questions[clampQuestionIndex(input.current_question_index ?? 0, questions)];
  if (byIndex) return byIndex;
  const activeScope = scopes.find((scope) => scope.status === 'IN_PROGRESS') ?? scopes[0];
  return questions.find((question) => question.id === activeScope?.questionIds[0]) ?? questions[0];
}

function synchronizeCurrentIdentity(
  session: PracticeSession,
  scopeId: RuntimeScopeId,
  questionId: string
): PracticeSession {
  const scope = session.modules.find((item) => item.id === scopeId);
  const questionIndex = session.questions.findIndex((item) => item.id === questionId);
  const question = session.questions[questionIndex];
  if (!scope || !question || question.module_id !== scope.id) return session;
  const activeSectionQuestionIds = session.questions
    .filter((item) => item.section_id === scope.section)
    .map((item) => item.id);
  return {
    ...session,
    current_section_id: scope.section,
    current_section: scope.section,
    current_module_id: scope.id,
    current_scope_id: scope.id,
    current_question_id: question.id,
    current_task_id: taskIdForQuestion(question),
    current_question_index: questionIndex,
    active_scope_question_ids: [...scope.questionIds],
    active_module_question_ids: [...scope.questionIds],
    active_section_question_ids: activeSectionQuestionIds,
    all_session_question_ids: session.questions.map((item) => item.id)
  };
}

function makeAnswerRecord(input: {
  existing?: AnswerRecord;
  questionId: string;
  answerValue: unknown;
  progressStatus: QuestionProgressStatus;
  isOvertime: boolean;
  isSkipped: boolean;
  isUncertain: boolean;
  activeTimeMs: number;
  modificationCount: number;
  firstAnswerElapsedMs?: number | null;
  firstAnswerAt?: string;
  nowIso: string;
}): AnswerRecord {
  return {
    question_id: input.questionId,
    answer_value: input.answerValue,
    progress_status: input.progressStatus,
    status: input.progressStatus,
    is_overtime: input.isOvertime,
    is_skipped: input.isSkipped,
    is_uncertain: input.isUncertain,
    first_answer_elapsed_ms: input.firstAnswerElapsedMs,
    final_answer_elapsed_ms:
      input.progressStatus === 'ANSWERED' || input.progressStatus === 'PARTIALLY_ANSWERED'
        ? input.activeTimeMs
        : input.existing?.final_answer_elapsed_ms,
    first_answer_at: input.firstAnswerAt,
    active_time_ms: Math.max(0, input.activeTimeMs),
    total_active_ms: Math.max(0, input.activeTimeMs),
    modification_count: input.modificationCount,
    revision_count: input.modificationCount,
    marked_review: input.isUncertain,
    last_changed_at: input.nowIso,
    updated_at: input.nowIso
  };
}

function isQuestionInFinalizedScope(session: PracticeSession, questionId: string): boolean {
  if (isDynamicSession(session)) {
    return session.dynamic_sections.some(
      (section) =>
        (section.status === 'COMPLETED' || section.status === 'SKIPPED_EMPTY') &&
        section.item_ids.includes(questionId)
    );
  }
  return session.modules.some((scope) => scope.status === 'FINALIZED' && scope.questionIds.includes(questionId));
}

function updateScope(
  session: PracticeSession,
  scopeId: RuntimeScopeId,
  patch: Partial<ModuleRuntimeState>
): PracticeSession {
  return {
    ...session,
    modules: session.modules.map((scope) => (scope.id === scopeId ? { ...scope, ...patch } : scope))
  };
}

function clampQuestionIndex(index: number, questions: PracticeQuestion[]): number {
  if (questions.length === 0 || index < 0) return 0;
  return Math.min(index, questions.length - 1);
}

function isProgressStatus(value: unknown): value is QuestionProgressStatus {
  return (
    value === 'NOT_ENCOUNTERED' ||
    value === 'ENCOUNTERED_UNANSWERED' ||
    value === 'PARTIALLY_ANSWERED' ||
    value === 'ANSWERED'
  );
}

function assertGloballyUniqueQuestionIds(questions: PracticeQuestion[]): void {
  const ids = new Set<string>();
  for (const question of questions) {
    if (ids.has(question.id)) throw new Error(`Duplicate question id: ${question.id}`);
    ids.add(question.id);
  }
}

function persistenceError(session: PracticeSession, message: string): FinalizeScopeResult {
  const failed: FinalizeScopeResult = { ok: false, reason: 'PERSISTENCE_ERROR', message, session };
  return { ...failed, session: { ...session, last_finalize_error: failed } };
}
