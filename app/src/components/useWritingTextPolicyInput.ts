import {
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CompositionEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject
} from 'react';
import type { WritingInputType } from '../types';
import { sanitizeWritingText } from '../lib/writingTextPolicy';

type WritingEditorElement = HTMLInputElement | HTMLTextAreaElement;

export function useWritingTextPolicyInput<T extends WritingEditorElement>({
  value,
  allowLineBreaks,
  onCommit,
  history
}: {
  value: string;
  allowLineBreaks: boolean;
  onCommit: (text: string, inputType: WritingInputType) => void;
  history?: {
    blocked: boolean;
    undoText?: string;
    redoText?: string;
    onUndo: () => boolean;
    onRedo: () => boolean;
  };
}): {
  editorRef: RefObject<T>;
  displayValue: string;
  policyNoticeVisible: boolean;
  replaceSelection: (inserted: string, inputType: WritingInputType) => void;
  onBeforeInput: (event: FormEvent<T>) => void;
  onPaste: (event: ClipboardEvent<T>) => void;
  onDrop: (event: DragEvent<T>) => void;
  onCut: () => void;
  onKeyDown: (event: KeyboardEvent<T>) => void;
  undoHistory: () => boolean;
  redoHistory: () => boolean;
  onCompositionStart: () => void;
  onCompositionEnd: (event: CompositionEvent<T>) => void;
  onChange: (event: ChangeEvent<T>) => void;
} {
  const editorRef = useRef<T>(null);
  const inputTypeRef = useRef<WritingInputType>('insertText');
  const composingRef = useRef(false);
  const pendingSelectionRef = useRef<number | null>(null);
  const ignoreNextCompositionValueRef = useRef<string | null>(null);
  const [compositionDraft, setCompositionDraft] = useState<string | null>(null);
  const [policyNoticeVisible, setPolicyNoticeVisible] = useState(false);
  const [selectionRevision, setSelectionRevision] = useState(0);

  useLayoutEffect(() => {
    if (pendingSelectionRef.current === null || !editorRef.current) return;
    const caret = Math.min(pendingSelectionRef.current, editorRef.current.value.length);
    pendingSelectionRef.current = null;
    editorRef.current.focus();
    editorRef.current.setSelectionRange(caret, caret);
  }, [selectionRevision, value]);

  const commitRawValue = (
    rawValue: string,
    inputType: WritingInputType,
    rawCaret: number | null = null
  ) => {
    const filtered = sanitizeWritingText(rawValue, { allow_line_breaks: allowLineBreaks });
    if (filtered.rejected_count > 0) setPolicyNoticeVisible(true);
    if (rawCaret !== null) {
      pendingSelectionRef.current = sanitizeWritingText(
        rawValue.slice(0, rawCaret),
        { allow_line_breaks: allowLineBreaks }
      ).text.length;
      setSelectionRevision((revision) => revision + 1);
    }
    setCompositionDraft(null);
    inputTypeRef.current = 'insertText';
    onCommit(filtered.text, inputType);
  };

  const replaceSelection = (inserted: string, inputType: WritingInputType) => {
    const editor = editorRef.current;
    if (!editor) return;
    const start = editor.selectionStart ?? 0;
    const end = editor.selectionEnd ?? start;
    const current = compositionDraft ?? value;
    const rawValue = `${current.slice(0, start)}${inserted}${current.slice(end)}`;
    commitRawValue(rawValue, inputType, start + inserted.length);
  };

  const runHistory = (direction: 'undo' | 'redo'): boolean => {
    if (!history || history.blocked) return false;
    const target = direction === 'undo' ? history.undoText : history.redoText;
    if (target === undefined) return false;
    const changed = direction === 'undo' ? history.onUndo() : history.onRedo();
    if (!changed) return false;
    pendingSelectionRef.current = target.length;
    setSelectionRevision((revision) => revision + 1);
    return true;
  };

  return {
    editorRef,
    displayValue: compositionDraft ?? value,
    policyNoticeVisible,
    replaceSelection,
    onBeforeInput(event) {
      const nativeEvent = event.nativeEvent as InputEvent;
      const inputType = nativeEvent.inputType || 'insertText';
      inputTypeRef.current = inputType;
      if (
        composingRef.current ||
        nativeEvent.isComposing ||
        inputType === 'insertCompositionText' ||
        nativeEvent.data === null
      ) return;
      const insertion = sanitizeWritingText(nativeEvent.data, { allow_line_breaks: allowLineBreaks });
      if (insertion.changed) {
        event.preventDefault();
        replaceSelection(nativeEvent.data, inputType);
      }
    },
    onPaste(event) {
      event.preventDefault();
      replaceSelection(event.clipboardData.getData('text/plain'), 'insertFromPaste');
    },
    onDrop(event) {
      event.preventDefault();
      replaceSelection(event.dataTransfer.getData('text/plain'), 'insertFromDrop');
    },
    onCut() {
      inputTypeRef.current = 'deleteByCut';
    },
    onKeyDown(event) {
      const nativeEvent = event.nativeEvent;
      const altGraph = typeof nativeEvent.getModifierState === 'function' && nativeEvent.getModifierState('AltGraph');
      if (
        history?.blocked || event.repeat || composingRef.current || nativeEvent.isComposing ||
        event.altKey || altGraph || !(event.ctrlKey || event.metaKey)
      ) return;
      const key = event.key.toLowerCase();
      const direction = key === 'z' && !event.shiftKey
        ? 'undo'
        : (key === 'y' && !event.shiftKey) || (key === 'z' && event.shiftKey)
          ? 'redo'
          : null;
      if (direction && runHistory(direction)) event.preventDefault();
    },
    undoHistory() {
      return runHistory('undo');
    },
    redoHistory() {
      return runHistory('redo');
    },
    onCompositionStart() {
      composingRef.current = true;
      ignoreNextCompositionValueRef.current = null;
      setCompositionDraft(value);
    },
    onCompositionEnd(event) {
      const rawValue = event.currentTarget.value;
      composingRef.current = false;
      ignoreNextCompositionValueRef.current = rawValue;
      commitRawValue(rawValue, 'insertCompositionText', event.currentTarget.selectionStart);
    },
    onChange(event) {
      const rawValue = event.target.value;
      if (composingRef.current) {
        setCompositionDraft(rawValue);
        return;
      }
      if (ignoreNextCompositionValueRef.current === rawValue) {
        ignoreNextCompositionValueRef.current = null;
        return;
      }
      const nativeInputType = (event.nativeEvent as InputEvent).inputType;
      commitRawValue(
        rawValue,
        nativeInputType || inputTypeRef.current || 'insertText',
        event.target.selectionStart
      );
    }
  };
}
