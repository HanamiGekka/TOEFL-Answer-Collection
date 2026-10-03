import type {
  AnswerRecord,
  DynamicItemTypeConfig,
  DynamicPracticeItem,
  DynamicSectionName,
  DynamicSectionRuntime,
  PracticeMode,
  PracticeSession,
  WritingInputType
} from '../types';
import {
  cloneItemTypeConfig,
  listItemTypePresets,
  validateItemTypeConfig
} from './itemTypeRegistry';
import { sanitizeWritingText } from './writingTextPolicy';
import {
  analyzeWritingChange,
  calculateKeyboardCpm,
  countCharacters,
  countEnglishWords
} from './writingStats';

export const DYNAMIC_SESSION_SCHEMA_VERSION = 6;
export const DYNAMIC_STRUCTURE_MODE = 'dynamic_manual' as const;
export const DYNAMIC_SECTION_ORDER: DynamicSectionName[] = ['Reading', 'Listening', 'Writing'];

export type DynamicPracticeSession = PracticeSession & {
  session_schema_version: 6;
  structure_mode: 'dynamic_manual';
  selected_sections: DynamicSectionName[];
  dynamic_sections: DynamicSectionRuntime[];
  item_type_registry: DynamicItemTypeConfig[];
};

export interface DynamicSessionValidation {
  ok: boolean;
  errors: string[];
}

export function createDynamicSession(input: {
  session_id: string;
  package_id: string;
  source_relative_path?: string;
  mode: PracticeMode;
  selected_sections: readonly (DynamicSectionName | string)[];
  created_at?: string;
}): DynamicPracticeSession {
  const requested = new Set(input.selected_sections);
  const selectedSections = DYNAMIC_SECTION_ORDER.filter((section) => requested.has(section));
  if (selectedSections.length === 0) throw new Error('Select at least one dynamic Section.');
  if (requested.size !== selectedSections.length) throw new Error('schema v6 only accepts Reading, Listening, and Writing.');
  const createdAt = input.created_at ?? new Date().toISOString();
  const sourceRelativePath = input.source_relative_path;
  if (sourceRelativePath !== undefined && !isSafeRelativePackagePath(sourceRelativePath)) {
    throw new Error('schema v6 requires a relative package source path.');
  }
  const firstSection = selectedSections[0];
  const dynamicSections = selectedSections.map((section, index): DynamicSectionRuntime => ({
    section_id: section,
    status: index === 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
    created_at: createdAt,
    started_at: index === 0 ? createdAt : null,
    completed_at: null,
    next_item_ordinal: 1,
    item_ids: [],
    active_time_ms: 0,
    pause_time_ms: 0
  }));
  return {
    session_schema_version: 6,
    structure_mode: DYNAMIC_STRUCTURE_MODE,
    session_id: input.session_id,
    package_id: input.package_id,
    ...(sourceRelativePath === undefined ? {} : { source_relative_path: sourceRelativePath }),
    mode: input.mode,
    timing_profile_id: 'dynamic-manual',
    timing_profile_version: '1.0.0',
    created_at: createdAt,
    started_at: createdAt,
    completed_sections: [],
    selected_sections: selectedSections,
    active_ms: 0,
    paused_ms: 0,
    unattributed_active_time_ms: 0,
    current_section_id: firstSection,
    current_module_id: firstSection,
    current_scope_id: firstSection,
    current_question_id: '',
    current_task_id: null,
    active_scope_question_ids: [],
    active_module_question_ids: [],
    active_section_question_ids: [],
    all_session_question_ids: [],
    current_section: firstSection,
    current_question_index: 0,
    questions: [],
    answers: {},
    modules: [],
    tasks: [],
    dynamic_sections: dynamicSections,
    item_type_registry: selectedSections.flatMap((section) => listItemTypePresets(section)),
    view: 'PRACTICE'
  };
}

export function isDynamicSession(session: Pick<PracticeSession, 'session_schema_version' | 'structure_mode'>): session is DynamicPracticeSession {
  return session.session_schema_version === DYNAMIC_SESSION_SCHEMA_VERSION && session.structure_mode === DYNAMIC_STRUCTURE_MODE;
}

