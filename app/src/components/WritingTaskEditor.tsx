import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentTask, getTaskTimingState, isWritingTaskEditable } from '../lib/taskRuntime';
import { formatDuration } from '../lib/timer';
import { useAppStore } from '../store/appStore';
import { useWritingTextPolicyInput } from './useWritingTextPolicyInput';

export function WritingTaskEditor() {
  const { t } = useTranslation();
  const session = useAppStore((state) => state.session);
  const isPaused = useAppStore((state) => state.isPaused);
  const taskActiveMs = useAppStore((state) => state.taskActiveMs);
  const updateWritingText = useAppStore((state) => state.updateWritingText);
  const undoWritingText = useAppStore((state) => state.undoWritingText);
  const redoWritingText = useAppStore((state) => state.redoWritingText);
  const sessionNotice = useAppStore((state) => state.sessionNotice);
  const windowClosePhase = useAppStore((state) => state.windowClosePhase);
  const [clipboardError, setClipboardError] = useState<string>();
  const task = session ? getCurrentTask(session) : undefined;
  const text = task?.text ?? '';
  const timing = task ? getTaskTimingState(task, taskActiveMs) : undefined;
  const editable = !!session && !!task && !!timing && !isPaused && isWritingTaskEditable(session, {
    ...task,
    is_overtime: timing.is_overtime
  }) && !sessionNotice && windowClosePhase === 'IDLE';
  const policy = useWritingTextPolicyInput<HTMLTextAreaElement>({
    value: text,
    allowLineBreaks: true,
    onCommit: updateWritingText,
    history: {
      blocked: !editable,
      undoText: task?.undo_stack?.at(-1),
      redoText: task?.redo_stack?.at(-1),
      onUndo: undoWritingText,
      onRedo: redoWritingText
    }
  });

  if (!session || !task || task.section_id !== 'Writing' || !timing) return null;
  const label = task.task_id === 'WRITING_EMAIL' ? 'Email' : 'Academic Discussion';

  const cutSelection = async () => {
    const editor = policy.editorRef.current;
    if (!editor || editor.selectionStart === editor.selectionEnd) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text.slice(start, end));
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

  return (
    <div className="writing-task-editor">
      <div className="task-timing-row">
        <span>{t('writing.activeTime', { time: formatDuration(taskActiveMs) })}</span>
        <span className={timing.is_overtime ? 'danger-text' : ''}>
          {t('writing.remaining', { time: timing.remaining_ms === null ? t('writing.unlimited') : formatDuration(timing.remaining_ms) })}
        </span>
        {timing.is_overtime ? <strong className="danger-text">{t(session.mode === 'practice' ? 'writing.overtimePractice' : 'writing.overtimeExam')}</strong> : null}
      </div>
      <div className="writing-toolbar" role="toolbar" aria-label={t('writing.toolbar', { label })}>
        <button disabled={!editable} onClick={() => void cutSelection()}>Cut</button>
        <button disabled={!editable} onClick={() => void pasteSelection()}>Paste</button>
        <button disabled={!editable || (task.undo_stack?.length ?? 0) === 0} onClick={policy.undoHistory}>Undo</button>
        <button disabled={!editable || (task.redo_stack?.length ?? 0) === 0} onClick={policy.redoHistory}>Redo</button>
      </div>
      {clipboardError ? <p role="alert" className="danger-text">{clipboardError}</p> : null}
      {policy.policyNoticeVisible ? (
        <p className="writing-policy-notice" role="status">{t('writing.policyNotice')}</p>
      ) : null}
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
        <span>Word count<strong>{task.word_count ?? 0}</strong></span>
        <span>Character count<strong>{task.character_count ?? 0}</strong></span>
        <span>Keyboard CPM<strong>{(task.keyboard_cpm ?? 0).toFixed(1)}</strong></span>
        <span>Keyboard characters<strong>{task.keyboard_inserted_characters ?? 0}</strong></span>
        <span>Pasted characters<strong>{task.pasted_characters ?? 0}</strong></span>
        <span>Deleted characters<strong>{task.deleted_characters ?? 0}</strong></span>
        <span>Cut / Paste<strong>{task.cut_count ?? 0} / {task.paste_count ?? 0}</strong></span>
        <span>Undo / Redo<strong>{task.undo_count ?? 0} / {task.redo_count ?? 0}</strong></span>
        <span>Changes<strong>{task.modification_count ?? 0}</strong></span>
      </div>
    </div>
  );
}
