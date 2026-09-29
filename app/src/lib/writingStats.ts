import type { WritingInputType } from '../types';

export interface WritingChangeDelta {
  keyboardCharacters: number;
  pastedCharacters: number;
  deletedCharacters: number;
  cutCount: number;
  pasteCount: number;
  undoCount: number;
  redoCount: number;
}

const WORD_PATTERN = /(?:\d+(?:\.\d+)+|[A-Za-zÀ-ÖØ-öø-ÿ0-9]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿ0-9]+)*['’]?)/g;

export function countEnglishWords(text: string): number {
  return text.match(WORD_PATTERN)?.length ?? 0;
}

export function countCharacters(text: string): number {
  return [...text].length;
}

export function calculateKeyboardCpm(keyboardCharacters: number, activeTimeMs: number): number {
  if (!Number.isFinite(activeTimeMs) || activeTimeMs <= 0) return 0;
  return (Math.max(0, keyboardCharacters) * 60_000) / activeTimeMs;
}

export function analyzeWritingChange(
  previousText: string,
  nextText: string,
  inputType: WritingInputType
): WritingChangeDelta {
  const { inserted, removed } = changedCodePointCounts(previousText, nextText);
  const historyUndo = inputType === 'historyUndo';
  const historyRedo = inputType === 'historyRedo';
  if (historyUndo || historyRedo) {
    return {
      keyboardCharacters: 0,
      pastedCharacters: 0,
      deletedCharacters: 0,
      cutCount: 0,
      pasteCount: 0,
      undoCount: historyUndo ? 1 : 0,
      redoCount: historyRedo ? 1 : 0
    };
  }

  const pasted = inputType === 'insertFromPaste';
  const cut = inputType === 'deleteByCut';
  return {
    keyboardCharacters: pasted || inputType.startsWith('delete') ? 0 : inserted,
    pastedCharacters: pasted ? inserted : 0,
    deletedCharacters: removed,
    cutCount: cut ? 1 : 0,
    pasteCount: pasted ? 1 : 0,
    undoCount: 0,
    redoCount: 0
  };
}

function changedCodePointCounts(previousText: string, nextText: string): { inserted: number; removed: number } {
  const previous = [...previousText];
  const next = [...nextText];
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    inserted: Math.max(0, next.length - prefix - suffix),
    removed: Math.max(0, previous.length - prefix - suffix)
  };
}
