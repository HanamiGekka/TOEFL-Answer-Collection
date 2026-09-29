#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const args = process.argv.slice(2);
const directoryArg = args.shift();
let preSnapshotPath;
let preEventsPath;
let reportPath;
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index];
  const value = args[index + 1];
  if (!value || !['--pre-snapshot', '--pre-events', '--json-report'].includes(flag)) {
    console.error('Usage: npm run audit:session -- <export-directory> [--pre-snapshot file] [--pre-events file] [--json-report file]');
    process.exit(2);
  }
  if (flag === '--pre-snapshot') preSnapshotPath = resolve(value);
  if (flag === '--pre-events') preEventsPath = resolve(value);
  if (flag === '--json-report') reportPath = resolve(value);
}
if (!directoryArg) {
  console.error('Usage: npm run audit:session -- <export-directory>');
  process.exit(2);
}

const directory = resolve(directoryArg);
const findings = [];
const fail = (code, message) => findings.push({ level: 'FAIL', code, message });
const warn = (code, message) => findings.push({ level: 'WARN', code, message });
const pass = (code, message) => findings.push({ level: 'PASS', code, message });
const check = (condition, code, message) => condition ? pass(code, message) : fail(code, message);

function readRequired(name) {
  const path = resolve(directory, name);
  if (!existsSync(path)) {
    fail('FILE_MISSING', `Required export file is missing: ${name}`);
    return undefined;
  }
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    fail('FILE_UNREADABLE', `Unable to read ${name}: ${error.message}`);
    return undefined;
  }
}

function parseJson(name) {
  const raw = readRequired(name);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail('JSON_INVALID', `${name} is not valid JSON: ${error.message}`);
    return undefined;
  }
}

function parseJsonl(name, rawOverride) {
  const raw = rawOverride ?? readRequired(name);
  if (raw === undefined) return [];
  const values = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      values.push(JSON.parse(line));
    } catch (error) {
      fail('EVENT_JSON_INVALID', `${name} line ${index + 1} is invalid JSON: ${error.message}`);
    }
  }
  return values;
}

