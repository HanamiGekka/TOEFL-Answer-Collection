import { useEffect } from 'react';
import { getCurrentQuestion } from '../lib/sessionEngine';
import {
  resolveShortcutAction,
  type ShortcutContext
} from '../lib/shortcutRegistry';
import { getCurrentTask } from '../lib/taskRuntime';
import { canToggleTypingPause, toggleTypingPause } from '../lib/typingPause';
import { useAppStore } from '../store/appStore';

export function GlobalShortcutController({ homePage }: { homePage: ShortcutContext['page'] }) {
  useEffect(() => {
    let isComposing = false;
    let clipboardActive = false;
    let clipboardReset = 0;
    const startComposition = () => { isComposing = true; };
    const endComposition = () => { isComposing = false; };
    const markClipboard = () => {
      clipboardActive = true;
      window.clearTimeout(clipboardReset);
      clipboardReset = window.setTimeout(() => { clipboardActive = false; }, 0);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const state = useAppStore.getState();
      const session = state.session;
      const question = session ? getCurrentQuestion(session) : undefined;
      const task = session ? getCurrentTask(session) : undefined;
      const typingActive = !session && canToggleTypingPause();
      const targetKind = describeTarget(event.target);
      const page: ShortcutContext['page'] = session
        ? session.view === 'SESSION_SUMMARY' ? 'summary' : 'practice'
        : homePage;
      const action = resolveShortcutAction(event, state.shortcutBindings, {
        page,
        target_kind: targetKind,
        answer_mode: question?.answer_mode,
        is_composing: isComposing,
        clipboard_active: clipboardActive,
        modal_open: Boolean(state.sessionNotice) || state.windowClosePhase !== 'IDLE',
        task_transition_pending: state.speakingTransitionPending,
        paused: Boolean(session && state.isPaused),
        typing_active: typingActive
      });
      if (!action) return;
      if (action === 'toggle_pause' && !session && !typingActive) return;
      event.preventDefault();
      switch (action) {
        case 'toggle_pause': session ? state.togglePause() : toggleTypingPause(); break;
        case 'next_question': state.nextQuestion(); break;
        case 'previous_question': state.previousQuestion(); break;
        case 'skip_question': state.skipCurrent(); break;
        case 'toggle_uncertain': state.toggleReview(); break;
        case 'complete_scope': void state.finalizeCurrentScope(); break;
        case 'speaking_start': void state.startSpeakingCurrent(); break;
        case 'speaking_complete': void state.markSpeakingCurrent('COMPLETED'); break;
        case 'speaking_retry':
          if (task?.needs_retry) void state.retrySpeakingCurrent();
          else void state.markSpeakingCurrent('NEEDS_RETRY');
          break;
        default: answerFromShortcut(action.slice(-1).toUpperCase(), state, question?.answer_mode);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('compositionstart', startComposition);
    window.addEventListener('compositionend', endComposition);
    window.addEventListener('copy', markClipboard);
    window.addEventListener('cut', markClipboard);
    window.addEventListener('paste', markClipboard);
    return () => {
      window.clearTimeout(clipboardReset);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('compositionstart', startComposition);
      window.removeEventListener('compositionend', endComposition);
      window.removeEventListener('copy', markClipboard);
      window.removeEventListener('cut', markClipboard);
      window.removeEventListener('paste', markClipboard);
    };
  }, [homePage]);
  return null;
}

function describeTarget(target: EventTarget | null): ShortcutContext['target_kind'] {
  if (!(target instanceof HTMLElement)) return 'other';
  if (target instanceof HTMLTextAreaElement) return 'textarea';
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return 'input';
  if (target.isContentEditable || target.closest('[contenteditable="true"]')) return 'contenteditable';
  return 'other';
}

function answerFromShortcut(
  option: string,
  state: ReturnType<typeof useAppStore.getState>,
  answerMode: string | undefined
): void {
  const session = state.session;
  if (!session) return;
  if (answerMode === 'single_choice') {
    state.answerCurrent(option);
  } else if (answerMode === 'multiple_choice') {
    const existing = session.answers[session.current_question_id]?.answer_value;
    const selected = Array.isArray(existing) ? existing.map(String) : [];
    state.answerCurrent(selected.includes(option)
      ? selected.filter((item) => item !== option)
      : [...selected, option].sort());
  }
}
