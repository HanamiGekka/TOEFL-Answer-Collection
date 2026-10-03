import { describe, expect, it } from 'vitest';
import {
  createDynamicItem,
  createDynamicSession,
  finishDynamicSection,
  reopenDynamicSection,
  validateDynamicSession,
  type DynamicPracticeSession
} from '../dynamicSession';
import { createCustomItemType, getItemTypePreset } from '../itemTypeRegistry';
import { serializeSessionForPersistence } from '../persistedTime';
import { prepareRecoverySession } from '../recovery';
import { buildSessionExportBundle } from '../sessionExport';
import type { AnswerRecord, DynamicSectionName } from '../../types';

const NOW = '2026-09-27T00:00:00.000Z';

function fresh(): DynamicPracticeSession {
  return createDynamicSession({
    session_id: 'synthetic-r0081', package_id: 'Synthetic.01',
    source_relative_path: 'Synthetic.01', mode: 'practice',
    selected_sections: ['Reading', 'Listening', 'Writing'], created_at: NOW
  });
}

function recover(session: DynamicPracticeSession) {
  return prepareRecoverySession(JSON.stringify(serializeSessionForPersistence(session)));
}

function syntheticAnswer(itemId: string, value: string): AnswerRecord {
  return {
    question_id: itemId, answer_value: value, progress_status: 'ANSWERED', status: 'ANSWERED',
    is_overtime: false, is_skipped: false, is_uncertain: false,
    active_time_ms: 1000, total_active_ms: 1000,
    modification_count: 1, revision_count: 1, marked_review: false,
    last_changed_at: NOW, updated_at: NOW
  };
}

function add(session: DynamicPracticeSession, section: DynamicSectionName) {
  const presetId = section === 'Reading' ? 'reading_single_choice'
    : section === 'Listening' ? 'listening_single_choice' : 'writing_email';
  return createDynamicItem(session, section, getItemTypePreset(section, presetId), NOW).session;
}

function finish(session: DynamicPracticeSession, section: DynamicSectionName) {
  const result = finishDynamicSection(session, section, { confirmed: true, now_iso: NOW });
  if (!result.ok) throw new Error('Synthetic section did not finish');
  return result.session;
}

describe('R008.1 H01 item type identity and recovery', () => {
  it('keeps equal configs deterministic and separates time, label, renderer, section, and options', () => {
    const base = { section: 'Reading' as const, type_label: 'Synthetic item', renderer: 'short_text' as const };
    const sixty = createCustomItemType({ ...base, custom_time_limit_ms: 60_000 });
    expect(createCustomItemType({ ...base, custom_time_limit_ms: 60_000 }).type_id).toBe(sixty.type_id);
    expect(createCustomItemType({ ...base, custom_time_limit_ms: 120_000 }).type_id).not.toBe(sixty.type_id);
    expect(createCustomItemType({ ...base, type_label: 'Other' }).type_id).not.toBe(sixty.type_id);
    expect(createCustomItemType({ ...base, renderer: 'long_text' }).type_id).not.toBe(sixty.type_id);
    expect(createCustomItemType({ ...base, section: 'Listening' }).type_id).not.toBe(sixty.type_id);
    const choice = createCustomItemType({ ...base, renderer: 'single_choice', option_labels: ['A', 'B'] });
    expect(createCustomItemType({ ...base, renderer: 'single_choice', option_labels: ['A', 'C'] }).type_id)
      .not.toBe(choice.type_id);
    expect(sixty.type_id).not.toBe(getItemTypePreset('Reading', 'reading_word_blank').type_id);
  });

  it('recovers two same-label items with different limits and retains an existing v6 custom ID', () => {
    const base = { section: 'Reading' as const, type_label: 'Synthetic blank', renderer: 'short_text' as const };
    const old = createCustomItemType({ ...base, custom_time_limit_ms: 60_000 });
    const oldId = old.type_id;
    let session = createDynamicItem(fresh(), 'Reading', old, NOW).session;
    session = createDynamicItem(session, 'Reading', createCustomItemType({ ...base, custom_time_limit_ms: 120_000 }), NOW).session;
    expect(new Set(session.item_type_registry.map((config) => config.type_id)).size).toBe(session.item_type_registry.length);
    expect(validateDynamicSession(session)).toEqual({ ok: true, errors: [] });
    const restored = recover(session);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.session.questions.map((item) => item.type_id)).toEqual([oldId, session.questions[1].type_id]);
    expect(restored.session.session_schema_version).toBe(6);
    expect(validateDynamicSession({
      ...session, item_type_registry: [...session.item_type_registry, session.item_type_registry.at(-1)!]
    }).errors).toContain(`Duplicate Registry type identity: ${session.item_type_registry.at(-1)!.type_id}.`);
  });

  it('reads an existing unsuffixed v6 custom ID without rewriting its snapshot identity', () => {
    const type = { ...createCustomItemType({
      section: 'Reading', type_label: 'Old synthetic', renderer: 'short_text', custom_time_limit_ms: 60_000
    }), type_id: 'custom_short_text_legacy' };
    const session = createDynamicItem(fresh(), 'Reading', type, NOW).session;
    const restored = recover(session);
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.session.questions[0].type_id).toBe(type.type_id);
  });
});

