import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];
const script = resolve(process.cwd(), 'scripts/audit-session-export.mjs');
const fixtures = resolve(process.cwd(), 'scripts/fixtures');

afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
});

describe('R006.1.2 read-only Session acceptance auditor', () => {
  it.each(['synthetic-complete-session', 'synthetic-incomplete-session'])('passes %s', (name) => {
    const result = spawnSync(process.execPath, [script, resolve(fixtures, name)], { encoding: 'utf8' });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('PASS');
  });

  it('returns non-zero for a duplicate event sequence without modifying the fixture', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'r006-1-2-auditor-'));
    temporaryDirectories.push(directory);
    cpSync(resolve(fixtures, 'synthetic-complete-session'), directory, { recursive: true });
    const eventsPath = resolve(directory, 'events.jsonl');
    const duplicate = '{"session_id":"synthetic-complete","seq":2,"monotonic_elapsed_ms":1000,"wall_clock":"2026-07-19T01:00:01.000Z","event_type":"session_completed","payload":{},"schema_version":1}\n';
    writeFileSync(eventsPath, duplicate + duplicate, 'utf8');
    const before = duplicate + duplicate;

    const result = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('FAIL');
    expect(readFileSync(eventsPath, 'utf8')).toBe(before);
  });
});
