import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnswerRecord, PracticeSession, TypingSnapshot } from '../../types';
import { DEFAULT_BLUEPRINT, type BlueprintQuestionSlot } from '../blueprint';
import { exportTypingRecord } from '../exporters';
import { prepareRecoverySession } from '../recovery';
import { buildInitialSessionRuntime, createDefaultQuestions } from '../sessionEngine';

const storageMocks = vi.hoisted(() => ({
  writeRecordIndex: vi.fn(async () => undefined)
}));

vi.mock('../storage', () => ({
  exportSessionTextAtomic: vi.fn(async () => undefined),
  exportTextAtomic: vi.fn(async () => undefined),
  writeRecordIndex: storageMocks.writeRecordIndex
}));

function typingSnapshot(): TypingSnapshot {
  return {
    text: 'draft remains intact',
    active_ms: 135_114.29999999888,
    paused_ms: 411.90000000037253,
    retained_letters: 18,
    retained_words: 3,
    retained_characters: 20,
    retained_typed_characters: 20,
    retained_spaces: 2,
    retained_line_breaks: 0,
    retained_typed_letters: 18,
    keyboard_inserted_characters: 20,
    keyboard_inserted_letters: 18,
    deleted_characters: 0,
    deleted_letters: 0,
    pasted_characters: 0,
    pasted_letters: 0,
    paste_count: 0,
    retention_accuracy: 100,
    net_cpm: 8.7,
    gross_cpm: 8.8,
    actual_wpm: 1.5,
    standard_wpm: 1.74
  };
}

function recoverySnapshot(): PracticeSession {
  return buildInitialSessionRuntime({
    session_schema_version: 5,
    session_id: 'synthetic-nullable-recovery',
    package_id: 'Synthetic.01.A.1',
    source_path: 'readonly-fixture',
    mode: 'practice',
    timing_profile_id: 'toefl-2026-practice',
    timing_profile_version: '1.0.0',
    blueprint_id: DEFAULT_BLUEPRINT.blueprint_id,
    blueprint_version: DEFAULT_BLUEPRINT.version,
    created_at: '2026-07-14T00:00:00.000Z',
    active_ms: 0,
    paused_ms: 0,
    questions: createDefaultQuestions(['Reading', 'Writing', 'Speaking']),
    answers: {},
    modules: [],
    view: 'PRACTICE'
  });
}

function answerFixture(
  questionId: string,
  overrides: Partial<AnswerRecord> = {}
): AnswerRecord {
  return {
    question_id: questionId,
    answer_value: '',
    progress_status: 'ENCOUNTERED_UNANSWERED',
    status: 'ENCOUNTERED_UNANSWERED',
    is_overtime: false,
    is_skipped: false,
    is_uncertain: false,
    first_answer_elapsed_ms: null,
    active_time_ms: 0,
    total_active_ms: 0,
    modification_count: 0,
    revision_count: 0,
    marked_review: false,
    last_changed_at: '2026-07-17T01:52:56.517Z',
    updated_at: '2026-07-17T01:52:56.517Z',
    ...overrides
  } as AnswerRecord;
}

beforeEach(() => vi.clearAllMocks());

describe('R006.1 persisted milliseconds boundary', () => {
  it('normalizes the Typing snapshot before every file and the Rust i64 record-index boundary', async () => {
    const snapshot = typingSnapshot();
    await exportTypingRecord('typing-1784000000000', snapshot, [], async () => undefined);

    expect(storageMocks.writeRecordIndex).toHaveBeenCalledWith(expect.objectContaining({
      active_time_ms: 135_114,
      pause_time_ms: 412
    }));
  });
});

