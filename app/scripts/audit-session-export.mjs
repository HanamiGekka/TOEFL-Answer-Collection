#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const [directoryArg, flag, reportArg, ...extra] = process.argv.slice(2);
if (!directoryArg || extra.length || (flag && (flag !== '--json-report' || !reportArg))) {
  console.error('Usage: npm run audit:session -- <export-directory> [--json-report file]');
  process.exit(2);
}
const directory = resolve(directoryArg);
const findings = [];
function check(ok, code) { if (!ok) findings.push(code); }
function milliseconds(value) { return Number.isSafeInteger(value) && value >= 0; }
try {
  const answers = JSON.parse(readFileSync(resolve(directory, 'answers.json'), 'utf8'));
  const index = JSON.parse(readFileSync(resolve(directory, 'record-index.json'), 'utf8'));
  const events = readFileSync(resolve(directory, 'events.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  check(answers.schema_version === 'practice-session-v6' && answers.structure_mode === 'dynamic_manual', 'UNSUPPORTED_SESSION_SCHEMA');
  check(index.session_id === answers.session_id && index.package_id === answers.package_id && index.record_id === `TOEFL:${answers.session_id}`, 'RECORD_IDENTITY');
  check(index.schema_version === answers.schema_version && index.structure_mode === answers.structure_mode, 'RECORD_FORMAT');
  check(basename(directory).endsWith(`_${answers.session_id.replace(/[^A-Za-z0-9._-]/g, '_')}`), 'DIRECTORY_IDENTITY');
  check(milliseconds(answers.active_time_ms) && milliseconds(answers.pause_time_ms), 'SESSION_TIME');
  const ids = new Set();
  let total = 0;
  for (const section of answers.sections ?? []) {
    check(['Reading', 'Listening', 'Writing'].includes(section.section_id), 'SECTION_ID');
    check(section.item_ids.length === section.created_item_count && section.next_item_ordinal === section.item_ids.length + 1, 'ITEM_ORDINAL');
    let active = 0;
    for (const [offset, id] of section.item_ids.entries()) {
      check(!ids.has(id) && id === `${section.section_id[0]}${offset + 1}`, 'ITEM_IDENTITY');
      ids.add(id);
      const item = answers.items.find(candidate => candidate.item_id === id);
      check(item?.section_id === section.section_id && item?.ordinal === offset + 1, 'ITEM_MEMBERSHIP');
      check(milliseconds(item?.timing?.active_time_ms) && milliseconds(item?.timing?.pause_time_ms), 'ITEM_TIME');
      check(['single_choice','multiple_choice','short_text','long_text'].includes(item?.renderer), 'ITEM_RENDERER');
      active += item?.timing?.active_time_ms ?? 0;
    }
    check(milliseconds(section.active_time_ms) && active === section.active_time_ms && milliseconds(section.pause_time_ms), 'SECTION_TIME');
    total += active;
    check(existsSync(resolve(directory, `${section.section_id}.md`)), 'SECTION_FILE');
  }
  check(ids.size === answers.items?.length && answers.items.every(item => ids.has(item.item_id)), 'ITEM_SET');
  check(total + (answers.unattributed_active_time_ms ?? 0) === answers.active_time_ms, 'TIME_LEDGER');
  const sequences = new Set();
  let previous = 0;
  for (const event of events) {
    check(event.session_id === answers.session_id && Number.isSafeInteger(event.seq) && event.seq > previous && !sequences.has(event.seq), 'EVENT_SEQUENCE');
    check(milliseconds(event.monotonic_elapsed_ms), 'EVENT_TIME');
    sequences.add(event.seq); previous = event.seq;
  }
  for (const name of ['session_summary.md','item_metrics.csv','section_metrics.csv']) check(existsSync(resolve(directory,name)), 'REQUIRED_FILE');
} catch (error) { findings.push(`INVALID_EXPORT: ${error.message}`); }
const result = { status: findings.length ? 'FAIL' : 'PASS', schema: 'practice-session-v6', findings };
if (reportArg) writeFileSync(resolve(reportArg), JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
process.exitCode = findings.length ? 1 : 0;
