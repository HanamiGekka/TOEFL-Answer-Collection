export const SUPPORTED_LOCALES = ['en', 'zh-CN', 'ja', 'zh-TW'] as const;
export type UiLocale = typeof SUPPORTED_LOCALES[number];

export const LOCALE_NAMES: Readonly<Record<UiLocale, string>> = {
  en: 'English',
  'zh-CN': '简体中文',
  ja: '日本語',
  'zh-TW': '繁體中文'
};

export function isSupportedLocale(value: unknown): value is UiLocale {
  return typeof value === 'string' && SUPPORTED_LOCALES.some((locale) => locale === value);
}

export function normalizeLocale(value: unknown): UiLocale {
  return isSupportedLocale(value) ? value : 'en';
}
