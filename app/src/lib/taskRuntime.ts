import i18n from '../i18n';
import type {
  AnswerRecord,
  ModuleRuntimeState,
  PracticeMode,
  PracticeQuestion,
  PracticeSession,
  PracticeTaskRun,
  RuntimeScopeId,
  SpeakingTaskOutcome,
  TaskRuntimeStatus,
  WritingInputType
} from '../types';
import {
  analyzeWritingChange,
  calculateKeyboardCpm,
  countCharacters,
  countEnglishWords
} from './writingStats';
import { DEFAULT_BLUEPRINT } from './blueprint';
import { sanitizeWritingText } from './writingTextPolicy';

export const TASK_RUNTIME_PROFILES = {
  practice: {
    writingBuildSentenceMs: configuredTaskTimer('WRITING_BUILD_SENTENCE', 420_000),
    writingEmailMs: configuredTaskTimer('WRITING_EMAIL', 420_000),
    writingAcademicDiscussionMs: configuredTaskTimer('WRITING_ACADEMIC_DISCUSSION', 600_000),
    listenRepeatGroupMs: configuredSpeakingGroupTimer(120_000),
    interviewResponseMs: configuredTaskTimer('SI1', 45_000),
    interviewPreparationMs: 0,
    writingEditableAfterTimeout: true
  },
  exam_simulation: {
    writingBuildSentenceMs: configuredTaskTimer('WRITING_BUILD_SENTENCE', 420_000),
    writingEmailMs: configuredTaskTimer('WRITING_EMAIL', 420_000),
    writingAcademicDiscussionMs: configuredTaskTimer('WRITING_ACADEMIC_DISCUSSION', 600_000),
    listenRepeatGroupMs: configuredSpeakingGroupTimer(120_000),
    interviewResponseMs: configuredTaskTimer('SI1', 45_000),
    interviewPreparationMs: 0,
    writingEditableAfterTimeout: false
  }
} as const;

export const MINIMUM_SPEAKING_TRANSITION_GUARD_MS = 750;

export interface TaskTimingState {
  active_time_ms: number;
  timer_limit_ms: number | null;
  remaining_ms: number | null;
  is_overtime: boolean;
}

type LongWritingTask = PracticeTaskRun & {
  task_id: 'WRITING_EMAIL' | 'WRITING_ACADEMIC_DISCUSSION';
};

interface TaskDefinition {
  task_id: string;
  section_id: 'Writing' | 'Speaking';
  task_type: string;
  scope_id: RuntimeScopeId;
  question_ids: string[];
  timer_limit_ms: number | null;
  writing: boolean;
}

export interface ListenRepeatGroupTiming {
  active_time_ms: number;
  timer_limit_ms: number;
  remaining_ms: number;
  is_overtime: boolean;
  started: boolean;
}

