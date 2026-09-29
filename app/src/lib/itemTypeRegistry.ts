import type {
  DynamicItemRenderer,
  DynamicItemTypeConfig,
  DynamicSectionName
} from '../types';

const REGISTRY_VERSION = '1.0.0';
const SAFE_RENDERERS = new Set<DynamicItemRenderer>([
  'single_choice',
  'multiple_choice',
  'short_text',
  'long_text'
]);
const DEFAULT_OPTIONS = ['A', 'B', 'C', 'D'];

type PresetDefinition = Omit<DynamicItemTypeConfig, 'custom_time_limit_ms' | 'created_by' | 'version'>;

const PRESETS: Record<DynamicSectionName, PresetDefinition[]> = {
  Reading: [
    preset('reading_single_choice', 'Single Choice', 'single_choice', 'Reading', DEFAULT_OPTIONS),
    preset('reading_multiple_choice', 'Multiple Choice', 'multiple_choice', 'Reading', DEFAULT_OPTIONS),
    preset('reading_word_blank', 'Fill in the Blank', 'short_text', 'Reading'),
    preset('reading_academic_single_choice', 'Academic Reading', 'single_choice', 'Reading', DEFAULT_OPTIONS),
    preset('reading_short_text', 'Short Text', 'short_text', 'Reading')
  ],
  Listening: [
    preset('listening_single_choice', 'Single Choice', 'single_choice', 'Listening', DEFAULT_OPTIONS),
    preset('listening_multiple_choice', 'Multiple Choice', 'multiple_choice', 'Listening', DEFAULT_OPTIONS),
    preset('listening_short_text', 'Short Text', 'short_text', 'Listening'),
    preset('listening_academic_lecture_single_choice', 'Academic Lecture', 'single_choice', 'Listening', DEFAULT_OPTIONS)
  ],
  Writing: [
    preset('writing_build_sentence', 'Build a Sentence', 'short_text', 'Writing'),
    preset('writing_email', 'Email', 'long_text', 'Writing'),
    preset('writing_academic_discussion', 'Academic Discussion', 'long_text', 'Writing'),
    preset('writing_short_text', 'Custom Short Text', 'short_text', 'Writing'),
    preset('writing_long_text', 'Custom Long Text', 'long_text', 'Writing')
  ]
};

export interface ItemTypeValidation {
  ok: boolean;
  errors: string[];
}

export function listItemTypePresets(section?: DynamicSectionName): DynamicItemTypeConfig[] {
  const definitions = section ? PRESETS[section] : Object.values(PRESETS).flat();
  return definitions.map((definition) => ({
    ...definition,
    option_labels: [...definition.option_labels],
    section_compatibility: [...definition.section_compatibility],
    custom_time_limit_ms: null,
    created_by: 'system_preset',
    version: REGISTRY_VERSION
  }));
}

export function getItemTypePreset(
  section: DynamicSectionName,
  typeId: string
): DynamicItemTypeConfig {
  const found = listItemTypePresets(section).find((item) => item.type_id === typeId);
  if (!found) throw new Error(`Unknown ${section} item type preset: ${typeId}`);
  return found;
}

export function createCustomItemType(input: {
  section: DynamicSectionName;
  type_label: string;
  renderer: DynamicItemRenderer;
  option_labels?: string[];
  custom_time_limit_ms?: number | null;
}): DynamicItemTypeConfig {
  const optionLabels = isChoiceRenderer(input.renderer)
    ? [...(input.option_labels ?? DEFAULT_OPTIONS)]
    : [];
  // v2 custom IDs encode the complete behavior-bearing configuration. Existing
  // persisted custom IDs are read as-is; only newly created configs use this ID.
  const signature = JSON.stringify([
    input.section, input.renderer, input.type_label.trim(), optionLabels,
    input.custom_time_limit_ms ?? null
  ]);
  return {
    type_id: `custom_v2_${encodeURIComponent(signature)}`,
    type_label: input.type_label.trim(),
    renderer: input.renderer,
    option_labels: optionLabels,
    custom_time_limit_ms: input.custom_time_limit_ms ?? null,
    section_compatibility: [input.section],
    created_by: 'user',
    version: REGISTRY_VERSION
  };
}

export function validateItemTypeConfig(config: DynamicItemTypeConfig): ItemTypeValidation {
  const errors: string[] = [];
  if (!config.type_id || hasDangerousControlCharacters(config.type_id)) {
    errors.push('type_id must be non-empty and contain no control characters.');
  }
  if (!config.type_label.trim() || config.type_label.length > 80 || hasDangerousControlCharacters(config.type_label)) {
    errors.push('type_label must be 1–80 safe characters.');
  }
  if (!SAFE_RENDERERS.has(config.renderer)) errors.push('renderer is not registered.');
  if (
    config.section_compatibility.length === 0 ||
    config.section_compatibility.some((section) => !['Reading', 'Listening', 'Writing'].includes(section))
  ) {
    errors.push('section compatibility must contain only Reading, Listening, or Writing.');
  }
  if (
    config.custom_time_limit_ms !== null &&
    (!Number.isSafeInteger(config.custom_time_limit_ms) || config.custom_time_limit_ms <= 0)
  ) {
    errors.push('custom time limit must be null or a positive safe integer.');
  }
  if (isChoiceRenderer(config.renderer)) {
    if (config.option_labels.length < 2 || config.option_labels.length > 10) {
      errors.push('choice renderers require 2–10 option labels.');
    }
    const normalized = config.option_labels.map((label) => label.trim());
    if (normalized.some((label) => !label || label.length > 40 || hasDangerousControlCharacters(label))) {
      errors.push('option labels must be 1–40 safe characters.');
    }
    if (new Set(normalized).size !== normalized.length) errors.push('option labels must be unique.');
  } else if (config.option_labels.length !== 0) {
    errors.push('text renderers cannot define option labels.');
  }
  if (!config.version.trim()) errors.push('registry version is required.');
  if (config.created_by !== 'system_preset' && config.created_by !== 'user') {
    errors.push('created_by is invalid.');
  }
  return { ok: errors.length === 0, errors };
}

export function cloneItemTypeConfig(config: DynamicItemTypeConfig): DynamicItemTypeConfig {
  return {
    ...config,
    option_labels: [...config.option_labels],
    section_compatibility: [...config.section_compatibility]
  };
}

function preset(
  type_id: string,
  type_label: string,
  renderer: DynamicItemRenderer,
  section: DynamicSectionName,
  option_labels: string[] = []
): PresetDefinition {
  return { type_id, type_label, renderer, option_labels, section_compatibility: [section] };
}

function isChoiceRenderer(renderer: DynamicItemRenderer): boolean {
  return renderer === 'single_choice' || renderer === 'multiple_choice';
}

function hasDangerousControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}
