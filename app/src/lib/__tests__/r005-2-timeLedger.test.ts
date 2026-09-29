import { describe, expect, it } from 'vitest';
import type { PracticeSession } from '../../types';
import { buildInitialSessionRuntime, createDefaultQuestions, finalizeQuestion } from '../sessionEngine';
import {
  applyDerivedTiming,
  createActivityTimer,
  deriveTimingLedger,
  pauseActivityTimer,
  previewActivityDelta,
  resumeActivityTimer,
  settleActivityTimer,
  startActivity
} from '../timeLedger';

function session(): PracticeSession {
  return buildInitialSessionRuntime({
    session_schema_version: 3,
    session_id: 'timing-ledger',
    package_id: '01.21.A.1',
    source_path: 'readonly',
    mode: 'practice',
    timing_profile_id: 'toefl-2026-practice',
    timing_profile_version: '1.0.0',
    created_at: '2026-07-11T00:00:00.000Z',
    started_at: '2026-07-11T00:00:00.000Z',
    active_ms: 99_999,
    paused_ms: 0,
    current_section: 'Reading',
    current_question_index: 0,
    questions: createDefaultQuestions(['Reading', 'Listening']),
    answers: {},
    modules: [],
    view: 'PRACTICE'
  });
}

function withQuestionTime(value: PracticeSession, questionId: string, activeMs: number): PracticeSession {
  const question = value.questions.find((item) => item.id === questionId);
  if (!question) throw new Error(`missing ${questionId}`);
  return finalizeQuestion(value, question, activeMs, false, '2026-07-11T00:00:01.000Z');
}

describe('R005.2 single activity timer', () => {
  it('settles one activity exactly once', () => {
    const timer = createActivityTimer('Reading-1', 1_000);
    const first = settleActivityTimer(timer, 1_450);
    const second = settleActivityTimer(first.timer, 1_450);

    expect(first).toMatchObject({ activityId: 'Reading-1', deltaMs: 450 });
    expect(second.deltaMs).toBe(0);
  });

  it('accumulates multiple visits to the same question without cross-question leakage', () => {
    let timer = createActivityTimer('Reading-1', 0);
    const first = settleActivityTimer(timer, 100);
    timer = startActivity(first.timer, 'Reading-2', 100);
    const middle = settleActivityTimer(timer, 160);
    timer = startActivity(middle.timer, 'Reading-1', 200);
    const revisit = settleActivityTimer(timer, 275);

    expect(first.deltaMs + revisit.deltaMs).toBe(175);
    expect(middle.deltaMs).toBe(60);
  });

  it('does not grow while paused and resumes from a fresh anchor', () => {
    const timer = createActivityTimer('Reading-1', 0);
    const paused = pauseActivityTimer(timer, 100);

    expect(paused.deltaMs).toBe(100);
    expect(previewActivityDelta(paused.timer, 900)).toBe(0);
    const resumed = resumeActivityTimer(paused.timer, 900);
    const settled = settleActivityTimer(resumed, 950);
    expect(settled.deltaMs).toBe(50);
    expect(settled.timer.pausedMs).toBe(800);
  });
});

describe('R005.2 derived timing ledger', () => {
  it('derives Scope, Section, and Session time from question children', () => {
    let value = session();
    value = withQuestionTime(value, 'Reading-1', 100);
    value = withQuestionTime(value, 'Reading-2', 200);
    value = withQuestionTime(value, 'Reading-36', 400);
    value = withQuestionTime(value, 'Listening-1', 500);

    const ledger = deriveTimingLedger(value);
    expect(ledger.scopes.READING_MODULE_1).toBe(300);
    expect(ledger.scopes.READING_MODULE_2).toBe(400);
    expect(ledger.scopes.LISTENING_MODULE_1).toBe(500);
    expect(ledger.scopes.LISTENING_MODULE_2).toBe(0);
    expect(ledger.sections.Reading).toBe(700);
    expect(ledger.sections.Listening).toBe(500);
    expect(ledger.sessionActiveMs).toBe(1_200);
    expect(ledger.unattributedActiveMs).toBe(0);
  });

  it('repairs legacy schema v3 aggregate fields without changing question answers', () => {
    let value = session();
    value = withQuestionTime(value, 'Reading-1', 120_258);
    value = withQuestionTime(value, 'Reading-2', 15_820);
    value = {
      ...value,
      session_schema_version: 3,
      active_ms: 1_023_016,
      modules: value.modules.map((scope) => ({ ...scope, activeTimeMs: scope.id === 'READING_MODULE_1' ? 41_099 : 0 }))
    };

    const repaired = applyDerivedTiming(value);
    const repairedAgain = applyDerivedTiming(repaired);
    expect(repaired.answers['Reading-1'].active_time_ms).toBe(120_258);
    expect(repaired.modules.find((scope) => scope.id === 'READING_MODULE_1')?.activeTimeMs).toBe(136_078);
    expect(repaired.active_ms).toBe(136_078);
    expect(repairedAgain).toEqual(repaired);
  });

  it('never reports a Scope or Section below one of its child questions', () => {
    let value = session();
    value = withQuestionTime(value, 'Listening-1', 126_400);
    value = withQuestionTime(value, 'Listening-2', 38_800);
    const ledger = deriveTimingLedger(value);

    expect(ledger.scopes.LISTENING_MODULE_1).toBe(165_200);
    expect(ledger.scopes.LISTENING_MODULE_2).toBe(0);
    expect(ledger.sections.Listening).toBe(165_200);
    expect(ledger.sessionActiveMs).toBe(165_200);
  });
});
