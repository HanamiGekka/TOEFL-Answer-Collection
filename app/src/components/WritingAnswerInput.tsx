import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sanitizeWritingText } from '../lib/writingTextPolicy';
import { useWritingTextPolicyInput } from './useWritingTextPolicyInput';

interface QuestionHistory {
  current: string;
  undo: string[];
  redo: string[];
}

export function WritingAnswerInput({
  sessionId,
  questionId,
  value,
  disabled,
  onChange,
  onHistoryChange
}: {
  sessionId: string;
  questionId: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onHistoryChange: (value: string, inputType: 'historyUndo' | 'historyRedo') => boolean;
}) {
  const { t } = useTranslation();
  const historiesRef = useRef<{ sessionId: string; entries: Map<string, QuestionHistory> }>({
    sessionId,
    entries: new Map()
  });
  const [, setHistoryRevision] = useState(0);
  if (historiesRef.current.sessionId !== sessionId) {
    historiesRef.current = { sessionId, entries: new Map() };
  }
  let history = historiesRef.current.entries.get(questionId);
  if (!history || history.current !== value) {
    history = { current: value, undo: [], redo: [] };
    historiesRef.current.entries.set(questionId, history);
  }

  const commit = (nextText: string) => {
    const acceptedPrevious = sanitizeWritingText(history!.current, { allow_line_breaks: false }).text;
    const acceptedNext = sanitizeWritingText(nextText, { allow_line_breaks: false }).text;
    if (acceptedPrevious === acceptedNext && history!.current === acceptedNext) return;
    history!.undo.push(acceptedPrevious);
    history!.redo = [];
    history!.current = acceptedNext;
    setHistoryRevision((revision) => revision + 1);
    onChange(acceptedNext);
  };

  const applyHistory = (direction: 'undo' | 'redo'): boolean => {
    const source = direction === 'undo' ? history!.undo : history!.redo;
    const target = source.at(-1);
    if (target === undefined) return false;
    const acceptedTarget = sanitizeWritingText(target, { allow_line_breaks: false }).text;
    const changed = onHistoryChange(acceptedTarget, direction === 'undo' ? 'historyUndo' : 'historyRedo');
    if (!changed) return false;
    source.pop();
    const destination = direction === 'undo' ? history!.redo : history!.undo;
    destination.push(sanitizeWritingText(history!.current, { allow_line_breaks: false }).text);
    history!.current = acceptedTarget;
    setHistoryRevision((revision) => revision + 1);
    return true;
  };

  const policy = useWritingTextPolicyInput<HTMLInputElement>({
    value,
    allowLineBreaks: false,
    onCommit: commit,
    history: {
      blocked: disabled,
      undoText: history.undo.at(-1),
      redoText: history.redo.at(-1),
      onUndo: () => applyHistory('undo'),
      onRedo: () => applyHistory('redo')
    }
  });

  return (
    <div className="writing-answer-input">
      <input
        ref={policy.editorRef}
        aria-label={t('writing.sentenceInput')}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        value={policy.displayValue}
        placeholder={t('writing.sentencePlaceholder')}
        disabled={disabled}
        onBeforeInput={policy.onBeforeInput}
        onPaste={policy.onPaste}
        onDrop={policy.onDrop}
        onCut={policy.onCut}
        onKeyDown={policy.onKeyDown}
        onCompositionStart={policy.onCompositionStart}
        onCompositionEnd={policy.onCompositionEnd}
        onChange={policy.onChange}
      />
      {policy.policyNoticeVisible ? (
        <p className="writing-policy-notice" role="status">{t('writing.policyNotice')}</p>
      ) : null}
    </div>
  );
}