export function createDynamicItem(
  session: DynamicPracticeSession,
  sectionId: DynamicSectionName,
  rawTypeConfig: DynamicItemTypeConfig,
  nowIso = new Date().toISOString()
): { session: DynamicPracticeSession; item: DynamicPracticeItem } {
  const section = session.dynamic_sections.find((candidate) => candidate.section_id === sectionId);
  if (!section) throw new Error(`Section is not selected: ${sectionId}`);
  if (section.status === 'COMPLETED' || section.status === 'SKIPPED_EMPTY') {
    throw new Error(`${sectionId} is closed; reopen it before adding an Item.`);
  }
  const typeConfig = cloneItemTypeConfig(rawTypeConfig);
  const validation = validateItemTypeConfig(typeConfig);
  if (!validation.ok) throw new Error(validation.errors.join(' '));
  if (!typeConfig.section_compatibility.includes(sectionId)) {
    throw new Error(`${typeConfig.type_id} is not compatible with ${sectionId}.`);
  }
  const ordinal = section.next_item_ordinal;
  const itemId = `${sectionPrefix(sectionId)}${ordinal}`;
  if (session.questions.some((question) => question.id === itemId)) {
    throw new Error(`Dynamic Item identity already exists: ${itemId}`);
  }
  const item: DynamicPracticeItem = {
    id: itemId,
    item_id: itemId,
    ordinal,
    section: sectionId,
    section_id: sectionId,
    module_id: sectionId,
    number: ordinal,
    type_id: typeConfig.type_id,
    type_label: typeConfig.type_label,
    renderer: typeConfig.renderer,
    answer_mode: typeConfig.renderer,
    option_count: typeConfig.option_labels.length || undefined,
    option_labels: [...typeConfig.option_labels],
    custom_time_limit_ms: typeConfig.custom_time_limit_ms,
    time_limit_ms: typeConfig.custom_time_limit_ms,
    remaining_ms: typeConfig.custom_time_limit_ms,
    timer_limit_ms: typeConfig.custom_time_limit_ms,
    type_config: typeConfig,
    created_at: nowIso,
    started_at: nowIso,
    completed_at: null,
    pause_time_ms: 0,
    encountered: true,
    visit_count: 1,
    first_seen_at: nowIso,
    last_entered_at: nowIso,
    writing_state: typeConfig.renderer === 'long_text' ? emptyWritingState() : undefined
  };
  const questions = [...session.questions, item];
  const updatedSections = session.dynamic_sections.map((candidate) => candidate.section_id === sectionId
    ? {
        ...candidate,
        status: 'IN_PROGRESS' as const,
        started_at: candidate.started_at ?? nowIso,
        item_ids: [...candidate.item_ids, itemId],
        next_item_ordinal: ordinal + 1
      }
    : candidate);
  const registryContainsConfig = session.item_type_registry.some((entry) => sameConfig(entry, typeConfig));
  return {
    item,
    session: {
      ...session,
      questions,
      dynamic_sections: updatedSections,
      item_type_registry: registryContainsConfig
        ? session.item_type_registry
        : [...session.item_type_registry, typeConfig],
      current_section_id: sectionId,
      current_section: sectionId,
      current_module_id: sectionId,
      current_scope_id: sectionId,
      current_question_id: itemId,
      current_question_index: questions.length - 1,
      current_task_id: null,
      active_scope_question_ids: [...updatedSections.find((candidate) => candidate.section_id === sectionId)!.item_ids],
      active_module_question_ids: [],
      active_section_question_ids: [...updatedSections.find((candidate) => candidate.section_id === sectionId)!.item_ids],
      all_session_question_ids: questions.map((question) => question.id)
    }
  };
}

export interface DynamicBatchBlock {
  config: DynamicItemTypeConfig;
  count: number;
}

