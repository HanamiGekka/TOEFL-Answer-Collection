import { useAppStore } from '../store/appStore';
import { useTranslation } from 'react-i18next';
import { isDynamicSession } from '../lib/dynamicSession';

export function BottomBar() {
  const { t } = useTranslation();
  const previousQuestion = useAppStore((state) => state.previousQuestion);
  const nextQuestion = useAppStore((state) => state.nextQuestion);
  const skipCurrent = useAppStore((state) => state.skipCurrent);
  const toggleReview = useAppStore((state) => state.toggleReview);
  const togglePause = useAppStore((state) => state.togglePause);
  const isPaused = useAppStore((state) => state.isPaused);
  const openDynamicItemCreator = useAppStore((state) => state.openDynamicItemCreator);
  const finishDynamicCurrentSection = useAppStore((state) => state.finishDynamicCurrentSection);
  const session = useAppStore((state) => state.session);
  if (session && isDynamicSession(session)) {
    const section = session.dynamic_sections.find((item) => item.section_id === session.current_section_id);
    const completesSession = session.dynamic_sections.every((item) =>
      item.section_id === session.current_section_id || item.status === 'COMPLETED' || item.status === 'SKIPPED_EMPTY');
    const finishLabel = t(completesSession ? 'dynamicItem.finishAndSession' : 'dynamicItem.finishSection', { section: t(`section.${session.current_section_id.toLowerCase()}`) });
    const currentPosition = section?.item_ids.indexOf(session.current_question_id) ?? -1;
    const simulationListeningLocked = session.mode === 'exam_simulation' && session.current_section_id === 'Listening';
    if (!session.current_question_id) {
      return (
        <footer className="bottom-bar dynamic-bottom-bar">
          <button className="primary" onClick={openDynamicItemCreator}>{t('bottomBar.addItem', { ordinal: section?.next_item_ordinal ?? 1 })}</button>
          <button onClick={() => void finishDynamicCurrentSection(false)}>{finishLabel}</button>
        </footer>
      );
    }
    return (
      <footer className="bottom-bar dynamic-bottom-bar">
        <button onClick={previousQuestion} disabled={isPaused || currentPosition <= 0 || simulationListeningLocked}>{t('bottomBar.previous')}</button>
        <button className="primary" onClick={nextQuestion} disabled={isPaused}>{t('bottomBar.next')}</button>
        <button onClick={skipCurrent} disabled={isPaused}>{t('bottomBar.skip')}</button>
        <button onClick={toggleReview} disabled={isPaused}>{t('bottomBar.uncertain')}</button>
        <button onClick={() => void finishDynamicCurrentSection(false)} disabled={isPaused}>{finishLabel}</button>
        <button onClick={togglePause}>{t(isPaused ? 'bottomBar.resume' : 'bottomBar.pause')}</button>
      </footer>
    );
  }

  return null;
}
