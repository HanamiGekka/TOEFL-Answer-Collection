import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Locale = 'en' | 'zh-CN' | 'ja' | 'zh-TW';
const translations = Object.fromEntries(
  (['en', 'zh-CN', 'ja', 'zh-TW'] as const).map((locale) => [locale, JSON.parse(
    readFileSync(resolve('src', 'i18n', 'locales', `${locale}.json`), 'utf8')
  ) as Record<string, string>])
) as Record<Locale, Record<string, string>>;
const { en } = translations;

test('English fallback and immediate locale selection persist through reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: en['app.title'] })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: en['app.settings'] }).click();

  for (const locale of ['zh-CN', 'ja', 'zh-TW', 'en'] as const) {
    const strings = translations[locale];
    await page.getByRole('combobox', { name: translations[pageLocaleBefore(locale)]['settings.language'] }).selectOption(locale);
    await expect(page.getByRole('heading', { name: strings['app.title'] })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('app-setting:ui_locale')))
      .toBe(JSON.stringify(locale));
    await page.reload();
    await expect(page.getByRole('heading', { name: strings['app.title'] })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
  }
});

test('fresh browser contexts start in English regardless of system language', async ({ browser }) => {
  for (const browserLocale of ['zh-CN', 'ja-JP', 'zh-TW']) {
    const context = await browser.newContext({ locale: browserLocale, baseURL: test.info().project.use.baseURL });
    try {
      const page = await context.newPage();
      await page.goto('/');
      await expect(page.getByRole('heading', { name: en['app.title'] })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    } finally {
      await context.close();
    }
  }
});

for (const locale of ['en', 'ja', 'zh-TW'] as const) {
  test(`${locale} item dialog translates system presets, batches and repeated operation`, async ({ page }) => {
    await page.setViewportSize({ width: 560, height: 900 });
    await page.addInitScript((selected) => {
      localStorage.setItem('app-setting:ui_locale', JSON.stringify(selected));
    }, locale);
    await page.goto('/');
    await installSyntheticSession(page);

    const strings = translations[locale];
    const title = strings['dynamicItem.addTitle']
      .replace('{{section}}', strings['section.reading']).replace('{{ordinal}}', '1');
    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('option', { name: strings['preset.singleChoice'] })).toBeAttached();
    await expect(dialog.getByRole('button', { name: strings['batch.readingWordBlank10'] })).toBeVisible();
    await dialog.getByRole('button', { name: strings['batch.readingWordBlank10'] }).click();
    const create = strings['dynamicItem.createManyAndEnter'].replace('{{count}}', '10');
    await expect(dialog.getByRole('button', { name: create })).toBeVisible();
    await expect(dialog.getByRole('button', { name: strings['template.saveNew'] })).toBeVisible();
    await expectNoHorizontalOverflow(page, dialog);

    await dialog.getByRole('button', { name: create }).click();
    await expect(dialog).not.toBeVisible();
    await page.evaluate(async () => {
      // @ts-expect-error Vite serves this source module only inside the page.
      const { useAppStore } = await import('/src/store/appStore.ts');
      useAppStore.getState().openDynamicItemCreator();
    });
    const repeated = strings['dynamicItem.repeatPreviousOperation'].replace('{{count}}', '10');
    await expect(page.getByRole('button', { name: repeated })).toBeVisible();
    await expectNoHorizontalOverflow(page, page.getByRole('dialog'));
  });
}

function pageLocaleBefore(locale: Locale): Locale {
  return locale === 'zh-CN' ? 'en' : locale === 'ja' ? 'zh-CN' : locale === 'zh-TW' ? 'ja' : 'zh-TW';
}

async function installSyntheticSession(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves this source module only inside the page.
    const { useAppStore } = await import('/src/store/appStore.ts');
    // @ts-expect-error Vite serves this source module only inside the page.
    const { createDynamicSession } = await import('/src/lib/dynamicSession.ts');
    useAppStore.setState({ session: createDynamicSession({
      session_id: 'e2e-i18n', package_id: 'synthetic', source_relative_path: 'synthetic',
      mode: 'practice', selected_sections: ['Reading'], created_at: '2026-09-28T00:00:00.000Z'
    }), itemTemplates: { schema_version: 1, templates: [] } });
    useAppStore.getState().openDynamicItemCreator();
  });
}

async function expectNoHorizontalOverflow(page: Page, dialog: ReturnType<Page['getByRole']>): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
}
