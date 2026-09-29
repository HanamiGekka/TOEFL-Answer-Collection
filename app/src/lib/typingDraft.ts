import type { SerializedTypingStats } from './typingStats';
import {
  serializeTypingMinuteSampleForPersistence,
  serializeTypingSnapshotForPersistence,
  toPersistedMilliseconds
} from './persistedTime';

const TYPING_DRAFT_KEY = 'toefl-answer-collection:typing-draft:v1';

export type TypingDraftStatus = 'running' | 'paused' | 'ended';

export interface TypingPracticeDraft {
  schema_version: 1;
  session_id: string;
  status: TypingDraftStatus;
  active_ms: number;
  paused_ms: number;
  saved_at: string;
  tracker_state: SerializedTypingStats;
}

export function loadTypingDraft(storage = getLocalStorage()): TypingPracticeDraft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(TYPING_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<TypingPracticeDraft>;
    if (
      draft.schema_version !== 1 ||
      typeof draft.session_id !== 'string' ||
      !isDraftStatus(draft.status) ||
      typeof draft.active_ms !== 'number' ||
      typeof draft.paused_ms !== 'number' ||
      typeof draft.saved_at !== 'string' ||
      draft.tracker_state?.schema_version !== 1 ||
      typeof draft.tracker_state.text !== 'string' ||
      typeof draft.tracker_state.origin_codes !== 'string' ||
      !Array.isArray(draft.tracker_state.samples)
    ) {
      return null;
    }
    return draft as TypingPracticeDraft;
  } catch {
    return null;
  }
}

export function saveTypingDraft(
  draft: TypingPracticeDraft,
  storage = getLocalStorage()
): boolean {
  if (!storage) return false;
  try {
    const persisted: TypingPracticeDraft = {
      schema_version: draft.schema_version,
      session_id: draft.session_id,
      status: draft.status,
      active_ms: toPersistedMilliseconds(draft.active_ms, 'typing.draft.active_ms'),
      paused_ms: toPersistedMilliseconds(draft.paused_ms, 'typing.draft.paused_ms'),
      saved_at: draft.saved_at,
      tracker_state: {
        ...draft.tracker_state,
        last_sample: draft.tracker_state.last_sample
          ? serializeTypingSnapshotForPersistence(draft.tracker_state.last_sample)
          : undefined,
        samples: draft.tracker_state.samples.map(serializeTypingMinuteSampleForPersistence)
      }
    };
    storage.setItem(TYPING_DRAFT_KEY, JSON.stringify(persisted));
    return true;
  } catch {
    return false;
  }
}

export function clearTypingDraft(storage = getLocalStorage()): void {
  try {
    storage?.removeItem(TYPING_DRAFT_KEY);
  } catch {
    // A storage denial must never prevent the user from resetting the UI.
  }
}

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isDraftStatus(value: unknown): value is TypingDraftStatus {
  return value === 'running' || value === 'paused' || value === 'ended';
}
