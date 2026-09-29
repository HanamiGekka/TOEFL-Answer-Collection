import { beforeEach } from 'vitest';
import i18n from '../i18n';

beforeEach(async () => {
  // Historical UI fixtures assert the original Chinese copy explicitly.
  // R008.5 locale tests select their own locale and verify English fallback.
  await i18n.changeLanguage('zh-CN');
  document.documentElement.lang = 'zh-CN';
});
