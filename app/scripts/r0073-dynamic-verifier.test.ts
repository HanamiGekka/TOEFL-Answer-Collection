import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createDynamicItem,
  createDynamicSession,
  finishDynamicSection,
  type DynamicPracticeSession,
  updateDynamicWritingText,
  validateDynamicSession
} from '../src/lib/dynamicSession';
import { getItemTypePreset } from '../src/lib/itemTypeRegistry';
import { serializeSessionForPersistence } from '../src/lib/persistedTime';
import { prepareRecoverySession } from '../src/lib/recovery';
import { buildSessionExportBundle } from '../src/lib/sessionExport';
import { upsertAnswer } from '../src/lib/sessionEngine';

function finish(session: DynamicPracticeSession, section: 'Reading' | 'Listening' | 'Writing') {
  const result = finishDynamicSection(session, section, {
    confirmed: true,
    now_iso: '2026-08-03T04:00:00.000Z'
  });
  if (!result.ok) throw new Error(`Could not finish ${section}.`);
  return result.session;
}

describe.skipIf(!process.env.R0073_VERIFY_ROOT)('R007.3 disposable dynamic verifier frontend flow', () => {
  it('creates only confirmed Items, save-closes, continues, completes, and exports the v6 contract', () => {
    const fixtureRoot = process.env.R0073_VERIFY_ROOT;
    expect(fixtureRoot).toBeTruthy();
    expect(existsSync(join(fixtureRoot!, '.r0073-disposable-root'))).toBe(true);

    let session = createDynamicSession({
      session_id: 'r0073-generated-dynamic',
      package_id: 'Mock.01.A.1',
      mode: 'practice',
      selected_sections: ['Reading', 'Listening', 'Writing'],
      created_at: '2026-08-03T04:00:00.000Z'
    });
    session = createDynamicItem(session, 'Reading', getItemTypePreset('Reading', 'reading_single_choice')).session;
    session = upsertAnswer(session, session.questions[0], 'B', 1100) as DynamicPracticeSession;
    session = createDynamicItem(session, 'Reading', getItemTypePreset('Reading', 'reading_short_text')).session;
    session = upsertAnswer(session, session.questions[1], 'synthetic', 1200) as DynamicPracticeSession;
    session = finish(session, 'Reading');

    session = createDynamicItem(session, 'Listening', getItemTypePreset('Listening', 'listening_multiple_choice')).session;
    session = upsertAnswer(session, session.questions[2], ['A', 'C'], 1300) as DynamicPracticeSession;

    const saved = serializeSessionForPersistence(session);
    const continued = prepareRecoverySession(JSON.stringify(saved));
    expect(continued.ok).toBe(true);
    if (!continued.ok) return;
    session = continued.session as DynamicPracticeSession;
    expect(session.dynamic_sections[0]).toMatchObject({ item_ids: ['R1', 'R2'], next_item_ordinal: 3 });
    expect(session.dynamic_sections[1]).toMatchObject({ item_ids: ['L1'], next_item_ordinal: 2 });
    expect(session.modules).toEqual([]);
    expect(session.tasks).toEqual([]);
    expect(session.source_relative_path).toBeUndefined();
    expect(session.source_path).toBeUndefined();

    session = finish(session, 'Listening');
    session = createDynamicItem(session, 'Writing', getItemTypePreset('Writing', 'writing_email')).session;
    session = updateDynamicWritingText(session, 'W1', 'Synthetic long text.', 'insertText', 1400).session;
    session = upsertAnswer(session, session.questions[3], 'Synthetic long text.', 1400) as DynamicPracticeSession;
    session = finish(session, 'Writing');

    expect(session.view).toBe('SESSION_SUMMARY');
    expect(validateDynamicSession(session)).toEqual({ ok: true, errors: [] });
    expect(session.questions.map((item) => item.id)).toEqual(['R1', 'R2', 'L1', 'W1']);
    const bundle = buildSessionExportBundle(session, []);
    expect(Object.keys(bundle.files).sort()).toEqual([
      'Listening.md', 'Reading.md', 'Writing.md', 'answers.json', 'events.jsonl',
      'item_metrics.csv', 'section_metrics.csv', 'session_summary.md'
    ]);
    const combined = Object.values(bundle.files).join('\n');
    expect(combined).not.toMatch(/Speaking|Module|question_body|standard_answer/i);
  });
});
