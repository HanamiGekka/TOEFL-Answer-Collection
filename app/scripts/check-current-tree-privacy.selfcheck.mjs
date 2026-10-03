import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectText, inspectTrackedPath } from './check-current-tree-privacy.mjs';

test('rejects private runtime and machine settings paths, preserving synthetic fixtures', () => {
  assert.equal(inspectTrackedPath('records/session/answers.json'), 'PROTECTED_RUNTIME_OR_PRIVATE_PATH');
  assert.equal(inspectTrackedPath('Demand/private.md'), 'PROTECTED_RUNTIME_OR_PRIVATE_PATH');
  assert.equal(inspectTrackedPath('config/app-settings.local.json'), 'MACHINE_CONFIG_OR_SECRET_FILE');
  assert.equal(inspectTrackedPath('records/.gitkeep'), undefined);
  assert.equal(inspectTrackedPath('data/recovery/.gitkeep'), undefined);
  assert.equal(inspectTrackedPath('app/scripts/fixtures/synthetic/events.jsonl'), undefined);
  assert.equal(inspectTrackedPath('app/scripts/fixtures/synthetic-complete-session/answers.json'), undefined);
  assert.equal(inspectTrackedPath('resources/Reading/real.pdf'), 'REVIEW_NON_SYNTHETIC_RESOURCE');
  assert.equal(inspectTrackedPath('config/private.key'), 'MACHINE_CONFIG_OR_SECRET_FILE');
});

test('detects private machine roots without flagging synthetic rejection examples', () => {
  const privatePath = 'E:' + '\\留学' + '\\TOEFL' + '\\Private';
  assert.deepEqual(inspectText(privatePath), [{ line: 1, category: 'PRIVATE_MACHINE_PATH' }]);
  assert.deepEqual(inspectText(String.raw`r"E:\outside.txt"\nMock.01.A.1\n127.0.0.1`), []);
  assert.deepEqual(inspectText('C:' + '\\Users' + '\\PersonalAccount' + '\\file.txt'), [{ line: 1, category: 'USER_HOME_PATH' }]);
  assert.deepEqual(inspectText('https://example.org/home/toefl'), []);
});
