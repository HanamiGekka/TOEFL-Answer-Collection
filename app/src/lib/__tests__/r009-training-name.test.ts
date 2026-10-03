import { describe, expect, it } from 'vitest';
import { createDynamicSession, validateDynamicSession } from '../dynamicSession';
import { validateTrainingName } from '../trainingName';
import { buildSessionExportBundle } from '../sessionExport';

describe('R009 training identity', () => {
  it('requires a name and accepts Unicode without source metadata', () => {
    expect(validateTrainingName('   ').error).toBe('required');
    const name = validateTrainingName('  第3套練習 Test  ').name;
    expect(name).toBe('第3套練習 Test');
    const session = createDynamicSession({ session_id: 'r009-synthetic', package_id: name, mode: 'practice', selected_sections: ['Reading'] });
    expect(session.package_id).toBe(name);
    expect(session.session_schema_version).toBe(6);
    expect(session.source_relative_path).toBeUndefined();
    expect(validateDynamicSession(session).ok).toBe(true);
    const exported = buildSessionExportBundle(session, []);
    expect(exported.files['session_summary.md']).toContain(`Training name: ${name}`);
    expect(JSON.parse(exported.files['answers.json']).package_id).toBe(name);
    expect(exported.files['answers.json']).not.toContain('source_relative_path');
  });

  it('rejects unsafe Windows identities and names over 80 visible characters', () => {
    for (const name of ['a/b', 'a\\b', 'a:b', 'a<b', 'a>b', 'a"b', 'a|b', 'a?b', 'a*b', '...', 'CON', 'LPT1.txt', 'a\n', 'name.']) {
      expect(validateTrainingName(name).error).toBe('unsafe');
    }
    expect(validateTrainingName('字'.repeat(81)).error).toBe('tooLong');
  });
});
