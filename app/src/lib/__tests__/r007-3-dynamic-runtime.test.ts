import { describe, expect, it } from 'vitest';
import type { AnswerRecord } from '../../types';
import {
  changeDynamicItemType,
  createDynamicItem,
  createDynamicSession,
  enterDynamicItem,
  finishDynamicSection,
  getDynamicNextAction,
  inspectDynamicSectionCompletion,
  reopenDynamicSection
} from '../dynamicSession';
import { createCustomItemType, getItemTypePreset } from '../itemTypeRegistry';

function base(mode: 'practice' | 'exam_simulation' = 'practice') {
  return createDynamicSession({
    session_id: `dynamic-${mode}`,
    package_id: '01.21.A.1',
    source_relative_path: 'readonly',
    mode,
    selected_sections: ['Reading', 'Listening', 'Writing'],
    created_at: '2026-08-03T01:00:00.000Z'
  });
}

function answer(questionId: string, value: unknown, flags: Partial<AnswerRecord> = {}): AnswerRecord {
  return {
    question_id: questionId,
    answer_value: value,
    progress_status: value === null || value === '' || (Array.isArray(value) && value.length === 0)
      ? 'ENCOUNTERED_UNANSWERED'
      : 'ANSWERED',
    status: value === null || value === '' || (Array.isArray(value) && value.length === 0)
      ? 'ENCOUNTERED_UNANSWERED'
      : 'ANSWERED',
    is_overtime: false,
    is_skipped: false,
    is_uncertain: false,
    active_time_ms: 10,
    total_active_ms: 10,
    modification_count: 1,
    revision_count: 1,
    marked_review: false,
    last_changed_at: '2026-08-03T01:00:10.000Z',
    updated_at: '2026-08-03T01:00:10.000Z',
    ...flags
  };
}

describe('R007.3 dynamic navigation', () => {
  it('navigates to an existing next Item and requests creation only at the last Item', () => {
    const type = getItemTypePreset('Reading', 'reading_single_choice');
    const first = createDynamicItem(base(), 'Reading', type).session;
    const second = createDynamicItem(first, 'Reading', type).session;
    const atFirst = enterDynamicItem(second, 'R1', 'answer_card');

    const existing = getDynamicNextAction(atFirst);
    expect(existing.kind).toBe('NAVIGATED');
    if (existing.kind === 'NAVIGATED') expect(existing.session.current_question_id).toBe('R2');

    expect(getDynamicNextAction(second)).toEqual({
      kind: 'CREATE_REQUIRED',
      section_id: 'Reading',
      next_ordinal: 3
    });
  });

  it('lets Practice return to any created Item and keeps Simulation Listening linear without Module locks', () => {
    const type = getItemTypePreset('Listening', 'listening_single_choice');
    const practiceL1 = createDynamicItem(base(), 'Listening', type).session;
    const practiceL2 = createDynamicItem(practiceL1, 'Listening', type).session;
    expect(enterDynamicItem(practiceL2, 'L1', 'answer_card').current_question_id).toBe('L1');

    const simulationL1 = createDynamicItem(base('exam_simulation'), 'Listening', type).session;
    const simulationL2 = createDynamicItem(simulationL1, 'Listening', type).session;
    expect(enterDynamicItem(simulationL2, 'L1', 'answer_card').current_question_id).toBe('L2');
    expect(simulationL2.modules).toEqual([]);
  });
});

describe('R007.3 user-driven Section completion', () => {
  it('checks only created unanswered/skipped/uncertain Items and completes after explicit confirmation', () => {
    const type = getItemTypePreset('Reading', 'reading_single_choice');
    const first = createDynamicItem(base(), 'Reading', type).session;
    const second = createDynamicItem(first, 'Reading', type).session;
    const withAnswers = {
      ...second,
      answers: {
        R1: answer('R1', 'B', { is_uncertain: true, marked_review: true }),
        R2: answer('R2', null, { is_skipped: true })
      }
    };

    expect(inspectDynamicSectionCompletion(withAnswers, 'Reading')).toEqual({
      created: 2,
      unanswered: ['R2'],
      skipped: ['R2'],
      uncertain: ['R1']
    });
    expect(finishDynamicSection(withAnswers, 'Reading', { confirmed: false }).ok).toBe(false);

    const finished = finishDynamicSection(withAnswers, 'Reading', {
      confirmed: true,
      now_iso: '2026-08-03T01:01:00.000Z'
    });
    expect(finished.ok).toBe(true);
    if (finished.ok) {
      expect(finished.session.dynamic_sections[0].status).toBe('COMPLETED');
      expect(finished.session.current_section_id).toBe('Listening');
      expect(finished.session.current_question_id).toBe('');
    }
  });

  it('skips an empty Section without creating a fake Item and can reopen without renumbering', () => {
    const blocked = finishDynamicSection(base(), 'Reading', { confirmed: false });
    expect(blocked).toMatchObject({ ok: false, reason: 'CONFIRM_EMPTY' });
    const skipped = finishDynamicSection(base(), 'Reading', {
      confirmed: true,
      now_iso: '2026-08-03T01:02:00.000Z'
    });
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;
    expect(skipped.session.questions).toEqual([]);
    expect(skipped.session.dynamic_sections[0].status).toBe('SKIPPED_EMPTY');

    const reopened = reopenDynamicSection(skipped.session, 'Reading', '2026-08-03T01:03:00.000Z');
    expect(reopened.dynamic_sections[0]).toMatchObject({ status: 'IN_PROGRESS', next_item_ordinal: 1 });
  });
});

describe('R007.3 dynamic type changes', () => {
  it('requires confirmation and clears an incompatible answer without silently converting it', () => {
    const initial = createDynamicItem(base(), 'Reading', getItemTypePreset('Reading', 'reading_single_choice')).session;
    const answered = { ...initial, answers: { R1: answer('R1', 'B') } };
    const textType = createCustomItemType({
      section: 'Reading',
      type_label: '改为短文本',
      renderer: 'short_text'
    });

    expect(changeDynamicItemType(answered, 'R1', textType, { confirm_clear: false })).toMatchObject({
      ok: false,
      reason: 'ANSWER_CLEAR_CONFIRMATION_REQUIRED'
    });
    const changed = changeDynamicItemType(answered, 'R1', textType, {
      confirm_clear: true,
      now_iso: '2026-08-03T01:04:00.000Z'
    });
    expect(changed.ok).toBe(true);
    if (changed.ok) {
      expect(changed.session.questions[0]).toMatchObject({ renderer: 'short_text', type_label: '改为短文本' });
      expect(changed.session.answers.R1?.answer_value).toBeNull();
      expect(changed.answer_cleared).toBe(true);
    }
  });

  it('requires confirmation when edited choice labels no longer contain the existing answer', () => {
    const initial = createDynamicItem(base(), 'Reading', getItemTypePreset('Reading', 'reading_single_choice')).session;
    const answered = { ...initial, answers: { R1: answer('R1', 'D') } };
    const narrowed = createCustomItemType({
      section: 'Reading',
      type_label: 'Narrow choice labels',
      renderer: 'single_choice',
      option_labels: ['A', 'B']
    });

    expect(changeDynamicItemType(answered, 'R1', narrowed, { confirm_clear: false })).toMatchObject({
      ok: false,
      reason: 'ANSWER_CLEAR_CONFIRMATION_REQUIRED'
    });
  });
});
