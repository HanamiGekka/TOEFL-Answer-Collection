import { expect, test } from '@playwright/test';

for (const width of [560, 720, 900]) {
  test(`${width}px home, records and settings have no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem('app-setting:ui_locale', JSON.stringify('zh-CN')));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '答案录入、计时与单词盲打' })).toBeVisible();
    await expect(page.getByText('完全离线 · 不展示题目')).toBeVisible();
    await expect(page.getByRole('heading', { name: '单词盲打训练' })).toBeVisible();
    await expect(page.locator('.home-header')).toHaveCSS('background-color', 'rgb(15, 116, 120)');
    await expect(page.locator('.home-grid > .card').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.getByRole('button', { name: '开始练习' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '开始练习' })).toHaveCSS('background-color', 'rgb(238, 242, 242)');
    await expect(page.getByRole('button', { name: '开始练习' })).toHaveCSS('color', 'rgb(93, 104, 110)');
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: '记录管理' }).click();
    await expect(page.getByRole('heading', { name: '记录管理' })).toBeVisible();
    await expect(page.locator('.records-page.card')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: '设置' }).click();
    await expect(page.getByRole('heading', { name: '快捷键' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '数据路径' })).toBeVisible();
    await expect(page.locator('.settings-page > .card')).toHaveCount(3);
    await expectNoHorizontalOverflow(page);
  });
}

for (const width of [560, 720, 900]) {
  test(`${width}px batch and template dialog stays usable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem('app-setting:ui_locale', JSON.stringify('zh-CN')));
    await page.goto('/');
    await page.evaluate(async () => {
      // Browser preview has no SOURCE_ROOT; install a synthetic in-memory Session.
      // @ts-expect-error Vite serves this source module only inside the page.
      const { useAppStore } = await import('/src/store/appStore.ts');
      // @ts-expect-error Vite serves this source module only inside the page.
      const { createDynamicSession } = await import('/src/lib/dynamicSession.ts');
      useAppStore.setState({ session: createDynamicSession({
        session_id: 'e2e-batch', package_id: 'synthetic', source_relative_path: 'synthetic',
        mode: 'practice', selected_sections: ['Reading'], created_at: '2026-09-28T00:00:00.000Z'
      }), itemTemplates: { schema_version: 1, templates: [] } });
      useAppStore.getState().openDynamicItemCreator();
    });
    const dialog = page.getByRole('dialog', { name: '添加 Reading 第 1 题' });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button', { name: '填词 × 10' })).toBeVisible();
    await page.getByRole('button', { name: '填词 × 10' }).click();
    await expect(page.getByRole('button', { name: '创建 10 题并进入第 1 题' })).toBeVisible();
    await expect(page.getByRole('button', { name: '保存为新模板' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (width === 560) {
      await page.getByRole('button', { name: '创建 10 题并进入第 1 题' }).click();
      await expect(dialog).not.toBeVisible();
      await page.evaluate(async () => {
        // @ts-expect-error Vite serves this source module only inside the page.
        const { useAppStore } = await import('/src/store/appStore.ts');
        useAppStore.getState().openDynamicItemCreator();
      });
      await page.getByRole('button', { name: '与上一个操作相同（共 10 题）' }).click();
      expect(await page.evaluate(async () => {
        // @ts-expect-error Vite serves this source module only inside the page.
        const { useAppStore } = await import('/src/store/appStore.ts');
        return useAppStore.getState().session.questions.length;
      })).toBe(20);
    }
  });
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
}
