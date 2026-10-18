import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const stageParent = dirname(sourceRoot);
const manifest = JSON.parse(readFileSync(join(sourceRoot, 'scripts/public-release/allowlist.json'), 'utf8'));
const exactFiles = new Set(manifest.files);
const reviewedIcons = new Map([
  ['app/src-tauri/icons/32x32.png', 32],
  ['app/src-tauri/icons/128x128.png', 128],
  ['app/src-tauri/icons/128x128@2x.png', 256],
  ['app/src-tauri/icons/icon.png', 512],
  ['app/src-tauri/icons/icon.ico', 256],
]);
const reviewedPresentation = new Map([
  ['docs/images/home-and-typing-v1.0.1.jpg', '93909becab7af20c83fda2d8568cb12de27789a2b030c40f0fee37c0b7f62cf9'],
]);
const allowedExtensions = new Set(['.cjs', '.css', '.csv', '.html', '.json', '.jsonl', '.md', '.mjs', '.rs', '.toml', '.ts', '.tsx', '.txt', '.yml']);
const forbiddenDirectories = new Set(['.git', 'Demand', 'Code prompt', 'data', 'records', 'typing_records', 'trash', 'exports', 'logs', 'backups', 'temp', 'local_assets', 'release-artifacts', 'Recovery', 'Organized_TOEFL_Resources', 'private_data', 'real_data']);
const markerName = '.r0086-public-stage-marker';
const privateSessionId = ['07', '29', 'A', '1'].join('.');
const privateProfileNumber = ['86', '157'].join('');

function normalized(path) { return path.replaceAll('\\', '/'); }
function isAllowed(path) { return exactFiles.has(path) || manifest.directories.some((prefix) => path.startsWith(prefix)); }
function assert(condition, message) { if (!condition) throw new Error(message); }

function verifyReviewedIcon(path, buffer) {
  assert(buffer.length > 100 && buffer.length <= 1_000_000, `Invalid icon size: ${path}`);
  const dimension = reviewedIcons.get(path);
  if (extname(path) === '.png') {
    assert(buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `Invalid PNG: ${path}`);
    assert(buffer.toString('ascii', 12, 16) === 'IHDR', `Missing PNG header: ${path}`);
    assert(buffer.readUInt32BE(16) === dimension && buffer.readUInt32BE(20) === dimension, `Unexpected PNG dimensions: ${path}`);
  } else {
    assert(buffer.readUInt16LE(0) === 0 && buffer.readUInt16LE(2) === 1 && buffer.readUInt16LE(4) > 0, `Invalid Windows icon: ${path}`);
    const entries = buffer.readUInt16LE(4);
    assert(buffer.length >= 6 + entries * 16, `Truncated Windows icon: ${path}`);
    assert([...Array(entries)].some((_, i) => buffer[6 + i * 16] === 0 && buffer[7 + i * 16] === 0), `Missing ${dimension}px Windows icon: ${path}`);
  }
}

function sourceFiles() {
  const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: sourceRoot, encoding: 'buffer' });
  assert(result.status === 0, 'Cannot enumerate source files from Git');
  return [...new Set(result.stdout.toString('utf8').split('\0').filter(Boolean).map(normalized))]
    .filter((path) => existsSync(resolve(sourceRoot, path))).sort();
}

function copyAllowedFiles(candidate) {
  let count = 0;
  for (const path of sourceFiles()) {
    if (!isAllowed(path)) continue;
    const source = resolve(sourceRoot, path);
    assert(source.startsWith(sourceRoot + sep), `Source escapes repository: ${path}`);
    const meta = lstatSync(source);
    assert(meta.isFile() && !meta.isSymbolicLink(), `Not a regular source file: ${path}`);
    const destination = resolve(candidate, path);
    assert(destination.startsWith(candidate + sep), `Destination escapes snapshot: ${path}`);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    count += 1;
  }
  assert(count > 100, `Unexpectedly small public snapshot: ${count} files`);
  return count;
}

