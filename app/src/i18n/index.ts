import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { isSupportedLocale, normalizeLocale, SUPPORTED_LOCALES, type UiLocale } from './locale';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import ja from './locales/ja.json';
import zhTW from './locales/zh-TW.json';

const resources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN },
  ja: { translation: ja },
  'zh-TW': { translation: zhTW }
};

const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: [...SUPPORTED_LOCALES],
  load: 'currentOnly',
  keySeparator: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false }
});

function applyDocumentLanguage(locale: UiLocale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

export async function hydrateLocale(): Promise<UiLocale> {
  let saved: unknown;
  try {
    const { getAppSetting } = await import('../lib/storage');
    saved = await getAppSetting<unknown>('ui_locale');
  }
  catch { /* A missing or unavailable setting must not block startup. */ }
  const locale = normalizeLocale(saved);
  await i18n.changeLanguage(locale);
  applyDocumentLanguage(locale);
  return locale;
}

export async function selectLocale(locale: UiLocale): Promise<void> {
  if (!isSupportedLocale(locale)) throw new Error('Unsupported UI locale.');
  await i18n.changeLanguage(locale);
  applyDocumentLanguage(locale);
  const { saveAppSetting } = await import('../lib/storage');
  await saveAppSetting('ui_locale', locale);
}

export default i18n;
