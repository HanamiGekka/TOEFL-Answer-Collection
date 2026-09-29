import { describe, expect, it } from 'vitest';
import type { EventLogEntry, PracticeSession, TypingMinuteSample, TypingSnapshot } from '../../types';
import floatingFixture from './fixtures/r005_2_1_floating_session.json';
import { migratePracticeSession } from '../sessionEngine';
import { buildSessionExportBundle } from '../sessionExport';
import {
  PersistedTimeError,
  serializeEventForPersistence,
  serializeSessionForPersistence,
  serializeTypingMinuteSampleForPersistence,
  serializeTypingSnapshotForPersistence,
  toPersistedMilliseconds
} from '../persistedTime';

const fixture = floatingFixture as unknown as PracticeSession;

describe('R005.2.1 integer millisecond boundary', () => {
  it.each([
    [22_790.29999999702, 22_790],
    [411.90000000037253, 412],
    [1_001.3000000007451, 1_001],
    [-0, 0]
  ])('normalizes %s with the documented Math.round policy', (input, expected) => {
    const result = toPersistedMilliseconds(input, 'fixture.duration_ms');
    expect(result).toBe(expected);
    expect(Number.isSafeInteger(result)).toBe(true);
    expect(Object.is(result, -0)).toBe(false);
  });

  it.each([
    [Number.NaN, 'NON_FINITE'],
    [Number.POSITIVE_INFINITY, 'NON_FINITE'],
    [-1, 'NEGATIVE'],
    [Number.MAX_SAFE_INTEGER + 1, 'UNSAFE_INTEGER']
  ])('rejects invalid value %s with a structured error', (input, code) => {
    expect(() => toPersistedMilliseconds(input, 'session.active_ms')).toThrow(PersistedTimeError);
    try {
      toPersistedMilliseconds(input, 'session.active_ms');
    } catch (error) {
      expect(error).toMatchObject({ code, fieldName: 'session.active_ms', value: input });
    }
  });
});

