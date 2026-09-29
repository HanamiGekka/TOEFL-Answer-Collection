import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PracticeSession } from '../../types';
import { buildInitialSessionRuntime, createDefaultQuestions, upsertAnswer } from '../sessionEngine';
import { DEFAULT_BLUEPRINT } from '../blueprint';
import { prepareRecoverySession } from '../recovery';
import { enterTask, getCurrentTask, redoWritingText, undoWritingText, updateWritingText } from '../taskRuntime';
import { sanitizeWritingText } from '../writingTextPolicy';

function writingSession(): PracticeSession {
  const now = '2026-07-19T12:00:00.000Z';
  return buildInitialSessionRuntime({
    session_schema_version: 5,
    session_id: 'r006-2-writing-policy',
    package_id: 'Synthetic.01.A.1',
    source_path: 'readonly',
    mode: 'practice',
    timing_profile_id: 'toefl-2026-practice',
    timing_profile_version: '1.0.0',
    blueprint_id: DEFAULT_BLUEPRINT.blueprint_id,
    blueprint_version: DEFAULT_BLUEPRINT.version,
    created_at: now,
    started_at: now,
    active_ms: 0,
    paused_ms: 0,
    current_section: 'Writing',
    current_question_index: 0,
    questions: createDefaultQuestions(['Writing']),
    answers: {},
    modules: [],
    view: 'PRACTICE'
  });
}

describe('R006.2 shared Writing text policy', () => {
  it('allows Unicode Latin, numbers and common English punctuation while normalizing tabs and CRLF', () => {
    const result = sanitizeWritingText('Café\t2026\r\n“email@example.com” — (A/B): yes; 50%.');
    expect(result).toEqual({
      text: 'Café    2026\n“email@example.com” — (A/B): yes; 50%.',
      rejected_count: 0,
      changed: true
    });
  });

  it('removes Han, Kana, Hangul, emoji, private-use and disallowed control characters', () => {
    const result = sanitizeWritingText(`Keep中文かな한글🙂\uE000\u0007 this.`);
    expect(result.text).toBe('Keep this.');
    expect(result.rejected_count).toBe(9);
  });

  it.each(['WRITING_EMAIL', 'WRITING_ACADEMIC_DISCUSSION'])('%s stores and counts only sanitized text', (taskId) => {
    const updated = updateWritingText(
      enterTask(writingSession(), taskId),
      'Hello中文🙂 world',
      'insertFromPaste'
    );
    expect(getCurrentTask(updated)).toMatchObject({
      text: 'Hello world',
      word_count: 2,
      character_count: 11,
      pasted_characters: 11
    });
  });

  it('never restores rejected content through Undo or Redo', () => {
    let value = enterTask(writingSession(), 'WRITING_EMAIL');
    value = updateWritingText(value, 'Safe', 'insertText');
    value = updateWritingText(value, 'Safe中文🙂 text', 'insertText');
    value = undoWritingText(value);
    expect(getCurrentTask(value)?.text).toBe('Safe');
    value = redoWritingText(value);
    expect(getCurrentTask(value)?.text).toBe('Safe text');
  });

  it('preserves all three legacy Recovery sources and reports compatibility until each working copy is edited', () => {
    let legacy = writingSession();
    const buildQuestion = legacy.questions.find((question) => question.id === 'Writing-1');
    if (!buildQuestion) throw new Error('missing Build a Sentence question');
    legacy = upsertAnswer(legacy, buildQuestion, '历史中文 build', 0);
    legacy = {
      ...legacy,
      tasks: legacy.tasks.map((task) => task.task_id === 'WRITING_EMAIL'
        ? { ...task, text: '历史中文 email 🙂' }
        : task.task_id === 'WRITING_ACADEMIC_DISCUSSION'
          ? { ...task, text: 'Legacy 日本語 discussion' }
          : task)
    };
    const raw = JSON.stringify(legacy);
    const rawHash = createHash('sha256').update(raw).digest('hex');
    const result = prepareRecoverySession(raw, [DEFAULT_BLUEPRINT.blueprint_id]);
    expect(result).toMatchObject({ ok: true, writing_policy_compatibility_warning: true });
    if (!result.ok) throw new Error('expected compatible Recovery');
    expect(result.session.answers['Writing-1'].answer_value).toBe('历史中文 build');
    expect(result.session.tasks.find((task) => task.task_id === 'WRITING_EMAIL')?.text).toBe('历史中文 email 🙂');
    expect(result.session.tasks.find((task) => task.task_id === 'WRITING_ACADEMIC_DISCUSSION')?.text).toBe('Legacy 日本語 discussion');

    const emailEdited = updateWritingText(
      enterTask(result.session, 'WRITING_EMAIL'),
      '历史中文 email 🙂 plus',
      'insertText'
    );
    const discussionEdited = updateWritingText(
      enterTask(result.session, 'WRITING_ACADEMIC_DISCUSSION'),
      'Legacy 日本語 discussion plus',
      'insertText'
    );
    expect(getCurrentTask(emailEdited)?.text).toBe(' email  plus');
    expect(getCurrentTask(discussionEdited)?.text).toBe('Legacy  discussion plus');
    expect(createHash('sha256').update(raw).digest('hex')).toBe(rawHash);
    expect(raw).toContain('历史中文 build');
    expect(raw).toContain('历史中文 email 🙂');
    expect(raw).toContain('日本語 discussion');
  });
});
