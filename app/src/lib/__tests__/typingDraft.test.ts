import { describe, expect, it } from 'vitest';
import { TypingStatsAccumulator } from '../typingStats';
import { clearTypingDraft, loadTypingDraft, saveTypingDraft, type TypingPracticeDraft } from '../typingDraft';

function draft(): TypingPracticeDraft {
  const tracker = new TypingStatsAccumulator();
  tracker.applyTextChange('', 'A long Writing draft.\nSecond line.', 'insertText');
  return {
    schema_version: 1,
    session_id: 'typing-test',
    status: 'running',
    active_ms: 12_000,
    paused_ms: 3_000,
    saved_at: '2026-07-10T00:00:00.000Z',
    tracker_state: tracker.serializeState()
  };
}

describe('typing draft recovery', () => {
  it('round-trips an unfinished typing draft in local storage', () => {
    expect(saveTypingDraft(draft(), localStorage)).toBe(true);
    expect(loadTypingDraft(localStorage)).toMatchObject({
      session_id: 'typing-test',
      status: 'running',
      active_ms: 12_000
    });
    expect(loadTypingDraft(localStorage)?.tracker_state.text).toContain('Second line.');
    clearTypingDraft(localStorage);
    expect(loadTypingDraft(localStorage)).toBeNull();
  });

  it('ignores corrupted or incompatible drafts', () => {
    localStorage.setItem('toefl-answer-collection:typing-draft:v1', '{bad-json');
    expect(loadTypingDraft(localStorage)).toBeNull();
    localStorage.setItem('toefl-answer-collection:typing-draft:v1', JSON.stringify({ schema_version: 99 }));
    expect(loadTypingDraft(localStorage)).toBeNull();
    clearTypingDraft(localStorage);
  });

  it('round-trips a 5000-word draft exactly and normalizes persisted duration fields', () => {
    const text = Array.from({ length: 5_000 }, (_, index) => `word${index}`).join(' ') + '\nFinal line.';
    const tracker = new TypingStatsAccumulator();
    tracker.applyTextChange('', text, 'insertText');
    const longDraft: TypingPracticeDraft = {
      schema_version: 1,
      session_id: 'typing-5000-words',
      status: 'paused',
      active_ms: 22_790.29999999702,
      paused_ms: 411.90000000037253,
      saved_at: '2026-07-11T00:00:00.000Z',
      tracker_state: tracker.serializeState()
    };

    expect(saveTypingDraft(longDraft, localStorage)).toBe(true);
    const restored = loadTypingDraft(localStorage);
    expect(restored?.active_ms).toBe(22_790);
    expect(restored?.paused_ms).toBe(412);
    expect(restored?.tracker_state.text).toBe(text);
    expect(restored?.tracker_state.origin_codes).toHaveLength([...text].length);
  });
});