function candidateFiles(root, directory = root) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (directory === root && entry.name === '.git') continue; // Local rehearsal metadata is created after copying.
    const path = join(directory, entry.name);
    const meta = lstatSync(path);
    assert(!meta.isSymbolicLink(), `Link in public snapshot: ${relative(root, path)}`);
    if (meta.isDirectory()) files.push(...candidateFiles(root, path));
    else {
      assert(meta.isFile(), `Unexpected entry in public snapshot: ${relative(root, path)}`);
      files.push(normalized(relative(root, path)));
    }
  }
  return files.sort();
}

function verifyMarkdownLinks(root, path, content) {
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:/iu.test(target)) continue;
    const resolved = resolve(dirname(join(root, path)), decodeURIComponent(target));
    assert(resolved.startsWith(root + sep), `Markdown link escapes snapshot: ${path} -> ${target}`);
    assert(existsSync(resolved), `Broken public Markdown link: ${path} -> ${target}`);
  }
}

function auditCandidate(root) {
  const files = candidateFiles(root);
  assert(files.length > 100, 'Public snapshot is incomplete');
  for (const path of files) {
    assert(isAllowed(path), `Unexpected public file: ${path}`);
    assert(!path.split('/').slice(0, -1).some((part) => forbiddenDirectories.has(part)), `Forbidden public directory: ${path}`);
    assert(allowedExtensions.has(extname(path)) || exactFiles.has(path), `Unexpected public file type: ${path}`);
    const buffer = readFileSync(join(root, path));
    assert(buffer.length <= 2_000_000, `Oversized public file: ${path}`);
    if (reviewedIcons.has(path)) {
      verifyReviewedIcon(path, buffer);
      continue;
    }
    if (reviewedPresentation.has(path)) {
      assert(buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9, `Invalid presentation JPEG: ${path}`);
      assert(createHash('sha256').update(buffer).digest('hex') === reviewedPresentation.get(path), `Presentation bytes changed: ${path}`);
      continue; // Individually reviewed synthetic UI capture; no general binary exemption.
    }
    assert(!buffer.includes(0), `Unexpected binary content: ${path}`);
    const content = buffer.toString('utf8');
    assert(!content.includes('\uFFFD'), `Invalid UTF-8 in public file: ${path}`);
    assert(!/\b[A-Za-z]:[\\/](?:Users|留学|日常工作|Program Files)[\\/]/u.test(content), `Local machine path in public file: ${path}`);
    assert(!/\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(content), `Credential material in public file: ${path}`);
    assert(!content.includes(privateSessionId) && !content.includes(privateProfileNumber), `Private identity in public file: ${path}`);
    if (path.endsWith('.md')) verifyMarkdownLinks(root, path, content);
  }
  for (const path of reviewedIcons.keys()) assert(files.includes(path), `Missing reviewed icon: ${path}`);
  for (const path of reviewedPresentation.keys()) assert(files.includes(path), `Missing reviewed presentation: ${path}`);
  for (const needed of ['LICENSE', 'README.md', 'docs/development/CHANGELOG.md', 'docs/development/ROADMAP.md']) {
    assert(files.includes(needed), `Missing public file: ${needed}`);
  }
  assert(!files.some((path) => /^README\.(?:zh-CN|ja|zh-TW)\.md$/u.test(path)), 'Obsolete localized README copied');
  const license = readFileSync(join(root, 'LICENSE'), 'utf8').replaceAll('\r\n', '\n');
  assert(license.startsWith('MIT License\n') && license.includes('Permission is hereby granted'), 'MIT license is missing or invalid');
  const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
  assert(version === '1.0.1', 'Public VERSION must be the reviewed R009 version');
  const npmPackage = JSON.parse(readFileSync(join(root, 'app/package.json'), 'utf8'));
  const npmLock = JSON.parse(readFileSync(join(root, 'app/package-lock.json'), 'utf8'));
  const tauri = JSON.parse(readFileSync(join(root, 'app/src-tauri/tauri.conf.json'), 'utf8'));
  const cargoToml = readFileSync(join(root, 'app/src-tauri/Cargo.toml'), 'utf8');
  const cargoLock = readFileSync(join(root, 'app/src-tauri/Cargo.lock'), 'utf8').replaceAll('\r\n', '\n');
  const appConstants = readFileSync(join(root, 'app/src/constants.ts'), 'utf8');
  assert(npmPackage.version === version && npmLock.version === version && npmLock.packages[''].version === version, 'Public npm version mismatch');
  assert(tauri.version === version, 'Public Tauri version mismatch');
  assert(cargoToml.split('[lib]')[0].includes(`version = "${version}"`), 'Public Cargo package version mismatch');
  assert(cargoLock.includes(`name = "toefl-answer-collection"\nversion = "${version}"`), 'Public Cargo lock version mismatch');
  assert(appConstants.includes(`APP_VERSION = '${version}'`), 'Public application display version mismatch');
  const readme = readFileSync(join(root, 'README.md'), 'utf8').replaceAll('\r\n', '\n');
  const sections = [
    ['english', 'English'],
    ['simplified-chinese', '简体中文'],
    ['japanese', '日本語'],
    ['traditional-chinese', '繁體中文'],
  ];
  const positions = sections.map(([anchor, label]) => {
    assert(readme.includes(`](#${anchor})`), `Missing README navigation: ${anchor}`);
    const position = readme.indexOf(`<a id="${anchor}"></a>\n\n## ${label}`);
    assert(position >= 0, `Missing README language: ${label}`);
    return position;
  });
  assert(positions.every((position, index) => index === 0 || position > positions[index - 1]), 'Wrong README language order');
  for (let index = 0; index < positions.length; index += 1) {
    const content = readme.slice(positions[index], positions[index + 1]);
    for (const fact of ['v1.0.1', '/releases/tag/v1.0.1', 'ETS', '(LICENSE)', 'WebView2', 'Node.js', 'Rust']) {
      assert(content.includes(fact), `Missing README fact in ${sections[index][1]}: ${fact}`);
    }
    const currentFacts = [
      ['Training name', 'Data folder', 'local-first', 'official TOEFL questions'],
      ['训练名称', '数据文件夹', '以本地为主', '不分发官方 TOEFL'],
      ['練習名', 'データフォルダー', 'ローカル優先', '公式 TOEFL'],
      ['練習名稱', '資料資料夾', '以本機為優先', '不散布官方 TOEFL'],
    ][index];
    for (const fact of currentFacts) assert(content.includes(fact), `Missing current README fact in ${sections[index][1]}: ${fact}`);
  }
  assert(!existsSync(join(root, 'Demand')) && !existsSync(join(root, 'temp')) && !existsSync(join(root, 'records')), 'Private directory copied');
  return files.length;
}

