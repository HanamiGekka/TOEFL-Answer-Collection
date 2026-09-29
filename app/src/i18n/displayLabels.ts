import type { DynamicItemTypeConfig } from '../types';
import i18n from './index';
import { normalizeLocale } from './locale';

const SYSTEM_PRESET_KEYS: Readonly<Record<string, string>> = {
  reading_single_choice: 'preset.singleChoice',
  reading_multiple_choice: 'preset.multipleChoice',
  reading_word_blank: 'preset.fillBlank',
  reading_academic_single_choice: 'preset.academicReading',
  reading_short_text: 'preset.shortText',
  listening_single_choice: 'preset.singleChoice',
  listening_multiple_choice: 'preset.multipleChoice',
  listening_short_text: 'preset.shortText',
  listening_academic_lecture_single_choice: 'preset.academicLecture',
  writing_build_sentence: 'preset.buildSentence',
  writing_email: 'preset.email',
  writing_academic_discussion: 'preset.academicDiscussion',
  writing_short_text: 'preset.customShortText',
  writing_long_text: 'preset.customLongText'
};

export function getItemTypeDisplayLabel(config: DynamicItemTypeConfig, locale: string): string {
  if (config.created_by !== 'system_preset') return config.type_label;
  const key = SYSTEM_PRESET_KEYS[config.type_id];
  return key ? i18n.t(key, { lng: normalizeLocale(locale) }) : config.type_label;
}

export function getPresetDisplayLabel(typeId: string, locale: string): string {
  const key = SYSTEM_PRESET_KEYS[typeId];
  return key ? i18n.t(key, { lng: normalizeLocale(locale) }) : typeId;
}
