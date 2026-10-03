import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../src/i18n/locales/', import.meta.url);
const locales = ['en', 'zh-CN', 'ja', 'zh-TW'];
const resources = new Map();
const errors = [];

for (const locale of locales) {
  const path = fileURLToPath(new URL(`${locale}.json`, root));
  let value;
  const text = readFileSync(path, 'utf8');
  try { value = JSON.parse(text); }
  catch (error) { errors.push(`${locale}: invalid JSON: ${error}`); continue; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${locale}: resource must be a flat object`);
    continue;
  }
  const writtenKeys = [...text.matchAll(/^\s*,?\s*"([^"\n]+)"\s*:/gm)].map((match) => match[1]);
  if (writtenKeys.length !== Object.keys(value).length) errors.push(`${locale}: duplicate keys or nested resource`);
  for (const [key, translation] of Object.entries(value)) {
    if (!/^[a-z][a-zA-Z0-9_]*(\.[a-z][a-zA-Z0-9_]*)+$/.test(key)) errors.push(`${locale}: nonsemantic key ${key}`);
    if (typeof translation !== 'string' || !translation.trim()) errors.push(`${locale}: empty or nonstring value for ${key}`);
  }
  resources.set(locale, value);
}

const english = resources.get('en');
if (!english) errors.push('English canonical resource is missing');
else for (const locale of locales.slice(1)) {
  const resource = resources.get(locale);
  if (!resource) continue;
  for (const key of Object.keys(english)) {
    if (!(key in resource)) { errors.push(`${locale}: missing ${key}`); continue; }
    const placeholders = (value) => [...new Set([...value.matchAll(/{{\s*([\w.]+)\s*}}/g)].map((match) => match[1]))].sort();
    if (JSON.stringify(placeholders(english[key])) !== JSON.stringify(placeholders(resource[key]))) {
      errors.push(`${locale}: interpolation mismatch for ${key}`);
    }
  }
  for (const key of Object.keys(resource)) if (!(key in english)) errors.push(`${locale}: stale extra key ${key}`);
}

const sourceRoot = new URL('../src/', import.meta.url);
const intentionalCjk = new Map([
  ['i18n/locale.ts', 'native locale names in the selector'],
  ['lib/sessionExport.ts', 'stable v6 Markdown export contract']
]);
let reviewedCjkLines = 0;
function scanSource(directory, relative = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'test' || path === 'i18n/locales') continue;
      scanSource(new URL(`${entry.name}/`, directory), path);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    const source = readFileSync(new URL(entry.name, directory), 'utf8');
    const cjkLines = source.split(/\r?\n/).filter((line) => /[\u3400-\u9fff\uf900-\ufaff]/u.test(line));
    if (cjkLines.length) {
      if (intentionalCjk.has(path)) reviewedCjkLines += cjkLines.length;
      else errors.push(`${path}: ${cjkLines.length} unreviewed CJK source lines`);
    }
    if (english) for (const match of source.matchAll(/(?:\bt|\bi18n\.t)\(\s*['"]([a-z][a-zA-Z0-9_.]*)['"]/g)) {
      if (!(match[1] in english)) errors.push(`${path}: untranslated static key ${match[1]}`);
    }
  }
}
scanSource(sourceRoot);

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else console.log(`i18n audit PASS: ${Object.keys(english).length} keys × ${locales.length} locales; ${reviewedCjkLines} reviewed CJK contract/name lines`);