/** Builds the entire recipe before returning a candidate Session. No caller state is mutated. */
export function createDynamicItemBatch(
  session: DynamicPracticeSession,
  sectionId: DynamicSectionName,
  blocks: readonly DynamicBatchBlock[],
  nowIso = new Date().toISOString()
): { session: DynamicPracticeSession; items: DynamicPracticeItem[]; created_item_ids: string[]; first_item: DynamicPracticeItem; batch_id: string } {
  const section = session.dynamic_sections.find((candidate) => candidate.section_id === sectionId);
  if (!section) throw new Error(`Section is not selected: ${sectionId}`);
  if (section.status === 'COMPLETED' || section.status === 'SKIPPED_EMPTY') throw new Error(`${sectionId} is closed.`);
  if (!Array.isArray(blocks) || blocks.length < 1 || blocks.length > 20) throw new Error('Batch requires 1–20 blocks.');
  let total = 0;
  const configs = blocks.map((block) => {
    if (!Number.isSafeInteger(block.count) || block.count < 1 || block.count > 100) throw new Error('Batch count must be 1–100.');
    total += block.count;
    const config = cloneItemTypeConfig(block.config);
    const validation = validateItemTypeConfig(config);
    if (!validation.ok) throw new Error(validation.errors.join(' '));
    if (!config.section_compatibility.includes(sectionId)) throw new Error(`${config.type_id} is not compatible with ${sectionId}.`);
    const existing = session.item_type_registry.find((entry) => entry.type_id === config.type_id);
    if (existing && !sameConfig(existing, config)) throw new Error(`Registry conflict: ${config.type_id}`);
    return config;
  });
  if (total > 100) throw new Error('Batch total must be at most 100.');
  const start = section.next_item_ordinal;
  if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(start + total)) throw new Error('Batch ordinal overflow.');
  if (start !== section.item_ids.length + 1) throw new Error('Batch ordinal does not follow Section Items.');
  const ids = Array.from({ length: total }, (_, index) => `${sectionPrefix(sectionId)}${start + index}`);
  const existingIds = new Set(session.questions.map((question) => question.id));
  if (ids.some((id) => existingIds.has(id) || section.item_ids.includes(id))) throw new Error('Dynamic Item identity already exists.');
  const registry = [...session.item_type_registry];
  for (const config of configs) {
    const existing = registry.find((entry) => entry.type_id === config.type_id);
    if (existing && !sameConfig(existing, config)) throw new Error(`Registry conflict: ${config.type_id}`);
    if (!existing) registry.push(config);
  }
  const items: DynamicPracticeItem[] = [];
  let offset = 0;
  blocks.forEach((block, blockIndex) => {
    const typeConfig = configs[blockIndex];
    for (let index = 0; index < block.count; index++) {
      const ordinal = start + offset;
      const itemId = ids[offset++];
      const entered = offset === 1;
      items.push({
        id: itemId, item_id: itemId, ordinal, section: sectionId, section_id: sectionId,
        module_id: sectionId, number: ordinal, type_id: typeConfig.type_id,
        type_label: typeConfig.type_label, renderer: typeConfig.renderer, answer_mode: typeConfig.renderer,
        option_count: typeConfig.option_labels.length || undefined, option_labels: [...typeConfig.option_labels],
        custom_time_limit_ms: typeConfig.custom_time_limit_ms, time_limit_ms: typeConfig.custom_time_limit_ms,
        remaining_ms: typeConfig.custom_time_limit_ms, timer_limit_ms: typeConfig.custom_time_limit_ms,
        type_config: typeConfig, created_at: nowIso, started_at: entered ? nowIso : null,
        completed_at: null, pause_time_ms: 0, encountered: entered, visit_count: entered ? 1 : 0,
        ...(entered ? { first_seen_at: nowIso, last_entered_at: nowIso } : {}),
        writing_state: typeConfig.renderer === 'long_text' ? emptyWritingState() : undefined
      });
    }
  });
  const questions = [...session.questions, ...items];
  const itemIds = [...section.item_ids, ...ids];
  const updatedSections = session.dynamic_sections.map((candidate) => candidate.section_id === sectionId
    ? { ...candidate, status: 'IN_PROGRESS' as const, started_at: candidate.started_at ?? nowIso,
        item_ids: itemIds, next_item_ordinal: start + total }
    : candidate);
  const first = items[0];
  return {
    items, created_item_ids: ids, first_item: first,
    batch_id: `${session.session_id}:${sectionId}:${start}:${nowIso}`,
    session: {
      ...session, questions, dynamic_sections: updatedSections, item_type_registry: registry,
      current_section_id: sectionId, current_section: sectionId, current_module_id: sectionId,
      current_scope_id: sectionId, current_question_id: first.item_id,
      current_question_index: questions.length - items.length, current_task_id: null,
      active_scope_question_ids: itemIds, active_module_question_ids: [],
      active_section_question_ids: itemIds, all_session_question_ids: questions.map((question) => question.id)
    }
  };
}