function parseCsv(name) {
  const raw = readRequired(name);
  if (raw === undefined) return [];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quoted) {
      if (char === '"' && raw[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (quoted) fail('CSV_INVALID', `${name} has an unterminated quoted field`);
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).filter((value) => value.some(Boolean)).map((value) =>
    Object.fromEntries(headers.map((header, index) => [header, value[index] ?? '']))
  );
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function finiteNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

const LISTENING_BLUEPRINT_LAYOUTS = new Map([
  ['1.1.0', [
    { moduleId: 'LISTENING_SECTION', first: 1, last: 47 }
  ]],
  ['1.2.0', [
    { moduleId: 'LISTENING_MODULE_1', first: 1, last: 35 },
    { moduleId: 'LISTENING_MODULE_2', first: 36, last: 47 }
  ]],
  ['1.3.0', [
    { moduleId: 'LISTENING_MODULE_1', first: 1, last: 32 },
    { moduleId: 'LISTENING_MODULE_2', first: 33, last: 47 }
  ]]
]);

function listeningQuestionIds(first, last) {
  return Array.from({ length: last - first + 1 }, (_, index) => `Listening-${first + index}`);
}

function auditListeningBlueprint(answers, questions) {
  const listening = (answers.sections ?? []).find((section) => section.section_id === 'Listening');
  if (!listening) return;

  const expectedLayout = LISTENING_BLUEPRINT_LAYOUTS.get(answers.blueprint_version);
  if (!expectedLayout) {
    warn(
      'LISTENING_BLUEPRINT_UNKNOWN',
      `Listening topology is not registered for Blueprint version ${answers.blueprint_version}`
    );
  } else {
    const actualModules = listening.modules ?? [];
    check(
      actualModules.length === expectedLayout.length,
      'LISTENING_BLUEPRINT_SNAPSHOT_MISMATCH',
      `Blueprint ${answers.blueprint_version} Listening module count matches its persisted Snapshot`
    );
    for (const [index, expected] of expectedLayout.entries()) {
      const actual = actualModules[index];
      const expectedQuestionIds = listeningQuestionIds(expected.first, expected.last);
      check(
        actual?.module_id === expected.moduleId && same(actual?.question_ids ?? [], expectedQuestionIds),
        'LISTENING_BLUEPRINT_SNAPSHOT_MISMATCH',
        `Blueprint ${answers.blueprint_version} expects ${expected.moduleId} = Listening-${expected.first}..Listening-${expected.last}`
      );
    }
  }

  const listeningModules = listening.modules ?? [];
  const moduleQuestionIds = listeningModules.flatMap((module) => module.question_ids ?? []);
  const uniqueQuestionIds = new Set(moduleQuestionIds);
  const expectedQuestionIds = listeningQuestionIds(1, 47);
  check(moduleQuestionIds.length === 47, 'LISTENING_TOTAL', 'Listening persisted Modules contain 47 Question IDs');
  check(uniqueQuestionIds.size === moduleQuestionIds.length, 'LISTENING_DUPLICATE', 'Listening persisted Modules contain no duplicate Question IDs');
  check(
    same([...uniqueQuestionIds].sort((left, right) => Number(left.split('-')[1]) - Number(right.split('-')[1])), expectedQuestionIds),
    'LISTENING_CONTIGUOUS',
    'Listening persisted Modules contain every contiguous Question ID from Listening-1 through Listening-47'
  );

  for (const module of listeningModules) {
    const ids = module.question_ids ?? [];
    const numbers = ids.map((id) => /^Listening-(\d+)$/u.exec(id)).map((match) => match ? Number(match[1]) : Number.NaN);
    check(
      numbers.every((number, index) => Number.isInteger(number) && (index === 0 || number === numbers[index - 1] + 1)),
      'LISTENING_MODULE_CONTIGUOUS',
      `Module ${module.module_id} Question IDs are ordered and contiguous`
    );
    for (const questionId of ids) {
      check(
        questions.get(questionId)?.module_id === module.module_id,
        'LISTENING_MODULE_MEMBERSHIP',
        `${questionId} persisted module identity matches ${module.module_id}`
      );
    }
  }

  const moduleActiveTime = listeningModules.reduce((sum, module) => sum + module.active_time_ms, 0);
  check(
    listening.active_time_ms === moduleActiveTime,
    'LISTENING_ACTIVE_SUM',
    'Listening Section active time equals the sum of persisted Listening Modules'
  );
}

function auditMilliseconds(value, path = 'answers') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => auditMilliseconds(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (key.endsWith('_ms') && child !== null) {
      check(finiteNonNegativeInteger(child), 'TIME_INTEGER', `${childPath} is a non-negative safe integer`);
    }
    auditMilliseconds(child, childPath);
  }
}

const answers = parseJson('answers.json');
const recordIndex = parseJson('record-index.json');
const events = parseJsonl('events.jsonl');
const questionRows = parseCsv('question_metrics.csv');
const taskRows = parseCsv('task_metrics.csv');
readRequired('session_summary.md');

if (answers && recordIndex) {
  for (const field of ['session_id', 'package_id', 'blueprint_id', 'blueprint_version', 'app_version']) {
    check(answers[field] === recordIndex[field], 'IDENTITY_MATCH', `${field} matches answers.json and record-index.json`);
  }
  check(answers.schema_version === recordIndex.schema_version, 'SCHEMA_MATCH', 'Session schema identity matches');
  check(recordIndex.record_type === 'TOEFL', 'RECORD_TYPE', 'Record type is TOEFL');
  check(recordIndex.record_id === `TOEFL:${answers.session_id}`, 'RECORD_ID', 'Record identity is stable record_type + session_id');
  check(recordIndex.relative_path?.split(/[\\/]/).at(-1)?.endsWith(answers.session_id), 'RECORD_PATH', 'Export path ends with the Session ID');
  const expectedCompletion = answers.ended_at ? 'COMPLETED' : 'INCOMPLETE';
  check(recordIndex.completion_status === expectedCompletion, 'COMPLETION_STATUS', `Completion status is ${expectedCompletion}`);
  check(recordIndex.export_status === 'EXPORTED', 'EXPORT_STATUS', 'Export status is EXPORTED');

  const indexed = new Set(recordIndex.file_names ?? []);
  for (const name of indexed) check(existsSync(resolve(directory, name)), 'INDEXED_FILE', `Indexed file exists: ${name}`);
  for (const required of ['session_summary.md', 'answers.json', 'events.jsonl', 'question_metrics.csv', 'task_metrics.csv']) {
    check(indexed.has(required), 'INDEX_FILE_SET', `record-index includes ${required}`);
  }
  for (const section of answers.sections ?? []) {
    check(indexed.has(`${section.section_id}.md`) && existsSync(resolve(directory, `${section.section_id}.md`)), 'SECTION_FILE', `${section.section_id}.md is indexed and present`);
  }

  auditMilliseconds(answers);
  auditMilliseconds(recordIndex, 'record-index');

  const questions = new Map((answers.questions ?? []).map((question) => [question.question_id, question]));
  const questionCsv = new Map(questionRows.map((row) => [row.question_id, row]));
  check(questions.size === questionCsv.size, 'QUESTION_COUNT', 'answers.json and question_metrics.csv question counts match');
  for (const [questionId, question] of questions) {
    const row = questionCsv.get(questionId);
    check(Boolean(row), 'QUESTION_ROW', `Question metric row exists for ${questionId}`);
    if (row) {
      check(row.section === question.section_id && row.module === question.module_id, 'QUESTION_IDENTITY', `Question identity matches for ${questionId}`);
      check(Number(row.active_time_ms) === question.active_time_ms, 'QUESTION_TIME', `Question timing matches for ${questionId}`);
    }
  }
  auditListeningBlueprint(answers, questions);

  const tasks = new Map((answers.tasks ?? []).map((task) => [task.task_id, task]));
  const taskCsv = new Map(taskRows.map((row) => [row.task_id, row]));
  check(tasks.size === taskCsv.size, 'TASK_COUNT', 'answers.json and task_metrics.csv task counts match');
  for (const [taskId, task] of tasks) {
    const row = taskCsv.get(taskId);
    check(Boolean(row), 'TASK_ROW', `Task metric row exists for ${taskId}`);
    if (row) {
      check(Number(row.active_time_ms) === task.active_time_ms, 'TASK_TIME', `Task timing matches for ${taskId}`);
      check(Number(row.attempt_count) === task.attempt_count, 'TASK_ATTEMPT', `Task attempt count matches for ${taskId}`);
    }
    const questionTime = (task.question_ids ?? []).reduce((sum, questionId) => sum + (questions.get(questionId)?.active_time_ms ?? 0), 0);
    check(task.active_time_ms === questionTime, 'TASK_LEDGER', `Task ${taskId} equals its mapped Question timing`);
    const speakingAnswerValue = questions.get(task.question_ids?.[0])?.answer_value;
    if (task.section_id === 'Speaking' && (task.attempt_count > 0 || speakingAnswerValue !== null)) {
      check(
        speakingAnswerValue && typeof speakingAnswerValue === 'object' && speakingAnswerValue.attempt_count === task.attempt_count,
        'SPEAKING_ATTEMPT',
        `Speaking Answer and Task attempt_count match for ${taskId}`
      );
    }
  }

  let attributed = 0;
  for (const section of answers.sections ?? []) {
    let sectionTotal = 0;
    for (const module of section.modules ?? []) {
      let moduleTotal;
      if (section.section_id === 'Writing' || section.section_id === 'Speaking') {
        moduleTotal = [...tasks.values()]
          .filter((task) => (task.question_ids ?? []).some((id) => (module.question_ids ?? []).includes(id)))
          .reduce((sum, task) => sum + task.active_time_ms, 0);
      } else {
        moduleTotal = (module.question_ids ?? []).reduce((sum, id) => sum + (questions.get(id)?.active_time_ms ?? 0), 0);
      }
      check(module.active_time_ms === moduleTotal, 'MODULE_LEDGER', `Module ${module.module_id} ledger reconciles`);
      sectionTotal += module.active_time_ms;
    }
    check(section.active_time_ms === sectionTotal, 'SECTION_LEDGER', `Section ${section.section_id} ledger reconciles`);
    attributed += section.active_time_ms;
  }
  check(answers.active_time_ms === attributed + answers.unattributed_active_time_ms, 'SESSION_LEDGER', 'Session = Sections + unattributed active time');
  check(recordIndex.active_time_ms === answers.active_time_ms && recordIndex.pause_time_ms === answers.pause_time_ms, 'INDEX_LEDGER', 'Record index active/pause timing matches answers.json');
}

const seenSeq = new Set();
let priorSeq = -1;
for (const event of events) {
  check(event.session_id === answers?.session_id, 'EVENT_SESSION', `Event seq ${event.seq} belongs to the exported Session`);
  check(finiteNonNegativeInteger(event.seq), 'EVENT_SEQ_INTEGER', `Event seq ${event.seq} is a non-negative safe integer`);
  check(!seenSeq.has(event.seq), 'EVENT_SEQ_UNIQUE', `Event seq ${event.seq} is unique`);
  check(event.seq > priorSeq, 'EVENT_SEQ_ORDER', `Event seq ${event.seq} is strictly increasing`);
  check(Number.isFinite(Date.parse(event.wall_clock)), 'EVENT_WALL_CLOCK', `Event seq ${event.seq} has a valid wall clock`);
  seenSeq.add(event.seq);
  priorSeq = event.seq;
}

function duplicateSemanticEvents(eventType, keyOf) {
  const keys = new Set();
  for (const event of events.filter((value) => value.event_type === eventType)) {
    const key = keyOf(event);
    if (!key) continue;
    check(!keys.has(key), 'EVENT_SEMANTIC_UNIQUE', `${eventType} semantic key ${key} is unique`);
    keys.add(key);
  }
}
duplicateSemanticEvents('task_overtime', (event) => event.payload?.task_id);
duplicateSemanticEvents('scope_finalized', (event) => event.payload?.scope_id ?? event.payload?.module_id);
duplicateSemanticEvents('speaking_task_result', (event) => {
  const task = event.payload?.task_id;
  const attempt = event.payload?.attempt ?? event.payload?.attempt_count;
  const outcome = event.payload?.outcome;
  return task && attempt !== undefined && outcome ? `${task}:${attempt}:${outcome}` : undefined;
});
check(events.filter((event) => event.event_type === 'session_completed').length <= 1, 'SESSION_COMPLETED_EVENT', 'session_completed occurs at most once');

if (preEventsPath) {
  const before = parseJsonl(basename(preEventsPath), readFileSync(preEventsPath, 'utf8'));
  const currentBySeq = new Map(events.map((event) => [event.seq, event]));
  for (const event of before) {
    check(same(currentBySeq.get(event.seq), event), 'PRE_EVENT_RETAINED', `Pre-recovery event seq ${event.seq} is retained unchanged`);
  }
  if (before.length && events.length > before.length) {
    check(events[before.length].seq > before.at(-1).seq, 'EVENT_APPEND_BOUNDARY', 'Post-recovery events append after the old maximum seq');
  }
}

if (preSnapshotPath && answers) {
  const before = JSON.parse(readFileSync(preSnapshotPath, 'utf8'));
  const beforeTasks = new Map((before.tasks ?? []).map((task) => [task.task_id, task]));
  const afterTasks = new Map((answers.tasks ?? []).map((task) => [task.task_id, task]));
  for (const [taskId, task] of beforeTasks) {
    const after = afterTasks.get(taskId);
    check(Boolean(after), 'PRE_TASK_RETAINED', `Pre-recovery task ${taskId} is retained`);
    if (after) {
      check(after.attempt_count >= task.attempt_count, 'ATTEMPT_MONOTONIC', `Task ${taskId} attempt count does not regress`);
      if (task.section_id === 'Speaking' && task.status === 'COMPLETED' && after.attempt_count > task.attempt_count) {
        const retryRecorded = events.some((event) =>
          event.event_type === 'speaking_task_retried'
          && event.payload?.task_id === taskId
          && event.payload?.attempt_count > task.attempt_count
        );
        check(retryRecorded, 'ATTEMPT_RETRY_EVIDENCE', `Speaking task ${taskId} only increases after an explicit retry event`);
      }
    }
  }
}

if ((answers?.tasks ?? []).some((task) => task.section_id === 'Speaking')) {
  warn('SPEAKING_EVIDENCE', 'Speaking attempt retention is checked against task_metrics.csv; use --pre-snapshot and --pre-events for cross-recovery proof.');
}

const failures = findings.filter((item) => item.level === 'FAIL');
const warnings = findings.filter((item) => item.level === 'WARN');
const report = {
  audit_schema: 'r007.1-session-audit-v2',
  directory,
  result: failures.length ? 'FAIL' : 'PASS',
  failure_count: failures.length,
  warning_count: warnings.length,
  findings
};
for (const finding of findings) console.log(`${finding.level} ${finding.code}: ${finding.message}`);
console.log(`${report.result}: ${findings.length - failures.length - warnings.length} checks passed, ${warnings.length} warnings, ${failures.length} failures.`);
if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.exitCode = failures.length ? 1 : 0;