describe('R006.1 Recovery nullable milliseconds', () => {
  it.each(['time_limit_ms', 'remaining_ms', 'timer_limit_ms'] as const)(
    'accepts explicit null at questions.0.%s',
    (field) => {
      const value = recoverySnapshot();
      (value.questions[0] as unknown as Record<string, unknown>)[field] = null;
      const prepared = prepareRecoverySession(value, [DEFAULT_BLUEPRINT.blueprint_id]);
      expect(prepared.ok).toBe(true);
      if (prepared.ok) expect((prepared.session.questions[0] as unknown as Record<string, unknown>)[field]).toBeNull();
    }
  );

  it('preserves nullable Task limit/remaining without turning null into zero', () => {
    const value = recoverySnapshot();
    const sr1 = value.tasks.find((task) => task.task_id === 'SR1');
    if (!sr1) throw new Error('missing synthetic SR1');
    sr1.timer_limit_ms = null;
    sr1.remaining_ms = null;
    const prepared = prepareRecoverySession(value, [DEFAULT_BLUEPRINT.blueprint_id]);
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.session.tasks.find((task) => task.task_id === 'SR1')).toMatchObject({
        timer_limit_ms: null,
        remaining_ms: null
      });
    }
  });

  it('rejects null in a required Session accumulator instead of silently coercing it to zero', () => {
    const value = recoverySnapshot();
    value.active_ms = null as never;
    expect(prepareRecoverySession(value, [DEFAULT_BLUEPRINT.blueprint_id])).toMatchObject({
      ok: false,
      code: 'INVALID_SNAPSHOT'
    });
  });

  it('rejects null in required Task active_time_ms', () => {
    const value = recoverySnapshot();
    value.tasks[0].active_time_ms = null as never;
    expect(prepareRecoverySession(value, [DEFAULT_BLUEPRINT.blueprint_id])).toMatchObject({
      ok: false,
      code: 'INVALID_SNAPSHOT'
    });
  });

  it('preserves an old Snapshot Blueprint identity instead of rewriting it to the new default', () => {
    const value = recoverySnapshot();
    value.blueprint_id = 'toefl-2026-default-question-blueprint';
    value.blueprint_version = '1.0.0';
    const prepared = prepareRecoverySession(value, [DEFAULT_BLUEPRINT.blueprint_id]);
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.session).toMatchObject({
        blueprint_id: 'toefl-2026-default-question-blueprint',
        blueprint_version: '1.0.0'
      });
    }
  });
});

