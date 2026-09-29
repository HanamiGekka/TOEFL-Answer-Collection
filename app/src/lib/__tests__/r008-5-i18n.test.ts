import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES, normalizeLocale } from '../../i18n/locale';
import { getItemTypeDisplayLabel } from '../../i18n/displayLabels';
import { BUILT_IN_BATCHES } from '../itemBatchRegistry';
import { createCustomItemType, getItemTypePreset } from '../itemTypeRegistry';

describe('R008.5 locale and identity contracts', () => {
  it('supports exactly the specified locales and falls back safely', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'zh-CN', 'ja', 'zh-TW']);
    expect(normalizeLocale('ja')).toBe('ja');
    expect(normalizeLocale('zh-CN')).toBe('zh-CN');
    expect(normalizeLocale('unsupported')).toBe('en');
  });

  it('separates a system preset display label from its stable identity', () => {
    const preset = getItemTypePreset('Reading', 'reading_word_blank');
    expect(preset.type_id).toBe('reading_word_blank');
    expect(preset.type_label).toBe('Fill in the Blank');
    expect(getItemTypeDisplayLabel(preset, 'ja')).toBe('穴埋め');
    expect(getItemTypeDisplayLabel(preset, 'en')).toBe('Fill in the Blank');
  });

  it('preserves user labels and batch IDs', () => {
    const custom = createCustomItemType({ section: 'Reading', type_label: 'R0085 日本語 中文 Test', renderer: 'short_text' });
    expect(getItemTypeDisplayLabel(custom, 'en')).toBe('R0085 日本語 中文 Test');
    expect(getItemTypeDisplayLabel(custom, 'ja')).toBe('R0085 日本語 中文 Test');
    expect(BUILT_IN_BATCHES.map((batch) => batch.id)).toEqual([
      'reading_word_blank_10', 'reading_academic_5', 'listening_academic_lecture_4', 'writing_build_sentence_10'
    ]);
    expect(BUILT_IN_BATCHES.map((batch) => batch.label_key)).toEqual([
      'batch.readingWordBlank10', 'batch.academicReading5', 'batch.academicLecture4', 'batch.buildSentence10'
    ]);
  });
});
