import { useAppStore } from '../store/appStore';
import { useTranslation } from 'react-i18next';
import { renderQuestionState } from '../lib/answerState';
import { getQuestionNavItems } from '../lib/sessionEngine';
import { getCurrentTask, isLongWritingTask } from '../lib/taskRuntime';

function questionStateClasses(item: ReturnType<typeof getQuestionNavItems>[number]): string {
  return [
    'answer-card-cell',
    item.isCurrent ? 'current' : '',
    item.status === 'ANSWERED' ? 'answered' : '',
    item.isSkipped ? 'skipped' : '',
    item.isUncertain ? 'uncertain' : '',
    item.isOvertime ? 'overtime' : ''
  ].filter(Boolean).join(' ');
}

export function ReviewPanel() {
  const { t } = useTranslation();
  const session = useAppStore((state) => state.session);
  const goToQuestion = useAppStore((state) => state.goToQuestion);
  const isPaused = useAppStore((state) => state.isPaused);
  if (!session) return null;
  if (isLongWritingTask(getCurrentTask(session))) return null;
  const items = getQuestionNavItems(session);

  return (
    <section className="card review-panel" id="answer-card-review" tabIndex={-1} aria-label={t('review.aria')}>
      <h2>{t('review.title')}</h2>
      <p className="muted">{t('review.help')}</p>
      <div className="answer-card-grid" aria-label={t('review.navigation')}>
        {items.map((item) => {
          const label = renderQuestionState(item.status, {
             isSkipped: item.isSkipped,
             isUncertain: item.isUncertain,
             isOvertime: item.isOvertime
           });
          return (
            <button
              key={item.id}
              className={questionStateClasses(item)}
              aria-current={item.ariaCurrent}
              title={t('review.questionTitle', { section: item.section, number: item.number, label })}
              disabled={isPaused || item.isDisabled}
              onClick={() => goToQuestion(item.index)}
            >
              <strong>{item.label}</strong>
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
