import { AnswerPanel } from './AnswerPanel';
import { useTranslation } from 'react-i18next';
import { getItemTypeDisplayLabel } from '../i18n/displayLabels';
import { ReviewPanel } from './ReviewPanel';
import { TopBar } from './TopBar';
import { BottomBar } from './BottomBar';
import { useAppStore } from '../store/appStore';
import { formatDuration } from '../lib/timer';
import { summarizeSession } from '../lib/sessionExport';
import { deriveTimingLedger } from '../lib/timeLedger';
import { getCurrentTask, isLongWritingTask, taskStatusLabel } from '../lib/taskRuntime';
import { isDynamicSession } from '../lib/dynamicSession';
import { DynamicItemDialog } from './DynamicItemDialog';

export function PracticeShell() {
  const { t } = useTranslation();
  const session = useAppStore((state) => state.session);
  const isPaused = useAppStore((state) => state.isPaused);
  const togglePause = useAppStore((state) => state.togglePause);

  if (!session) return null;
  if (session.view === 'SESSION_SUMMARY') return <SessionSummary />;
  const longWritingTask = isLongWritingTask(getCurrentTask(session));
  const dynamicEmptySection = isDynamicSession(session) && !session.current_question_id;

  return (
    <section className="practice-layout">
      <TopBar />
      <div className={longWritingTask ? 'practice-main task-only' : 'practice-main'}>
        {dynamicEmptySection ? <DynamicEmptySection /> : <AnswerPanel />}
        {longWritingTask || dynamicEmptySection ? null : <ReviewPanel />}
      </div>
      <BottomBar />
      <DynamicItemDialog />
      <SessionNoticeDialog />
      {isPaused ? (
        <div className="pause-overlay" role="dialog" aria-modal="true" aria-label={t('practice.paused')}>
          <div className="pause-card">
            <h2>{t('practice.paused')}</h2>
            <button className="primary" onClick={togglePause}>{t('bottomBar.resume')}</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DynamicEmptySection() {
  const { t } = useTranslation();
  const session = useAppStore((state) => state.session);
  const openCreator = useAppStore((state) => state.openDynamicItemCreator);
  if (!session || !isDynamicSession(session)) return null;
  const section = session.dynamic_sections.find((item) => item.section_id === session.current_section_id);
  if (!section) return null;
  return (
    <section className="card dynamic-empty-section">
      <p className="eyebrow">Dynamic Manual Recorder</p>
      <h2>{t(`section.${section.section_id.toLowerCase()}`)}</h2>
      <p>{t('practice.emptySection')}</p>
      <button className="primary" onClick={openCreator}>{t('bottomBar.addItem', { ordinal: section.next_item_ordinal })}</button>
    </section>
  );
}

function SessionNoticeDialog() {
  const { t } = useTranslation();
  const notice = useAppStore((state) => state.sessionNotice);
  const goToFirstUnencountered = useAppStore((state) => state.goToFirstUnencountered);
  const finalizeCurrentScope = useAppStore((state) => state.finalizeCurrentScope);
  const exportSession = useAppStore((state) => state.exportSession);
  const retryTerminalRecoveryCleanup = useAppStore((state) => state.retryTerminalRecoveryCleanup);
  const goToFirstSpeakingRetry = useAppStore((state) => state.goToFirstSpeakingRetry);
  const confirmFinalizeWithSpeakingRetries = useAppStore((state) => state.confirmFinalizeWithSpeakingRetries);
  const finishDynamicCurrentSection = useAppStore((state) => state.finishDynamicCurrentSection);
  const dismiss = useAppStore((state) => state.dismissSessionNotice);
  if (!notice) return null;
  const shownIds = notice.questionIds?.slice(0, 12) ?? [];
  const shownTaskIds = notice.taskIds?.slice(0, 12) ?? [];
  const remaining = Math.max(0, (notice.questionIds?.length ?? 0) - shownIds.length);

  return (
    <div className="session-notice-overlay" role="presentation">
      <section
        className={`session-notice-dialog ${notice.kind}`}
        role="dialog"
        aria-modal="true"
        aria-label={t(notice.kind === 'error' ? 'practice.operationFailed' : 'practice.beforeFinish')}
      >
        <h2>{notice.kind === 'error'
          ? t('practice.operationIncomplete')
          : notice.retryAction === 'CONFIRM_SPEAKING_RETRIES'
            ? t('practice.speakingNeedsRetry')
            : t('practice.checkScope')}</h2>
        <p>{notice.messageKey ? t(notice.messageKey, notice.messageValues) : notice.message}</p>
        {shownIds.length > 0 ? (
          <div className="unencountered-list" aria-label={t('practice.unvisitedItems')}>
            {shownIds.map((questionId) => <span key={questionId}>{questionId}</span>)}
            {remaining > 0 ? <span>{t('practice.moreItems', { count: remaining })}</span> : null}
          </div>
        ) : null}
        {shownTaskIds.length > 0 ? (
          <div className="unencountered-list" aria-label={t('practice.retryItems')}>
            {shownTaskIds.map((taskId) => <span key={taskId}>{taskId}</span>)}
          </div>
        ) : null}
        <div className="dialog-actions">
          {shownIds.length > 0 ? (
            <button className="primary" onClick={goToFirstUnencountered}>{t('practice.goFirstUnvisited')}</button>
          ) : null}
          {notice.retryAction === 'FINALIZE_SCOPE' ? (
            <button className="primary" onClick={() => void finalizeCurrentScope()}>{t('practice.retryFinishScope')}</button>
          ) : null}
          {notice.retryAction === 'EXPORT_SESSION' ? (
            <button className="primary" onClick={() => void exportSession()}>{t('practice.retryExport')}</button>
          ) : null}
          {notice.retryAction === 'CLEANUP_TERMINAL_RECOVERY' ? (
            <button className="primary" onClick={() => void retryTerminalRecoveryCleanup()}>{t('practice.retryRecoveryCleanup')}</button>
          ) : null}
          {notice.retryAction === 'CONFIRM_SPEAKING_RETRIES' ? (
            <>
              <button className="primary" onClick={goToFirstSpeakingRetry}>{t('practice.goFirstRetry')}</button>
              <button onClick={() => void confirmFinalizeWithSpeakingRetries()}>{t('practice.finishAnyway')}</button>
            </>
          ) : null}
          {notice.retryAction === 'CONFIRM_DYNAMIC_SECTION' ? (
            <button className="primary" onClick={() => void finishDynamicCurrentSection(true)}>{t('practice.confirmFinishSection')}</button>
          ) : null}
          {notice.retryAction !== 'CONFIRM_SPEAKING_RETRIES' ? (
            <button onClick={dismiss}>{t('practice.cancelClose')}</button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function SessionSummary() {
  const { t, i18n } = useTranslation();
  const session = useAppStore((state) => state.session);
  const returnHome = useAppStore((state) => state.returnHome);
  const exportSession = useAppStore((state) => state.exportSession);
  const openCurrentExportDirectory = useAppStore((state) => state.openCurrentExportDirectory);
  const exportStatus = useAppStore((state) => state.exportStatus);
  const exportError = useAppStore((state) => state.exportError);
  const exportDirectory = useAppStore((state) => state.exportDirectory);
  const reopenDynamicSection = useAppStore((state) => state.reopenDynamicSection);
  if (!session) return null;
  const metrics = summarizeSession(session);
  const timing = deriveTimingLedger(session);
  const dynamic = isDynamicSession(session);
  const sections = dynamic
    ? session.dynamic_sections.map((section) => section.section_id)
    : Array.from(new Set(session.modules.map((scope) => scope.section)));
  const dynamicTypeCounts = dynamic
    ? Array.from(session.questions.reduce((counts, item) => {
        const key = `${item.renderer} / ${item.type_config ? getItemTypeDisplayLabel(item.type_config, i18n.language) : item.type_label}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return counts;
      }, new Map<string, number>()))
    : [];

  return (
    <section className="card session-summary">
      <p className="eyebrow">{t('summary.title')}</p>
      <h2>{session.package_id}</h2>
      <div className="summary-metrics">
        <span>{t('summary.activeTime')}<strong>{formatDuration(session.active_ms)}</strong></span>
        <span>{t('summary.pausedTime')}<strong>{formatDuration(session.paused_ms)}</strong></span>
        <span>{t('summary.answered')}<strong>{metrics.answered}</strong></span>
        <span>{t('summary.unanswered')}<strong>{metrics.unanswered}</strong></span>
        <span>{t('bottomBar.skip')}<strong>{metrics.skipped}</strong></span>
        <span>{t('bottomBar.uncertain')}<strong>{metrics.uncertain}</strong></span>
        <span>{t('common.overtime')}<strong>{metrics.overtime}</strong></span>
        <span>{t('summary.visitedUnanswered')}<strong>{metrics.encounteredUnanswered}</strong></span>
      </div>
      <h3>{t(dynamic ? 'summary.sectionTime' : 'summary.scopeTime')}</h3>
      <ul className="scope-summary-list section-summary-list">
        {sections.map((section) => (
          <li key={section}>
            <span>{t(`section.${section.toLowerCase()}`)}</span>
            <span>{formatDuration(timing.sections[section])}</span>
          </li>
        ))}
      </ul>
      {dynamic ? (
        <>
          <ul className="scope-summary-list dynamic-section-summary-list">
            {session.dynamic_sections.map((section) => {
              const items = section.item_ids.map((itemId) => session.questions.find((item) => item.id === itemId)).filter(Boolean);
              const answered = section.item_ids.filter((itemId) => session.answers[itemId]?.progress_status === 'ANSWERED').length;
              const skipped = section.item_ids.filter((itemId) => session.answers[itemId]?.is_skipped).length;
              const uncertain = section.item_ids.filter((itemId) => session.answers[itemId]?.is_uncertain).length;
              return (
                <li key={section.section_id}>
                  <span>{t('summary.sectionMetrics', { section: t(`section.${section.section_id.toLowerCase()}`), created: items.length, answered, skipped, uncertain })}</span>
                  <button onClick={() => reopenDynamicSection(section.section_id)}>{t('summary.reopenSection')}</button>
                </li>
              );
            })}
          </ul>
          <h3>{t('summary.typeStats')}</h3>
          <ul className="scope-summary-list dynamic-type-summary-list">
            {dynamicTypeCounts.map(([label, count]) => (
              <li key={label}><span>{label}</span><strong>{count}</strong></li>
            ))}
          </ul>
        </>
      ) : (
        <ul className="scope-summary-list">
          {session.modules.map((scope) => (
            <li key={scope.id}>
              <span>{scope.label}</span>
              <span>{t(scope.status === 'FINALIZED' ? 'status.completed' : 'status.incomplete')} · {formatDuration(scope.activeTimeMs)}</span>
            </li>
          ))}
        </ul>
      )}
      {!dynamic && session.tasks.length > 0 ? (
        <>
          <h3>Task Runtime</h3>
          <ul className="scope-summary-list task-summary-list">
            {session.tasks.map((task) => (
              <li key={task.task_id}>
                <span>{task.task_id} · {task.task_type}</span>
                <span>{taskStatusLabel(task)} · {formatDuration(task.active_time_ms)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {timing.unattributedActiveMs > 0 ? (
        <p className="danger-text">{t('summary.unattributedTime', { time: formatDuration(timing.unattributedActiveMs) })}</p>
      ) : null}
      <div className={`export-result ${exportStatus}`} aria-live="polite">
        {exportStatus === 'exporting' ? <p>{t('summary.exporting')}</p> : null}
        {exportStatus === 'exported' ? <p className="success-text">{t('summary.exportSuccess', { path: exportDirectory })}</p> : null}
        {exportStatus === 'error' ? <p className="danger-text">{t('summary.exportFailed', { detail: exportError })}</p> : null}
      </div>
      <div className="summary-actions">
        <button className="primary" onClick={() => void exportSession()} disabled={exportStatus === 'exporting'}>
          {t(exportStatus === 'error' ? 'practice.retryExport' : 'summary.exportAll')}
        </button>
        <button onClick={() => void openCurrentExportDirectory()} disabled={!exportDirectory}>{t('summary.openExportDirectory')}</button>
        <button onClick={returnHome}>{t('summary.returnHome')}</button>
      </div>
    </section>
  );
}
