import { describe, expect, it } from 'vitest';
import { answerModeToInputControl, createDefaultQuestions, getQuestionBlueprint } from '../sessionEngine';

describe('question blueprint and input controls', () => {
  it('maps answer modes to explicit input controls', () => {
    expect(answerModeToInputControl('single_choice')).toBe('single_choice_buttons');
    expect(answerModeToInputControl('multiple_choice')).toBe('multiple_choice_controls');
    expect(answerModeToInputControl('text')).toBe('single_line_text');
    expect(answerModeToInputControl('long_text')).toBe('multi_line_text');
    expect(answerModeToInputControl('order')).toBe('order_input');
  });

  it('maps only the 30 confirmed Reading Complete the Words slots to text controls', () => {
    const reading = createDefaultQuestions(['Reading']);
    const textLikeCount = reading.filter((question) => answerModeToInputControl(question.answer_mode) === 'single_line_text').length;
    expect(reading).toHaveLength(50);
    expect(textLikeCount).toBe(30);
    expect(reading.slice(0, 20).every((question) => question.answer_mode === 'text')).toBe(true);
    expect(reading.slice(20, 35).every((question) => question.answer_mode === 'single_choice')).toBe(true);
    expect(reading.slice(35, 45).every((question) => question.answer_mode === 'text')).toBe(true);
    expect(reading.slice(45).every((question) => question.answer_mode === 'single_choice')).toBe(true);
  });

  it('uses a versioned TOEFL 2026 blueprint', () => {
    const blueprint = getQuestionBlueprint();
    expect(blueprint.blueprint_id).toBe('toefl-2026-r006-1-question-blueprint');
    expect(blueprint.blueprint_version).toBe('1.3.0');
    expect(blueprint.sections.Reading).toHaveLength(50);
  });
});
