import type { ListeningState } from '../types';

const ALLOWED: Record<ListeningState, ListeningState[]> = {
  WAITING_FOR_AUDIO: ['AUDIO_PLAYING_EXTERNAL'],
  AUDIO_PLAYING_EXTERNAL: ['WAITING_FOR_USER_MARK'],
  WAITING_FOR_USER_MARK: ['ANSWERING'],
  ANSWERING: ['OVERTIME_ANSWERING', 'COMPLETED'],
  OVERTIME_ANSWERING: ['COMPLETED'],
  COMPLETED: []
};

export function canTransitionListening(from: ListeningState, to: ListeningState): boolean {
  return ALLOWED[from].includes(to);
}

export function transitionListening(from: ListeningState, to: ListeningState): ListeningState {
  if (!canTransitionListening(from, to)) {
    throw new Error(`Invalid listening transition: ${from} -> ${to}`);
  }
  return to;
}