describe('R005.2.1 explicit persistence DTO', () => {
  it('normalizes every snapshot duration and derives aggregates from integer questions', () => {
    const persisted = serializeSessionForPersistence(fixture);
    const module1 = persisted.modules.find((scope) => scope.id === 'READING_MODULE_1');
    const module2 = persisted.modules.find((scope) => scope.id === 'READING_MODULE_2');
    const section = persisted.modules.reduce((sum, scope) => sum + scope.activeTimeMs, 0);

    expect(persisted.answers['Reading-1'].active_time_ms).toBe(22_790);
    expect(persisted.answers['Reading-2'].active_time_ms).toBe(412);
    expect(persisted.answers['Reading-36'].active_time_ms).toBe(1_001);
    expect(persisted.answers['Reading-1'].first_answer_elapsed_ms).toBe(1_001);
    expect(persisted.questions[0].time_limit_ms).toBe(45_000);
    expect(module1?.activeTimeMs).toBe(23_202);
    expect(module2?.activeTimeMs).toBe(1_001);
    expect(section).toBe(24_203);
    expect(persisted.active_ms).toBe(section + (persisted.unattributed_active_time_ms ?? 0));
    expect(allSnapshotDurations(persisted).every(Number.isSafeInteger)).toBe(true);
  });

  it('normalizes optional task duration fields without changing task identity', () => {
    const withTasks = {
      ...fixture,
      tasks: [
        {
          task_id: 'future-persistence-shape-only',
          active_time_ms: 411.90000000037253,
          pause_time_ms: 1001.3000000007451,
          remaining_ms: 22790.29999999702,
          timer_limit_ms: 45_000.4
        }
      ]
    } as PracticeSession & { tasks: Array<Record<string, string | number>> };
    const persisted = serializeSessionForPersistence(withTasks);

    expect(persisted.tasks).toEqual([
      {
        task_id: 'future-persistence-shape-only',
        active_time_ms: 412,
        pause_time_ms: 1_001,
        remaining_ms: 22_790,
        timer_limit_ms: 45_000
      }
    ]);
  });

  it.each([2, 3, 4])('migrates a schema v%s floating snapshot and can serialize it again', (version) => {
    const migrated = migratePracticeSession({ ...floatingFixture, session_schema_version: version });
    const savedAgain = serializeSessionForPersistence(migrated);

    expect(savedAgain.answers['Reading-1'].answer_value).toBe('A');
    expect(savedAgain.answers['Reading-1'].is_uncertain).toBe(true);
    expect(savedAgain.answers['Reading-2'].is_skipped).toBe(true);
    expect(allSnapshotDurations(savedAgain).every(Number.isSafeInteger)).toBe(true);
  });

  it('rejects an invalid legacy time with a diagnostic field path', () => {
    const invalid = structuredClone(fixture);
    invalid.answers['Reading-1'].active_time_ms = Number.NaN;
    expect(() => migratePracticeSession(invalid)).toThrow(/answers\.Reading-1\.active_time_ms/);
  });

  it('normalizes pause/resume and event elapsed duration fields only', () => {
    const event: EventLogEntry = {
      session_id: 'fixture',
      seq: 3,
      monotonic_elapsed_ms: 22_790.29999999702,
      wall_clock: '2026-07-11T09:00:23.000Z',
      event_type: 'session_resumed',
      payload: { paused_delta_ms: 411.90000000037253, answer_count: 7, label: 'unchanged' },
      schema_version: '1.0.0'
    };
    expect(serializeEventForPersistence(event)).toMatchObject({
      monotonic_elapsed_ms: 22_790,
      payload: { paused_delta_ms: 412, answer_count: 7, label: 'unchanged' }
    });
  });

  it('normalizes typing snapshot and minute sample duration without rounding rate metrics', () => {
    const snapshot = { text: 'word', active_ms: 1001.3000000007451, paused_ms: 411.90000000037253 } as TypingSnapshot;
    const sample = {
      active_minute_index: 'FINAL',
      timestamp: '2026-07-11T09:00:23.000Z',
      active_ms: 22790.29999999702,
      net_cpm: 123.45
    } as TypingMinuteSample;
    expect(serializeTypingSnapshotForPersistence(snapshot)).toMatchObject({ active_ms: 1_001, paused_ms: 412 });
    expect(serializeTypingMinuteSampleForPersistence(sample)).toMatchObject({ active_ms: 22_790, net_cpm: 123.45 });
  });

  it('writes only integer duration fields to the formal Session export JSON and events JSONL', () => {
    const event = {
      session_id: fixture.session_id,
      seq: 1,
      monotonic_elapsed_ms: 411.90000000037253,
      wall_clock: fixture.created_at,
      event_type: 'fixture',
      payload: { active_time_ms: 1001.3000000007451 },
      schema_version: '1.0.0'
    } satisfies EventLogEntry;
    const bundle = buildSessionExportBundle(fixture, [event]);
    const answers = JSON.parse(bundle.files['answers.json']) as Record<string, unknown>;
    const events = JSON.parse(bundle.files['events.jsonl'].trim()) as EventLogEntry;

    expect(allSnapshotDurations(answers).every(Number.isSafeInteger)).toBe(true);
    expect(events.monotonic_elapsed_ms).toBe(412);
    expect(events.payload.active_time_ms).toBe(1_001);
  });
});

function allSnapshotDurations(value: unknown): number[] {
  const found: number[] = [];
  visit(value, '', found);
  return found;
}

function visit(value: unknown, key: string, found: number[]): void {
  if (typeof value === 'number' && (key.endsWith('_ms') || key === 'activeTimeMs')) found.push(value);
  if (Array.isArray(value)) value.forEach((item) => visit(item, key, found));
  else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([childKey, child]) => visit(child, childKey, found));
  }
}
