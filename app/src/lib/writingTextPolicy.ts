import type { PracticeSession } from '../types';


export interface WritingTextPolicyResult {
  text: string;
  rejected_count: number;
  changed: boolean;
}

const LATIN = /\p{Script=Latin}/u;
const NUMBER = /\p{Number}/u;
const MARK = /\p{Mark}/u;
const SPACE_SEPARATOR = /\p{Zs}/u;
const ALLOWED_PUNCTUATION = new Set([
  '.', ',', '!', '?', ':', ';', "'", '"', '‘', '’', '“', '”',
  '-', '–', '—', '…', '(', ')', '[', ']', '{', '}', '/', '\\',
  '@', '#', '$', '%', '&', '*', '+', '=', '_', '<', '>'
]);

export function sanitizeWritingText(
  value: string,
  options: { allow_line_breaks?: boolean } = {}
): WritingTextPolicyResult {
  const allowLineBreaks = options.allow_line_breaks ?? true;
  const normalized = value.replace(/\r\n?/g, '\n');
  let text = '';
  let rejectedCount = 0;
  let latinBaseAvailable = false;

  for (const character of normalized) {
    if (character === '\t') {
      text += '    ';
      latinBaseAvailable = false;
    } else if (character === '\n') {
      text += allowLineBreaks ? '\n' : ' ';
      latinBaseAvailable = false;
    } else if (character === ' ' || SPACE_SEPARATOR.test(character)) {
      text += ' ';
      latinBaseAvailable = false;
    } else if (LATIN.test(character)) {
      text += character;
      latinBaseAvailable = true;
    } else if (MARK.test(character) && latinBaseAvailable) {
      text += character;
    } else if (NUMBER.test(character) || ALLOWED_PUNCTUATION.has(character)) {
      text += character;
      latinBaseAvailable = false;
    } else {
      rejectedCount += 1;
      latinBaseAvailable = false;
    }
  }

  return {
    text,
    rejected_count: rejectedCount,
    changed: text !== value
  };
}

export function writingTextNeedsCompatibilityNotice(session: PracticeSession): boolean {
  const writingQuestionIds = new Set(
    session.questions
      .filter((question) => question.section_id === 'Writing')
      .map((question) => question.id)
  );
  return Object.entries(session.answers).some(([questionId, answer]) =>
    writingQuestionIds.has(questionId) &&
    typeof answer.answer_value === 'string' &&
    sanitizeWritingText(answer.answer_value).rejected_count > 0
  );
}