export function createPracticeTasks(
  questions: PracticeQuestion[],
  answers: Record<string, AnswerRecord>,
  mode: PracticeMode,
  rawTasks: PracticeTaskRun[] = [],
  rawScopes: ModuleRuntimeState[] = []
): PracticeTaskRun[] {
  return taskDefinitions(questions, mode).map((definition) => {
    const prior = rawTasks.find((task) => task.task_id === definition.task_id);
    const legacyScopeId = definition.section_id === 'Writing' ? 'WRITING_TASK_GROUP' : 'SPEAKING_TASK_GROUP';
    const scope = rawScopes.find((item) => item.id === definition.scope_id) ??
      rawScopes.find((item) => String(item.id) === legacyScopeId);
    const activeTimeMs = definition.question_ids.reduce(
      (total, questionId) => total + Number(answers[questionId]?.active_time_ms ?? 0),
      0
    );
    const text = definition.writing
      ? String(prior?.text ?? answers[definition.question_ids.at(-1) ?? '']?.answer_value ?? '')
      : undefined;
    const remaining = definition.writing
      ? (definition.timer_limit_ms === null ? null : Math.max(0, definition.timer_limit_ms - activeTimeMs))
      : prior?.remaining_ms ??
        (definition.timer_limit_ms === null ? null : Math.max(0, definition.timer_limit_ms - activeTimeMs));
    const status = normalizeStatus(
      prior?.status ??
      (scope?.status === 'FINALIZED'
        ? 'COMPLETED'
        : remaining === 0 && activeTimeMs > 0
          ? 'OVERTIME'
          : activeTimeMs > 0
            ? 'ACTIVE'
            : 'NOT_STARTED')
    );
    return {
      task_id: definition.task_id,
      section_id: definition.section_id,
      task_type: definition.task_type,
      status,
      active_time_ms: activeTimeMs,
      pause_time_ms: Number(prior?.pause_time_ms ?? 0),
      timer_limit_ms: definition.timer_limit_ms,
      remaining_ms: remaining,
      started_at: prior?.started_at ?? null,
      completed_at: prior?.completed_at ?? (status === 'COMPLETED' ? scope?.finalizedAt ?? null : null),
      attempt_count: Number(prior?.attempt_count ?? 0),
      is_overtime: Boolean(prior?.is_overtime || (remaining !== null && remaining <= 0 && activeTimeMs > 0)),
      overtime_event_recorded: Boolean(
        prior?.overtime_event_recorded ??
        (prior ? prior.is_overtime || (remaining !== null && remaining <= 0 && activeTimeMs > 0) : false)
      ),
      needs_retry: Boolean(prior?.needs_retry || status === 'NEEDS_RETRY'),
      question_ids: [...definition.question_ids],
      ...(definition.writing
        ? {
            text,
            word_count: countEnglishWords(text ?? ''),
            character_count: countCharacters(text ?? ''),
            keyboard_cpm: calculateKeyboardCpm(Number(prior?.keyboard_inserted_characters ?? 0), activeTimeMs),
            keyboard_inserted_characters: Number(prior?.keyboard_inserted_characters ?? 0),
            pasted_characters: Number(prior?.pasted_characters ?? 0),
            deleted_characters: Number(prior?.deleted_characters ?? 0),
            cut_count: Number(prior?.cut_count ?? 0),
            paste_count: Number(prior?.paste_count ?? 0),
            undo_count: Number(prior?.undo_count ?? 0),
            redo_count: Number(prior?.redo_count ?? 0),
            modification_count: Number(prior?.modification_count ?? 0),
            undo_stack: [...(prior?.undo_stack ?? [])],
            redo_stack: [...(prior?.redo_stack ?? [])]
          }
        : {})
    };
  });
}

export function taskIdForQuestion(question: PracticeQuestion): string | null {
  return DEFAULT_BLUEPRINT.sections
    .find((section) => section.section_id === question.section_id)
    ?.task_slots.find((task) => task.question_slot_ids.includes(question.id))?.task_id ?? null;
}

export function scopeIdForTaskQuestion(question: PracticeQuestion): RuntimeScopeId {
  const configured = DEFAULT_BLUEPRINT.sections
    .find((section) => section.section_id === question.section_id)
    ?.question_slots.find((slot) => slot.number === question.number)?.module_id;
  return configured ?? question.module_id;
}

export function getCurrentTask(session: PracticeSession): PracticeTaskRun | undefined {
  const currentQuestion = session.questions.find((question) => question.id === session.current_question_id);
  const taskId = session.current_task_id ?? (currentQuestion ? taskIdForQuestion(currentQuestion) : null);
  return session.tasks.find((task) => task.task_id === taskId);
}

export function isLongWritingTask(task: PracticeTaskRun | undefined): task is LongWritingTask {
  return task?.task_id === 'WRITING_EMAIL' || task?.task_id === 'WRITING_ACADEMIC_DISCUSSION';
}

export function getTaskTimingState(
  task: PracticeTaskRun,
  activeTimeMs = task.active_time_ms
): TaskTimingState {
  const active = Math.max(0, Number.isFinite(activeTimeMs) ? activeTimeMs : task.active_time_ms);
  const limit = task.timer_limit_ms;
  if (limit === null) {
    return {
      active_time_ms: active,
      timer_limit_ms: null,
      remaining_ms: null,
      is_overtime: task.is_overtime
    };
  }
  return {
    active_time_ms: active,
    timer_limit_ms: limit,
    remaining_ms: Math.max(0, limit - active),
    is_overtime: task.is_overtime || active >= limit
  };
}

export function markTaskOvertimeEventRecorded(session: PracticeSession, taskId: string): PracticeSession {
  return {
    ...session,
    tasks: session.tasks.map((task) => task.task_id === taskId
      ? { ...task, overtime_event_recorded: true }
      : task)
  };
}

