import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const protectedRoots = new Set([
  'records', 'typing_records', 'data', 'exports', 'logs', 'trash', 'backups',
  'Demand', 'Code prompt', 'temp', 'real_data', 'private_data', 'personal_exports',
  'Organized_TOEFL_Resources'
]);
const privateDriveRoot = new RegExp('E:' + String.raw`\\留学\\TOEFL`, 'i');
const windowsHome = /[A-Z]:\\Users\\(?!<|Example(?:\\|$)|Synthetic(?:\\|$)|Public(?:\\|$))[^\\\s]+/i;
const unixHome = /(?<![\w/])\/(?:Users|home)\/(?!<|example(?:\/|$)|synthetic(?:\/|$))[^/\s]+/;

export function inspectTrackedPath(path) {
  const normalized = path.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (protectedRoots.has(parts[0]) && !/^(?:records|typing_records|data|exports|logs|trash|backups)(?:\/[^/]+)*\/\.gitkeep$/.test(normalized)) {
    return 'PROTECTED_RUNTIME_OR_PRIVATE_PATH';
  }
  if (/^config\/app-settings\.(?:json|local\.json|last-known-good\.json)$/i.test(normalized)
      || /(?:^|\/)\.env(?:\.[^/]*)?$/i.test(normalized)
      || /\.(?:pem|key|p12|pfx)$/i.test(normalized)) {
    return 'MACHINE_CONFIG_OR_SECRET_FILE';
  }
  if (/\.(?:pdf|docx?|mp3|mp4|wav|m4a)$/i.test(normalized)) {
    return 'REVIEW_NON_SYNTHETIC_RESOURCE';
  }
  return undefined;
}

export function inspectText(text) {
  const lines = text.split(/\r?\n/);
  const findings = [];
  lines.forEach((line, index) => {
    const decoded = line.replaceAll('\\\\', '\\');
    if (privateDriveRoot.test(decoded)) findings.push({ line: index + 1, category: 'PRIVATE_MACHINE_PATH' });
    if (windowsHome.test(decoded) || unixHome.test(decoded)) findings.push({ line: index + 1, category: 'USER_HOME_PATH' });
    if (decoded.includes('-----BEGIN ' + 'PRIVATE KEY-----') || /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/.test(decoded)) {
      findings.push({ line: index + 1, category: 'POSSIBLE_CREDENTIAL' });
    }
  });
  return findings;
}

export function auditCurrentTree(repoRoot) {
  const tracked = execFileSync('git', ['ls-files', '--cached', '-z'], { cwd: repoRoot })
    .toString('utf8').split('\0').filter((path) => path && existsSync(resolve(repoRoot, path)));
  const findings = [];
  for (const path of tracked) {
    const pathCategory = inspectTrackedPath(path);
    if (pathCategory) findings.push({ path, category: pathCategory });
    const bytes = readFileSync(resolve(repoRoot, path));
    if (bytes.includes(0) || bytes.length > 2_000_000) continue;
    for (const finding of inspectText(bytes.toString('utf8'))) {
      findings.push({ path, ...finding });
    }
  }
  return { trackedCount: tracked.length, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd() }).toString('utf8').trim();
  const result = auditCurrentTree(repoRoot);
  if (result.findings.length) {
    for (const finding of result.findings) {
      console.error(`${finding.category}: ${finding.path}${finding.line ? `:${finding.line}` : ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`CURRENT TREE PRIVACY PASS (${result.trackedCount} tracked files)`);
  }
}
