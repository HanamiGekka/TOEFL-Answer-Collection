import { useAppStore } from '../store/appStore';
import { useTranslation } from 'react-i18next';
import { getItemTypeDisplayLabel } from '../i18n/displayLabels';
import { formatDuration } from '../lib/timer';
import { isDynamicSession } from '../lib/dynamicSession';

export function TopBar() {
  const { t, i18n } = useTranslation();
  const session = useAppStore((state) => state.session);
  const scopeActiveMs = useAppStore((state) => state.scopeActiveMs);
  const isPaused = useAppStore((state) => state.isPaused);
  const hideTimes = useAppStore((state) => state.hideTimes);
  const toggleHideTimes = useAppStore((state) => state.toggleHideTimes);
  const saveStatus = useAppStore((state) => state.saveStatus);
  const question = session?.questions.find((item) => item.id === session.current_question_id);

  if (!session) return null;
  if (isDynamicSession(session) && !question) {
    return (
      <header className="top-bar">
        <div><strong>{session.package_id}</strong><span>{t('topBar.dynamicRecorder')}</span></div>
        <div className="current-question-title"><strong>{t('topBar.noItems', { section: t(`section.${session.current_section_id.toLowerCase()}`) })}</strong></div>
        <div><span>{t('topBar.saveStatus', { status: t(`status.save.${saveStatus}`) })}</span></div>
      </header>
    );
  }
  if (!question) return null;
  const sectionTotal = session.active_section_question_ids.length;
  return (
    <header className="top-bar">
      <div>
        <strong>{session.package_id}</strong>
        <span className="nowrap">{t(session.mode === 'practice' ? 'setup.practiceMode' : 'setup.examMode')}</span>
      </div>
      <div className="current-question-title">
        <strong>{t(`section.${question.section.toLowerCase()}`)} · {t('topBar.dynamicPosition', { number: question.number, total: sectionTotal })}</strong>
        <span>{t('answer.type', { name: question.type_config ? getItemTypeDisplayLabel(question.type_config, i18n.language) : question.type_label })}</span>
      </div>
      <div>
        <button className="ghost" onClick={toggleHideTimes}>{t(hideTimes ? 'topBar.showTime' : 'topBar.hideTime')}</button>
        <span>{t('topBar.currentScope')}</span>
        <span className={isPaused ? 'timer paused' : 'timer'}>{hideTimes ? '••:••' : formatDuration(scopeActiveMs)}</span>
        <span>{t(isPaused ? 'status.paused' : 'status.timing')}</span>
        <span>{t('topBar.saveStatus', { status: t(`status.save.${saveStatus}`) })}</span>
      </div>
    </header>
  );
}