export function synchronizeTaskTimingState(session: PracticeSession): PracticeSession {
  let answers = session.answers;
  const tasks = session.tasks.map((task) => {
    if (!isLongWritingTask(task)) return task;
    const timing = getTaskTimingState(task);
    const questionId = task.question_ids.at(-1);
    const compatibleAnswerRecord = questionId ? answers[questionId] : undefined;
    if (questionId && compatibleAnswerRecord && compatibleAnswerRecord.is_overtime !== timing.is_overtime) {
      answers = {
        ...answers,
        [questionId]: { ...compatibleAnswerRecord, is_overtime: timing.is_overtime }
      };
    }
    return {
      ...task,
      remaining_ms: timing.remaining_ms,
      is_overtime: timing.is_overtime,
      status: taskStatusWithFlags(task.status, task.needs_retry, timing.is_overtime)
    };
  });
  return { ...session, answers, tasks };
}

export function enterTask(
  session: PracticeSession,
  taskId: string,
  nowIso = new Date().toISOString()
): PracticeSession {
  const task = session.tasks.find((item) => item.task_id === taskId);
  const questionId = task?.question_ids[0];
  const questionIndex = session.questions.findIndex((question) => question.id === questionId);
  const question = session.questions[questionIndex];
  const scope = session.modules.find((item) => item.id === question?.module_id);
  if (!task || !question || !scope || scope.status === 'FINALIZED') return session;
  const questions = session.questions.map((item) => item.id === question.id
    ? {
        ...item,
        encountered: true,
        visit_count: (item.visit_count ?? 0) + 1,
        first_seen_at: item.first_seen_at ?? nowIso,
        last_entered_at: nowIso
      }
    : item);
  const entered = {
    ...session,
    questions,
    current_section_id: scope.section,
    current_section: scope.section,
    current_module_id: scope.id,
    current_scope_id: scope.id,
    current_question_id: question.id,
    current_question_index: questionIndex,
    current_task_id: task.task_id,
    active_scope_question_ids: [...scope.questionIds],
    active_module_question_ids: [...scope.questionIds],
    active_section_question_ids: session.questions
      .filter((item) => item.section_id === scope.section)
      .map((item) => item.id)
  } satisfies PracticeSession;
  return question.section_id === 'Writing' ? activateWritingTask(entered, task.task_id, nowIso) : entered;
}

export function activateTaskForQuestion(
  session: PracticeSession,
  questionId: string,
  nowIso = new Date().toISOString()
): PracticeSession {
  const question = session.questions.find((item) => item.id === questionId);
  const taskId = question ? taskIdForQuestion(question) : null;
  if (!taskId) return { ...session, current_task_id: null };
  const withIdentity = { ...session, current_task_id: taskId };
  return question?.section_id === 'Writing' ? activateWritingTask(withIdentity, taskId, nowIso) : withIdentity;
}

export function updateWritingText(
  session: PracticeSession,
  nextText: string,
  inputType: WritingInputType,
  nowIso = new Date().toISOString()
): PracticeSession {
  const task = getCurrentTask(session);
  if (!task || task.section_id !== 'Writing' || !isWritingTaskEditable(session, task)) return session;
  const previousText = task.text ?? '';
  const acceptedPreviousText = sanitizeWritingText(previousText).text;
  const acceptedNextText = sanitizeWritingText(nextText).text;
  if (previousText === acceptedNextText) return session;
  const delta = analyzeWritingChange(acceptedPreviousText, acceptedNextText, inputType);
  const trackHistory = inputType !== 'historyUndo' && inputType !== 'historyRedo';
  const updatedTask = withWritingText(
    {
      ...task,
      status: task.is_overtime ? 'OVERTIME' : 'ACTIVE',
      started_at: task.started_at ?? nowIso,
      attempt_count: Math.max(1, task.attempt_count),
      keyboard_inserted_characters: (task.keyboard_inserted_characters ?? 0) + delta.keyboardCharacters,
      pasted_characters: (task.pasted_characters ?? 0) + delta.pastedCharacters,
      deleted_characters: (task.deleted_characters ?? 0) + delta.deletedCharacters,
      cut_count: (task.cut_count ?? 0) + delta.cutCount,
      paste_count: (task.paste_count ?? 0) + delta.pasteCount,
      undo_count: (task.undo_count ?? 0) + delta.undoCount,
      redo_count: (task.redo_count ?? 0) + delta.redoCount,
      modification_count: (task.modification_count ?? 0) + 1,
      undo_stack: trackHistory ? [...(task.undo_stack ?? []), acceptedPreviousText] : [...(task.undo_stack ?? [])],
      redo_stack: trackHistory ? [] : [...(task.redo_stack ?? [])]
    },
    acceptedNextText
  );
  return writeTaskAndCompatibleAnswer(session, updatedTask, acceptedNextText, nowIso);
}