export function validateDynamicSession(session: DynamicPracticeSession): DynamicSessionValidation {
  const errors: string[] = [];
  if (!isDynamicSession(session)) errors.push('Session must be schema v6 dynamic_manual.');
  if (
    (session.source_relative_path !== undefined && !isSafeRelativePackagePath(session.source_relative_path)) ||
    session.source_path !== undefined
  ) {
    errors.push('Dynamic Sessions may contain only safe legacy source_relative_path metadata, never source_path.');
  }
  const raw = session as unknown as Record<string, unknown>;
  if (
    raw.blueprint_id !== undefined ||
    raw.blueprint_version !== undefined ||
    raw.blueprint_override_package_id !== undefined
  ) {
    errors.push('Dynamic Sessions cannot contain Blueprint identity.');
  }
  if (!Array.isArray(session.modules) || session.modules.length !== 0) {
    errors.push('Dynamic Sessions cannot contain Modules.');
  }
  if (!Array.isArray(session.tasks) || session.tasks.length !== 0) {
    errors.push('Dynamic Sessions cannot contain legacy Tasks.');
  }
  if (!Array.isArray(session.selected_sections) || !Array.isArray(session.dynamic_sections)) {
    return { ok: false, errors: [...errors, 'Dynamic Section collections are required.'] };
  }
  if (
    session.selected_sections.length === 0 ||
    session.selected_sections.some((section) => !DYNAMIC_SECTION_ORDER.includes(section as DynamicSectionName)) ||
    new Set(session.selected_sections).size !== session.selected_sections.length
  ) {
    errors.push('Selected Sections must be unique Reading, Listening, or Writing values.');
  }
  const sectionIds = session.dynamic_sections.map((section) => section.section_id);
  if (new Set(sectionIds).size !== sectionIds.length) errors.push('Dynamic Section identities must be unique.');
  if (sectionIds.some((section) => !DYNAMIC_SECTION_ORDER.includes(section))) errors.push('Only Reading, Listening, and Writing are supported.');
  if (sectionIds.join('\u0000') !== session.selected_sections.join('\u0000')) {
    errors.push('Dynamic Sections must exactly match selected Sections in canonical order.');
  }
  if (!Array.isArray(session.item_type_registry)) {
    return { ok: false, errors: [...errors, 'Item Type Registry is required.'] };
  }
  const registryIds = new Set<string>();
  for (const config of session.item_type_registry) {
    const validation = validateItemTypeConfig(config);
    if (!validation.ok) errors.push(`Registry config is invalid: ${String(config?.type_id ?? '')}.`);
    if (registryIds.has(config.type_id)) errors.push(`Duplicate Registry type identity: ${config.type_id}.`);
    registryIds.add(config.type_id);
  }
  const knownItems = new Map<string, DynamicSectionName>();
  for (const section of session.dynamic_sections) {
    if (!['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED_EMPTY'].includes(section.status)) {
      errors.push(`${section.section_id} status is invalid.`);
    }
    if (!Array.isArray(section.item_ids)) {
      errors.push(`${section.section_id} Item collection is invalid.`);
      continue;
    }
    if (!isSafeDuration(section.active_time_ms) || !isSafeDuration(section.pause_time_ms)) {
      errors.push(`${section.section_id} timing is invalid.`);
    }
    const prefix = sectionPrefix(section.section_id);
    if (!Number.isSafeInteger(section.next_item_ordinal) || section.next_item_ordinal < 1) {
      errors.push(`${section.section_id} next ordinal is invalid.`);
    }
    section.item_ids.forEach((itemId, index) => {
      if (knownItems.has(itemId)) errors.push(`Duplicate Item identity: ${itemId}`);
      knownItems.set(itemId, section.section_id);
      if (itemId !== `${prefix}${index + 1}`) errors.push(`${section.section_id} Item order is not contiguous.`);
    });
    if (section.next_item_ordinal !== section.item_ids.length + 1) {
      errors.push(`${section.section_id} next ordinal does not follow created Items.`);
    }
  }
  if (!Array.isArray(session.questions)) {
    return { ok: false, errors: [...errors, 'Dynamic Item collection is required.'] };
  }
  // Section.item_ids defines navigation/ordinal order. questions keeps creation
  // order, which may interleave Sections after an earlier Section is reopened.
  const questionIds = session.questions.map((item) => item.id);
  if (questionIds.length !== knownItems.size ||
      new Set(questionIds).size !== questionIds.length ||
      questionIds.some((itemId) => !knownItems.has(itemId))) {
    errors.push('Dynamic Items must match Section membership exactly once.');
  }
  for (const question of session.questions) {
    const item = question as DynamicPracticeItem;
    if (knownItems.get(item.id) !== item.section_id) {
      errors.push(`Dynamic Item belongs to a different Section: ${item.id}.`);
    }
    if (!knownItems.has(item.id) || item.item_id !== item.id || item.ordinal !== item.number) {
      errors.push(`Dynamic Item identity is inconsistent: ${item.id}.`);
    }
    const configValidation = item.type_config ? validateItemTypeConfig(item.type_config) : { ok: false, errors: ['missing type config'] };
    if (!configValidation.ok) errors.push(`Dynamic Item config is invalid: ${item.id}.`);
    if (item.renderer !== item.type_config?.renderer || item.type_label !== item.type_config?.type_label) {
      errors.push(`Dynamic Item renderer/config mismatch: ${item.id}.`);
    }
    if (
      item.section !== item.section_id ||
      item.module_id !== item.section_id ||
      item.answer_mode !== item.renderer ||
      item.type_id !== item.type_config?.type_id ||
      item.ordinal !== Number(item.id.slice(1)) ||
      item.option_labels?.join('\u0000') !== item.type_config?.option_labels.join('\u0000') ||
      item.custom_time_limit_ms !== item.type_config?.custom_time_limit_ms ||
      !item.type_config?.section_compatibility.includes(item.section_id)
    ) {
      errors.push(`Dynamic Item structure/config is inconsistent: ${item.id}.`);
    }
    if (!registryIds.has(item.type_id)) errors.push(`Dynamic Item type is absent from Registry: ${item.id}.`);
    if (!isSafeDuration(item.pause_time_ms)) errors.push(`Dynamic Item pause timing is invalid: ${item.id}.`);
    if (item.renderer === 'long_text' && !isValidWritingState(item.writing_state)) {
      errors.push(`Dynamic long-text state is invalid: ${item.id}.`);
    }
    if (item.renderer !== 'long_text' && item.writing_state !== undefined) {
      errors.push(`Only long-text Items may contain writing state: ${item.id}.`);
    }
  }
  if (knownItems.size !== session.questions.length) errors.push('Dynamic Section Item membership is incomplete.');
  if (session.current_question_id && !knownItems.has(session.current_question_id)) {
    errors.push('Current Item does not exist.');
  }
  if (!session.selected_sections.includes(session.current_section_id as DynamicSectionName)) {
    errors.push('Current Section is not selected.');
  }
  if (session.current_question_id) {
    const currentItem = session.questions.find((item) => item.id === session.current_question_id);
    if (currentItem?.section_id !== session.current_section_id) errors.push('Current Item is outside the current Section.');
  }
  if (!session.answers || typeof session.answers !== 'object' || Array.isArray(session.answers)) {
    errors.push('Dynamic answers collection is invalid.');
  } else {
    for (const [itemId, answer] of Object.entries(session.answers)) {
      const item = session.questions.find((candidate) => candidate.id === itemId) as DynamicPracticeItem | undefined;
      if (!item || answer.question_id !== itemId) {
        errors.push(`Dynamic answer identity is invalid: ${itemId}.`);
        continue;
      }
      if (!isAnswerValueValid(item, answer.answer_value)) errors.push(`Dynamic answer value is invalid: ${itemId}.`);
      if (!isSafeDuration(answer.active_time_ms) || !isSafeDuration(answer.total_active_ms)) {
        errors.push(`Dynamic answer timing is invalid: ${itemId}.`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function enterDynamicItem(
  session: DynamicPracticeSession,
  itemId: string,
  via: 'next' | 'previous' | 'answer_card' | 'restore' = 'answer_card',
  nowIso = new Date().toISOString()
): DynamicPracticeSession {
  const itemIndex = session.questions.findIndex((question) => question.id === itemId);
  const item = session.questions[itemIndex] as DynamicPracticeItem | undefined;
  if (!item) return session;
  const section = session.dynamic_sections.find((candidate) => candidate.section_id === item.section_id);
  if (!section || section.status === 'COMPLETED' || section.status === 'SKIPPED_EMPTY') return session;
  if (
    session.mode === 'exam_simulation' &&
    item.section_id === 'Listening' &&
    itemId !== session.current_question_id
  ) {
    const currentPosition = section.item_ids.indexOf(session.current_question_id);
    const targetPosition = section.item_ids.indexOf(itemId);
    if (targetPosition < currentPosition || targetPosition > currentPosition + 1 ||
        (via === 'next' && targetPosition !== currentPosition + 1)) return session;
  }
  const questions = session.questions.map((question) => question.id === itemId
    ? {
        ...question,
        encountered: true,
        visit_count: question.visit_count + (question.id === session.current_question_id ? 0 : 1),
        first_seen_at: question.first_seen_at ?? nowIso,
        last_entered_at: nowIso,
        started_at: question.started_at ?? nowIso
      }
    : question);
  return {
    ...session,
    questions,
    current_section_id: item.section_id,
    current_section: item.section_id,
    current_module_id: item.section_id,
    current_scope_id: item.section_id,
    current_question_id: itemId,
    current_question_index: itemIndex,
    current_task_id: null,
    active_scope_question_ids: [...section.item_ids],
    active_module_question_ids: [],
    active_section_question_ids: [...section.item_ids],
    all_session_question_ids: questions.map((question) => question.id)
  };
}

export type DynamicNextAction =
  | { kind: 'NAVIGATED'; session: DynamicPracticeSession }
  | { kind: 'CREATE_REQUIRED'; section_id: DynamicSectionName; next_ordinal: number };

export function getDynamicNextAction(session: DynamicPracticeSession): DynamicNextAction {
  const section = session.dynamic_sections.find((candidate) => candidate.section_id === session.current_section_id);
  if (!section) throw new Error('Current dynamic Section is unavailable.');
  const currentPosition = section.item_ids.indexOf(session.current_question_id);
  const nextItemId = currentPosition >= 0 ? section.item_ids[currentPosition + 1] : section.item_ids[0];
  return nextItemId
    ? { kind: 'NAVIGATED', session: enterDynamicItem(session, nextItemId, 'next') }
    : { kind: 'CREATE_REQUIRED', section_id: section.section_id, next_ordinal: section.next_item_ordinal };
}

export function previousDynamicItem(session: DynamicPracticeSession): DynamicPracticeSession {
  const section = session.dynamic_sections.find((candidate) => candidate.section_id === session.current_section_id);
  if (!section) return session;
  const currentPosition = section.item_ids.indexOf(session.current_question_id);
  const priorItemId = section.item_ids[currentPosition - 1];
  return priorItemId ? enterDynamicItem(session, priorItemId, 'previous') : session;
}

export function inspectDynamicSectionCompletion(
  session: DynamicPracticeSession,
  sectionId: DynamicSectionName
): { created: number; unanswered: string[]; skipped: string[]; uncertain: string[] } {
  const section = session.dynamic_sections.find((candidate) => candidate.section_id === sectionId);
  if (!section) throw new Error(`Section is not selected: ${sectionId}`);
  const unanswered: string[] = [];
  const skipped: string[] = [];
  const uncertain: string[] = [];
  for (const itemId of section.item_ids) {
    const answer = session.answers[itemId];
    if (!answer || answer.progress_status !== 'ANSWERED') unanswered.push(itemId);
    if (answer?.is_skipped) skipped.push(itemId);
    if (answer?.is_uncertain) uncertain.push(itemId);
  }
  return { created: section.item_ids.length, unanswered, skipped, uncertain };
}

export type DynamicSectionFinishResult =
  | {
      ok: false;
      reason: 'CONFIRM_EMPTY' | 'CONFIRM_ITEMS';
      inspection: ReturnType<typeof inspectDynamicSectionCompletion>;
      session: DynamicPracticeSession;
    }
  | {
      ok: true;
      next: 'NEXT_SECTION' | 'SESSION_SUMMARY';
      session: DynamicPracticeSession;
    };

export function finishDynamicSection(
  session: DynamicPracticeSession,
  sectionId: DynamicSectionName,
  options: { confirmed: boolean; now_iso?: string }
): DynamicSectionFinishResult {
  const inspection = inspectDynamicSectionCompletion(session, sectionId);
  if (!options.confirmed) {
    if (inspection.created === 0) return { ok: false, reason: 'CONFIRM_EMPTY', inspection, session };
    if (inspection.unanswered.length || inspection.skipped.length || inspection.uncertain.length) {
      return { ok: false, reason: 'CONFIRM_ITEMS', inspection, session };
    }
  }
  const nowIso = options.now_iso ?? new Date().toISOString();
  const sectionIndex = session.dynamic_sections.findIndex((candidate) => candidate.section_id === sectionId);
  const nextSectionIndex = session.dynamic_sections.findIndex((candidate, index) =>
    index > sectionIndex && candidate.status !== 'COMPLETED' && candidate.status !== 'SKIPPED_EMPTY');
  const nextSection = nextSectionIndex >= 0 ? session.dynamic_sections[nextSectionIndex] : undefined;
  const dynamicSections = session.dynamic_sections.map((candidate, index) => {
    if (candidate.section_id === sectionId) {
      return {
        ...candidate,
        status: inspection.created === 0 ? 'SKIPPED_EMPTY' as const : 'COMPLETED' as const,
        completed_at: nowIso
      };
    }
    if (index === nextSectionIndex) {
      return { ...candidate, status: 'IN_PROGRESS' as const, started_at: candidate.started_at ?? nowIso };
    }
    return candidate;
  });
  const completedSections = Array.from(new Set([...(session.completed_sections ?? []), sectionId]));
  if (!nextSection) {
    return {
      ok: true,
      next: 'SESSION_SUMMARY',
      session: {
        ...session,
        dynamic_sections: dynamicSections,
        completed_sections: completedSections,
        completed_at: nowIso,
        view: 'SESSION_SUMMARY'
      }
    };
  }
  const firstItemId = nextSection.item_ids[0] ?? '';
  const itemIndex = firstItemId ? session.questions.findIndex((item) => item.id === firstItemId) : 0;
  return {
    ok: true,
    next: 'NEXT_SECTION',
    session: {
      ...session,
      dynamic_sections: dynamicSections,
      completed_sections: completedSections,
      current_section_id: nextSection.section_id,
      current_section: nextSection.section_id,
      current_module_id: nextSection.section_id,
      current_scope_id: nextSection.section_id,
      current_question_id: firstItemId,
      current_question_index: Math.max(0, itemIndex),
      current_task_id: null,
      active_scope_question_ids: [...nextSection.item_ids],
      active_module_question_ids: [],
      active_section_question_ids: [...nextSection.item_ids]
    }
  };
}

export function reopenDynamicSection(
  session: DynamicPracticeSession,
  sectionId: DynamicSectionName,
  nowIso = new Date().toISOString()
): DynamicPracticeSession {
  const section = session.dynamic_sections.find((candidate) => candidate.section_id === sectionId);
  if (!section) return session;
  const itemId = section.item_ids.at(-1) ?? '';
  const itemIndex = itemId ? session.questions.findIndex((item) => item.id === itemId) : 0;
  return {
    ...session,
    view: 'PRACTICE',
    completed_at: undefined,
    completed_sections: (session.completed_sections ?? []).filter((section) => section !== sectionId),
    dynamic_sections: session.dynamic_sections.map((candidate) => candidate.section_id === sectionId
      ? { ...candidate, status: 'IN_PROGRESS', completed_at: null, started_at: candidate.started_at ?? nowIso }
      : candidate),
    current_section_id: sectionId,
    current_section: sectionId,
    current_module_id: sectionId,
    current_scope_id: sectionId,
    current_question_id: itemId,
    current_question_index: Math.max(0, itemIndex),
    current_task_id: null,
    active_scope_question_ids: [...section.item_ids],
    active_module_question_ids: [],
    active_section_question_ids: [...section.item_ids]
  };
}

export type DynamicTypeChangeResult =
  | { ok: false; reason: 'ANSWER_CLEAR_CONFIRMATION_REQUIRED'; session: DynamicPracticeSession }
  | { ok: true; session: DynamicPracticeSession; answer_cleared: boolean };

export function changeDynamicItemType(
  session: DynamicPracticeSession,
  itemId: string,
  rawTypeConfig: DynamicItemTypeConfig,
  options: { confirm_clear: boolean; now_iso?: string }
): DynamicTypeChangeResult {
  const item = session.questions.find((question) => question.id === itemId) as DynamicPracticeItem | undefined;
  if (!item) throw new Error(`Dynamic Item does not exist: ${itemId}`);
  const typeConfig = cloneItemTypeConfig(rawTypeConfig);
  const validation = validateItemTypeConfig(typeConfig);
  if (!validation.ok) throw new Error(validation.errors.join(' '));
  if (!typeConfig.section_compatibility.includes(item.section_id)) {
    throw new Error(`${typeConfig.type_id} is not compatible with ${item.section_id}.`);
  }
  const prior = session.answers[itemId];
  const incompatible = hasAnswerValue(prior?.answer_value) &&
    !isAnswerCompatibleWithConfig(item.renderer, typeConfig, prior?.answer_value);
  if (incompatible && !options.confirm_clear) {
    return { ok: false, reason: 'ANSWER_CLEAR_CONFIRMATION_REQUIRED', session };
  }
  const nowIso = options.now_iso ?? new Date().toISOString();
  const questions = session.questions.map((question) => question.id === itemId
    ? {
        ...question,
        type_id: typeConfig.type_id,
        type_label: typeConfig.type_label,
        renderer: typeConfig.renderer,
        answer_mode: typeConfig.renderer,
        option_labels: [...typeConfig.option_labels],
        option_count: typeConfig.option_labels.length || undefined,
        custom_time_limit_ms: typeConfig.custom_time_limit_ms,
        time_limit_ms: typeConfig.custom_time_limit_ms,
        timer_limit_ms: typeConfig.custom_time_limit_ms,
        remaining_ms: typeConfig.custom_time_limit_ms,
        type_config: typeConfig,
        writing_state: typeConfig.renderer === 'long_text'
          ? question.writing_state ?? emptyWritingState()
          : undefined
      }
    : question);
  const answers = incompatible && prior
    ? {
        ...session.answers,
        [itemId]: clearAnswer(prior, nowIso)
      }
    : session.answers;
  const registryContainsConfig = session.item_type_registry.some((entry) => sameConfig(entry, typeConfig));
  return {
    ok: true,
    answer_cleared: incompatible,
    session: {
      ...session,
      questions,
      answers,
      item_type_registry: registryContainsConfig
        ? session.item_type_registry
        : [...session.item_type_registry, typeConfig]
    }
  };
}

export function addDynamicPauseTime(
  session: DynamicPracticeSession,
  itemId: string,
  pauseDeltaMs: number
): DynamicPracticeSession {
  const delta = Number.isFinite(pauseDeltaMs) ? Math.max(0, pauseDeltaMs) : 0;
  if (delta === 0) return session;
  const item = session.questions.find((question) => question.id === itemId) as DynamicPracticeItem | undefined;
  if (!item) return session;
  return {
    ...session,
    questions: session.questions.map((question) => question.id === itemId
      ? { ...question, pause_time_ms: (question.pause_time_ms ?? 0) + delta }
      : question),
    dynamic_sections: session.dynamic_sections.map((section) => section.section_id === item.section_id
      ? { ...section, pause_time_ms: section.pause_time_ms + delta }
      : section)
  };
}

export function updateDynamicWritingText(
  session: DynamicPracticeSession,
  itemId: string,
  rawText: string,
  inputType: WritingInputType,
  activeTimeMs: number
): { session: DynamicPracticeSession; text: string } {
  const item = session.questions.find((question) => question.id === itemId) as DynamicPracticeItem | undefined;
  if (!item || item.renderer !== 'long_text') return { session, text: '' };
  const prior = item.writing_state ?? emptyWritingState();
  const text = sanitizeWritingText(rawText, { allow_line_breaks: true }).text;
  if (text === prior.text) return { session, text };
  const delta = analyzeWritingChange(prior.text, text, inputType);
  const historyAction = inputType === 'historyUndo' || inputType === 'historyRedo';
  const writingState = {
    ...prior,
    text,
    word_count: countEnglishWords(text),
    character_count: countCharacters(text),
    keyboard_inserted_characters: prior.keyboard_inserted_characters + delta.keyboardCharacters,
    pasted_characters: prior.pasted_characters + delta.pastedCharacters,
    deleted_characters: prior.deleted_characters + delta.deletedCharacters,
    cut_count: prior.cut_count + delta.cutCount,
    paste_count: prior.paste_count + delta.pasteCount,
    undo_count: prior.undo_count + delta.undoCount,
    redo_count: prior.redo_count + delta.redoCount,
    modification_count: prior.modification_count + 1,
    keyboard_cpm: calculateKeyboardCpm(
      prior.keyboard_inserted_characters + delta.keyboardCharacters,
      activeTimeMs
    ),
    undo_stack: historyAction ? prior.undo_stack : [...prior.undo_stack, prior.text],
    redo_stack: historyAction ? prior.redo_stack : []
  };
  return {
    text,
    session: {
      ...session,
      questions: session.questions.map((question) => question.id === itemId
        ? { ...question, writing_state: writingState }
        : question)
    }
  };
}

export function undoDynamicWritingText(
  session: DynamicPracticeSession,
  itemId: string,
  activeTimeMs: number
): { session: DynamicPracticeSession; text?: string } {
  const item = session.questions.find((question) => question.id === itemId) as DynamicPracticeItem | undefined;
  const state = item?.writing_state;
  const target = state?.undo_stack.at(-1);
  if (!item || !state || target === undefined) return { session };
  const updated = updateDynamicWritingText(session, itemId, target, 'historyUndo', activeTimeMs);
  return {
    text: updated.text,
    session: {
      ...updated.session,
      questions: updated.session.questions.map((question) => question.id === itemId && question.writing_state
        ? {
            ...question,
            writing_state: {
              ...question.writing_state,
              undo_stack: state.undo_stack.slice(0, -1),
              redo_stack: [...state.redo_stack, state.text]
            }
          }
        : question)
    }
  };
}

export function redoDynamicWritingText(
  session: DynamicPracticeSession,
  itemId: string,
  activeTimeMs: number
): { session: DynamicPracticeSession; text?: string } {
  const item = session.questions.find((question) => question.id === itemId) as DynamicPracticeItem | undefined;
  const state = item?.writing_state;
  const target = state?.redo_stack.at(-1);
  if (!item || !state || target === undefined) return { session };
  const updated = updateDynamicWritingText(session, itemId, target, 'historyRedo', activeTimeMs);
  return {
    text: updated.text,
    session: {
      ...updated.session,
      questions: updated.session.questions.map((question) => question.id === itemId && question.writing_state
        ? {
            ...question,
            writing_state: {
              ...question.writing_state,
              undo_stack: [...state.undo_stack, state.text],
              redo_stack: state.redo_stack.slice(0, -1)
            }
          }
        : question)
    }
  };
}

function sectionPrefix(section: DynamicSectionName): 'R' | 'L' | 'W' {
  return section === 'Reading' ? 'R' : section === 'Listening' ? 'L' : 'W';
}

function sameConfig(left: DynamicItemTypeConfig, right: DynamicItemTypeConfig): boolean {
  return left.type_id === right.type_id &&
    left.type_label === right.type_label &&
    left.renderer === right.renderer &&
    left.custom_time_limit_ms === right.custom_time_limit_ms &&
    left.option_labels.join('\u0000') === right.option_labels.join('\u0000') &&
    left.section_compatibility.join('\u0000') === right.section_compatibility.join('\u0000') &&
    left.created_by === right.created_by && left.version === right.version;
}

function hasAnswerValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && String(value).length > 0;
}

function isAnswerCompatibleWithConfig(
  priorRenderer: DynamicPracticeItem['renderer'],
  nextConfig: DynamicItemTypeConfig,
  value: unknown
): boolean {
  if (priorRenderer !== nextConfig.renderer) return false;
  if (nextConfig.renderer === 'single_choice') {
    return typeof value === 'string' && nextConfig.option_labels.includes(value);
  }
  if (nextConfig.renderer === 'multiple_choice') {
    return Array.isArray(value) && value.every((entry) =>
      typeof entry === 'string' && nextConfig.option_labels.includes(entry));
  }
  return typeof value === 'string';
}

function isSafeRelativePackagePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) return false;
  if (/^([A-Za-z]:[\\/]|[\\/]{2}|[\\/])/.test(value)) return false;
  if (Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  })) return false;
  const segments = value.split(/[\\/]/);
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes(':'));
}

