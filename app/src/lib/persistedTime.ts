import type {
  AnswerRecord,
  EventLogEntry,
  ModuleRuntimeState,
  PersistedTaskRuntime,
  PracticeQuestion,
  PracticeSession,
  TypingMinuteSample,
  TypingSnapshot
} from '../types';
import { isDynamicSession } from './dynamicSession';

export type PersistedTimeErrorCode = 'INVALID_TYPE' | 'NULL_REQUIRED' | 'NON_FINITE' | 'NEGATIVE' | 'UNSAFE_INTEGER';

export class PersistedTimeError extends Error {
  readonly code: PersistedTimeErrorCode;
  readonly fieldName: string;
  readonly value: unknown;

  constructor(code: PersistedTimeErrorCode, fieldName: string, value: unknown) {
    super(`Invalid persisted milliseconds at ${fieldName}: ${describeValue(value)} (${code})`);
    this.name = 'PersistedTimeError';
    this.code = code;
    this.fieldName = fieldName;
    this.value = value;
  }
}

/**
 * Persistence uses one policy for duration fields: finite, non-negative, Math.round,
 * and representable as a JavaScript safe integer before it reaches an i64 boundary.
 */
export function toPersistedMilliseconds(value: unknown, fieldName: string): number;
export function toPersistedMilliseconds(value: unknown, fieldName: string, nullable: true): number | null;
export function toPersistedMilliseconds(value: unknown, fieldName: string, nullable = false): number | null {
  if (value === null) {
    if (nullable) return null;
    throw new PersistedTimeError('NULL_REQUIRED', fieldName, value);
  }
  if (typeof value !== 'number') throw new PersistedTimeError('INVALID_TYPE', fieldName, value);
  if (!Number.isFinite(value)) throw new PersistedTimeError('NON_FINITE', fieldName, value);
  if (value < 0) throw new PersistedTimeError('NEGATIVE', fieldName, value);
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded)) throw new PersistedTimeError('UNSAFE_INTEGER', fieldName, value);
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Lifecycle metadata may be absent or explicitly unknown, but any numeric value uses the same persistence boundary. */
export function toNullablePersistedMilliseconds(value: unknown, fieldName: string): number | null {
  return toPersistedMilliseconds(value, fieldName, true);
}

export function serializeSessionForPersistence(session: PracticeSession): PracticeSession {
  validateAggregateInputs(session);
  const questions = session.questions.map(serializeQuestion);
  const answers = Object.fromEntries(
    Object.entries(session.answers).map(([questionId, answer]) => [questionId, serializeAnswer(answer, questionId)])
  );
  const tasks = (session.tasks ?? []).map((task, index) => serializeTask({
    ...task,
    active_time_ms: task.question_ids?.reduce(
      (sum, questionId) => sum + (answers[questionId]?.active_time_ms ?? 0),
      0
    ) ?? task.active_time_ms
  }, index));
  const modules = derivePersistedModules(session.modules, answers, tasks);
  const questionActiveMs = sumPersistedMilliseconds(
    questions.map((question) => answers[question.id]?.active_time_ms ?? 0),
    'session.questions.active_time_ms'
  );
  const dynamicSections = session.dynamic_sections?.map((section, index) => ({
    ...section,
    item_ids: [...section.item_ids],
    active_time_ms: sumPersistedMilliseconds(
      section.item_ids.map((itemId) => answers[itemId]?.active_time_ms ?? 0),
      `dynamic_sections.${index}.active_time_ms`
    ),
    pause_time_ms: toPersistedMilliseconds(section.pause_time_ms, `dynamic_sections.${index}.pause_time_ms`)
  }));
  const attributedActiveMs = isDynamicSession(session)
    ? questionActiveMs
    : sumPersistedMilliseconds(
        modules.map((scope) => scope.activeTimeMs),
        'session.sections.active_ms'
      );
  const explicitUnattributed = toPersistedMilliseconds(
    session.unattributed_active_time_ms ?? 0,
    'session.unattributed_active_time_ms'
  );
  const unattributedActiveMs = Math.max(explicitUnattributed, questionActiveMs - attributedActiveMs, 0);
  const activeMs = sumPersistedMilliseconds(
    [attributedActiveMs, unattributedActiveMs],
    'session.active_ms'
  );
  return {
    session_schema_version: session.session_schema_version,
    structure_mode: session.structure_mode,
    session_id: session.session_id,
    package_id: session.package_id,
    ...(isDynamicSession(session)
      ? { source_relative_path: session.source_relative_path }
      : { source_path: session.source_path }),
    mode: session.mode,
    timing_profile_id: session.timing_profile_id,
    timing_profile_version: session.timing_profile_version,
    blueprint_id: session.blueprint_id,
    blueprint_version: session.blueprint_version,
    blueprint_override_package_id: session.blueprint_override_package_id,
    created_at: session.created_at,
    started_at: session.started_at,
    completed_at: session.completed_at,
    completed_sections: session.completed_sections ? [...session.completed_sections] : undefined,
    selected_sections: session.selected_sections ? [...session.selected_sections] : undefined,
    active_ms: activeMs,
    paused_ms: toPersistedMilliseconds(session.paused_ms, 'session.paused_ms'),
    unattributed_active_time_ms: unattributedActiveMs,
    current_section_id: session.current_section_id,
    current_module_id: session.current_module_id,
    current_scope_id: session.current_scope_id,
    current_question_id: session.current_question_id,
    current_task_id: session.current_task_id,
    active_scope_question_ids: [...session.active_scope_question_ids],
    active_module_question_ids: [...session.active_module_question_ids],
    active_section_question_ids: [...session.active_section_question_ids],
    all_session_question_ids: [...session.all_session_question_ids],
    current_section: session.current_section,
    current_question_index: session.current_question_index,
    questions,
    answers,
    modules,
    tasks,
    dynamic_sections: dynamicSections,
    item_type_registry: session.item_type_registry?.map((config) => ({
      ...config,
      option_labels: [...config.option_labels],
      section_compatibility: [...config.section_compatibility],
      custom_time_limit_ms: config.custom_time_limit_ms === null
        ? null
        : toPersistedMilliseconds(config.custom_time_limit_ms, `item_type_registry.${config.type_id}.custom_time_limit_ms`)
    })),
    view: session.view
  };
}