export function undoWritingText(session: PracticeSession, nowIso = new Date().toISOString()): PracticeSession {
  const task = getCurrentTask(session);
  const stack = task?.undo_stack ?? [];
  if (!task || task.section_id !== 'Writing' || stack.length === 0 || !isWritingTaskEditable(session, task)) return session;
  const text = sanitizeWritingText(stack.at(-1) ?? '').text;
  const updatedTask = withWritingText({
    ...task,
    undo_count: (task.undo_count ?? 0) + 1,
    modification_count: (task.modification_count ?? 0) + 1,
    undo_stack: stack.slice(0, -1),
    redo_stack: [...(task.redo_stack ?? []), sanitizeWritingText(task.text ?? '').text]
  }, text);
  return writeTaskAndCompatibleAnswer(session, updatedTask, text, nowIso);
}

export function redoWritingText(session: PracticeSession, nowIso = new Date().toISOString()): PracticeSession {
  const task = getCurrentTask(session);
  const stack = task?.redo_stack ?? [];
  if (!task || task.section_id !== 'Writing' || stack.length === 0 || !isWritingTaskEditable(session, task)) return session;
  const text = sanitizeWritingText(stack.at(-1) ?? '').text;
  const updatedTask = withWritingText({
    ...task,
    redo_count: (task.redo_count ?? 0) + 1,
    modification_count: (task.modification_count ?? 0) + 1,
    undo_stack: [...(task.undo_stack ?? []), sanitizeWritingText(task.text ?? '').text],
    redo_stack: stack.slice(0, -1)
  }, text);
  return writeTaskAndCompatibleAnswer(session, updatedTask, text, nowIso);
}

export function applyTaskActivityDelta(
  session: PracticeSession,
  activityId: string,
  deltaMs: number
): PracticeSession {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return session;
  const question = session.questions.find((item) => item.id === activityId);
  const taskId = question ? taskIdForQuestion(question) : null;
  if (!question || !taskId) return session;
  const task = session.tasks.find((item) => item.task_id === taskId);
  if (!task || (task.section_id === 'Speaking' && task.status !== 'ACTIVE' && task.status !== 'OVERTIME')) {
    return session;
  }
  const cappedAtLimit =
    (task.section_id === 'Writing' && session.mode === 'exam_simulation') || task.task_id.startsWith('SI');
  const appliedDelta = cappedAtLimit && task.remaining_ms !== null
    ? Math.min(deltaMs, task.remaining_ms)
    : deltaMs;
  if (appliedDelta <= 0) return session;
  const currentAnswer = session.answers[activityId];
  const activeTimeMs = (currentAnswer?.active_time_ms ?? 0) + appliedDelta;
  let answers = {
    ...session.answers,
    [activityId]: compatibleAnswer(currentAnswer, activityId, currentAnswer?.answer_value ?? null, activeTimeMs)
  };
  const nextActiveTimeMs = task.active_time_ms + appliedDelta;
  const remaining = isLongWritingTask(task)
    ? getTaskTimingState(task, nextActiveTimeMs).remaining_ms
    : task.remaining_ms === null ? null : Math.max(0, task.remaining_ms - appliedDelta);
  const taskOvertime = isLongWritingTask(task)
    ? getTaskTimingState(task, nextActiveTimeMs).is_overtime
    : task.is_overtime || (remaining !== null && remaining <= 0);
  let tasks = session.tasks.map((item) => item.task_id === taskId
    ? {
        ...item,
        active_time_ms: nextActiveTimeMs,
        remaining_ms: remaining,
        is_overtime: taskOvertime,
        status: taskStatusWithFlags(item.status, item.needs_retry, taskOvertime),
        keyboard_cpm: item.section_id === 'Writing'
          ? calculateKeyboardCpm(item.keyboard_inserted_characters ?? 0, item.active_time_ms + appliedDelta)
          : item.keyboard_cpm
      }
    : item);
  const candidate = { ...session, answers, tasks };
  if (taskId.startsWith('SR') && getListenRepeatGroupTiming(candidate).is_overtime) {
    tasks = candidate.tasks.map((item) => item.task_id === taskId
      ? { ...item, is_overtime: true, status: taskStatusWithFlags(item.status, item.needs_retry, true) }
      : item);
  }
  const updatedTask = tasks.find((item) => item.task_id === taskId);
  if (updatedTask?.is_overtime) {
    answers = {
      ...answers,
      [activityId]: { ...answers[activityId], is_overtime: true }
    };
  }
  return { ...candidate, answers, tasks };
}

