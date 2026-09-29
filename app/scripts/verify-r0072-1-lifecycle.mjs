import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, '..');
const projectDirectory = resolve(appDirectory, '..');
const fixtureParent = join(projectDirectory, '.r0063-verification-fixtures');
const runId = `${Date.now()}-${process.pid}`;
const fixtureRoot = join(fixtureParent, `r0063-verification-${runId}`);
const appRoot = join(fixtureRoot, 'app');
const sourceRoot = join(fixtureRoot, 'source');
const sessionId = 'r0072-1-generated-lifecycle';
const r0063Marker = join(fixtureRoot, '.r0063-fixture-root.json');
const r00721Marker = join(fixtureRoot, '.r0072-1-disposable-root');
const protectedPaths = [
  join(projectDirectory, 'Demand', '最新Codex提示词.md'),
  join(projectDirectory, 'config', 'app-settings.local.json'),
  join(projectDirectory, 'config', 'app-settings.last-known-good.json'),
  join(projectDirectory, 'records'),
  join(projectDirectory, 'data'),
  join(projectDirectory, 'trash'),
  resolve(projectDirectory, '..', 'Organized_TOEFL_Resources')
];

function normalize(path) {
  return resolve(path).replaceAll('\\', '/').toLocaleLowerCase('en-US');
}

function fingerprint(path) {
  if (!existsSync(path)) return 'MISSING';
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) return 'SYMLINK';
  if (metadata.isFile()) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  return createHash('sha256')
    .update(`${normalize(path)}|${metadata.size}|${metadata.mtimeMs}|${metadata.mode}`)
    .digest('hex');
}

function assertSafeFixturePath() {
  if (dirname(fixtureRoot) !== fixtureParent) throw new Error('fixture parent mismatch');
  if (!/^r0063-verification-\d+-\d+$/u.test(basename(fixtureRoot))) {
    throw new Error('fixture name mismatch');
  }
  if (!normalize(fixtureRoot).startsWith(`${normalize(fixtureParent)}/`)) {
    throw new Error('fixture escapes verification parent');
  }
}

function createFixture() {
  assertSafeFixturePath();
  mkdirSync(fixtureParent, { recursive: true });
  if (existsSync(fixtureRoot)) throw new Error('fixture root already exists');
  for (const path of [
    sourceRoot,
    join(appRoot, 'records'),
    join(appRoot, 'typing_records'),
    join(appRoot, 'trash'),
    join(appRoot, 'data', 'recovery'),
    join(appRoot, 'logs'),
    join(appRoot, 'config', 'timing-profiles')
  ]) {
    mkdirSync(path, { recursive: true });
  }
  writeFileSync(
    r0063Marker,
    `${JSON.stringify({
      fixture_id: 'R006.3',
      root: fixtureRoot,
      scenario: 'verification',
      nonce: randomBytes(16).toString('hex')
    }, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' }
  );
  writeFileSync(r00721Marker, 'R007.2.1 marker-bound disposable lifecycle root\n', {
    encoding: 'utf8',
    flag: 'wx'
  });
  writeFileSync(
    join(sourceRoot, 'README.fixture.txt'),
    'Synthetic source stub. No formal source or user response content.\n',
    { encoding: 'utf8', flag: 'wx' }
  );
}

function requirePlainTree(path) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) throw new Error('fixture contains a symbolic link');
  if (!metadata.isDirectory()) return;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('fixture contains a symbolic link');
    requirePlainTree(join(path, entry.name));
  }
}

function cleanupFixture() {
  assertSafeFixturePath();
  if (!statSync(r0063Marker).isFile() || !statSync(r00721Marker).isFile()) {
    throw new Error('fixture cleanup marker missing');
  }
  const marker = JSON.parse(readFileSync(r0063Marker, 'utf8'));
  if (marker.fixture_id !== 'R006.3' || normalize(marker.root) !== normalize(fixtureRoot)) {
    throw new Error('fixture cleanup marker identity mismatch');
  }
  if (normalize(realpathSync(fixtureRoot)) !== normalize(fixtureRoot)) {
    throw new Error('fixture canonical root mismatch');
  }
  requirePlainTree(fixtureRoot);
  rmSync(fixtureRoot, { recursive: true });
  if (existsSync(fixtureRoot)) throw new Error('fixture cleanup incomplete');
  if (existsSync(fixtureParent) && readdirSync(fixtureParent).length === 0) {
    rmdirSync(fixtureParent);
  }
}

function identityArtifactPaths(path, found = []) {
  if (!existsSync(path)) return found;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.name.includes(sessionId)) found.push(child);
    if (entry.isDirectory() && !entry.isSymbolicLink()) identityArtifactPaths(child, found);
  }
  return found;
}

function protectedPathsAreStable(before) {
  return protectedPaths.every((path) => fingerprint(path) === before.get(path));
}

const protectedBefore = new Map(protectedPaths.map((path) => [path, fingerprint(path)]));
let passed = false;
let classification = 'NOT_RUN';
let artifactCount = -1;

try {
  createFixture();
  const result = spawnSync(
    'cargo',
    [
      'test',
      'records::tests::r0072_1_generated_lifecycle_acceptance',
      '--',
      '--ignored',
      '--exact'
    ],
    {
      cwd: join(appDirectory, 'src-tauri'),
      env: {
        ...process.env,
        TOEFL_R0063_FIXTURE_ROOT: fixtureRoot,
        TOEFL_R0063_SCENARIO: 'verification',
        R00721_VERIFY_ROOT: fixtureRoot
      },
      encoding: 'utf8',
      windowsHide: true
    }
  );
  if (result.error || result.status !== 0) throw new Error('generated lifecycle command failed');
  artifactCount = identityArtifactPaths(appRoot).length;
  if (artifactCount !== 0) throw new Error('generated identity artifacts remain');
  if (!protectedPathsAreStable(protectedBefore)) throw new Error('protected path fingerprint changed');
  classification = 'TERMINAL_IDENTITY_ABSENT';
  passed = true;
} catch {
  classification = 'VERIFIER_FAILURE_EVIDENCE_RETAINED';
} finally {
  if (passed) {
    try {
      cleanupFixture();
      if (!protectedPathsAreStable(protectedBefore)) {
        passed = false;
        classification = 'PROTECTED_PATH_CHANGED_AFTER_CLEANUP';
      }
    } catch {
      passed = false;
      classification = 'CLEANUP_FAILURE_EVIDENCE_RETAINED';
    }
  }
}

console.log(`IDENTITY=${sessionId}`);
console.log(`ARTIFACT_COUNT=${artifactCount < 0 ? 'UNKNOWN' : artifactCount}`);
console.log(`CLASSIFICATION=${classification}`);
console.log(`PATHS=APP_ROOT:${appRoot};SOURCE_ROOT:${sourceRoot};EVIDENCE_ROOT:${passed ? 'CLEANED' : fixtureRoot}`);
console.log(passed ? 'PASS' : 'FAIL');
if (!passed) process.exitCode = 1;
