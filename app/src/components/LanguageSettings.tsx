import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { selectLocale } from '../i18n';
import { LOCALE_NAMES, SUPPORTED_LOCALES, normalizeLocale, type UiLocale } from '../i18n/locale';

export function LanguageSettings() {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState('');
  return <section className="card settings-section">
    <h2>{t('settings.language')}</h2>
    <label>{t('settings.language')}
      <select value={normalizeLocale(i18n.language)} onChange={(event) => {
        setError('');
        void selectLocale(event.target.value as UiLocale).catch((cause) => setError(String(cause)));
      }}>
        {SUPPORTED_LOCALES.map((locale) => <option key={locale} value={locale}>{LOCALE_NAMES[locale]}</option>)}
      </select>
    </label>
    <p className="muted">{t('settings.languageHelp')}</p>
    {error ? <p className="danger-text" role="alert">{t('settings.languageSaveFailed', { detail: error })}</p> : null}
  </section>;
}
