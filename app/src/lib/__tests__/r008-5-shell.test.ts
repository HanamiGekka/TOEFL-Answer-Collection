import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';

describe('R008.5.1 English static application shell', () => {
  it('uses the canonical brand in Tauri and HTML metadata', () => {
    const tauri = JSON.parse(readFileSync(resolve('src-tauri/tauri.conf.json'), 'utf8'));
    const html = readFileSync(resolve('index.html'), 'utf8');
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    expect(tauri.productName).toBe('TOEFL Answer Collection');
    expect(tauri.app.windows[0].title).toBe('TOEFL Answer Collection');
    expect(tauri.bundle.shortDescription).toMatch(/Local TOEFL answer recording/);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<title>TOEFL Answer Collection</title>');
    expect(pkg.description).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('provides localized native path dialog titles', () => {
    for (const locale of ['en', 'zh-CN', 'ja', 'zh-TW']) {
      expect(i18n.t('paths.selectAppRoot', { lng: locale })).not.toBe('paths.selectAppRoot');
      expect(i18n.t('paths.openFolder', { lng: locale })).not.toBe('paths.openFolder');
    }
  });
});
