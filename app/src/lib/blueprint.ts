import rawBlueprint from '../../../config/blueprints/toefl-2026.json';
import type { AnswerMode, ModuleRuntimeState, PracticeMode, PracticeQuestion, RuntimeScopeId, SectionName, TimingProfile } from '../types';

export type BlueprintConfirmationStatus = 'USER_CONFIRMED' | 'LOCAL_SOURCE_CONFIRMED' | 'NEEDS_USER_CONFIRMATION';

export interface BlueprintModule {
  module_id: RuntimeScopeId;
  order: number;
  kind: ModuleRuntimeState['kind'];
  label: string;
  question_numbers: [number, number];
}

export interface BlueprintQuestionSlot {
  slot_id: string;
  number: number;
  module_id: RuntimeScopeId;
  type_label: string;
  answer_mode: AnswerMode;
  option_count?: number;
  multiple_select_count?: number;
  text_input_type?: string;
  time_limit_ms?: number;
  listening_group_id?: string;
  passage_group_id?: string;
  confirmation_status: BlueprintConfirmationStatus;
}

export interface BlueprintTaskSlot {
  task_id: string;
  task_type: string;
  question_slot_ids: string[];
  timer_limit_ms: number | null;
}

export interface BlueprintSection {
  section_id: SectionName;
  declared_question_count: number;
  timing_profile: string;
  modules: BlueprintModule[];
  question_slots: BlueprintQuestionSlot[];
  task_slots: BlueprintTaskSlot[];
  group_timer_limit_ms?: number;
  navigation_policy: Record<string, string>;
}

export interface ToeflBlueprint {
  blueprint_id: string;
  version: string;
  lifecycle_status: 'LEGACY_NEW_SESSION_DISABLED';
  source_note: string;
  timing_profiles: string[];
  navigation_profiles: Record<PracticeMode, TimingProfile['navigation_rules']>;
  sections: BlueprintSection[];
}

interface RawQuestionSlotGroup {
  numbers: number[];
  type_label: string;
  answer_mode: AnswerMode;
  option_count?: number;
  multiple_select_count?: number;
  text_input_type?: string;
  time_limit_ms?: number;
  listening_group_size?: number;
  passage_group_id?: string;
  confirmation_status: BlueprintConfirmationStatus;
}

interface RawTaskSlot {
  task_id: string;
  task_type: string;
  question_numbers: number[];
  timer_limit_ms: number | null;
}

interface RawSection extends Omit<BlueprintSection, 'question_slots' | 'task_slots'> {
  question_slots: RawQuestionSlotGroup[];
  task_slots: RawTaskSlot[];
}

interface RawBlueprint extends Omit<ToeflBlueprint, 'sections'> {
  sections: RawSection[];
}

export interface BlueprintOverride {
  package_id: string;
  slot_overrides: Record<string, Partial<Pick<
    BlueprintQuestionSlot,
    'type_label' | 'answer_mode' | 'option_count' | 'multiple_select_count' | 'text_input_type' | 'confirmation_status'
  >>>;
}

export interface BlueprintValidationError {
  code: 'DUPLICATE_ID' | 'MISSING_RENDERER' | 'INVALID_TIMER' | 'MISSING_PROFILE' | 'COUNT_MISMATCH' | 'MISSING_SLOT' | 'MODULE_ORDER';
  path: string;
  message: string;
}

const SUPPORTED_RENDERERS = new Set<AnswerMode>([
  'single_choice', 'multiple_choice', 'text', 'short_text', 'word_blanks', 'sentence', 'long_text', 'order',
  'order_input', 'speaking_timer'
]);

export const DEFAULT_BLUEPRINT: ToeflBlueprint = expandBlueprint(rawBlueprint as unknown as RawBlueprint);

