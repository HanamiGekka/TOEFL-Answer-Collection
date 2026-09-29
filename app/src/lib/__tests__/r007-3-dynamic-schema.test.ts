import { describe, expect, it } from 'vitest';
import {
  createDynamicItem,
  createDynamicSession,
  isDynamicSession,
  validateDynamicSession
} from '../dynamicSession';
import {
  createCustomItemType,
  getItemTypePreset,
  validateItemTypeConfig
} from '../itemTypeRegistry';
import { DEFAULT_BLUEPRINT } from '../blueprint';

const sessionInput = {
  session_id: 'r0073-schema',
  package_id: '01.21.A.1',
  source_relative_path: '01.21.A.1',
  mode: 'practice' as const,
  selected_sections: ['Reading', 'Listening', 'Writing'] as const,
  created_at: '2026-08-03T00:00:00.000Z'
};

describe('R007.3 schema v6 dynamic manual factory', () => {
  it('marks the fixed Blueprint as disabled for new Sessions while retaining it for legacy reads', () => {
    expect(DEFAULT_BLUEPRINT.lifecycle_status).toBe('LEGACY_NEW_SESSION_DISABLED');
    expect(DEFAULT_BLUEPRINT.sections.length).toBeGreaterThan(0);
  });

  it('creates only empty Reading, Listening, and Writing Sections without Blueprint, Module, Task, or Speaking', () => {
    const session = createDynamicSession(sessionInput);

    expect(session).toMatchObject({
      session_schema_version: 6,
      structure_mode: 'dynamic_manual',
      questions: [],
      modules: [],
      tasks: []
    });
    expect(session.blueprint_id).toBeUndefined();
    expect(session.blueprint_version).toBeUndefined();
    expect(session.source_relative_path).toBe('01.21.A.1');
    expect(session.source_path).toBeUndefined();
    expect(session.dynamic_sections.map((section) => section.section_id)).toEqual([
      'Reading',
      'Listening',
      'Writing'
    ]);
    expect(session.dynamic_sections.every((section) => section.item_ids.length === 0)).toBe(true);
    expect(session.dynamic_sections.every((section) => section.next_item_ordinal === 1)).toBe(true);
    expect(isDynamicSession(session)).toBe(true);
    expect(validateDynamicSession(session)).toEqual({ ok: true, errors: [] });
  });

  it('rejects Speaking and ignores package contents when creating the new runtime', () => {
    expect(() => createDynamicSession({
      ...sessionInput,
      selected_sections: ['Reading', 'Speaking'] as never
    })).toThrow(/Speaking/);

    const first = createDynamicSession(sessionInput);
    const second = createDynamicSession({ ...sessionInput, package_id: '07.26.B.9' });
    expect(second.dynamic_sections).toEqual(first.dynamic_sections);
    expect(second.questions).toEqual([]);
  });

  it('rejects absolute or traversing package source metadata', () => {
    for (const source_relative_path of ['../outside', 'C:\\formal', '/formal', '\\\\server\\share']) {
      expect(() => createDynamicSession({ ...sessionInput, source_relative_path })).toThrow(/relative package source path/);
    }
  });
});

describe('R007.3 safe item type registry', () => {
  it('maps presets to a renderer without using the display label as component identity', () => {
    expect(getItemTypePreset('Reading', 'reading_single_choice')).toMatchObject({
      type_label: 'Single Choice',
      renderer: 'single_choice',
      option_labels: ['A', 'B', 'C', 'D']
    });
    expect(getItemTypePreset('Writing', 'writing_email')).toMatchObject({
      type_label: 'Email',
      renderer: 'long_text'
    });

    const custom = createCustomItemType({
      section: 'Reading',
      type_label: '用户自定义名称',
      renderer: 'single_choice',
      option_labels: ['甲', '乙']
    });
    expect(custom.type_label).toBe('用户自定义名称');
    expect(custom.renderer).toBe('single_choice');
  });

  it('validates 2–10 ordered, unique, non-empty safe option labels', () => {
    const valid = createCustomItemType({
      section: 'Listening',
      type_label: '自定义选择题',
      renderer: 'multiple_choice',
      option_labels: ['A', 'C', 'B']
    });
    expect(validateItemTypeConfig(valid)).toEqual({ ok: true, errors: [] });
    expect(valid.option_labels).toEqual(['A', 'C', 'B']);

    for (const optionLabels of [
      ['A'],
      Array.from({ length: 11 }, (_, index) => String(index)),
      ['A', 'A'],
      ['A', ' '],
      ['A', 'B\u0007']
    ]) {
      expect(validateItemTypeConfig({ ...valid, option_labels: optionLabels }).ok).toBe(false);
    }
  });

  it('does not accept arbitrary renderer names or incompatible Sections', () => {
    const config = createCustomItemType({
      section: 'Writing',
      type_label: '自定义长文本',
      renderer: 'long_text'
    });
    expect(validateItemTypeConfig({ ...config, renderer: 'remote_component' as never }).ok).toBe(false);
    expect(validateItemTypeConfig({ ...config, section_compatibility: ['Speaking'] as never }).ok).toBe(false);
  });
});

describe('R007.3 stable dynamic Item identity', () => {
  it('creates R1 then R2 without pre-creating future items or copying answers', () => {
    const initial = createDynamicSession({ ...sessionInput, selected_sections: ['Reading'] });
    const type = getItemTypePreset('Reading', 'reading_single_choice');
    const first = createDynamicItem(initial, 'Reading', type, '2026-08-03T00:00:01.000Z');
    const answered = {
      ...first.session,
      answers: {
        R1: {
          question_id: 'R1',
          answer_value: 'B',
          progress_status: 'ANSWERED' as const,
          status: 'ANSWERED' as const,
          is_overtime: false,
          is_skipped: false,
          is_uncertain: false,
          active_time_ms: 1,
          total_active_ms: 1,
          modification_count: 1,
          revision_count: 1,
          marked_review: false,
          last_changed_at: '2026-08-03T00:00:02.000Z',
          updated_at: '2026-08-03T00:00:02.000Z'
        }
      }
    };
    const second = createDynamicItem(answered, 'Reading', first.item.type_config, '2026-08-03T00:00:03.000Z');

    expect(first.item.item_id).toBe('R1');
    expect(second.item.item_id).toBe('R2');
    expect(second.session.questions.map((item) => item.id)).toEqual(['R1', 'R2']);
    expect(second.session.dynamic_sections[0]).toMatchObject({
      item_ids: ['R1', 'R2'],
      next_item_ordinal: 3
    });
    expect(second.session.answers.R1?.answer_value).toBe('B');
    expect(second.session.answers.R2).toBeUndefined();
  });
});
