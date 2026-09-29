import type { SectionName } from '../types';
import { NEW_SESSION_SECTION_ORDER } from '../constants';
import { useAppStore } from '../store/appStore';
import { useTranslation } from 'react-i18next';

export function PracticeSetup() {
  const { t } = useTranslation();
  const mode = useAppStore((state) => state.mode);
  const setMode = useAppStore((state) => state.setMode);
  const selectedSections = useAppStore((state) => state.selectedSections);
  const toggleSection = useAppStore((state) => state.toggleSection);
  const startSession = useAppStore((state) => state.startSession);
  const selectedPackage = useAppStore((state) => state.selectedPackage);

  return (
    <div className="stack">
      <fieldset>
        <legend>{t('setup.mode')}</legend>
        <label><input type="radio" checked={mode === 'practice'} onChange={() => setMode('practice')} /> {t('setup.practiceMode')}</label>
        <label><input type="radio" checked={mode === 'exam_simulation'} onChange={() => setMode('exam_simulation')} /> {t('setup.examMode')}</label>
      </fieldset>

      <fieldset>
        <legend>{t('setup.sections')}</legend>
        {NEW_SESSION_SECTION_ORDER.map((section) => (
          <label key={section}>
            <input
              type="checkbox"
              checked={selectedSections.includes(section as SectionName)}
              onChange={() => toggleSection(section as SectionName)}
            />
            {t(`section.${section.toLowerCase()}`)}
          </label>
        ))}
      </fieldset>

      <button className="primary" disabled={!selectedPackage} onClick={startSession}>
        {t('setup.start')}
      </button>

      <div className="setup-note">
        <p>{t('setup.externalMaterial')}</p>
        <p>{t('setup.dynamicItems')}</p>
        <p>{mode === 'practice' ? t('setup.practiceNote') : t('setup.examNote')}</p>
      </div>
    </div>
  );
}