export function validateBlueprint(blueprint: ToeflBlueprint): { ok: boolean; errors: BlueprintValidationError[] } {
  const errors: BlueprintValidationError[] = [];
  for (const mode of ['practice', 'exam_simulation'] as const) {
    if (!blueprint.navigation_profiles?.[mode]) {
      errors.push({ code: 'MISSING_PROFILE', path: `navigation_profiles.${mode}`, message: `Missing navigation profile ${mode}.` });
    }
  }
  const moduleIds = new Set<string>();
  const questionIds = new Set<string>();
  const taskIds = new Set<string>();
  for (const [sectionIndex, section] of blueprint.sections.entries()) {
    const sectionSlotIds = new Set<string>();
    const sectionModuleIds = new Set(section.modules.map((module) => module.module_id));
    if (!blueprint.timing_profiles.includes(section.timing_profile)) {
      errors.push({ code: 'MISSING_PROFILE', path: `sections.${sectionIndex}.timing_profile`, message: `Unknown timing profile ${section.timing_profile}.` });
    }
    if (section.question_slots.length !== section.declared_question_count) {
      errors.push({ code: 'COUNT_MISMATCH', path: `sections.${sectionIndex}`, message: 'Declared question count does not match expanded slots.' });
    }
    const moduleOrders = section.modules.map((module) => module.order).sort((a, b) => a - b);
    if (moduleOrders.some((order, index) => order !== index + 1)) {
      errors.push({ code: 'MODULE_ORDER', path: `sections.${sectionIndex}.modules`, message: 'Module order must be contiguous from 1.' });
    }
    const moduleQuestionNumbers = new Set<number>();
    for (const module of section.modules) {
      addUnique(module.module_id, `sections.${sectionIndex}.modules`, moduleIds, errors);
      if (!module.label || !['MODULE', 'SECTION', 'TASK_GROUP'].includes(module.kind)) {
        errors.push({ code: 'MISSING_SLOT', path: module.module_id, message: 'Module kind/label is not renderable.' });
      }
      const [first, last] = module.question_numbers;
      if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > section.declared_question_count) {
        errors.push({ code: 'COUNT_MISMATCH', path: module.module_id, message: 'Module question range is outside the declared Section range.' });
        continue;
      }
      for (let number = first; number <= last; number += 1) {
        if (moduleQuestionNumbers.has(number)) {
          errors.push({ code: 'COUNT_MISMATCH', path: module.module_id, message: `Question ${number} belongs to multiple Modules.` });
        }
        moduleQuestionNumbers.add(number);
      }
    }
    if (moduleQuestionNumbers.size !== section.declared_question_count) {
      errors.push({ code: 'COUNT_MISMATCH', path: `sections.${sectionIndex}.modules`, message: 'Modules do not cover each Section question exactly once.' });
    }
    for (const [slotIndex, slot] of section.question_slots.entries()) {
      addUnique(slot.slot_id, `sections.${sectionIndex}.question_slots.${slotIndex}`, questionIds, errors);
      sectionSlotIds.add(slot.slot_id);
      if (!sectionModuleIds.has(slot.module_id)) {
        errors.push({ code: 'MISSING_SLOT', path: slot.slot_id, message: `Question references unknown module ${slot.module_id}.` });
      }
      if (!SUPPORTED_RENDERERS.has(slot.answer_mode)) {
        errors.push({ code: 'MISSING_RENDERER', path: slot.slot_id, message: `No renderer for ${slot.answer_mode}.` });
      }
      if (slot.time_limit_ms !== undefined && (!Number.isFinite(slot.time_limit_ms) || slot.time_limit_ms < 0)) {
        errors.push({ code: 'INVALID_TIMER', path: slot.slot_id, message: 'Question timer must be non-negative.' });
      }
    }
    const taskQuestionIds = new Set<string>();
    for (const task of section.task_slots) {
      addUnique(task.task_id, `sections.${sectionIndex}.task_slots`, taskIds, errors);
      if (task.timer_limit_ms !== null && (!Number.isFinite(task.timer_limit_ms) || task.timer_limit_ms < 0)) {
        errors.push({ code: 'INVALID_TIMER', path: task.task_id, message: 'Task timer must be non-negative.' });
      }
      for (const slotId of task.question_slot_ids) {
        if (!sectionSlotIds.has(slotId)) errors.push({ code: 'MISSING_SLOT', path: task.task_id, message: `Missing question slot ${slotId}.` });
        if (taskQuestionIds.has(slotId)) errors.push({ code: 'DUPLICATE_ID', path: task.task_id, message: `Question slot belongs to multiple tasks: ${slotId}.` });
        taskQuestionIds.add(slotId);
      }
    }
    if (section.task_slots.length > 0 && taskQuestionIds.size !== sectionSlotIds.size) {
      errors.push({ code: 'COUNT_MISMATCH', path: `sections.${sectionIndex}.task_slots`, message: 'Task slots do not cover each section question exactly once.' });
    }
  }
  return { ok: errors.length === 0, errors };
}

