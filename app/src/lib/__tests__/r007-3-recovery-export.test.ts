import { describe, expect, it } from 'vitest';
import type { AnswerRecord, PracticeSession } from '../../types';
import {
  createDynamicItem,
  createDynamicSession,
  type DynamicPracticeSession,
  updateDynamicWritingText,
  validateDynamicSession
} from '../dynamicSession';
import { createCustomItemType, getItemTypePreset } from '../itemTypeRegistry';
import { serializeSessionForPersistence } from '../persistedTime';
import { prepareRecoverySession } from '../recovery';
import { buildSessionExportBundle } from '../sessionExport';
import { buildInitialSessionRuntime, createDefaultQuestions } from '../sessionEngine';
import { buildSessionRecordIndex } from '../exporters';

const NOW = '2026-08-03T02:00:00.000Z';

function answer(
  itemId: string,
  answerValue: string | string[],
  overrides: Partial<AnswerRecord> = {}
): AnswerRecord {
  return {
    question_id: itemId,
    answer_value: answerValue,
    progress_status: 'ANSWERED',
    status: 'ANSWERED',
    is_overtime: false,
    is_skipped: false,
    is_uncertain: false,
    first_answer_elapsed_ms: 1000,
    final_answer_elapsed_ms: 2000,
    active_time_ms: 2000,
    total_active_ms: 2000,
    modification_count: 1,
    revision_count: 1,
    marked_review: false,
    first_answer_at: NOW,
    last_changed_at: NOW,
    updated_at: NOW,
    ...overrides
  };
}

function dynamicFixture(): DynamicPracticeSession {
  let session = createDynamicSession({
    session_id: 'r0073-recovery-export',
    package_id: 'Mock.01.A.1',
    source_path: 'readonly-package-metadata',
    mode: 'practice',
    selected_sections: ['Reading', 'Listening', 'Writing'],
    created_at: NOW
  });
  session = createDynamicItem(
    session,
    'Reading',
    getItemTypePreset('Reading', 'reading_single_choice'),
    NOW
  ).session;
  session = createDynamicItem(
    session,
    'Reading',
    getItemTypePreset('Reading', 'reading_short_text'),
    NOW
  ).session;
  session = createDynamicItem(
    session,
    'Listening',
    createCustomItemType({
      section: 'Listening',
      type_label: 'Ordered multi',
      renderer: 'multiple_choice',
      option_labels: ['A', 'C', 'B'],
      custom_time_limit_ms: 30_000
    }),
    NOW
  ).session;
  session = createDynamicItem(
    session,
    'Writing',
    getItemTypePreset('Writing', 'writing_email'),
    NOW
  ).session;
  session = updateDynamicWritingText(
    session,
    'W1',
    'Private draft entered by the user.',
    'insertText',
    4000
  ).session;
  return {
    ...session,
    active_ms: 10_000,
    paused_ms: 900,
    dynamic_sections: session.dynamic_sections.map((section) => ({
      ...section,
      pause_time_ms: section.section_id === 'Reading' ? 900 : 0
    })),
    questions: session.questions.map((item) => ({
      ...item,
      pause_time_ms: item.id === 'R1' ? 900 : 0
    })),
    answers: {
      R1: answer('R1', 'C', { is_uncertain: true }),
      L1: answer('L1', ['C', 'A'], { is_overtime: true, active_time_ms: 31_000, total_active_ms: 31_000 }),
      W1: answer('W1', 'Private draft entered by the user.', { active_time_ms: 4000, total_active_ms: 4000 })
    },
    current_section_id: 'Writing',
    current_scope_id: 'Writing',
    current_module_id: 'Writing',
    current_section: 'Writing',
    current_question_id: 'W1',
    current_question_index: 3
  };
}

