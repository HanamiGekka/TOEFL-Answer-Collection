import { describe, expect, it } from 'vitest';
import { createDefaultQuestions } from '../sessionEngine';
import { prepareRecoverySession } from '../recovery';
import { buildInitialSessionRuntime } from '../sessionEngine';

function snapshot() {
  return buildInitialSessionRuntime({
    session_schema_version: 5,
    session_id: 'recover-me',
    package_id: 'Mock.01.A.1',
    source_path: 'readonly',
    mode: 'practice',
    timing_profile_id: 'toefl-2026-practice',
    timing_profile_version: '1.0.0',
    created_at: '2026-07-13T00:00:00.000Z',
    started_at: '2026-07-13T00:00:00.000Z',
    active_ms: 0,
    paused_ms: 0,
    questions: createDefaultQuestions(['Writing', 'Speaking']),
    answers: {},
    modules: [],
    view: 'PRACTICE'
  });
}

describe('R006 recovery preparation', () => {
  it('restores a valid v5 snapshot', () => {
    expect(prepareRecoverySession(snapshot(), ['toefl-2026-default']).ok).toBe(true);
  });

  it('migrates a v4 snapshot non-destructively', () => {
    const value = snapshot() as unknown as Record<string, unknown>;
    value.session_schema_version = 4;
    delete value.tasks;
    const result = prepareRecoverySession(value, ['toefl-2026-default']);
    expect(result.ok && result.session.session_schema_version).toBe(5);
  });

  it('always returns recovered sessions paused with no old monotonic anchor', () => {
    const result = prepareRecoverySession(snapshot(), ['toefl-2026-default']);
    expect(result.ok && result.resume_policy).toEqual({ paused: true, reuse_monotonic_anchor: false });
  });

  it('preserves Writing full text', () => {
    const value = snapshot();
    value.tasks.find((task) => task.task_id === 'WRITING_EMAIL')!.text = 'keep this full text';
    const result = prepareRecoverySession(value, ['toefl-2026-default']);
    expect(result.ok && result.session.tasks.find((task) => task.task_id === 'WRITING_EMAIL')?.text).toBe('keep this full text');
  });

  it('preserves Speaking attempts', () => {
    const value = snapshot();
    value.tasks.find((task) => task.task_id === 'SR1')!.attempt_count = 3;
    const result = prepareRecoverySession(value, ['toefl-2026-default']);
    expect(result.ok && result.session.tasks.find((task) => task.task_id === 'SR1')?.attempt_count).toBe(3);
  });

  it('diagnoses corrupted snapshots without throwing', () => {
    expect(prepareRecoverySession('{broken', ['toefl-2026-default'])).toMatchObject({ ok: false, code: 'CORRUPT_SNAPSHOT' });
  });

  it('diagnoses unsupported schemas', () => {
    expect(prepareRecoverySession({ session_schema_version: 99 }, ['toefl-2026-default'])).toMatchObject({ ok: false, code: 'UNSUPPORTED_SCHEMA' });
  });

  it('diagnoses a missing blueprint', () => {
    expect(prepareRecoverySession(snapshot(), [])).toMatchObject({ ok: false, code: 'BLUEPRINT_MISSING' });
  });
});