function isSafeDuration(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isValidWritingState(value: DynamicPracticeItem['writing_state']): boolean {
  if (!value || typeof value.text !== 'string') return false;
  const counters = [
    value.word_count,
    value.character_count,
    value.keyboard_inserted_characters,
    value.pasted_characters,
    value.deleted_characters,
    value.cut_count,
    value.paste_count,
    value.undo_count,
    value.redo_count,
    value.modification_count
  ];
  return counters.every(isSafeDuration) &&
    typeof value.keyboard_cpm === 'number' &&
    Number.isFinite(value.keyboard_cpm) &&
    value.keyboard_cpm >= 0 &&
    Array.isArray(value.undo_stack) &&
    value.undo_stack.every((entry) => typeof entry === 'string') &&
    Array.isArray(value.redo_stack) &&
    value.redo_stack.every((entry) => typeof entry === 'string');
}

function isAnswerValueValid(item: DynamicPracticeItem, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (item.renderer === 'single_choice') {
    return typeof value === 'string' && item.option_labels.includes(value);
  }
  if (item.renderer === 'multiple_choice') {
    return Array.isArray(value) &&
      value.every((entry) => typeof entry === 'string' && item.option_labels.includes(entry)) &&
      new Set(value).size === value.length;
  }
  return typeof value === 'string';
}

function clearAnswer(answer: AnswerRecord, nowIso: string): AnswerRecord {
  return {
    ...answer,
    answer_value: null,
    progress_status: 'ENCOUNTERED_UNANSWERED',
    status: 'ENCOUNTERED_UNANSWERED',
    modification_count: answer.modification_count + 1,
    revision_count: answer.revision_count + 1,
    final_answer_elapsed_ms: null,
    last_changed_at: nowIso,
    updated_at: nowIso
  };
}

function emptyWritingState() {
  return {
    text: '',
    word_count: 0,
    character_count: 0,
    keyboard_cpm: 0,
    keyboard_inserted_characters: 0,
    pasted_characters: 0,
    deleted_characters: 0,
    cut_count: 0,
    paste_count: 0,
    undo_count: 0,
    redo_count: 0,
    modification_count: 0,
    undo_stack: [],
    redo_stack: []
  };
}
