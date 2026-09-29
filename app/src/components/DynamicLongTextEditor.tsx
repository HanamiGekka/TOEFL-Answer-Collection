import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDuration } from '../lib/timer';
import { getItemTypeDisplayLabel } from '../i18n/displayLabels';
import i18n from '../i18n';
import { useAppStore } from '../store/appStore';
import { useWritingTextPolicyInput } from './useWritingTextPolicyInput';

export function DynamicLongTextEditor() {
  const { t } = useTranslation();
  const session = useAppStore((state) => state.session);
  const isPaused = useAppStore((state) => state.isPaused);
  const questionActiveMs = useAppStore((state) => state.questionActiveMs);
  const sessionNotice = useAppStore((state) => state.sessionNotice);
  const windowClosePhase = useAppStore((state) => state.windowClosePhase);
  const updateText = useAppStore((state) => state.updateDynamicLongText);
  const undoText = useAppStore((state) => state.undoDynamicLongText);
  const redoText = useAppStore((state) => state.redoDynamicLongText);
  const [clipboardError, setClipboardError] = useState<string>();
  const item = session?.questions.find((question) => question.id === session.current_question_id);
  const writing = item?.writing_state;
  const text = writing?.text ?? '';
  const editable = Boolean(item && !isPaused && !sessionNotice && windowClosePhase === 'IDLE');
  const remaining = item?.custom_time_limit_ms == null
    ? null
    : Math.max(0, item.custom_time_limit_ms - questionActiveMs);
  const overtime = item?.custom_time_limit_ms != null && questionActiveMs >= item.custom_time_limit_ms;
  const policy = useWritingTextPolicyInput<HTMLTextAreaElement>({
    value: text,
    allowLineBreaks: true,
    onCommit: updateText,
    history: {
      blocked: !editable,
      undoText: writing?.undo_stack.at(-1),
      redoText: writing?.redo_stack.at(-1),
      onUndo: undoText,
      onRedo: redoText
    }
  });

  if (!session || !item || item.renderer !== 'long_text') return null;

  const cutSelection = async () => {
    const editor = policy.editorRef.current;
    if (!editor || editor.selectionStart === editor.selectionEnd) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text.slice(editor.selectionStart, editor.selectionEnd));
      setClipboardError(undefined);
      policy.replaceSelection('', 'deleteByCut');
    } catch (error) {
      setClipboardError(t('writing.clipboardWriteFailed', { detail: error instanceof Error ? error.message : String(error) }));
    }
  };

  const pasteSelection = async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error('Clipboard API unavailable');
      const pasted = await navigator.clipboard.readText();
      setClipboardError(undefined);
      policy.replaceSelection(pasted, 'insertFromPaste');
    } catch (error) {
      setClipboardError(t('writing.clipboardReadFailed', { detail: error instanceof Error ? error.message : String(error) }));
    }
  };

  const label = item.type_config ? getItemTypeDisplayLabel(item.type_config, i18n.language) : item.type_label;
  return (
    <div className="writing-task-editor dynamic-long-text-editor">
      <div className="task-timing-row">
        <span>{t('writing.activeTime', { time: formatDuration(questionActiveMs) })}</span>
        <span className={overtime ? 'danger-text' : ''}>{t('writing.remaining', { time: remaining === null ? t('writing.unlimited') : formatDuration(remaining) })}</span>
        {overtime ? <strong className="danger-text">{t('writing.overtimeCustom')}</strong> : null}
      </div>
      <div className="writing-toolbar" role="toolbar" aria-label={t('writing.toolbar', { label })}>
        <button disabled={!editable} onClick={() => void cutSelection()}>Cut</button>
        <button disabled={!editable} onClick={() => void pasteSelection()}>Paste</button>
        <button disabled={!editable || (writing?.undo_stack.length ?? 0) === 0} onClick={policy.undoHistory}>Undo</button>
        <button disabled={!editable || (writing?.redo_stack.length ?? 0) === 0} onClick={policy.redoHistory}>Redo</button>
      </div>
      {clipboardError ? <p role="alert" className="danger-text">{clipboardError}</p> : null}
      {policy.policyNoticeVisible ? <p className="writing-policy-notice" role="status">{t('writing.policyNotice')}</p> : null}
      <textarea
        ref={policy.editorRef}
        className="writing-input"
        aria-label={t('writing.input', { label })}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        value={policy.displayValue}
        disabled={!editable}
        placeholder={t('writing.placeholder', { label })}
        onBeforeInput={policy.onBeforeInput}
        onPaste={policy.onPaste}
        onDrop={policy.onDrop}
        onCut={policy.onCut}
        onKeyDown={policy.onKeyDown}
        onCompositionStart={policy.onCompositionStart}
        onCompositionEnd={policy.onCompositionEnd}
        onChange={policy.onChange}
      />
      <div className="writing-metrics" aria-live="polite">
        <span>Word count<strong>{writing?.word_count ?? 0}</strong></span>
        <span>Character count<strong>{writing?.character_count ?? 0}</strong></span>
        <span>Keyboard CPM<strong>{(writing?.keyboard_cpm ?? 0).toFixed(1)}</strong></span>
        <span>Keyboard characters<strong>{writing?.keyboard_inserted_characters ?? 0}</strong></span>
        <span>Pasted characters<strong>{writing?.pasted_characters ?? 0}</strong></span>
        <span>Deleted characters<strong>{writing?.deleted_characters ?? 0}</strong></span>
        <span>Cut / Paste<strong>{writing?.cut_count ?? 0} / {writing?.paste_count ?? 0}</strong></span>
        <span>Undo / Redo<strong>{writing?.undo_count ?? 0} / {writing?.redo_count ?? 0}</strong></span>
        <span>Changes<strong>{writing?.modification_count ?? 0}</strong></span>
      </div>
    </div>
  );
}
