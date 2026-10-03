import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTranslation } from 'react-i18next';
import i18n, { hydrateLocale, selectLocale } from '../index';
import { LanguageSettings } from '../../components/LanguageSettings';
import { getAppSetting, saveAppSetting } from '../../lib/storage';
import { BUILT_IN_BATCHES } from '../../lib/itemBatchRegistry';
import { RuntimeNotice } from '../../components/RuntimeNotice';

vi.mock('../../lib/storage', () => ({
  getAppSetting: vi.fn(async () => undefined),
  saveAppSetting: vi.fn(async () => undefined)
}));

function LiveText() {
  const { t } = useTranslation();
  return <span>{t('settings.language')}</span>;
}

describe('R008.5 locale runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses English as the sole fallback for a missing translation', () => {
    i18n.addResource('en', 'translation', 'test.englishOnly', 'English only');
    expect(i18n.t('test.englishOnly', { lng: 'ja' })).toBe('English only');
    expect(i18n.t('test.englishOnly', { lng: 'zh-TW' })).toBe('English only');
    delete (i18n.getResourceBundle('en', 'translation') as Record<string, string>)['test.englishOnly'];
  });

  it('hydrates a saved locale and updates document language after restart', async () => {
    vi.mocked(getAppSetting).mockResolvedValueOnce('ja');
    expect(await hydrateLocale()).toBe('ja');
    expect(i18n.language).toBe('ja');
    expect(document.documentElement.lang).toBe('ja');
    vi.mocked(getAppSetting).mockResolvedValueOnce('zh-TW');
    expect(await hydrateLocale()).toBe('zh-TW');
    expect(i18n.language).toBe('zh-TW');
  });

  it('falls back to English for a stored unsupported locale', async () => {
    vi.mocked(getAppSetting).mockResolvedValueOnce('fr-FR');
    expect(await hydrateLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it.each(['zh-CN', 'ja-JP', 'zh-TW'])(
    'starts in English without a saved preference under browser language %s', async (language) => {
      const languageGetter = vi.spyOn(navigator, 'language', 'get').mockReturnValue(language);
      try {
        expect(await hydrateLocale()).toBe('en');
        expect(i18n.language).toBe('en');
        expect(document.documentElement.lang).toBe('en');
      } finally {
        languageGetter.mockRestore();
      }
    }
  );

  it('renders each production startup notice in all four locales and switches a visible notice live', async () => {
    const codes = [
      'APP_PATHS_FALLBACK_LAST_KNOWN_GOOD',
      'APP_PATHS_FALLBACK_USER_DEFAULT'
    ] as const;
    for (const code of codes) {
      for (const locale of ['en', 'zh-CN', 'ja', 'zh-TW'] as const) {
        await i18n.changeLanguage(locale);
        const { unmount } = render(<RuntimeNotice code={code} />);
        const notice = screen.getByRole('alert').textContent ?? '';
        expect(notice.length).toBeGreaterThan(10);
        expect(notice).not.toContain('runtimeNotice.');
        if (locale === 'en') expect(notice).not.toMatch(/[\u4e00-\u9fff]/);
        unmount();
      }
    }
    await i18n.changeLanguage('en');
    render(<RuntimeNotice code={codes[0]} />);
    const english = screen.getByRole('alert').textContent;
    await selectLocale('ja');
    await waitFor(() => expect(screen.getByRole('alert').textContent).not.toBe(english));
    expect(screen.getByRole('alert').textContent).not.toContain('runtimeNotice.');
  });

  it('changes the UI immediately and persists ui_locale', async () => {
    render(<><LanguageSettings /><LiveText /></>);
    expect(screen.getByRole('combobox', { name: '语言' })).toBeInTheDocument();
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['English', '简体中文', '日本語', '繁體中文']);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ja' } });
    await waitFor(() => expect(screen.getAllByText('言語').length).toBeGreaterThan(0));
    expect(document.documentElement.lang).toBe('ja');
    expect(saveAppSetting).toHaveBeenCalledWith('ui_locale', 'ja');
    await expect(selectLocale('fr' as never)).rejects.toThrow('Unsupported UI locale');
    expect(i18n.language).toBe('ja');
  });

  it('translates batch display without changing its stable ID', () => {
    const batch = BUILT_IN_BATCHES[0];
    expect(batch.id).toBe('reading_word_blank_10');
    expect(i18n.t(batch.label_key, { lng: 'en' })).toBe('Fill in the Blank × 10');
    expect(i18n.t(batch.label_key, { lng: 'ja' })).toBe('穴埋め × 10');
    expect(i18n.t(batch.label_key, { lng: 'zh-TW' })).toBe('填空 × 10');
    expect(batch.id).toBe('reading_word_blank_10');
  });
});
