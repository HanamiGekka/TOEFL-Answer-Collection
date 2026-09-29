import { describe, expect, it } from 'vitest';
import { transitionListening } from '../listeningState';

describe('Listening state machine', () => {
  it('allows the external audio flow', () => {
    let state = transitionListening('WAITING_FOR_AUDIO', 'AUDIO_PLAYING_EXTERNAL');
    state = transitionListening(state, 'WAITING_FOR_USER_MARK');
    state = transitionListening(state, 'ANSWERING');
    state = transitionListening(state, 'COMPLETED');
    expect(state).toBe('COMPLETED');
  });

  it('rejects skipping the user audio-end mark', () => {
    expect(() => transitionListening('AUDIO_PLAYING_EXTERNAL', 'ANSWERING')).toThrow();
  });
});