export function serializeEventForPersistence(entry: EventLogEntry): EventLogEntry {
  return {
    session_id: entry.session_id,
    seq: entry.seq,
    monotonic_elapsed_ms: toPersistedMilliseconds(
      entry.monotonic_elapsed_ms,
      `events.${entry.seq}.monotonic_elapsed_ms`
    ),
    wall_clock: entry.wall_clock,
    event_type: entry.event_type,
    payload: normalizeKnownDurationPayload(entry.payload, `events.${entry.seq}.payload`),
    schema_version: entry.schema_version
  };
}

export function serializeTypingSnapshotForPersistence(snapshot: TypingSnapshot): TypingSnapshot {
  return {
    ...snapshot,
    active_ms: toPersistedMilliseconds(snapshot.active_ms, 'typing.snapshot.active_ms'),
    paused_ms: toPersistedMilliseconds(snapshot.paused_ms, 'typing.snapshot.paused_ms')
  };
}

export function serializeTypingMinuteSampleForPersistence(
  sample: TypingMinuteSample,
  index = 0
): TypingMinuteSample {
  return {
    ...sample,
    active_ms: toPersistedMilliseconds(sample.active_ms, `typing.samples.${index}.active_ms`)
  };
}

function serializeQuestion(question: PracticeQuestion, index: number): PracticeQuestion {
  return {
    id: question.id,
    section: question.section,
    section_id: question.section_id,
    module_id: question.module_id,
    number: question.number,
    type_label: question.type_label,
    answer_mode: question.answer_mode,
    option_count: question.option_count,
    time_limit_ms:
      question.time_limit_ms === undefined
        ? undefined
        : toNullablePersistedMilliseconds(question.time_limit_ms, `questions.${index}.time_limit_ms`),
    remaining_ms:
      question.remaining_ms === undefined
        ? undefined
        : toNullablePersistedMilliseconds(question.remaining_ms, `questions.${index}.remaining_ms`),
    timer_limit_ms:
      question.timer_limit_ms === undefined
        ? undefined
        : toNullablePersistedMilliseconds(question.timer_limit_ms, `questions.${index}.timer_limit_ms`),
    passage_group_id: question.passage_group_id,
    listening_group_id: question.listening_group_id,
    encountered: question.encountered,
    visit_count: question.visit_count,
    first_seen_at: question.first_seen_at,
    last_entered_at: question.last_entered_at,
    item_id: question.item_id,
    ordinal: question.ordinal,
    type_id: question.type_id,
    renderer: question.renderer,
    option_labels: question.option_labels ? [...question.option_labels] : undefined,
    custom_time_limit_ms: question.custom_time_limit_ms === undefined
      ? undefined
      : toNullablePersistedMilliseconds(question.custom_time_limit_ms, `questions.${index}.custom_time_limit_ms`),
    type_config: question.type_config ? {
      ...question.type_config,
      option_labels: [...question.type_config.option_labels],
      section_compatibility: [...question.type_config.section_compatibility],
      custom_time_limit_ms: question.type_config.custom_time_limit_ms === null
        ? null
        : toPersistedMilliseconds(question.type_config.custom_time_limit_ms, `questions.${index}.type_config.custom_time_limit_ms`)
    } : undefined,
    created_at: question.created_at,
    started_at: question.started_at,
    completed_at: question.completed_at,
    pause_time_ms: question.pause_time_ms === undefined
      ? undefined
      : toPersistedMilliseconds(question.pause_time_ms, `questions.${index}.pause_time_ms`),
    writing_state: question.writing_state ? { ...question.writing_state } : undefined
  };
}

