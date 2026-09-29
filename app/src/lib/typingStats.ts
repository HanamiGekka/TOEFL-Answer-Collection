import type { TypingMinuteSample, TypingSnapshot } from '../types';

type Origin = 'keyboard' | 'paste' | 'unknown';

interface TrackedChar {
  ch: string;
  origin: Origin;
}

export interface SerializedTypingStats {
  schema_version: 1;
  text: string;
  origin_codes: string;
  keyboard_inserted_characters: number;
  keyboard_inserted_letters: number;
  deleted_characters: number;
  deleted_letters: number;
  pasted_characters: number;
  pasted_letters: number;
  paste_count: number;
  last_sample?: TypingSnapshot;
  samples: TypingMinuteSample[];
}

export interface TextDelta {
  start: number;
  removed: string;
  inserted: string;
}

export function countCharacters(value: string): number {
  return [...value].length;
}

export function countAsciiLetters(value: string): number {
  return (value.match(/[A-Za-z]/g) ?? []).length;
}

export function countEnglishWords(value: string): number {
  return (value.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? []).length;
}

export function diffText(before: string, after: string): TextDelta {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  return {
    start,
    removed: before.slice(start, beforeEnd),
    inserted: after.slice(start, afterEnd)
  };
}

export class TypingStatsAccumulator {
  private chars: TrackedChar[] = [];
  private keyboardInsertedCharacters = 0;
  private keyboardInsertedLetters = 0;
  private deletedCharacters = 0;
  private deletedLetters = 0;
  private pastedCharacters = 0;
  private pastedLetters = 0;
  private pasteCount = 0;
  private lastSample?: TypingSnapshot;
  private samples: TypingMinuteSample[] = [];

  constructor(initialText = '') {
    this.chars = [...initialText].map((ch) => ({ ch, origin: 'unknown' }));
  }

  static fromState(state: SerializedTypingStats): TypingStatsAccumulator {
    const tracker = new TypingStatsAccumulator();
    const characters = [...state.text];
    tracker.chars = characters.map((ch, index) => ({
      ch,
      origin: decodeOrigin(state.origin_codes[index])
    }));
    tracker.keyboardInsertedCharacters = Math.max(0, state.keyboard_inserted_characters);
    tracker.keyboardInsertedLetters = Math.max(0, state.keyboard_inserted_letters);
    tracker.deletedCharacters = Math.max(0, state.deleted_characters);
    tracker.deletedLetters = Math.max(0, state.deleted_letters);
    tracker.pastedCharacters = Math.max(0, state.pasted_characters);
    tracker.pastedLetters = Math.max(0, state.pasted_letters);
    tracker.pasteCount = Math.max(0, state.paste_count);
    tracker.lastSample = state.last_sample ? { ...state.last_sample } : undefined;
    tracker.samples = state.samples.map((sample) => ({ ...sample }));
    return tracker;
  }

  applyTextChange(before: string, after: string, inputType: string): void {
    const delta = diffText(before, after);
    const startIndex = countCharacters(before.slice(0, delta.start));
    const removedCount = countCharacters(delta.removed);
    const removedTracked = this.chars.slice(startIndex, startIndex + removedCount);
    const isHistory = inputType === 'historyUndo' || inputType === 'historyRedo';
    if (!isHistory) {
      this.deletedCharacters += removedTracked.length;
      this.deletedLetters += removedTracked.reduce(
        (sum, item) => sum + (/[A-Za-z]/.test(item.ch) ? 1 : 0),
        0
      );
    }

    const origin = classifyOrigin(inputType);
    const insertedTracked = [...delta.inserted].map((ch) => ({ ch, origin }));
    this.chars.splice(startIndex, removedCount, ...insertedTracked);

    const insertedCharacters = insertedTracked.length;
    const insertedLetters = countAsciiLetters(delta.inserted);
    if (origin === 'paste') {
      this.pastedCharacters += insertedCharacters;
      this.pastedLetters += insertedLetters;
      if (insertedCharacters > 0) this.pasteCount += 1;
    } else if (origin === 'keyboard') {
      this.keyboardInsertedCharacters += insertedCharacters;
      this.keyboardInsertedLetters += insertedLetters;
    }
  }