function selfCheck(root) {
  const unrelatedIcon = join(root, 'app/src-tauri/icons/unreviewed.png');
  writeFileSync(unrelatedIcon, Buffer.from([137, 80, 78, 71]));
  try {
    let rejected = false;
    try { auditCandidate(root); } catch (error) { rejected = String(error).includes('Unexpected public file'); }
    assert(rejected, 'Public audit did not reject an unreviewed icon binary');
  } finally {
    rmSync(unrelatedIcon);
  }
  const injected = join(root, 'records', 'synthetic-probe.txt');
  mkdirSync(dirname(injected));
  writeFileSync(injected, 'SYNTHETIC AUDIT PROBE\n');
  try {
    let rejected = false;
    try { auditCandidate(root); } catch (error) { rejected = String(error).includes('Unexpected public file'); }
    assert(rejected, 'Public audit did not reject a forbidden directory');
  } finally {
    rmSync(injected);
    rmdirSync(dirname(injected));
  }
  const readme = join(root, 'README.md');
  const original = readFileSync(readme);
  writeFileSync(readme, Buffer.concat([original, Buffer.from('C:' + '\\Users\\' + 'synthetic' + '\\private\n')]));
  try {
    let rejected = false;
    try { auditCandidate(root); } catch (error) { rejected = String(error).includes('Local machine path'); }
    assert(rejected, 'Public audit did not reject a local machine path');
  } finally {
    writeFileSync(readme, original);
  }
  writeFileSync(readme, original.toString('utf8').replace('## 日本語', '## Missing'));
  try {
    let rejected = false;
    try { auditCandidate(root); } catch (error) { rejected = String(error).includes('Missing README language'); }
    assert(rejected, 'Public audit did not reject a missing README language');
  } finally {
    writeFileSync(readme, original);
  }
  const versionPath = join(root, 'VERSION');
  const originalVersion = readFileSync(versionPath);
  writeFileSync(versionPath, '1.0-dev\n');
  try {
    let rejected = false;
    try { auditCandidate(root); } catch (error) { rejected = String(error).includes('Public VERSION must be the reviewed R009 version'); }
    assert(rejected, 'Public audit did not reject a prerelease version');
  } finally {
    writeFileSync(versionPath, originalVersion);
  }
}

