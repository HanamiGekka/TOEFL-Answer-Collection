import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const locales = ['en', 'zh-CN', 'ja', 'zh-TW'] as const;
const strings = Object.fromEntries(locales.map((locale) => [locale,
  JSON.parse(readFileSync(resolve('src/i18n/locales', `${locale}.json`), 'utf8')) as Record<string, string>
])) as Record<typeof locales[number], Record<string, string>>;

for (const locale of locales) {
  test(`R009 ${locale}: fresh Home, Settings and populated Records at 560px`, async ({ page }) => {
    const t = strings[locale];
    const record = { record_id: 'TOEFL:synthetic-r009-record', record_type: 'TOEFL',
      session_id: 'synthetic-r009-record', package_id: 'R009 Synthetic 日本語 中文',
      created_at: '2026-10-03T00:00:00.000Z', mode: 'practice', selected_sections: ['Reading'],
      profile_id: 'dynamic-manual', active_time_ms: 1200, pause_time_ms: 100,
      completion_status: 'COMPLETED', export_status: 'EXPORTED', schema_version: 'practice-session-v6',
      structure_mode: 'dynamic_manual', app_version: '1.0.1-dev.0', directory_size_bytes: 120,
      relative_path: 'records/synthetic-r009-path', file_names: ['answers.json'], section_item_counts: { Reading: 5 } };
    // Browser-only storage boundary: product components render a synthetic index, with no real data access.
    await page.route('**/src/lib/storage.ts', async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      const replaced = source.replace(/async function listLocalRecords\(\)\s*\{[\s\S]*?\n\}/,
        `async function listLocalRecords() { return ${JSON.stringify([record])};\n}`);
      expect(replaced).not.toBe(source);
      await route.fulfill({ response, body: replaced });
    });
    await page.addInitScript(({ selected }) => {
      localStorage.setItem('app-setting:ui_locale', JSON.stringify(selected));
      localStorage.setItem('app-setting:shortcuts', JSON.stringify({ speaking_start: 'F9', speaking_retry: 'F10', next_question: 'Alt+N' }));
    }, { selected: locale });
    await page.setViewportSize({ width: 560, height: 900 });
    await page.goto('/');
    await expect(page.getByLabel(t['setup.trainingName'])).toBeVisible();
    await expect(page.getByRole('button', { name: t['setup.start'] })).toBeDisabled();
    for (const invalid of ['  ', 'CON', 'bad/name', 'x'.repeat(81)]) {
      await page.getByLabel(t['setup.trainingName']).fill(invalid);
      await expect(page.getByRole('button', { name: t['setup.start'] })).toBeDisabled();
    }
    await page.getByLabel(t['setup.trainingName']).fill('R009 Synthetic 日本語 中文');
    await expect(page.getByRole('button', { name: t['setup.start'] })).toBeEnabled();
    expect(await page.locator('body').innerText()).not.toMatch(/APP_ROOT|SOURCE_ROOT|Speaking|PackagePicker|scan_packages/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: t['app.settings'] }).click();
    await expect(page.locator('.path-current')).toContainText(t['paths.dataFolder']);
    expect(await page.locator('body').innerText()).not.toMatch(/Speaking|speaking_|toggle_pause|previous_question|APP_ROOT|SOURCE_ROOT|Central Shortcut Registry/);
    await expect(page.getByRole('textbox', { name: new RegExp(t['shortcut.action.next_question']) })).toHaveValue('Alt+N');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: t['app.records'] }).click();
    const card = page.locator('.record-card');
    await expect(card.getByText(record.package_id, { exact: true })).toBeVisible();
    expect(await card.innerText()).not.toMatch(/synthetic-r009-record|practice-session-v6|dynamic_manual|synthetic-r009-path/);
    await card.locator('summary').click();
    await expect(card.getByText(/synthetic-r009-record/)).toBeVisible();
    await expect(card.getByText(/practice-session-v6/)).toBeVisible();
    await card.locator('summary').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('R009 direct Unicode training creates Reading, Listening and Writing batches', async ({ page }) => {
  const t = strings.en;
  await page.goto('/');
  await page.getByLabel('Training name').fill('R009 Synthetic 日本語 中文');
  await page.getByRole('button', { name: 'Start practice' }).click();
  for (const [section, key, count] of [
    ['Reading', 'batch.academicReading5', 5], ['Listening', 'batch.academicLecture4', 4],
    ['Writing', 'batch.buildSentence10', 10]
  ] as const) {
    await page.locator('.dynamic-empty-section').getByRole('button').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: t[key], exact: true }).click();
    await dialog.getByRole('button', { name: t['dynamicItem.createManyAndEnter'].replace('{{count}}', String(count)), exact: true }).click();
    const state = await page.evaluate(async () => {
      // @ts-expect-error Vite module is available in the browser only.
      const { useAppStore } = await import('/src/store/appStore.ts');
      return useAppStore.getState().session;
    });
    expect(state?.questions.filter((item: { section_id: string }) => item.section_id === section)).toHaveLength(count);
    if (section === 'Reading') await page.getByRole('button', { name: 'B', exact: true }).click();
    await page.getByRole('button', { name: section === 'Writing' ? 'Finish Writing and session' : `Finish ${section}`, exact: true }).click();
    await page.getByRole('button', { name: t['practice.confirmFinishSection'], exact: true }).click();
  }
  await expect(page.locator('.session-summary').getByRole('heading', { name: 'R009 Synthetic 日本語 中文' })).toBeVisible();
});
