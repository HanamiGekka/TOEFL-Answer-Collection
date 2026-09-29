import { getCurrentTask, getListenRepeatGroupTiming, taskStatusLabel } from '../lib/taskRuntime';
import { useTranslation } from 'react-i18next';
import { formatDuration } from '../lib/timer';
import { useAppStore } from '../store/appStore';

export function SpeakingTaskPanel() {
  const { t } = useTranslation();
  const session = useAppStore((state) => state.session);
  const isPaused = useAppStore((state) => state.isPaused);
  const taskActiveMs = useAppStore((state) => state.taskActiveMs);
  const taskRemainingMs = useAppStore((state) => state.taskRemainingMs);
  const startCurrent = useAppStore((state) => state.startSpeakingCurrent);
  const markCurrent = useAppStore((state) => state.markSpeakingCurrent);
  const advanceCurrent = useAppStore((state) => state.advanceSpeakingCurrent);
  const retryCurrent = useAppStore((state) => state.retrySpeakingCurrent);
  const finalizeCurrentScope = useAppStore((state) => state.finalizeCurrentScope);
  const transitionPending = useAppStore((state) => state.speakingTransitionPending);
  const guardUntil = useAppStore((state) => state.speakingTransitionGuardUntil);
  const guardTaskId = useAppStore((state) => state.speakingTransitionGuardTaskId);
  const guardAttempt = useAppStore((state) => state.speakingTransitionGuardAttempt);
  const task = session ? getCurrentTask(session) : undefined;
  if (!session || !task || task.section_id !== 'Speaking') return null;

  const listenRepeat = task.task_id.startsWith('SR');
  const groupTasks = session.tasks.filter((item) => listenRepeat ? item.task_id.startsWith('SR') : item.task_id.startsWith('SI'));
  const isLast = groupTasks.at(-1)?.task_id === task.task_id;
  const marked = task.status === 'COMPLETED' || task.status === 'NEEDS_RETRY';
  const groupTiming = listenRepeat ? getListenRepeatGroupTiming(session) : undefined;
  const guardActive = guardTaskId === task.task_id && guardAttempt === task.attempt_count &&
    monotonicNow() < guardUntil;
  const taskActionDisabled = isPaused || transitionPending || guardActive;

  return (
    <div className="speaking-task-runtime">
      <div className="task-timing-row">
        <span>{t('speaking.activeTime', { time: formatDuration(taskActiveMs) })}</span>
        <span className={taskRemainingMs === 0 ? 'danger-text' : ''}>
          {t('speaking.remaining', { time: taskRemainingMs === null ? t('speaking.groupTimer') : formatDuration(taskRemainingMs) })}
        </span>
        <strong className={task.is_overtime || taskRemainingMs === 0 ? 'danger-text' : ''}>{taskStatusLabel(task)}</strong>
      </div>

      {transitionPending || guardActive ? (
        <p className="muted" role="status">{t('speaking.transitionPending')}</p>
      ) : null}

      {listenRepeat ? (
        <>
          <p className="setup-note">{t('speaking.listenNote')}</p>
          <p>{t('speaking.groupTiming', { active: formatDuration(groupTiming?.active_time_ms ?? 0), remaining: formatDuration(taskRemainingMs ?? groupTiming?.remaining_ms ?? 0) })}</p>
        </>
      ) : (
        <p className="setup-note">{t('speaking.interviewNote')}</p>
      )}

      <div className="speaking-task-list" aria-label={t(listenRepeat ? 'speaking.listenStatus' : 'speaking.interviewStatus')}>
        {groupTasks.map((item) => (
          <span key={item.task_id} className={item.task_id === task.task_id ? 'current' : ''}>
            <strong>{item.task_id}</strong>{taskStatusLabel(item)}
          </span>
        ))}
      </div>

      <div className="speaking-controls">
        {task.status === 'NOT_STARTED' ? (
          <button className="primary" disabled={isPaused || transitionPending} onClick={() => void startCurrent()}>
            {t(listenRepeat && task.task_id === 'SR1' ? 'speaking.startListen' : 'speaking.startTask')}
          </button>
        ) : null}
        {task.status === 'ACTIVE' || task.status === 'OVERTIME' ? (
          <>
            <button className="primary" disabled={taskActionDisabled} onClick={() => void markCurrent('COMPLETED')}>
              {t(listenRepeat ? 'speaking.markComplete' : 'speaking.complete')}
            </button>
            <button disabled={taskActionDisabled} onClick={() => void markCurrent('NEEDS_RETRY')}>{t('state.needsRetry')}</button>
          </>
        ) : null}
        {task.needs_retry ? (
          <button disabled={isPaused || transitionPending} onClick={() => void retryCurrent()}>{t('speaking.retry')}</button>
        ) : null}
        {marked && !isLast ? (
          <button className="primary" disabled={taskActionDisabled} onClick={() => void advanceCurrent()}>{t('speaking.next')}</button>
        ) : null}
        {marked && isLast ? (
          <button className="primary" disabled={isPaused || transitionPending} onClick={() => void finalizeCurrentScope()}>
            {t(listenRepeat ? 'speaking.finishListen' : 'speaking.finishSpeaking')}
          </button>
        ) : null}
      </div>
      <p className="muted">{t('speaking.privacy')}</p>
    </div>
  );
}

function monotonicNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
