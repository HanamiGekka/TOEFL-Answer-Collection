import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BLUEPRINT } from '../blueprint';
import { prepareRecoverySession } from '../recovery';
import { buildSessionExportBundle } from '../sessionExport';
import { upsertAnswer } from '../sessionEngine';
import { enterTask, getCurrentTask, updateWritingText } from '../taskRuntime';
import { sanitizeWritingText } from '../writingTextPolicy';

describe.skipIf(!process.env.R0062_VERIFY_ROOT)('R006.2 generated legacy Writing fixture', () => {
  it('keeps the raw diagnostic immutable and applies policy only to edited working copies and normal export', () => {
    const root = process.env.R0062_VERIFY_ROOT;
    if (!root) throw new Error('R0062_VERIFY_ROOT is required');
    const manifest = JSON.parse(readFileSync(join(root, 'fixture-manifest.json'), 'utf8')) as {
      legacy_writing_snapshot_path: string;
      legacy_writing_snapshot_sha256: string;
    };
    const snapshotPath = join(root, ...manifest.legacy_writing_snapshot_path.split('/'));
    const raw = readFileSync(snapshotPath);
    expect(createHash('sha256').update(raw).digest('hex')).toBe(manifest.legacy_writing_snapshot_sha256);

    const prepared = prepareRecoverySession(raw.toString('utf8'), [DEFAULT_BLUEPRINT.blueprint_id]);
    expect(prepared).toMatchObject({ ok: true, writing_policy_compatibility_warning: true });
    if (!prepared.ok) throw new Error('expected compatible generated Recovery');
    expect(prepared.session.answers['Writing-1'].answer_value).toContain('历史中文');
    expect(prepared.session.tasks.find((task) => task.task_id === 'WRITING_EMAIL')?.text).toContain('历史中文');
    expect(prepared.session.tasks.find((task) => task.task_id === 'WRITING_ACADEMIC_DISCUSSION')?.text).toContain('日本語');

    const buildQuestion = prepared.session.questions.find((question) => question.id === 'Writing-1');
    if (!buildQuestion) throw new Error('missing generated Build question');
    const editedBuild = sanitizeWritingText('Legacy 历史中文 build plus', { allow_line_breaks: false }).text;
    let current = upsertAnswer(prepared.session, buildQuestion, editedBuild, 0);
    current = updateWritingText(enterTask(current, 'WRITING_EMAIL'), 'Legacy 历史中文 email 🙂 plus', 'insertText');
    expect(getCurrentTask(current)?.text).toBe('Legacy  email  plus');
    current = updateWritingText(enterTask(current, 'WRITING_ACADEMIC_DISCUSSION'), 'Legacy 日本語 discussion plus', 'insertText');
    expect(getCurrentTask(current)?.text).toBe('Legacy  discussion plus');
    expect(current.answers['Writing-1'].answer_value).toBe('Legacy  build plus');

    const bundle = buildSessionExportBundle(current, []);
    const exported = `${bundle.files['answers.json']}\n${bundle.files['Writing.md']}`;
    expect(exported).not.toMatch(/历史中文|日本語|🙂/u);
    expect(exported).toContain('Legacy  build plus');
    expect(exported).toContain('Legacy  email  plus');
    expect(exported).toContain('Legacy  discussion plus');
    expect(createHash('sha256').update(readFileSync(snapshotPath)).digest('hex')).toBe(manifest.legacy_writing_snapshot_sha256);
    expect(raw.toString('utf8')).toMatch(/历史中文 build|历史中文 email|日本語 discussion/u);
  });
});