describe('R006.1.1 Answer nullable lifecycle milliseconds', () => {
  it.each([4, 5])('restores a schema v%s answered Writing Answer with explicit null', (schemaVersion) => {
    const value = recoverySnapshot();
    value.session_schema_version = schemaVersion as PracticeSession['session_schema_version'];
    value.answers['Writing-12'] = answerFixture('Writing-12', {
      answer_value: 'x',
      progress_status: 'ANSWERED',
      status: 'ANSWERED',
      first_answer_elapsed_ms: null,
      first_answer_at: '2026-07-17T01:52:56.517Z',
      active_time_ms: 3_003,
      total_active_ms: 3_003
    } as Partial<AnswerRecord>);

    const prepared = prepareRecoverySession(value, [DEFAULT_BLUEPRINT.blueprint_id]);
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.session.answers['Writing-12']).toMatchObject({
        answer_value: 'x',
        progress_status: 'ANSWERED',
        first_answer_elapsed_ms: null,
        first_answer_at: '2026-07-17T01:52:56.517Z',
        active_time_ms: 3_003
      });
    }
  });

  it.each([
    ['Reading-1', ''],
    ['Speaking-1', { recording_status: 'NOT_STARTED', attempts: [] }]
  ])('restores %s with explicit null without changing the Answer value', (questionId, answerValue) => {
    const value = recoverySnapshot();
    value.answers[questionId] = answerFixture(questionId, { answer_value: answerValue } as Partial<AnswerRecord>);
    const prepared = prepareRecoverySession(value, [DEFAULT_BLUEPRINT.blueprint_id]);
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.session.answers[questionId].first_answer_elapsed_ms).toBeNull();
      expect(prepared.session.answers[questionId].answer_value).toEqual(answerValue);
    }
  });

  it('accepts an omitted lifecycle field and a valid integer', () => {
    const omitted = recoverySnapshot();
    const omittedAnswer = answerFixture('Reading-1');
    delete (omittedAnswer as Partial<AnswerRecord>).first_answer_elapsed_ms;
    omitted.answers['Reading-1'] = omittedAnswer;
    const omittedResult = prepareRecoverySession(omitted, [DEFAULT_BLUEPRINT.blueprint_id]);
    expect(omittedResult.ok).toBe(true);
    if (omittedResult.ok) expect(omittedResult.session.answers['Reading-1'].first_answer_elapsed_ms).toBeUndefined();

    const integer = recoverySnapshot();
    integer.answers['Reading-1'] = answerFixture('Reading-1', { first_answer_elapsed_ms: 1_234 });
    const integerResult = prepareRecoverySession(integer, [DEFAULT_BLUEPRINT.blueprint_id]);
    expect(integerResult.ok).toBe(true);
    if (integerResult.ok) expect(integerResult.session.answers['Reading-1'].first_answer_elapsed_ms).toBe(1_234);
  });

  it('rounds a legacy finite decimal at the persistence boundary', () => {
    const value = recoverySnapshot();
    value.answers['Reading-1'] = answerFixture('Reading-1', { first_answer_elapsed_ms: 3_003.6 });
    const prepared = prepareRecoverySession(value, [DEFAULT_BLUEPRINT.blueprint_id]);
    expect(prepared.ok).toBe(true);
    if (prepared.ok) expect(prepared.session.answers['Reading-1'].first_answer_elapsed_ms).toBe(3_004);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid lifecycle elapsed %s', (invalid) => {
    const value = recoverySnapshot();
    value.answers['Reading-1'] = answerFixture('Reading-1', { first_answer_elapsed_ms: invalid });
    expect(prepareRecoverySession(value, [DEFAULT_BLUEPRINT.blueprint_id])).toMatchObject({
      ok: false,
      code: 'INVALID_SNAPSHOT'
    });
  });

  it('still rejects explicit null in required Answer active_time_ms', () => {
    const value = recoverySnapshot();
    value.answers['Writing-12'] = answerFixture('Writing-12', {
      active_time_ms: null as never,
      total_active_ms: null as never
    });
    expect(prepareRecoverySession(value, [DEFAULT_BLUEPRINT.blueprint_id])).toMatchObject({
      ok: false,
      code: 'INVALID_SNAPSHOT'
    });
  });
});

describe('R006.1 confirmed Reading Blueprint slots', () => {
  it('defines exactly 30 independent Complete the Words text slots in the confirmed ranges', () => {
    const reading = DEFAULT_BLUEPRINT.sections.find((section) => section.section_id === 'Reading');
    if (!reading) throw new Error('missing Reading section');
    const confirmedNumbers = [...Array.from({ length: 20 }, (_, index) => index + 1), ...Array.from({ length: 10 }, (_, index) => index + 36)];
    const slots = reading.question_slots.filter((slot) => confirmedNumbers.includes(slot.number));
    expect(slots).toHaveLength(30);
    expect(slots.every((slot) => slot.type_label === 'Complete the Words' && slot.answer_mode === 'text')).toBe(true);
    expect(new Set(slots.map((slot) => slot.slot_id)).size).toBe(30);
  });

  it('assigns the three confirmed passage groups without merging Question identities', () => {
    const reading = DEFAULT_BLUEPRINT.sections.find((section) => section.section_id === 'Reading');
    if (!reading) throw new Error('missing Reading section');
    const passageGroup = (slot: BlueprintQuestionSlot) =>
      (slot as BlueprintQuestionSlot & { passage_group_id?: string }).passage_group_id;
    expect(reading.question_slots.filter((slot) => slot.number >= 1 && slot.number <= 10).every((slot) => passageGroup(slot) === 'READING_M1_CTW_A')).toBe(true);
    expect(reading.question_slots.filter((slot) => slot.number >= 11 && slot.number <= 20).every((slot) => passageGroup(slot) === 'READING_M1_CTW_B')).toBe(true);
    expect(reading.question_slots.filter((slot) => slot.number >= 36 && slot.number <= 45).every((slot) => passageGroup(slot) === 'READING_M2_CTW_A')).toBe(true);
  });
});
