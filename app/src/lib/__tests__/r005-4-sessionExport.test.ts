import { describe, expect, it } from 'vitest';
import type { PracticeSession, SectionName } from '../../types';
import { buildInitialSessionRuntime, createDefaultQuestions } from '../sessionEngine';
import { buildSessionExportBundle } from '../sessionExport';
import { enterTask, markSpeakingTask, startSpeakingTask, updateWritingText } from '../taskRuntime';

function session(sections: SectionName[]): PracticeSession {
  const now = '2026-07-11T15:00:00.000Z';
  return buildInitialSessionRuntime({
    session_schema_version: 4,
    session_id: 'export-r005-4',
    package_id: 'Mock.01.A.1',
    source_path: 'readonly',
    mode: 'practice',
    timing_profile_id: 'toefl-2026-practice',
    timing_profile_version: '1.0.0',
    created_at: now,
    started_at: now,
    completed_at: now,
    active_ms: 0,
    paused_ms: 0,
    current_section: sections[0],
    current_question_index: 0,
    questions: createDefaultQuestions(sections),
    answers: {},
    modules: [],
    view: 'SESSION_SUMMARY'
  });
}

describe('R005.4 Task export', () => {
  it('exports independent Email and Discussion text with full Writing metrics', () => {
    let value = enterTask(session(['Writing']), 'WRITING_EMAIL');
    value = updateWritingText(value, "Email user's full text.", 'insertText');
    value = enterTask(value, 'WRITING_ACADEMIC_DISCUSSION');
    value = updateWritingText(value, 'Discussion full text.', 'insertFromPaste');
    const bundle = buildSessionExportBundle(value, []);
    expect(bundle.files['Writing.md']).toContain("Email user's full text.");
    expect(bundle.files['Writing.md']).toContain('Discussion full text.');
    expect(bundle.files['Writing.md']).toMatch(/Word count|Keyboard CPM|Cut|Undo/i);
  });

  it('adds Task runtime to answers JSON while retaining compatible questions', () => {
    const bundle = buildSessionExportBundle(session(['Writing', 'Speaking']), []);
    const answers = JSON.parse(bundle.files['answers.json']) as { schema_version: string; tasks: unknown[]; questions: unknown[] };
    expect(answers.schema_version).toBe('practice-session-v5');
    expect(answers.tasks).toHaveLength(14);
    expect(answers.questions).toHaveLength(23);
  });

  it('adds a task_metrics.csv without removing question_metrics.csv', () => {
    const files = buildSessionExportBundle(session(['Writing', 'Speaking']), []).files;
    expect(files['question_metrics.csv']).toContain('question_id');
    expect(files['task_metrics.csv']).toContain('task_id');
    expect(files['task_metrics.csv']).toContain('attempt_count');
  });

  it('exports SR1–SR7, SI1–SI4, group timer, attempts and independent flags', () => {
    let value = startSpeakingTask(session(['Speaking']), 'SR1');
    value = markSpeakingTask(value, 'SR1', 'NEEDS_RETRY');
    value = enterTask(value, 'SI1');
    value = startSpeakingTask(value, 'SI1');
    value = markSpeakingTask(value, 'SI1', 'COMPLETED');
    const speaking = buildSessionExportBundle(value, []).files['Speaking.md'];
    expect(speaking).toMatch(/Listen and Repeat.*2:00|120000|02:00/i);
    expect(speaking).toContain('SR1');
    expect(speaking).toContain('需重练');
    expect(speaking).toContain('SI1');
    expect(speaking).toMatch(/45 秒|00:45/);
    expect(speaking).toMatch(/attempt/i);
  });

  it('does not export audio, question body, scoring, correctness, or standard answers', () => {
    const combined = Object.values(buildSessionExportBundle(session(['Speaking']), []).files).join('\n');
    expect(combined).not.toMatch(/audio[_ ]?(?:data|blob)|question[_ ]?body|correct[_ ]?answer|standard[_ ]?answer|score|accuracy/i);
  });
});
