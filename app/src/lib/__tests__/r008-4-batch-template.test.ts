import { describe, expect, it } from 'vitest';
import { createDynamicItem, createDynamicItemBatch, createDynamicSession, enterDynamicItem, getDynamicNextAction, inspectDynamicSectionCompletion, validateDynamicSession } from '../dynamicSession';
import { createCustomItemType, getItemTypePreset } from '../itemTypeRegistry';
import { getBuiltInBatch } from '../itemBatchRegistry';
import { parseItemTemplates, resolveTemplateBlocks, validateItemTemplate } from '../itemTemplate';
import { prepareRecoverySession } from '../recovery';
import { serializeSessionForPersistence } from '../persistedTime';
import { buildSessionExportBundle } from '../sessionExport';

const now = '2026-09-28T01:00:00.000Z';
const base = () => createDynamicSession({ session_id: 'batch-test', package_id: 'synthetic', source_relative_path: 'synthetic', mode: 'practice', selected_sections: ['Reading', 'Listening', 'Writing'], created_at: now });

describe('R008.4 batch engine', () => {
  it('keeps count one equivalent to single item creation', () => {
    const config = getItemTypePreset('Reading', 'reading_single_choice');
    expect(createDynamicItemBatch(base(), 'Reading', [{ config, count: 1 }], now).session)
      .toEqual(createDynamicItem(base(), 'Reading', config, now).session);
  });

  it.each([
    ['reading_word_blank_10', 'Reading', 10, 'reading_word_blank', 'short_text'],
    ['reading_academic_5', 'Reading', 5, 'reading_academic_single_choice', 'single_choice'],
    ['listening_academic_lecture_4', 'Listening', 4, 'listening_academic_lecture_single_choice', 'single_choice'],
    ['writing_build_sentence_10', 'Writing', 10, 'writing_build_sentence', 'short_text']
  ] as const)('creates %s with one entered item', (id, section, count, typeId, renderer) => {
    const definition = getBuiltInBatch(id);
    expect(definition).toMatchObject({ section, count, type_id: typeId });
    const created = createDynamicItemBatch(base(), section, [{ config: getItemTypePreset(section, typeId), count }], now);
    expect(created.items).toHaveLength(count);
    expect(created.items.every((item) => item.renderer === renderer)).toBe(true);
    expect(created.items[0]).toMatchObject({ encountered: true, visit_count: 1, started_at: now });
    for (const item of created.items.slice(1)) {
      expect(item).toMatchObject({ encountered: false, visit_count: 0, started_at: null });
      expect(item.first_seen_at).toBeUndefined();
      expect(item.last_entered_at).toBeUndefined();
    }
    expect(created.session.dynamic_sections.find((entry) => entry.section_id === section)?.next_item_ordinal).toBe(count + 1);
    expect(validateDynamicSession(created.session).ok).toBe(true);
    expect(prepareRecoverySession(JSON.stringify(created.session), [])).toMatchObject({ ok: true });
  });

  it('allocates sequential identities across ordered blocks and navigates until creation is needed', () => {
    const result = createDynamicItemBatch(base(), 'Reading', [
      { config: getItemTypePreset('Reading', 'reading_word_blank'), count: 10 },
      { config: getItemTypePreset('Reading', 'reading_academic_single_choice'), count: 5 }
    ], now);
    expect(result.items.map((item) => item.id)).toEqual(Array.from({ length: 15 }, (_, i) => `R${i + 1}`));
    let session = result.session;
    for (let i = 2; i <= 15; i++) {
      const next = getDynamicNextAction(session);
      expect(next.kind).toBe('NAVIGATED');
      if (next.kind !== 'NAVIGATED') return;
      session = next.session;
      expect(session.current_question_id).toBe(`R${i}`);
    }
    expect(getDynamicNextAction(session)).toMatchObject({ kind: 'CREATE_REQUIRED', next_ordinal: 16 });
    expect(inspectDynamicSectionCompletion(result.session, 'Reading').unanswered).toHaveLength(15);
  });

  it('rejects invalid count, identity collision, and registry conflict without mutating source', () => {
    const source = base();
    const config = getItemTypePreset('Reading', 'reading_word_blank');
    for (const count of [0, 101, 1.5]) {
      expect(() => createDynamicItemBatch(source, 'Reading', [{ config, count }], now)).toThrow();
    }
    const collision = { ...source, questions: [{ ...createDynamicItem(source, 'Reading', config, now).item }] };
    expect(() => createDynamicItemBatch(collision, 'Reading', [{ config, count: 10 }], now)).toThrow();
    const conflict = { ...config, type_label: 'conflicting label' };
    expect(() => createDynamicItemBatch(source, 'Reading', [{ config: conflict, count: 2 }], now)).toThrow();
    expect(source.questions).toEqual([]);
    expect(source.dynamic_sections[0].next_item_ordinal).toBe(1);
  });

  it('preserves existing answers, deduplicates registry and initializes future lifecycle on entry', () => {
    const config = getItemTypePreset('Reading', 'reading_word_blank');
    const first = createDynamicItem(base(), 'Reading', config, now).session;
    const batch = createDynamicItemBatch(first, 'Reading', [{ config, count: 3 }], now);
    expect(batch.created_item_ids).toEqual(['R2', 'R3', 'R4']);
    expect(batch.session.item_type_registry.filter((entry) => entry.type_id === config.type_id)).toHaveLength(1);
    const returned = enterDynamicItem(batch.session, 'R3', 'answer_card', now);
    expect(returned.questions.find((item) => item.id === 'R3')).toMatchObject({ encountered: true, visit_count: 1, started_at: now, first_seen_at: now, last_entered_at: now });
    expect(returned.questions.find((item) => item.id === 'R4')).toMatchObject({ encountered: false, visit_count: 0, started_at: null });
  });

  it('prevents exam Listening from jumping to later pre-created items', () => {
    const session = createDynamicSession({ session_id: 'exam', package_id: 'synthetic', source_relative_path: 'synthetic', mode: 'exam_simulation', selected_sections: ['Listening'], created_at: now });
    const batch = createDynamicItemBatch(session, 'Listening', [{ config: getItemTypePreset('Listening', 'listening_academic_lecture_single_choice'), count: 4 }], now);
    expect(enterDynamicItem(batch.session, 'L4', 'answer_card', now)).toBe(batch.session);
    expect(getDynamicNextAction(batch.session).kind).toBe('NAVIGATED');
  });

  it('round-trips mixed batches through Recovery and exports every Item without template data', () => {
    let session = base();
    for (const [section, typeId, count] of [
      ['Reading', 'reading_word_blank', 10], ['Reading', 'reading_academic_single_choice', 5],
      ['Listening', 'listening_academic_lecture_single_choice', 4], ['Writing', 'writing_build_sentence', 10]
    ] as const) session = createDynamicItemBatch(session, section, [{ config: getItemTypePreset(section, typeId), count }], now).session;
    const recovered = prepareRecoverySession(JSON.stringify(serializeSessionForPersistence(session)), []);
    expect(recovered).toMatchObject({ ok: true, migrated: false });
    if (!recovered.ok) return;
    expect(recovered.session.questions.map((item) => item.id)).toEqual(session.questions.map((item) => item.id));
    expect(recovered.session.questions.find((item) => item.id === 'R2')).toMatchObject({ encountered: false, visit_count: 0, started_at: null });
    expect(recovered.session.dynamic_sections?.map((entry) => entry.next_item_ordinal)).toEqual([16, 5, 11]);
    const files = buildSessionExportBundle(session, []).files;
    expect(files['item_metrics.csv'].trim().split('\n')).toHaveLength(30);
    expect(files['item_metrics.csv'].indexOf(',R10,')).toBeLessThan(files['item_metrics.csv'].indexOf(',R11,'));
    expect(Object.values(files).join('\n')).not.toContain('item_templates');
  });
});