  snapshot(activeMs: number, pausedMs: number): TypingSnapshot {
    const text = this.chars.map((item) => item.ch).join('');
    const retainedCharacters = this.chars.length;
    const retainedLetters = countAsciiLetters(text);
    const retainedWords = countEnglishWords(text);
    const retainedTypedCharacters = this.chars.reduce(
      (sum, item) => sum + (item.origin === 'keyboard' ? 1 : 0),
      0
    );
    const retainedTypedLetters = this.chars.reduce(
      (sum, item) => sum + (item.origin === 'keyboard' && /[A-Za-z]/.test(item.ch) ? 1 : 0),
      0
    );
    const activeMinutes = Math.max(activeMs / 60_000, 0);
    const retentionAccuracy =
      this.keyboardInsertedLetters === 0
        ? 100
        : Math.max(0, Math.min(100, (retainedTypedLetters / this.keyboardInsertedLetters) * 100));

    return {
      text,
      active_ms: Math.max(0, activeMs),
      paused_ms: Math.max(0, pausedMs),
      retained_letters: retainedLetters,
      retained_words: retainedWords,
      retained_characters: retainedCharacters,
      retained_typed_characters: retainedTypedCharacters,
      retained_spaces: (text.match(/ /g) ?? []).length,
      retained_line_breaks: (text.match(/\n/g) ?? []).length,
      retained_typed_letters: retainedTypedLetters,
      keyboard_inserted_characters: this.keyboardInsertedCharacters,
      keyboard_inserted_letters: this.keyboardInsertedLetters,
      deleted_characters: this.deletedCharacters,
      deleted_letters: this.deletedLetters,
      pasted_characters: this.pastedCharacters,
      pasted_letters: this.pastedLetters,
      paste_count: this.pasteCount,
      retention_accuracy: retentionAccuracy,
      net_cpm: activeMinutes > 0 ? retainedTypedCharacters / activeMinutes : 0,
      gross_cpm: activeMinutes > 0 ? this.keyboardInsertedCharacters / activeMinutes : 0,
      actual_wpm: activeMinutes > 0 ? retainedWords / activeMinutes : 0,
      standard_wpm: activeMinutes > 0 ? retainedTypedCharacters / 5 / activeMinutes : 0
    };
  }

  sample(activeMs: number, pausedMs: number, timestamp: string, final = false): TypingMinuteSample | null {
    const current = this.snapshot(activeMs, pausedMs);
    const activeMinute = Math.floor(activeMs / 60_000);
    if (!final && activeMinute <= this.samples.length) return null;

    const previous = this.lastSample;
    const sample: TypingMinuteSample = {
      active_minute_index: final ? 'FINAL' : activeMinute,
      timestamp,
      active_ms: activeMs,
      retained_letters_cumulative: current.retained_letters,
      retained_letters_delta: current.retained_letters - (previous?.retained_letters ?? 0),
      retained_words_cumulative: current.retained_words,
      retained_words_delta: current.retained_words - (previous?.retained_words ?? 0),
      retained_characters_cumulative: current.retained_characters,
      retained_characters_delta: current.retained_characters - (previous?.retained_characters ?? 0),
      keyboard_inserted_characters_cumulative: current.keyboard_inserted_characters,
      keyboard_inserted_characters_delta:
        current.keyboard_inserted_characters - (previous?.keyboard_inserted_characters ?? 0),
      keyboard_inserted_letters_cumulative: current.keyboard_inserted_letters,
      keyboard_inserted_letters_delta:
        current.keyboard_inserted_letters - (previous?.keyboard_inserted_letters ?? 0),
      deleted_characters_cumulative: current.deleted_characters,
      deleted_characters_delta: current.deleted_characters - (previous?.deleted_characters ?? 0),
      deleted_letters_cumulative: current.deleted_letters,
      deleted_letters_delta: current.deleted_letters - (previous?.deleted_letters ?? 0),
      pasted_characters_cumulative: current.pasted_characters,
      pasted_characters_delta: current.pasted_characters - (previous?.pasted_characters ?? 0),
      pasted_letters_cumulative: current.pasted_letters,
      pasted_letters_delta: current.pasted_letters - (previous?.pasted_letters ?? 0),
      retention_accuracy: current.retention_accuracy,
      net_cpm: current.net_cpm,
      gross_cpm: current.gross_cpm,
      actual_wpm: current.actual_wpm,
      standard_wpm: current.standard_wpm
    };
    this.lastSample = current;
    this.samples.push(sample);
    return sample;
  }

  getSamples(): TypingMinuteSample[] {
    return this.samples.map((sample) => ({ ...sample }));
  }

  serializeState(): SerializedTypingStats {
    return {
      schema_version: 1,
      text: this.chars.map((item) => item.ch).join(''),
      origin_codes: this.chars.map((item) => encodeOrigin(item.origin)).join(''),
      keyboard_inserted_characters: this.keyboardInsertedCharacters,
      keyboard_inserted_letters: this.keyboardInsertedLetters,
      deleted_characters: this.deletedCharacters,
      deleted_letters: this.deletedLetters,
      pasted_characters: this.pastedCharacters,
      pasted_letters: this.pastedLetters,
      paste_count: this.pasteCount,
      last_sample: this.lastSample ? { ...this.lastSample } : undefined,
      samples: this.getSamples()
    };
  }
}

function classifyOrigin(inputType: string): Origin {
  if (inputType === 'insertFromPaste' || inputType === 'insertFromPasteAsQuotation') return 'paste';
  if (inputType === 'historyUndo' || inputType === 'historyRedo' || inputType === 'insertFromDrop') {
    return 'unknown';
  }
  return inputType.startsWith('insert') ? 'keyboard' : 'unknown';
}

function encodeOrigin(origin: Origin): string {
  if (origin === 'keyboard') return 'k';
  if (origin === 'paste') return 'p';
  return 'u';
}

function decodeOrigin(value: string | undefined): Origin {
  if (value === 'k') return 'keyboard';
  if (value === 'p') return 'paste';
  return 'unknown';
}
