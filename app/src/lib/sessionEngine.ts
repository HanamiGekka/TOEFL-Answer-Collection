import type { AnswerRecord, AnswerMode, EventLogEntry, InputControlKind, PracticeQuestion, PracticeSession, QuestionNavItem, QuestionProgressStatus } from '../types';
import { SCHEMA_VERSION } from '../constants';
import { inferAnswerStatus } from './answerState';
import { enterDynamicItem, isDynamicSession } from './dynamicSession';
import { getNavigationRules } from './navigationPolicy';

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
  const progressStatus = inferAnswerStatus(answerValue);
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
  return answer ? inferAnswerStatus(answer.answer_value) : 'ENCOUNTERED_UNANSWERED';
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

export function canNavigateBackward(session: PracticeSession): boolean {
  return session.current_section_id !== 'Listening' || getNavigationRules(session).listening_can_return;
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

function isProgressStatus(value: unknown): value is QuestionProgressStatus {
  return (
    value === 'NOT_ENCOUNTERED' ||
    value === 'ENCOUNTERED_UNANSWERED' ||
    value === 'PARTIALLY_ANSWERED' ||
    value === 'ANSWERED'
  );
}

export function answerModeToInputControl(mode: AnswerMode): InputControlKind {
  if (mode === 'single_choice') return 'single_choice_buttons';
  if (mode === 'multiple_choice') return 'multiple_choice_controls';
  return mode === 'long_text' ? 'multi_line_text' : 'single_line_text';
}

export function shouldQuestionBeOvertime(_session: Pick<PracticeSession, 'mode' | 'tasks'>, question: PracticeQuestion, activeTimeMs: number): boolean {
  return question.time_limit_ms != null && activeTimeMs >= question.time_limit_ms;
}

export function canNavigateToQuestion(session: PracticeSession, questionId: string, intent: 'next' | 'previous' | 'answer_card' | 'restore' = 'answer_card'): boolean {
  if (!isDynamicSession(session) || session.view !== 'PRACTICE' || !session.active_scope_question_ids.includes(questionId) || isQuestionInFinalizedScope(session, questionId)) return false;
  const target = session.questions.find((item) => item.id === questionId);
  if (!target || target.section_id !== session.current_section_id) return false;
  if (questionId === session.current_question_id) return true;
  if (session.current_section_id !== 'Listening') return true;
  const current = session.active_scope_question_ids.indexOf(session.current_question_id);
  const next = session.active_scope_question_ids.indexOf(questionId);
  return intent === 'next' ? next === current + 1 : getNavigationRules(session).listening_can_return && target.encountered;
}

export function enterQuestion(session: PracticeSession, questionId: string, nowIso = new Date().toISOString(), intent: 'next' | 'previous' | 'answer_card' | 'restore' = 'answer_card'): PracticeSession {
  return isDynamicSession(session) && canNavigateToQuestion(session, questionId, intent) ? enterDynamicItem(session, questionId, intent, nowIso) : session;
}

function isQuestionInFinalizedScope(session: PracticeSession, questionId: string): boolean {
  return session.dynamic_sections?.some((section) => (section.status === 'COMPLETED' || section.status === 'SKIPPED_EMPTY') && section.item_ids.includes(questionId)) ?? true;
}
