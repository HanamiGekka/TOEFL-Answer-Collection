import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories = [];
const script = resolve(process.cwd(), 'scripts/audit-session-export.mjs');

afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

function questionIds(first, last) {
  return Array.from({ length: last - first + 1 }, (_, index) => `Listening-${first + index}`);
}

function writeListeningFixture(version, ranges) {
  const directory = mkdtempSync(resolve(tmpdir(), 'r007-1-listening-audit-'));
  temporaryDirectories.push(directory);
  const sessionId = `synthetic-listening-${version.replaceAll('.', '-')}-${ranges[0][1]}`;
  const modules = ranges.map(([first, last], index) => ({
    module_id: `LISTENING_MODULE_${index + 1}`,
    label: `Listening Module ${index + 1}`,
    status: 'FINALIZED',
    active_time_ms: 0,
    started_at: '2026-07-25T00:00:00.000Z',
    finalized_at: '2026-07-25T00:01:00.000Z',
    question_ids: questionIds(first, last)
  }));
  const questions = modules.flatMap((module) => module.question_ids.map((questionId) => ({
    question_id: questionId,
    section_id: 'Listening',
    module_id: module.module_id,
    question_type: 'External Audio Question',
    answer_value: null,
    progress_status: 'ENCOUNTERED_UNANSWERED',
    encountered: true,
    visit_count: 1,
    first_seen_at: '2026-07-25T00:00:00.000Z',
    first_answer_at: null,
    last_changed_at: null,
    active_time_ms: 0,
    is_skipped: false,
    is_uncertain: false,
    is_overtime: false,
    modification_count: 0
  })));
  const fileNames = [
    'session_summary.md',
    'answers.json',
    'events.jsonl',
    'question_metrics.csv',
    'task_metrics.csv',
    'Listening.md'
  ];
  const answers = {
    schema_version: 'practice-session-v5',
    app_version: '1.0-dev',
    session_id: sessionId,
    package_id: 'Synthetic.01.A.1',
    mode: 'practice',
    profile_id: 'toefl-2026-practice',
    profile_version: '1.0.0',
    blueprint_id: 'toefl-2026-r006-1-question-blueprint',
    blueprint_version: version,
    started_at: '2026-07-25T00:00:00.000Z',
    ended_at: '2026-07-25T00:01:00.000Z',
    active_time_ms: 0,
    pause_time_ms: 0,
    unattributed_active_time_ms: 0,
    sections: [{
      section_id: 'Listening',
      active_time_ms: 0,
      modules,
      metrics: { answered: 0, unanswered: 47, skipped: 0, uncertain: 0, overtime: 0 }
    }],
    questions,
    tasks: []
  };
  const recordIndex = {
    record_id: `TOEFL:${sessionId}`,
    record_type: 'TOEFL',
    session_id: sessionId,
    package_id: answers.package_id,
    created_at: answers.started_at,
    mode: answers.mode,
    profile_id: answers.profile_id,
    blueprint_id: answers.blueprint_id,
    blueprint_version: version,
    selected_sections: ['Listening'],
    active_time_ms: 0,
    pause_time_ms: 0,
    completion_status: 'COMPLETED',
    export_status: 'EXPORTED',
    schema_version: answers.schema_version,
    app_version: answers.app_version,
    directory_size_bytes: 0,
    relative_path: `records/Synthetic.01.A.1/2026-07-25_08-00-00_${sessionId}`,
    file_names: fileNames
  };
  const questionMetrics = [
    'section,module,question_id,question_type,progress_status,answer,active_time_ms,visit_count,modification_count,skipped,uncertain,overtime',
    ...questions.map((question) => [
      question.section_id,
      question.module_id,
      question.question_id,
      question.question_type,
      question.progress_status,
      '',
      0,
      1,
      0,
      false,
      false,
      false
    ].join(','))
  ].join('\n') + '\n';

  writeFileSync(resolve(directory, 'answers.json'), `${JSON.stringify(answers, null, 2)}\n`, 'utf8');
  writeFileSync(resolve(directory, 'record-index.json'), `${JSON.stringify(recordIndex, null, 2)}\n`, 'utf8');
  writeFileSync(resolve(directory, 'events.jsonl'), '', 'utf8');
  writeFileSync(resolve(directory, 'question_metrics.csv'), questionMetrics, 'utf8');
  writeFileSync(resolve(directory, 'task_metrics.csv'), 'section,task_id,task_type,status,active_time_ms,attempt_count\n', 'utf8');
  writeFileSync(resolve(directory, 'session_summary.md'), '# Synthetic Listening Session\n', 'utf8');
  writeFileSync(resolve(directory, 'Listening.md'), '# Synthetic Listening Record\n', 'utf8');
  return directory;
}

function audit(directory) {
  return spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
}

describe('R007.1 blueprint-aware Session auditor', () => {
  it('passes Blueprint 1.3.0 with the persisted 32+15 topology', () => {
    const result = audit(writeListeningFixture('1.3.0', [[1, 32], [33, 47]]));
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('PASS');
    expect(result.stdout).toContain('Blueprint 1.3.0 expects LISTENING_MODULE_1 = Listening-1..Listening-32');
  });

  it('fails Blueprint 1.3.0 carrying a persisted 35+12 topology with an explicit mismatch', () => {
    const result = audit(writeListeningFixture('1.3.0', [[1, 35], [36, 47]]));
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('FAIL LISTENING_BLUEPRINT_SNAPSHOT_MISMATCH');
    expect(result.stdout).toContain('Blueprint 1.3.0 expects LISTENING_MODULE_1 = Listening-1..Listening-32');
  });

  it('passes historical Blueprint 1.2.0 with the persisted 35+12 topology', () => {
    const result = audit(writeListeningFixture('1.2.0', [[1, 35], [36, 47]]));
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('PASS');
    expect(result.stdout).toContain('Blueprint 1.2.0 expects LISTENING_MODULE_2 = Listening-36..Listening-47');
  });
});
