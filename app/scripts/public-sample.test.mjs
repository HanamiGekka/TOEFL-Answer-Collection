import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDynamicSession } from '../src/lib/dynamicSession';

const root = resolve('..', 'samples');
const packageId = 'Mock.99.Z.1';

describe('R008.6 public synthetic package', () => {
  it('contains only declared structure placeholders', () => {
    expect(readdirSync(root).sort()).toEqual(['Mock.99.Z.1', 'README.md']);
    expect(readdirSync(resolve(root, packageId)).sort()).toEqual(['Listening', 'Reading', 'Writing']);
    for (const section of ['Reading', 'Listening', 'Writing']) {
      expect(readdirSync(resolve(root, packageId, section))).toEqual(['README.txt']);
      const content = readFileSync(resolve(root, packageId, section, 'README.txt'), 'utf8');
      expect(content).toContain('SYNTHETIC STRUCTURE ONLY');
      expect(content).not.toMatch(/\d{2}\.\d{2}\.[A-Z]\.\d+|Organized_TOEFL_Resources|[A-Z]:\\Users\\|answer key|official audio/iu);
    }
  });

  it('uses the existing v6 Session contract without a sample import feature', () => {
    const session = createDynamicSession({
      session_id: 'synthetic-public-example',
      package_id: packageId,
      source_relative_path: packageId,
      mode: 'practice',
      selected_sections: ['Reading', 'Listening', 'Writing'],
      created_at: '2026-01-01T00:00:00.000Z'
    });
    expect(session.session_schema_version).toBe(6);
    expect(session.structure_mode).toBe('dynamic_manual');
    expect(session.selected_sections).toEqual(['Reading', 'Listening', 'Writing']);
    expect(JSON.stringify(session)).not.toContain('source_path');
  });
});
