import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { answerModeToInputControl, shouldQuestionBeOvertime } from '../lib/sessionEngine';
import { WritingAnswerInput } from './WritingAnswerInput';
import { isDynamicSession } from '../lib/dynamicSession';
import { DynamicLongTextEditor } from './DynamicLongTextEditor';
import { getItemTypeDisplayLabel } from '../i18n/displayLabels';

export function AnswerPanel() {
  const { t, i18n } = useTranslation();
  const session = useAppStore((state) => state.session);
  const answerCurrent = useAppStore((state) => state.answerCurrent);
  const questionActiveMs = useAppStore((state) => state.questionActiveMs);
  const isPaused = useAppStore((state) => state.isPaused);
  const sessionNotice = useAppStore((state) => state.sessionNotice);
  const windowClosePhase = useAppStore((state) => state.windowClosePhase);
  const openDynamicItemEditor = useAppStore((state) => state.openDynamicItemEditor);
  const question = session?.questions.find((item) => item.id === session.current_question_id);
  const stored = question ? session?.answers[question.id] : undefined;

  const options = useMemo(
    () => question?.option_labels ?? Array.from({ length: question?.option_count ?? 4 }, (_, index) => String.fromCharCode(65 + index)),
    [question]
  );
  if (!session || !question) return null;

  const overtime = stored?.is_overtime || shouldQuestionBeOvertime(session, question, questionActiveMs);
  const inputControl = answerModeToInputControl(question.answer_mode);
  const selectedMultiple = Array.isArray(stored?.answer_value) ? stored.answer_value.map(String) : [];
  const writingInputDisabled = isPaused || !!sessionNotice || windowClosePhase !== 'IDLE';
  const dynamic = isDynamicSession(session);

  return (
    <section className="card answer-panel">
      <div className="section-title">
        <h2>{t('answer.heading', { section: t(`section.${question.section.toLowerCase()}`), number: question.number })}</h2>
        {overtime ? <span className="danger">{t('common.overtime')}</span> : null}
      </div>
      <p className="question-type">{t('answer.type', { name: question.type_config ? getItemTypeDisplayLabel(question.type_config, i18n.language) : question.type_label })}</p>
      <p className="muted">{t('answer.noQuestions')}</p>
      {dynamic ? <button onClick={openDynamicItemEditor}>{t('answer.editType')}</button> : null}

      {dynamic && question.renderer === 'long_text' ? (
        <DynamicLongTextEditor />
      ) : dynamic && question.renderer === 'short_text' ? (
        <WritingAnswerInput
          sessionId={session.session_id}
          questionId={question.id}
          value={String(stored?.answer_value ?? '')}
          disabled={writingInputDisabled}
          onChange={answerCurrent}
          onHistoryChange={(text, inputType) => useAppStore.getState().updateWritingAnswerFromHistory(text, inputType)}
        />
      ) : inputControl === 'single_choice_buttons' ? (
        <div className="choice-grid">
          {options.map((option) => (
            <button
              key={option}
              className={stored?.answer_value === option ? 'choice selected' : 'choice'}
              disabled={isPaused}
              onClick={() => answerCurrent(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : inputControl === 'multiple_choice_controls' ? (
        <div className="choice-grid" role="group" aria-label={t('answer.multipleChoice')}>
          {options.map((option) => {
            const selected = selectedMultiple.includes(option);
            return (
              <button
                key={option}
                className={selected ? 'choice selected' : 'choice'}
                aria-pressed={selected}
                disabled={isPaused}
                onClick={() => {
                  const next = selected
                    ? selectedMultiple.filter((item) => item !== option)
                    : [...selectedMultiple, option];
                  answerCurrent(next);
                }}
              >
                {option}
              </button>
            );
          })}
        </div>
      ) : inputControl === 'multi_line_text' ? (
        <textarea
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          value={String(stored?.answer_value ?? '')}
          placeholder={t('answer.writingPlaceholder')}
          disabled={isPaused}
          onChange={(event) => {
            answerCurrent(event.target.value);
          }}
        />
      ) : (
        <input
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          value={String(stored?.answer_value ?? '')}
          placeholder={t('answer.shortPlaceholder')}
          disabled={isPaused}
          onChange={(event) => {
            answerCurrent(event.target.value);
          }}
        />
      )}
    </section>
  );
}