describe('R007.3 schema v6 Recovery', () => {
  it('keeps a new v6 source reference relative across snapshot, Recovery, export, and record index', () => {
    const sourceRoot = 'C:\\Synthetic\\PrivateSource';
    const session = createDynamicSession({
      session_id: 'r0083-relative-source',
      package_id: 'Mock.01.A.1',
      source_relative_path: 'Mock.01.A.1',
      mode: 'practice',
      selected_sections: ['Reading'],
      created_at: NOW
    });
    const persisted = serializeSessionForPersistence(session);
    expect(persisted.source_relative_path).toBe('Mock.01.A.1');
    expect(persisted.source_path).toBeUndefined();
    const prepared = prepareRecoverySession(JSON.stringify(persisted), []);
    expect(prepared.ok).toBe(true);
    const bundle = buildSessionExportBundle(session, []);
    const index = buildSessionRecordIndex(session, bundle.directory, Object.keys(bundle.files));
    for (const artifact of [persisted, prepared, bundle, index]) {
      expect(JSON.stringify(artifact)).not.toContain(sourceRoot);
      expect(JSON.stringify(artifact)).not.toMatch(/[A-Z]:\\\\[^"\\\\]+/i);
    }
  });

  it('round-trips dynamic identity, registry, answers, timing, options, ordinal, and long-text draft without Blueprint', () => {
    const persisted = serializeSessionForPersistence(dynamicFixture());
    const prepared = prepareRecoverySession(JSON.stringify(persisted), []);

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.migrated).toBe(false);
    expect(prepared.resume_policy).toEqual({ paused: true, reuse_monotonic_anchor: false });
    expect(validateDynamicSession(prepared.session as DynamicPracticeSession)).toEqual({ ok: true, errors: [] });
    expect(prepared.session).toMatchObject({
      session_schema_version: 6,
      structure_mode: 'dynamic_manual',
      modules: [],
      tasks: [],
      current_question_id: 'W1'
    });
    expect(prepared.session.blueprint_id).toBeUndefined();
    expect(prepared.session.dynamic_sections?.map((section) => [section.section_id, section.item_ids, section.next_item_ordinal])).toEqual([
      ['Reading', ['R1', 'R2'], 3],
      ['Listening', ['L1'], 2],
      ['Writing', ['W1'], 2]
    ]);
    expect(prepared.session.answers.L1.answer_value).toEqual(['C', 'A']);
    expect(prepared.session.questions.find((item) => item.id === 'L1')).toMatchObject({
      option_labels: ['A', 'C', 'B'],
      custom_time_limit_ms: 30_000
    });
    expect(prepared.session.questions.find((item) => item.id === 'W1')?.writing_state?.text)
      .toBe('Private draft entered by the user.');
  });

  it('rejects malformed v6 dynamic snapshots instead of falling through legacy migration', () => {
    const invalid = { ...dynamicFixture(), modules: [{ id: 'forbidden-module' }] };
    expect(prepareRecoverySession(invalid, [])).toMatchObject({ ok: false, code: 'INVALID_SNAPSHOT' });
  });
});

describe('R007.3 schema v6 exports', () => {
  it('uses only the dynamic export contract in stable Item order', () => {
    const bundle = buildSessionExportBundle(dynamicFixture(), []);
    expect(Object.keys(bundle.files).sort()).toEqual([
      'Listening.md',
      'Reading.md',
      'Writing.md',
      'answers.json',
      'events.jsonl',
      'item_metrics.csv',
      'section_metrics.csv',
      'session_summary.md'
    ]);
    expect(bundle.files).not.toHaveProperty('question_metrics.csv');
    expect(bundle.files).not.toHaveProperty('task_metrics.csv');
    expect(bundle.files).not.toHaveProperty('Speaking.md');

    const answers = JSON.parse(bundle.files['answers.json']) as Record<string, unknown>;
    expect(answers).toMatchObject({
      schema_version: 'practice-session-v6',
      structure_mode: 'dynamic_manual'
    });
    expect(answers).not.toHaveProperty('blueprint_id');
    expect(JSON.stringify(answers)).not.toMatch(/module_id|tasks|Speaking/);
    expect(JSON.stringify(answers)).toMatch(/item_id.*ordinal.*section_id.*type_id.*type_label.*renderer.*option_labels/s);

    const metrics = bundle.files['item_metrics.csv'];
    expect(metrics.split('\n')[0]).toBe([
      'session_id', 'package_id', 'section_id', 'item_id', 'ordinal', 'type_id', 'type_label',
      'renderer', 'option_count', 'answered', 'skipped', 'uncertain', 'overtime', 'active_time_ms',
      'pause_time_ms', 'first_answer_elapsed_ms', 'final_answer_elapsed_ms', 'answer_change_count'
    ].join(','));
    expect(metrics.indexOf(',R1,')).toBeLessThan(metrics.indexOf(',R2,'));
    expect(metrics.indexOf(',R2,')).toBeLessThan(metrics.indexOf(',L1,'));
    expect(bundle.files['Reading.md']).toMatch(/R1[\s\S]*Renderer: single_choice[\s\S]*Answer: C/);
    expect(bundle.files['Writing.md']).toContain('Private draft entered by the user.');
    expect(bundle.files['session_summary.md']).not.toMatch(/Module|Speaking/);
  });

  it('does not expose source paths, question bodies, standard answers, or source option text', () => {
    const combined = Object.values(buildSessionExportBundle(dynamicFixture(), []).files).join('\n');
    expect(combined).not.toContain('readonly-package-metadata');
    expect(combined).not.toMatch(/question[_ ]?body|correct[_ ]?answer|standard[_ ]?answer|audio[_ ]?(?:data|blob)/i);
  });

  it('marks the record index as v6 dynamic_manual with per-Section created counts', () => {
    const index = buildSessionRecordIndex(dynamicFixture(), 'records/mock/session', ['answers.json']);
    expect(index).toMatchObject({
      schema_version: 'practice-session-v6',
      structure_mode: 'dynamic_manual',
      section_item_counts: { Reading: 2, Listening: 1, Writing: 1 }
    });
    expect(index.selected_sections).toEqual(['Reading', 'Listening', 'Writing']);
    expect(index.legacy_label).toBeUndefined();
  });
});

describe('R007.3 legacy Recovery compatibility', () => {
  it('continues a schema v5 snapshot as legacy instead of converting it to dynamic Items', () => {
    const legacy = buildInitialSessionRuntime({
      session_schema_version: 5,
      session_id: 'legacy-v5',
      package_id: 'legacy-package',
      source_path: 'readonly',
      mode: 'practice',
      timing_profile_id: 'legacy',
      timing_profile_version: '1',
      blueprint_id: 'toefl-2026-default',
      blueprint_version: '1.3.0',
      created_at: NOW,
      active_ms: 0,
      paused_ms: 0,
      current_section: 'Speaking',
      current_question_index: 0,
      questions: createDefaultQuestions(['Speaking']),
      answers: {},
      modules: [],
      tasks: [],
      view: 'PRACTICE'
    } satisfies Partial<PracticeSession>);
    const prepared = prepareRecoverySession(legacy, ['toefl-2026-default']);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.session.session_schema_version).toBe(5);
    expect(prepared.session.structure_mode).toBeUndefined();
    expect(prepared.session.dynamic_sections).toBeUndefined();
    expect(prepared.migrated).toBe(false);
  });
});