export function addCurrentTaskPause(session: PracticeSession, pauseDeltaMs: number): PracticeSession {
  const task = getCurrentTask(session);
  if (
    !task ||
    !['ACTIVE', 'PAUSED', 'OVERTIME'].includes(task.status) ||
    !Number.isFinite(pauseDeltaMs) ||
    pauseDeltaMs <= 0
  ) return session;
  return {
    ...session,
    tasks: session.tasks.map((item) => item.task_id === task.task_id
      ? { ...item, pause_time_ms: item.pause_time_ms + pauseDeltaMs }
      : item)
  };
}

export function pauseCurrentTask(session: PracticeSession): PracticeSession {
  const task = getCurrentTask(session);
  if (!task || task.status !== 'ACTIVE') return session;
  return replaceTask(session, { ...task, status: 'PAUSED' });
}

export function resumeCurrentTask(session: PracticeSession): PracticeSession {
  const task = getCurrentTask(session);
  if (!task || task.status !== 'PAUSED') return session;
  return replaceTask(session, { ...task, status: task.is_overtime ? 'OVERTIME' : 'ACTIVE' });
}

export function startSpeakingTask(
  session: PracticeSession,
  taskId: string,
  nowIso = new Date().toISOString()
): PracticeSession {
  const task = session.tasks.find((item) => item.task_id === taskId);
  if (!task || task.section_id !== 'Speaking') return session;
  if (task.status === 'ACTIVE' || task.status === 'OVERTIME') return session;
  if (session.tasks.some((item) => item.section_id === 'Speaking' && item.status === 'ACTIVE' && item.task_id !== taskId)) {
    return session;
  }
  const started = {
    ...task,
    status: 'ACTIVE' as const,
    started_at: task.started_at ?? nowIso,
    completed_at: null,
    attempt_count: Math.max(1, task.attempt_count),
    needs_retry: false
  };
  const scopeId = taskId.startsWith('SR') ? 'SPEAKING_LISTEN_REPEAT' : 'SPEAKING_INTERVIEW';
  return {
    ...replaceTask(session, started),
    current_task_id: taskId,
    modules: session.modules.map((scope) => scope.id === scopeId
      ? { ...scope, status: 'IN_PROGRESS', startedAt: scope.startedAt ?? nowIso }
      : scope)
  };
}

export function markSpeakingTask(
  session: PracticeSession,
  taskId: string,
  outcome: SpeakingTaskOutcome,
  nowIso = new Date().toISOString()
): PracticeSession {
  const task = session.tasks.find((item) => item.task_id === taskId);
  if (!task || task.section_id !== 'Speaking' || !['ACTIVE', 'OVERTIME'].includes(task.status)) return session;
  const needsRetry = outcome === 'NEEDS_RETRY';
  const updated = {
    ...task,
    status: (needsRetry ? 'NEEDS_RETRY' : 'COMPLETED') as TaskRuntimeStatus,
    needs_retry: needsRetry,
    completed_at: nowIso
  };
  const questionId = task.question_ids[0];
  const existing = session.answers[questionId];
  return {
    ...replaceTask(session, updated),
    answers: {
      ...session.answers,
      [questionId]: compatibleAnswer(existing, questionId, {
        completed: !needsRetry,
        needs_retry: needsRetry,
        is_overtime: task.is_overtime,
        attempt_count: task.attempt_count,
        completed_at: nowIso
      }, existing?.active_time_ms ?? task.active_time_ms)
    }
  };
}

export function advanceAfterSpeakingTask(
  session: PracticeSession,
  nowIso = new Date().toISOString()
): PracticeSession {
  const task = getCurrentTask(session);
  if (!task || task.section_id !== 'Speaking' || !['COMPLETED', 'NEEDS_RETRY'].includes(task.status)) return session;
  const scopeTasks = session.tasks.filter((item) =>
    task.task_id.startsWith('SR') ? item.task_id.startsWith('SR') : item.task_id.startsWith('SI')
  );
  const index = scopeTasks.findIndex((item) => item.task_id === task.task_id);
  const next = scopeTasks[index + 1];
  if (!next) return session;
  const entered = enterTask(session, next.task_id, nowIso);
  return task.task_id.startsWith('SR') && next.status === 'NOT_STARTED'
    ? startSpeakingTask(entered, next.task_id, nowIso)
    : entered;
}

