import { describe, expect, it } from 'vitest';
import type { PracticeSession } from '../../types';
import { buildSessionExportBundle } from '../sessionExport';
import { buildInitialSessionRuntime, createDefaultQuestions, finalizeQuestion } from '../sessionEngine';

function legacyCompletedSession(): PracticeSession {
  let session = buildInitialSessionRuntime({
    session_schema_version: 3,
    session_id: 'legacy-timing-export',
    package_id: '01.21.A.1',
    source_path: 'readonly',
    mode: 'practice',
    timing_profile_id: 'toefl-2026-practice',
    timing_profile_version: '1.0.0',
    created_at: '2026-07-11T00:00:00.000Z',
    completed_at: '2026-07-11T00:10:00.000Z',
    active_ms: 1_023_016,
    paused_ms: 1_350,
    current_section: 'Reading',
    current_question_index: 0,
    questions: createDefaultQuestions(['Reading', 'Listening']),
    answers: {},
    modules: [],
    view: 'SESSION_SUMMARY'
  });
  for (const [questionId, activeMs] of [
    ['Reading-1', 120_258],
    ['Reading-36', 138_902],
    ['Listening-1', 126_400],
    ['Listening-2', 38_800]
  ] as const) {
    const question = session.questions.find((item) => item.id === questionId);
    if (!question) throw new Error(`missing ${questionId}`);
    session = finalizeQuestion(session, question, activeMs);
  }
  return {
    ...session,
    active_ms: 1_023_016,
    modules: session.modules.map((scope) => ({ ...scope, activeTimeMs: 1 }))
  };
}

describe('R005.2 export timing consistency', () => {
  it('re-derives one ledger for JSON, CSV, Section Markdown, and session summary', () => {
    const bundle = buildSessionExportBundle(legacyCompletedSession(), []);
    const answers = JSON.parse(bundle.files['answers.json']) as {
      active_time_ms: number;
      unattributed_active_time_ms: number;
      sections: Array<{ section_id: string; active_time_ms: number; modules: Array<{ active_time_ms: number }> }>;
    };
    const reading = answers.sections.find((section) => section.section_id === 'Reading');
    const listening = answers.sections.find((section) => section.section_id === 'Listening');

    expect(reading?.modules.map((scope) => scope.active_time_ms)).toEqual([120_258, 138_902]);
    expect(reading?.active_time_ms).toBe(259_160);
    expect(listening?.active_time_ms).toBe(165_200);
    expect(answers.active_time_ms).toBe(424_360);
    expect(answers.unattributed_active_time_ms).toBe(0);
    expect(bundle.files['question_metrics.csv']).toContain('Reading,READING_MODULE_1,Reading-1');
    expect(bundle.files['Reading.md']).toContain('有效时间：04:19');
    expect(bundle.files['Listening.md']).toContain('有效时间：02:45');
    expect(bundle.files['session_summary.md']).toContain('总有效时间：07:04');
    expect(bundle.files['session_summary.md']).toContain(
      'Session 07:04.3 = Sections 07:04.3 + Unattributed 00:00.0'
    );
  });
});