function serializeAnswer(answer: AnswerRecord, questionId: string): AnswerRecord {
  const path = `answers.${questionId}`;
  const activeMs = toPersistedMilliseconds(answer.active_time_ms, `${path}.active_time_ms`);
  toPersistedMilliseconds(answer.total_active_ms, `${path}.total_active_ms`);
  return {
    question_id: answer.question_id,
    answer_value: answer.answer_value,
    progress_status: answer.progress_status,
    status: answer.status,
    is_overtime: answer.is_overtime,
    is_skipped: answer.is_skipped,
    is_uncertain: answer.is_uncertain,
    first_answer_elapsed_ms:
      answer.first_answer_elapsed_ms === undefined
        ? undefined
        : toNullablePersistedMilliseconds(answer.first_answer_elapsed_ms, `${path}.first_answer_elapsed_ms`),
    final_answer_elapsed_ms:
      answer.final_answer_elapsed_ms === undefined
        ? undefined
        : toNullablePersistedMilliseconds(answer.final_answer_elapsed_ms, `${path}.final_answer_elapsed_ms`),
    first_answer_at: answer.first_answer_at,
    active_time_ms: activeMs,
    total_active_ms: activeMs,
    modification_count: answer.modification_count,
    revision_count: answer.revision_count,
    marked_review: answer.marked_review,
    last_changed_at: answer.last_changed_at,
    updated_at: answer.updated_at
  };
}

function derivePersistedModules(
  modules: ModuleRuntimeState[],
  answers: Record<string, AnswerRecord>,
  tasks: PersistedTaskRuntime[]
): ModuleRuntimeState[] {
  return modules.map((scope, index) => {
    toPersistedMilliseconds(scope.activeTimeMs, `modules.${index}.activeTimeMs`);
    return {
      id: scope.id,
      section: scope.section,
      kind: scope.kind,
      label: scope.label,
      status: scope.status,
      questionIds: [...scope.questionIds],
      activeTimeMs: sumPersistedMilliseconds(
        scope.section === 'Writing' || scope.section === 'Speaking'
          ? tasks
              .filter((task) => task.question_ids.some((questionId) => scope.questionIds.includes(questionId)))
              .map((task) => task.active_time_ms)
          : scope.questionIds.map((questionId) => answers[questionId]?.active_time_ms ?? 0),
        `modules.${index}.activeTimeMs`
      ),
      isOvertime: scope.isOvertime,
      startedAt: scope.startedAt,
      finalizedAt: scope.finalizedAt
    };
  });
}

function serializeTask(task: PersistedTaskRuntime, index: number): PersistedTaskRuntime {
  const path = `tasks.${index}`;
  return {
    ...task,
    task_id: task.task_id,
    active_time_ms: toPersistedMilliseconds(task.active_time_ms, `${path}.active_time_ms`),
    pause_time_ms: toPersistedMilliseconds(task.pause_time_ms, `${path}.pause_time_ms`),
    remaining_ms: toNullablePersistedMilliseconds(task.remaining_ms, `${path}.remaining_ms`),
    timer_limit_ms: toNullablePersistedMilliseconds(task.timer_limit_ms, `${path}.timer_limit_ms`)
  };
}

function validateAggregateInputs(session: PracticeSession): void {
  toPersistedMilliseconds(session.active_ms, 'session.active_ms');
  session.modules.forEach((scope, index) => {
    toPersistedMilliseconds(scope.activeTimeMs, `modules.${index}.activeTimeMs`);
  });
}

function sumPersistedMilliseconds(values: number[], fieldName: string): number {
  return toPersistedMilliseconds(values.reduce((sum, value) => sum + value, 0), fieldName);
}

const PAYLOAD_DURATION_FIELDS = new Set([
  'active_ms',
  'active_time_ms',
  'paused_ms',
  'pause_time_ms',
  'paused_delta_ms',
  'duration_ms',
  'elapsed_ms',
  'monotonic_elapsed_ms',
  'remaining_ms',
  'timer_limit_ms'
]);

function normalizeKnownDurationPayload(
  payload: Record<string, unknown>,
  path: string
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => {
      const fieldPath = `${path}.${key}`;
      if (PAYLOAD_DURATION_FIELDS.has(key)) {
        if (typeof value !== 'number') return [key, value];
        return [key, toPersistedMilliseconds(value, fieldPath)];
      }
      if (Array.isArray(value)) {
        return [key, value.map((item, index) => normalizePayloadChild(item, `${fieldPath}.${index}`))];
      }
      return [key, normalizePayloadChild(value, fieldPath)];
    })
  );
}

function normalizePayloadChild(value: unknown, path: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return normalizeKnownDurationPayload(value as Record<string, unknown>, path);
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'number') return `${typeof value}(${String(value)})`;
  if (Number.isNaN(value)) return 'NaN';
  if (value === Number.POSITIVE_INFINITY) return 'Infinity';
  if (value === Number.NEGATIVE_INFINITY) return '-Infinity';
  return String(value);
}