export function retrySpeakingTask(
  session: PracticeSession,
  taskId: string,
  nowIso = new Date().toISOString()
): PracticeSession {
  const task = session.tasks.find((item) => item.task_id === taskId);
  if (!task || task.section_id !== 'Speaking') return session;
  if (session.tasks.some((item) => item.section_id === 'Speaking' && item.status === 'ACTIVE' && item.task_id !== taskId)) {
    return session;
  }
  return replaceTask(session, {
    ...task,
    status: 'ACTIVE',
    needs_retry: false,
    completed_at: null,
    started_at: nowIso,
    attempt_count: task.attempt_count + 1,
    remaining_ms: task.timer_limit_ms
  });
}

export function speakingRetryTaskIdsInCurrentScope(session: PracticeSession): string[] {
  const scope = session.modules.find((item) => item.id === session.current_scope_id);
  if (!scope || scope.section !== 'Speaking') return [];
  const questionIds = new Set(scope.questionIds);
  return session.tasks
    .filter((task) => task.section_id === 'Speaking' && task.needs_retry &&
      task.question_ids.some((questionId) => questionIds.has(questionId)))
    .map((task) => task.task_id);
}

export function completeCurrentTask(session: PracticeSession, nowIso = new Date().toISOString()): PracticeSession {
  const task = getCurrentTask(session);
  if (!task) return session;
  return replaceTask(session, {
    ...task,
    status: task.needs_retry ? 'NEEDS_RETRY' : 'COMPLETED',
    completed_at: nowIso
  });
}

export function getListenRepeatGroupTiming(session: PracticeSession): ListenRepeatGroupTiming {
  const tasks = session.tasks.filter((task) => /^SR[1-7]$/.test(task.task_id));
  const active = tasks.reduce((total, task) => total + task.active_time_ms, 0);
  const limit = TASK_RUNTIME_PROFILES[session.mode].listenRepeatGroupMs;
  return {
    active_time_ms: active,
    timer_limit_ms: limit,
    remaining_ms: Math.max(0, limit - active),
    is_overtime: active >= limit,
    started: tasks.some((task) => task.attempt_count > 0 || task.started_at !== null)
  };
}

export function isWritingTaskEditable(session: Pick<PracticeSession, 'mode'>, task: PracticeTaskRun): boolean {
  const overtime = isLongWritingTask(task) ? getTaskTimingState(task).is_overtime : task.is_overtime;
  return task.section_id === 'Writing' && task.status !== 'COMPLETED' &&
    (!overtime || TASK_RUNTIME_PROFILES[session.mode].writingEditableAfterTimeout);
}

export function taskStatusLabel(task: PracticeTaskRun): string {
  const base = task.needs_retry
    ? i18n.t('state.needsRetry')
    : task.status === 'NOT_STARTED'
      ? i18n.t('state.notStarted')
      : task.status === 'ACTIVE'
        ? i18n.t('state.active')
        : task.status === 'PAUSED'
          ? i18n.t('state.paused')
          : task.status === 'COMPLETED'
            ? i18n.t('state.completed')
            : task.status === 'OVERTIME'
              ? i18n.t('state.overtime')
              : i18n.t('state.needsRetry');
  return task.is_overtime && task.status !== 'OVERTIME' ? `${base} · ${i18n.t('state.overtime')}` : base;
}

function activateWritingTask(session: PracticeSession, taskId: string, nowIso: string): PracticeSession {
  const task = session.tasks.find((item) => item.task_id === taskId);
  if (!task || task.section_id !== 'Writing' || task.status === 'COMPLETED') return session;
  return replaceTask(session, {
    ...task,
    status: task.is_overtime ? 'OVERTIME' : 'ACTIVE',
    started_at: task.started_at ?? nowIso,
    attempt_count: Math.max(1, task.attempt_count)
  });
}

