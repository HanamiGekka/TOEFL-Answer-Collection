import { describe, expect, it } from 'vitest';
import type { EventLogEntry, PracticeSession } from '../../types';
import { buildInitialSessionRuntime, createDefaultQuestions, upsertAnswer } from '../sessionEngine';
import { buildSessionExportBundle, buildSessionExportDirectory } from '../sessionExport';

function completedSession(): PracticeSession {
  const questions = createDefaultQuestions(['Reading', 'Listening']);
  const base = buildInitialSessionRuntime({
    session_schema_version: 2,
    session_id: 'Mock.01.A.1-12345',
    package_id: 'Mock.01.A.1',
    source_path: 'readonly',
    mode: 'practice',
    timing_profile_id: 'toefl-2026-practice',
    timing_profile_version: '1.0.0',
    created_at: '2026-07-10T08:09:10.000Z',
    started_at: '2026-07-10T08:09:10.000Z',
    completed_at: '2026-07-10T09:10:11.000Z',
    active_ms: 61_000,
    paused_ms: 5_000,
    current_section: 'Reading',
    current_question_index: 0,
    questions,
    answers: {},
    modules: [],
    view: 'SESSION_SUMMARY'
  });
  return upsertAnswer(base, base.questions[0], 'A', 1_234);
}

const event: EventLogEntry = {
  session_id: 'Mock.01.A.1-12345',
  seq: 1,
  monotonic_elapsed_ms: 0,
  wall_clock: '2026-07-10T08:09:10.000Z',
  event_type: 'session_started',
  payload: {},
  schema_version: '1.0.0'
};

describe('R005.1 Session export bundle', () => {
  it('uses a records/package/timestamp_session path', () => {
    const localEndedAt = new Date('2026-07-10T08:09:10.000Z');
    const localStamp = [
      localEndedAt.getFullYear().toString().padStart(4, '0'),
      (localEndedAt.getMonth() + 1).toString().padStart(2, '0'),
      localEndedAt.getDate().toString().padStart(2, '0')
    ].join('-') + `_${localEndedAt.getHours().toString().padStart(2, '0')}-09-10`;
    expect(buildSessionExportDirectory(completedSession())).toBe(
      `records/Mock.01.A.1/${localStamp}_Mock.01.A.1-12345`
    );
  });

  it('generates the required complete file set for selected sections', () => {
    const bundle = buildSessionExportBundle(completedSession(), [event]);
    expect(Object.keys(bundle.files)).toEqual(
      expect.arrayContaining([
        'session_summary.md',
        'answers.json',
        'events.jsonl',
        'question_metrics.csv',
        'Reading.md',
        'Listening.md'
      ])
    );
    expect(bundle.files['Writing.md']).toBeUndefined();
    expect(bundle.files['Speaking.md']).toBeUndefined();
  });

  it('exports raw answers and independent state fields without scoring data', () => {
    const bundle = buildSessionExportBundle(completedSession(), [event]);
    const answers = JSON.parse(bundle.files['answers.json']) as {
      app_version: string;
      active_time_ms: number;
      questions: Array<Record<string, unknown>>;
    };
    expect(answers.app_version).toBe('1.0.0');
    expect(answers.active_time_ms).toBe(1_234);
    expect(answers.questions[0]).toMatchObject({
      answer_value: 'A',
      progress_status: 'ANSWERED',
      is_skipped: false,
      is_uncertain: false,
      is_overtime: false
    });
    expect(bundle.files['answers.json']).not.toMatch(/correct[_ ]?answer|standard[_ ]?answer|标准答案/i);
  });

  it('writes parseable JSONL and the required CSV columns', () => {
    const bundle = buildSessionExportBundle(completedSession(), [event]);
    expect(JSON.parse(bundle.files['events.jsonl'].trim())).toMatchObject({ event_type: 'session_started' });
    expect(bundle.files['question_metrics.csv'].split('\n')[0]).toBe(
      'section,module,question_id,question_type,progress_status,answer,active_time_ms,visit_count,modification_count,skipped,uncertain,overtime'
    );
  });

  it('keeps Markdown copyable and contains no question body or standard answers', () => {
    const bundle = buildSessionExportBundle(completedSession(), [event]);
    expect(bundle.files['session_summary.md']).toContain('总有效时间');
    expect(bundle.files['Reading.md']).toContain('| R1 |');
    expect(bundle.files['Reading.md']).not.toMatch(/correct answer|标准答案|题目正文/i);
  });

  it('uses the same export directory on retry for the same session', () => {
    const value = completedSession();
    expect(buildSessionExportDirectory(value)).toBe(buildSessionExportDirectory(value));
    expect(buildSessionExportDirectory({ ...value, session_id: 'another-session' })).not.toBe(
      buildSessionExportDirectory(value)
    );
  });
});