export function createQuestionsFromBlueprint(blueprint: ToeflBlueprint, sections: SectionName[]): PracticeQuestion[] {
  const selected = new Set(sections);
  return blueprint.sections.filter((section) => selected.has(section.section_id)).flatMap((section) =>
    section.question_slots.map((slot) => ({
      id: slot.slot_id,
      section: section.section_id,
      section_id: section.section_id,
      module_id: slot.module_id,
      number: slot.number,
      type_label: slot.type_label,
      answer_mode: slot.answer_mode,
      ...(slot.option_count === undefined ? {} : { option_count: slot.option_count }),
      ...(slot.time_limit_ms === undefined ? {} : { time_limit_ms: slot.time_limit_ms }),
      ...(slot.listening_group_id === undefined ? {} : { listening_group_id: slot.listening_group_id }),
      ...(slot.passage_group_id === undefined ? {} : { passage_group_id: slot.passage_group_id }),
      encountered: false,
      visit_count: 0
    }))
  );
}

export function mergeBlueprintOverride(
  blueprint: ToeflBlueprint,
  override: BlueprintOverride,
  packageId = override.package_id
): ToeflBlueprint {
  const raw = override as unknown as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !['package_id', 'slot_overrides'].includes(key))) {
    throw new Error('Package override attempted to change safety policy or an unsupported blueprint field.');
  }
  if (override.package_id !== packageId) return structuredClone(blueprint);
  const merged = structuredClone(blueprint);
  for (const [slotId, changes] of Object.entries(override.slot_overrides ?? {})) {
    const slot = merged.sections.flatMap((section) => section.question_slots).find((item) => item.slot_id === slotId);
    if (!slot) throw new Error(`Package override references an unknown slot: ${slotId}`);
    Object.assign(slot, changes);
  }
  return merged;
}

function expandBlueprint(raw: RawBlueprint): ToeflBlueprint {
  return {
    blueprint_id: raw.blueprint_id,
    version: raw.version,
    lifecycle_status: raw.lifecycle_status,
    source_note: raw.source_note,
    timing_profiles: [...raw.timing_profiles],
    navigation_profiles: structuredClone(raw.navigation_profiles),
    sections: raw.sections.map((section) => {
      const questionSlots = section.question_slots.flatMap((group) => group.numbers.map((number) => {
        const module = section.modules.find((item) => number >= item.question_numbers[0] && number <= item.question_numbers[1]);
        if (!module) throw new Error(`${section.section_id}-${number} is outside every configured module.`);
        return {
          slot_id: `${section.section_id}-${number}`,
          number,
          module_id: module.module_id,
          type_label: group.type_label,
          answer_mode: group.answer_mode,
          ...(group.option_count === undefined ? {} : { option_count: group.option_count }),
          ...(group.multiple_select_count === undefined ? {} : { multiple_select_count: group.multiple_select_count }),
          ...(group.text_input_type === undefined ? {} : { text_input_type: group.text_input_type }),
          ...(group.time_limit_ms === undefined ? {} : { time_limit_ms: group.time_limit_ms }),
          ...(group.listening_group_size === undefined ? {} : {
            listening_group_id: `L-G${Math.ceil(number / group.listening_group_size)}`
          }),
          ...(group.passage_group_id === undefined ? {} : { passage_group_id: group.passage_group_id }),
          confirmation_status: group.confirmation_status
        } satisfies BlueprintQuestionSlot;
      })).sort((left, right) => left.number - right.number);
      return {
        section_id: section.section_id,
        declared_question_count: section.declared_question_count,
        timing_profile: section.timing_profile,
        modules: structuredClone(section.modules),
        question_slots: questionSlots,
        task_slots: section.task_slots.map((task) => ({
          task_id: task.task_id,
          task_type: task.task_type,
          question_slot_ids: task.question_numbers.map((number) => `${section.section_id}-${number}`),
          timer_limit_ms: task.timer_limit_ms
        })),
        ...(section.group_timer_limit_ms === undefined ? {} : { group_timer_limit_ms: section.group_timer_limit_ms }),
        navigation_policy: { ...section.navigation_policy }
      };
    })
  };
}

function addUnique(
  id: string,
  path: string,
  ids: Set<string>,
  errors: BlueprintValidationError[]
): void {
  if (ids.has(id)) errors.push({ code: 'DUPLICATE_ID', path, message: `Duplicate id: ${id}` });
  ids.add(id);
}
