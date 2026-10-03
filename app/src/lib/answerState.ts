import type { QuestionProgressStatus } from '../types';
import i18n from '../i18n';

export function inferAnswerStatus(answerValue: unknown): QuestionProgressStatus {
  if (answerValue === null || answerValue === undefined) return 'ENCOUNTERED_UNANSWERED';
  if (typeof answerValue === 'string') return answerValue.trim() ? 'ANSWERED' : 'ENCOUNTERED_UNANSWERED';
  if (Array.isArray(answerValue)) {
    if (answerValue.length === 0) return 'ENCOUNTERED_UNANSWERED';
    return 'ANSWERED';
  }
  if (typeof answerValue === 'object') {
    const values = Object.values(answerValue as Record<string, unknown>);
    if (values.length === 0) return 'ENCOUNTERED_UNANSWERED';
    const answered = values.filter((value) => String(value ?? '').trim() !== '').length;
    if (answered === 0) return 'ENCOUNTERED_UNANSWERED';
    if (answered < values.length) return 'PARTIALLY_ANSWERED';
    return 'ANSWERED';
  }
  return 'ANSWERED';
}

export function renderQuestionState(
  status: QuestionProgressStatus,
  flags: { isSkipped: boolean; isUncertain: boolean; isOvertime: boolean }
): string {
  const parts = [renderStatusLabel(status)];
  if (flags.isSkipped) parts.push(i18n.t('state.skipped'));
  if (flags.isUncertain) parts.push(i18n.t('state.uncertain'));
  if (flags.isOvertime) parts.push(i18n.t('state.overtime'));
  return parts.join(' · ');
}

export function renderStatus(
  status: QuestionProgressStatus,
  isSkipped: boolean,
  isOvertime: boolean,
  isUncertain = false
): string {
  return renderQuestionState(status, { isSkipped, isUncertain, isOvertime });
}

export function renderStatusLabel(status: QuestionProgressStatus): string {
  const labels: Record<QuestionProgressStatus, string> = {
    NOT_ENCOUNTERED: i18n.t('state.notEncountered'),
    ENCOUNTERED_UNANSWERED: i18n.t('state.unanswered'),
    PARTIALLY_ANSWERED: i18n.t('state.partiallyAnswered'),
    ANSWERED: i18n.t('state.answered')
  };
  return labels[status];
}