describe('R008.4 template validation', () => {
  it('accepts ordered blocks and rejects wrong sections or excessive totals', () => {
    const template = { template_id: 'sample', name: 'Sample', section: 'Reading' as const, blocks: [
      { source: 'system_preset' as const, type_id: 'reading_word_blank', count: 10 },
      { source: 'system_preset' as const, type_id: 'reading_academic_single_choice', count: 5 }
    ] };
    expect(validateItemTemplate(template).ok).toBe(true);
    expect(validateItemTemplate({ ...template, section: 'Listening' }).ok).toBe(false);
    expect(validateItemTemplate({ ...template, blocks: [{ ...template.blocks[0], count: 101 }] }).ok).toBe(false);
  });

  it('returns empty for absent settings and reports corrupt settings without rewriting them', () => {
    expect(parseItemTemplates(undefined)).toEqual({ collection: { schema_version: 1, templates: [] } });
    expect(parseItemTemplates({ schema_version: 99, templates: [] }).error).toBeTruthy();
    expect(parseItemTemplates({ schema_version: 1, templates: [{ template_id: 'x', name: 'X', section: 'Reading',
      blocks: [{ source: 'system_preset', type_id: 'reading_word_blank', count: 1, question_body: 'private' }] }] }).error).toBeTruthy();
  });

  it('loads existing duplicate template names without deleting or rewriting them', () => {
    const old = { template_id: 'old', name: 'Existing', section: 'Reading',
      blocks: [{ source: 'system_preset', type_id: 'reading_word_blank', count: 2 }] };
    const parsed = parseItemTemplates({ schema_version: 1, templates: [old, { ...old, template_id: 'old-duplicate' }] });
    expect(parsed.error).toBeUndefined();
    expect(parsed.collection.templates).toHaveLength(2);
  });

  it('applies an ordered system and custom template as one candidate', () => {
    const config = createCustomItemType({ section: 'Reading', type_label: 'Synthetic short text', renderer: 'short_text' });
    const template = { template_id: 'mixed', name: 'Mixed', section: 'Reading' as const, blocks: [
      { source: 'system_preset' as const, type_id: 'reading_word_blank', count: 2 },
      { source: 'custom_config' as const, config, count: 3 }
    ] };
    const blocks = resolveTemplateBlocks(template);
    const result = createDynamicItemBatch(base(), template.section, blocks, now);
    expect(result.items.map((item) => item.type_id)).toEqual(['reading_word_blank', 'reading_word_blank', config.type_id, config.type_id, config.type_id]);
    expect(result.session.item_type_registry.filter((entry) => entry.type_id === config.type_id)).toHaveLength(1);
    expect(JSON.stringify(result.session)).not.toContain('template_id');
    const invalid = { ...blocks[1], config: { ...config, type_id: 'reading_word_blank' } };
    const source = base();
    expect(() => createDynamicItemBatch(source, 'Reading', [blocks[0], invalid], now)).toThrow(/Registry conflict/);
    expect(source.questions).toHaveLength(0);
  });
});
