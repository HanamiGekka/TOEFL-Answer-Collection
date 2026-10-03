import { useTranslation } from 'react-i18next';
import type { RuntimeNoticeCode } from '../lib/storage';

const NOTICE_KEYS: Record<RuntimeNoticeCode, string> = {
  APP_PATHS_FALLBACK_LAST_KNOWN_GOOD: 'runtimeNotice.fallbackLastKnownGood',
  APP_PATHS_FALLBACK_USER_DEFAULT: 'runtimeNotice.fallbackUserDefault'
};

export function RuntimeNotice({ code }: { code: RuntimeNoticeCode }) {
  const { t } = useTranslation();
  return <div className="warning startup-warning" role="alert">
    {t(NOTICE_KEYS[code] ?? 'runtimeNotice.unknown')}
  </div>;
}
