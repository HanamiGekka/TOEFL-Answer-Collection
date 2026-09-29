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
const fixtureParent = join(projectDirectory, '.r0073-verification-fixtures');
const fixtureRoot = join(fixtureParent, `r0073-verification-${Date.now()}-${process.pid}`);
const appRoot = join(fixtureRoot, 'app');
const sourceRoot = join(fixtureRoot, 'source');
const sessionId = 'r0073-generated-dynamic';
const legacySessionId = 'r0073-legacy-v5-readable';
const compatibilityMarker = join(fixtureRoot, '.r0063-fixture-root.json');
const r0073Marker = join(fixtureRoot, '.r0073-disposable-root');
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
  if (metadata.isFile()) return createHash('sha256').update(readFileSync(path)).digest('hex');
  return createHash('sha256')
    .update(`${normalize(path)}|${metadata.size}|${metadata.mtimeMs}|${metadata.mode}`)
    .digest('hex');
}

function assertSafeFixturePath() {
  if (dirname(fixtureRoot) !== fixtureParent) throw new Error('fixture parent mismatch');
  if (!/^r0073-verification-\d+-\d+$/u.test(basename(fixtureRoot))) throw new Error('fixture name mismatch');
  if (!normalize(fixtureRoot).startsWith(`${normalize(fixtureParent)}/`)) {
    throw new Error('fixture escapes verification parent');
  }
}

function createFixture() {
  assertSafeFixturePath();
  cleanupVerifiedStaleFixtures();
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
  ]) mkdirSync(path, { recursive: true });
  writeFileSync(
    compatibilityMarker,
    `${JSON.stringify({
      fixture_id: 'R006.3',
      root: fixtureRoot,
      scenario: 'verification',
      nonce: randomBytes(16).toString('hex')
    }, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' }
  );
  writeFileSync(r0073Marker, 'R007.3 marker-bound disposable dynamic lifecycle root\n', {
    encoding: 'utf8', flag: 'wx'
  });
  writeFileSync(join(sourceRoot, 'README.fixture.txt'), 'Synthetic metadata-only source stub.\n', {
    encoding: 'utf8', flag: 'wx'
  });
}

function cleanupVerifiedStaleFixtures() {
  if (!existsSync(fixtureParent)) return;
  for (const entry of readdirSync(fixtureParent, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^r0073-verification-\d+-\d+$/u.test(entry.name)) continue;
    const staleRoot = join(fixtureParent, entry.name);
    const staleCompatibilityMarker = join(staleRoot, '.r0063-fixture-root.json');
    const staleRoundMarker = join(staleRoot, '.r0073-disposable-root');
    if (!existsSync(staleCompatibilityMarker) || !existsSync(staleRoundMarker)) continue;
    const marker = JSON.parse(readFileSync(staleCompatibilityMarker, 'utf8'));
    if (marker.fixture_id !== 'R006.3' || normalize(marker.root) !== normalize(staleRoot)) continue;
    if (normalize(realpathSync(staleRoot)) !== normalize(staleRoot)) continue;
    requirePlainTree(staleRoot);
    rmSync(staleRoot, { recursive: true });
  }
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
  if (!statSync(compatibilityMarker).isFile() || !statSync(r0073Marker).isFile()) {
    throw new Error('fixture cleanup marker missing');
  }
  const marker = JSON.parse(readFileSync(compatibilityMarker, 'utf8'));
  if (marker.fixture_id !== 'R006.3' || normalize(marker.root) !== normalize(fixtureRoot)) {
    throw new Error('fixture cleanup marker identity mismatch');
  }
  if (normalize(realpathSync(fixtureRoot)) !== normalize(fixtureRoot)) {
    throw new Error('fixture canonical root mismatch');
  }
  requirePlainTree(fixtureRoot);
  rmSync(fixtureRoot, { recursive: true });
  if (existsSync(fixtureRoot)) throw new Error('fixture cleanup incomplete');
  if (existsSync(fixtureParent) && readdirSync(fixtureParent).length === 0) rmdirSync(fixtureParent);
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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: appDirectory,
    env: {
      ...process.env,
      TOEFL_R0063_FIXTURE_ROOT: fixtureRoot,
      TOEFL_R0063_SCENARIO: 'verification',
      R0073_VERIFY_ROOT: fixtureRoot
    },
    encoding: 'utf8',
    windowsHide: true,
    ...options
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed\n${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim());
  }
}

cleanupVerifiedStaleFixtures();
const protectedBefore = new Map(protectedPaths.map((path) => [path, fingerprint(path)]));
const gitBefore = spawnSync('git', ['status', '--short'], { cwd: projectDirectory, encoding: 'utf8', windowsHide: true }).stdout;
let passed = false;
let classification = 'NOT_RUN';
let artifactCount = -1;
let diagnostic = '';

try {
  createFixture();
  run(process.execPath, [
    join(appDirectory, 'node_modules', 'vitest', 'vitest.mjs'),
    'run', '--run', 'src/lib/__tests__/r007-3-verifier-flow.test.ts'
  ]);
  run('cargo', [
    'test',
    'records::tests::r0073_generated_dynamic_lifecycle_acceptance',
    '--', '--ignored', '--exact'
  ], { cwd: join(appDirectory, 'src-tauri') });
  artifactCount = identityArtifactPaths(appRoot).length;
  if (artifactCount !== 0) throw new Error('generated dynamic identity artifacts remain');
  if (!protectedPaths.every((path) => fingerprint(path) === protectedBefore.get(path))) {
    throw new Error('protected source or normal APP_ROOT fingerprint changed');
  }
  passed = true;
  classification = 'TERMINAL_IDENTITY_ABSENT';
} catch (error) {
  diagnostic = error instanceof Error ? error.message : String(error);
  classification = 'VERIFIER_FAILURE_EVIDENCE_RETAINED';
} finally {
  if (passed) {
    try {
      cleanupFixture();
      const gitAfter = spawnSync('git', ['status', '--short'], { cwd: projectDirectory, encoding: 'utf8', windowsHide: true }).stdout;
      if (gitAfter !== gitBefore) throw new Error('disposable verifier data changed Git status');
      if (!protectedPaths.every((path) => fingerprint(path) === protectedBefore.get(path))) {
        throw new Error('protected fingerprint changed after cleanup');
      }
    } catch (error) {
      passed = false;
      diagnostic = error instanceof Error ? error.message : String(error);
      classification = 'CLEANUP_FAILURE_EVIDENCE_RETAINED';
    }
  }
}

console.log(`IDENTITY=${sessionId}`);
console.log(`LEGACY_IDENTITY=${legacySessionId}:READABLE`);
console.log(`ARTIFACT_COUNT=${artifactCount < 0 ? 'UNKNOWN' : artifactCount}`);
console.log(`CLASSIFICATION=${classification}`);
console.log(`PATHS=APP_ROOT:${appRoot};SOURCE_ROOT:${sourceRoot};EVIDENCE_ROOT:${passed ? 'CLEANED' : fixtureRoot}`);
if (diagnostic) console.log(`DIAGNOSTIC=${diagnostic}`);
console.log(passed ? 'PASS' : 'FAIL');
if (!passed) process.exitCode = 1;