function assertStageForCleanup(stage) {
  const expectedParent = realpathSync(stageParent);
  assert(dirname(stage) === stageParent && realpathSync(dirname(stage)) === expectedParent, 'Unexpected stage parent');
  assert(/^\.r0086-public-stage-[A-Za-z0-9]+$/u.test(basename(stage)), 'Unexpected stage name');
  assert(realpathSync(stage) === stage, 'Stage is a link or unexpected path');
  assert(readFileSync(join(stage, markerName), 'utf8') === stage, 'Stage marker mismatch');
}

function rehearse(candidate) {
  function run(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 20_000_000 });
    assert(result.status === 0, `Rehearsal failed: ${command} ${args.join(' ')}\n${(result.stderr || result.stdout || result.error || '').toString().slice(-3000)}`);
  }
  const npmCli = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  assert(existsSync(npmCli), 'Cannot find npm beside Node.js for clean rehearsal');
  const app = join(candidate, 'app');
  run('git', ['init'], candidate);
  run('git', ['add', '-A'], candidate);
  run('git', ['-c', 'user.name=Public Rehearsal', '-c', 'user.email=rehearsal@example.invalid', 'commit', '-m', 'Initial reviewed source snapshot'], candidate);
  const history = spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: candidate, encoding: 'utf8' });
  assert(history.status === 0 && history.stdout.trim() === '1', 'Public candidate contains old ancestry');
  const remote = spawnSync('git', ['remote'], { cwd: candidate, encoding: 'utf8' });
  assert(remote.status === 0 && remote.stdout.trim() === '', 'Public candidate has a remote');
  run(process.execPath, [npmCli, 'ci'], app);
  for (const script of ['audit:privacy', 'audit:public-release', 'test', 'build']) {
    run(process.execPath, [npmCli, 'run', script], app);
  }
  run('cargo', ['check', '--locked'], join(app, 'src-tauri'));
  console.log('CLEAN PUBLIC SNAPSHOT REHEARSAL PASS (one new Git root, no remote or private ancestry)');
}

const args = process.argv.slice(2);
if (args[0] === '--root') {
  assert(args.length === 2, 'Usage: audit.mjs --root <snapshot>');
  const root = resolve(args[1]);
  console.log(`PUBLIC RELEASE AUDIT PASS (${auditCandidate(root)} files)`);
} else {
  assert(args.length === 0 || (args.length === 1 && ['--keep', '--rehearse'].includes(args[0])), 'Usage: audit.mjs [--keep|--rehearse]');
  const stage = mkdtempSync(join(stageParent, '.r0086-public-stage-'));
  const candidate = join(stage, 'snapshot');
  writeFileSync(join(stage, markerName), stage);
  mkdirSync(candidate);
  try {
    const copied = copyAllowedFiles(candidate);
    const audited = auditCandidate(candidate);
    selfCheck(candidate);
    assert(copied === audited, 'Snapshot file count changed during audit');
    console.log(`PUBLIC RELEASE AUDIT PASS (${audited} files; explicit allowlist)`);
    if (args[0] === '--rehearse') rehearse(candidate);
    if (args[0] === '--keep') console.log(`PUBLIC SNAPSHOT: ${candidate}`);
  } finally {
    if (args[0] !== '--keep') {
      assertStageForCleanup(stage);
      rmSync(stage, { recursive: true });
    }
  }
}
