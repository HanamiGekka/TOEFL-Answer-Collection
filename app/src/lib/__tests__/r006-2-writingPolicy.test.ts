import { describe, expect, it } from 'vitest';
import { createDynamicItem, createDynamicSession, updateDynamicWritingText, undoDynamicWritingText, redoDynamicWritingText } from '../dynamicSession';
import { getItemTypePreset } from '../itemTypeRegistry';
import { sanitizeWritingText } from '../writingTextPolicy';

describe('R006.2 shared Writing text policy', () => {
  it('allows Unicode Latin, numbers and common English punctuation while normalizing tabs and CRLF', () => {
    const result = sanitizeWritingText('Café\t2026\r\n“email@example.com” — (A/B): yes; 50%.');
    expect(result).toEqual({
      text: 'Café    2026\n“email@example.com” — (A/B): yes; 50%.',
      rejected_count: 0,
      changed: true
    });
  });

  it('removes Han, Kana, Hangul, emoji, private-use and disallowed control characters', () => {
    const result = sanitizeWritingText(`Keep中文かな한글🙂\uE000\u0007 this.`);
    expect(result.text).toBe('Keep this.');
    expect(result.rejected_count).toBe(9);
  });

  it('sanitizes dynamic long text and never restores rejected content through history', () => {
    let session=createDynamicItem(createDynamicSession({session_id:'writing-policy',package_id:'Synthetic',mode:'practice',selected_sections:['Writing']}),'Writing',getItemTypePreset('Writing','writing_email')).session;
    session=updateDynamicWritingText(session,'W1','Safe','insertText',0).session;
    session=updateDynamicWritingText(session,'W1','Safe中文🙂 text','insertText',0).session;
    expect(session.questions[0].writing_state?.text).toBe('Safe text');
    session=undoDynamicWritingText(session,'W1',0).session;
    expect(session.questions[0].writing_state?.text).toBe('Safe');
    session=redoDynamicWritingText(session,'W1',0).session;
    expect(session.questions[0].writing_state?.text).toBe('Safe text');
  });
});
