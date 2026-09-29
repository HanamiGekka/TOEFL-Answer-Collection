import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import historicalV4 from './fixtures/r005_2_1_floating_session.json';
import { DEFAULT_BLUEPRINT } from '../blueprint';
import { prepareRecoverySession } from '../recovery';
import { buildSessionExportBundle } from '../sessionExport';

const fixturePath = resolve(process.cwd(), 'src/lib/__tests__/fixtures/r005_2_1_floating_session.json');
const expectedHash = '7c41fe92df79a3aa23381481bc3935fee72d739d624a68b6f7db2b1ad8de9e58';

describe('Legacy v4 recovery and export compatibility', () => {
  it('recovers the v4 fixture committed by schema-v4 code without changing its bytes', () => {
    const before = readFileSync(fixturePath);
    expect(createHash('sha256').update(before).digest('hex')).toBe(expectedHash);
    expect(historicalV4.session_schema_version).toBe(4);

    const prepared = prepareRecoverySession(before.toString('utf8'), [DEFAULT_BLUEPRINT.blueprint_id]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared).toMatchObject({ migrated: true, resume_policy: { paused: true, reuse_monotonic_anchor: false } });
    expect(prepared.session).toMatchObject({
      session_id: 'r005-2-1-floating-fixture', session_schema_version: 5
    });
    expect(prepared.session.answers['Reading-1']).toMatchObject({ answer_value: 'A', is_uncertain: true });
    expect(prepared.session.answers['Reading-2']).toMatchObject({ is_skipped: true });
    const exported = buildSessionExportBundle(prepared.session, []);
    expect(JSON.parse(exported.files['answers.json']).session_id).toBe('r005-2-1-floating-fixture');
    expect(createHash('sha256').update(readFileSync(fixturePath)).digest('hex')).toBe(expectedHash);
  });
});