describe('R008.1 H02 section membership independent of physical array order', () => {
  it('recovers R1 L1 W1 then reopened Reading R2 without reordering creation events', () => {
    let session = add(fresh(), 'Reading');
    session = finish(session, 'Reading');
    session = add(session, 'Listening');
    session = finish(session, 'Listening');
    session = add(session, 'Writing');
    session = finish(session, 'Writing');
    session = reopenDynamicSection(session, 'Reading', NOW);
    session = add(session, 'Reading');
    session = { ...session, answers: { R1: syntheticAnswer('R1', 'B'), L1: syntheticAnswer('L1', 'A') } };
    expect(session.questions.map((item) => item.id)).toEqual(['R1', 'L1', 'W1', 'R2']);
    expect(session.dynamic_sections.map((section) => [section.item_ids, section.next_item_ordinal])).toEqual([
      [['R1', 'R2'], 3], [['L1'], 2], [['W1'], 2]
    ]);
    expect(validateDynamicSession(session)).toEqual({ ok: true, errors: [] });
    const restored = recover(session);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.session.questions.map((item) => item.id)).toEqual(['R1', 'L1', 'W1', 'R2']);
    expect(restored.session.current_question_id).toBe('R2');
    expect(restored.session.current_question_index).toBe(3);
    expect(restored.session.answers.R1.answer_value).toBe('B');
    expect(restored.session.answers.L1.answer_value).toBe('A');
    const exported = JSON.parse(buildSessionExportBundle(restored.session, []).files['answers.json']);
    expect(exported.items.map((item: { item_id: string }) => item.item_id)).toEqual(['R1', 'R2', 'L1', 'W1']);
  });

  it('recovers mixed R1 L1 W1 R2 L2 W2 and still rejects duplicate membership', () => {
    let session = fresh();
    for (const section of ['Reading', 'Listening', 'Writing'] as const) {
      session = finish(add(session, section), section);
    }
    for (const section of ['Reading', 'Listening', 'Writing'] as const) {
      session = reopenDynamicSection(session, section, NOW);
      session = add(session, section);
      session = finish(session, section);
    }
    expect(session.questions.map((item) => item.id)).toEqual(['R1', 'L1', 'W1', 'R2', 'L2', 'W2']);
    expect(session.dynamic_sections.map((section) => section.item_ids)).toEqual([
      ['R1', 'R2'], ['L1', 'L2'], ['W1', 'W2']
    ]);
    expect(recover(session).ok).toBe(true);
    expect(validateDynamicSession({ ...session, questions: [...session.questions, session.questions[0]] }).ok).toBe(false);
  });

  it('rejects an Item whose declared Section disagrees with its owning item_ids', () => {
    let session = add(fresh(), 'Reading');
    session = add(session, 'Listening');
    const listeningType = getItemTypePreset('Listening', 'listening_single_choice');
    const mismatched = {
      ...session,
      questions: session.questions.map((item) => item.id === 'R1' ? {
        ...item, section: 'Listening' as const, section_id: 'Listening' as const,
        module_id: 'Listening' as const, type_id: listeningType.type_id, type_label: listeningType.type_label,
        renderer: listeningType.renderer, answer_mode: listeningType.renderer,
        type_config: listeningType
      } : item)
    };
    expect(validateDynamicSession(mismatched).ok).toBe(false);
  });
});