function taskDefinitions(questions: PracticeQuestion[], mode: PracticeMode): TaskDefinition[] {
  void mode;
  return DEFAULT_BLUEPRINT.sections
    .filter((section) => section.section_id === 'Writing' || section.section_id === 'Speaking')
    .flatMap((section) => section.task_slots.map((task) => {
      const mappedQuestions = questions.filter((question) => task.question_slot_ids.includes(question.id));
      return {
        task_id: task.task_id,
        section_id: section.section_id as 'Writing' | 'Speaking',
        task_type: task.task_type,
        scope_id: mappedQuestions[0]?.module_id ?? section.modules[0].module_id,
        question_ids: mappedQuestions.map((question) => question.id),
        timer_limit_ms: task.timer_limit_ms,
        writing: task.task_id === 'WRITING_EMAIL' || task.task_id === 'WRITING_ACADEMIC_DISCUSSION'
      } satisfies TaskDefinition;
    }))
    .filter((definition) => definition.question_ids.length > 0);
}

function configuredTaskTimer(taskId: string, fallback: number): number {
  return DEFAULT_BLUEPRINT.sections
    .flatMap((section) => section.task_slots)
    .find((task) => task.task_id === taskId)?.timer_limit_ms ?? fallback;
}

function configuredSpeakingGroupTimer(fallback: number): number {
  return DEFAULT_BLUEPRINT.sections.find((section) => section.section_id === 'Speaking')?.group_timer_limit_ms ?? fallback;
}

function withWritingText(task: PracticeTaskRun, text: string): PracticeTaskRun {
  const acceptedText = sanitizeWritingText(text).text;
  return {
    ...task,
    text: acceptedText,
    word_count: countEnglishWords(acceptedText),
    character_count: countCharacters(acceptedText),
    keyboard_cpm: calculateKeyboardCpm(task.keyboard_inserted_characters ?? 0, task.active_time_ms)
  };
}

function writeTaskAndCompatibleAnswer(
  session: PracticeSession,
  task: PracticeTaskRun,
  text: string,
  nowIso: string
): PracticeSession {
  const questionId = task.question_ids.at(-1);
  if (!questionId) return replaceTask(session, task);
  const existing = session.answers[questionId];
  const answer = compatibleAnswer(existing, questionId, text, existing?.active_time_ms ?? task.active_time_ms, nowIso);
  return {
    ...replaceTask(session, task),
    answers: { ...session.answers, [questionId]: { ...answer, modification_count: task.modification_count ?? 0, revision_count: task.modification_count ?? 0 } },
    questions: session.questions.map((question) => question.id === questionId
      ? { ...question, encountered: true, visit_count: Math.max(1, question.visit_count) }
      : question)
  };
}

function compatibleAnswer(
  existing: AnswerRecord | undefined,
  questionId: string,
  value: unknown,
  activeTimeMs: number,
  nowIso = new Date().toISOString()
): AnswerRecord {
  const hasValue = typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
  const modificationCount = existing?.modification_count ?? existing?.revision_count ?? 0;
  return {
    question_id: questionId,
    answer_value: value,
    progress_status: hasValue ? 'ANSWERED' : 'ENCOUNTERED_UNANSWERED',
    status: hasValue ? 'ANSWERED' : 'ENCOUNTERED_UNANSWERED',
    is_overtime: existing?.is_overtime ?? false,
    is_skipped: existing?.is_skipped ?? false,
    is_uncertain: existing?.is_uncertain ?? false,
    first_answer_elapsed_ms: existing?.first_answer_elapsed_ms,
    first_answer_at: existing?.first_answer_at ?? (hasValue ? nowIso : undefined),
    active_time_ms: activeTimeMs,
    total_active_ms: activeTimeMs,
    modification_count: modificationCount,
    revision_count: modificationCount,
    marked_review: existing?.marked_review ?? false,
    last_changed_at: nowIso,
    updated_at: nowIso
  };
}

function replaceTask(session: PracticeSession, task: PracticeTaskRun): PracticeSession {
  return { ...session, tasks: session.tasks.map((item) => item.task_id === task.task_id ? task : item) };
}

function taskStatusWithFlags(status: TaskRuntimeStatus, needsRetry: boolean, overtime: boolean): TaskRuntimeStatus {
  if (needsRetry) return 'NEEDS_RETRY';
  if (overtime && status !== 'COMPLETED') return 'OVERTIME';
  return status;
}

function normalizeStatus(status: unknown): TaskRuntimeStatus {
  return ['NOT_STARTED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'NEEDS_RETRY', 'OVERTIME'].includes(String(status))
    ? status as TaskRuntimeStatus
    : 'NOT_STARTED';
}
