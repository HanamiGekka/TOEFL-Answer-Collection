import { describe, expect, it } from 'vitest';
import type { PracticeSession } from '../../types';
import {
  buildInitialSessionRuntime,
  canNavigateToQuestion,
  createDefaultQuestions,
  enterQuestion,
  getQuestionNavItems,
  normalizeRestoredNavigation,
  previousQuestionInSession
} from '../sessionEngine';

function listening(mode: PracticeSession['mode']): PracticeSession {
  return buildInitialSessionRuntime({
    session_schema_version: 3,
    session_id: `listening-${mode}`,
    package_id: '01.21.A.1',
    source_path: 'readonly',
    mode,
    timing_profile_id: mode === 'practice' ? 'toefl-2026-practice' : 'toefl-2026-exam-simulation',
    timing_profile_version: '1.0.0',
    created_at: '2026-07-11T00:00:00.000Z',
    active_ms: 0,
    paused_ms: 0,
    current_section: 'Listening',
    current_question_index: 0,
    questions: createDefaultQuestions(['Listening']),
    answers: {},
    modules: [],
    view: 'PRACTICE'
  });
}

describe('R005.2 Listening navigation profile', () => {
  it('allows practice mode to return only to encountered questions', () => {
    const second = enterQuestion(listening('practice'), 'Listening-2', undefined, 'next');
    expect(canNavigateToQuestion(second, 'Listening-1', 'answer_card')).toBe(true);
    expect(canNavigateToQuestion(second, 'Listening-3', 'answer_card')).toBe(false);
    const back = previousQuestionInSession(second);
    expect(back.current_question_id).toBe('Listening-1');
    expect(canNavigateToQuestion(back, 'Listening-2', 'answer_card')).toBe(true);
  });

  it('rejects previous, answer-card, and direct engine back-navigation in exam simulation', () => {
    const second = enterQuestion(listening('exam_simulation'), 'Listening-2', undefined, 'next');
    expect(previousQuestionInSession(second)).toBe(second);
    expect(enterQuestion(second, 'Listening-1')).toBe(second);
    expect(canNavigateToQuestion(second, 'Listening-1', 'answer_card')).toBe(false);
    expect(getQuestionNavItems(second).find((item) => item.id === 'Listening-1')?.isDisabled).toBe(true);
  });

  it('normalizes an exam restore that points behind the encountered frontier', () => {
    let value = listening('exam_simulation');
    value = enterQuestion(value, 'Listening-2', undefined, 'next');
    value = enterQuestion(value, 'Listening-3', undefined, 'next');
    const tampered = { ...value, current_question_id: 'Listening-1', current_question_index: 0 };

    expect(normalizeRestoredNavigation(tampered).current_question_id).toBe('Listening-3');
  });

  it('does not change Reading answer-card navigation rules', () => {
    const reading = buildInitialSessionRuntime({
      ...listening('exam_simulation'),
      session_id: 'reading-exam',
      current_section: 'Reading',
      current_question_index: 0,
      questions: createDefaultQuestions(['Reading']),
      modules: []
    });
    const third = enterQuestion(reading, 'Reading-3');
    expect(enterQuestion(third, 'Reading-1').current_question_id).toBe('Reading-1');
  });
});
