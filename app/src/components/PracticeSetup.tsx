import type { SectionName } from '../types';
import { NEW_SESSION_SECTION_ORDER } from '../constants';
import { useAppStore } from '../store/appStore';
import { useTranslation } from 'react-i18next';
import { validateTrainingName } from '../lib/trainingName';

export function PracticeSetup() {
  const { t } = useTranslation();
  const mode = useAppStore((state) => state.mode);
  const setMode = useAppStore((state) => state.setMode);
  const selectedSections = useAppStore((state) => state.selectedSections);
  const toggleSection = useAppStore((state) => state.toggleSection);
  const startSession = useAppStore((state) => state.startSession);
  const trainingName = useAppStore((state) => state.trainingName);
  const setTrainingName = useAppStore((state) => state.setTrainingName);
  const nameError = validateTrainingName(trainingName).error;

  return (
    <div className="stack">
      <label className="label" htmlFor="training-name">{t('setup.trainingName')}</label>
      <input id="training-name" value={trainingName} placeholder={t('setup.trainingNamePlaceholder')}
        aria-invalid={Boolean(nameError)} aria-describedby="training-name-error"
        onChange={(event) => setTrainingName(event.target.value)} />
      {nameError ? <p id="training-name-error" className="warning-text">{t(`setup.trainingName.${nameError}`)}</p> : null}
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
      {selectedSections.length === 0 ? <p className="warning-text">{t('setup.sectionRequired')}</p> : null}

      <button className="primary" disabled={Boolean(nameError) || selectedSections.length === 0} onClick={startSession}>
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
