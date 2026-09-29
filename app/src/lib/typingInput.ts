export interface FilteredTypingInput {
  text: string;
  rejectedCount: number;
}

const ENGLISH_TYPOGRAPHY = new Set(['‘', '’', '“', '”', '–', '—', '…']);
const LATIN_LETTER = /\p{Script=Latin}/u;

export function filterTypingInput(value: string): FilteredTypingInput {
  let text = '';
  let rejectedCount = 0;
  const characters = [...value];
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === '\r') {
      if (characters[index + 1] === '\n') index += 1;
      text += '\n';
      continue;
    }
    if (character === '\n') {
      text += character;
      continue;
    }
    if (character === '\t') {
      text += '    ';
      continue;
    }
    if (isAllowedTypingCharacter(character)) {
      text += character;
    } else {
      rejectedCount += 1;
    }
  }
  return { text, rejectedCount };
}

export function isAllowedTypingCharacter(character: string): boolean {
  if (character.length === 0) return false;
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint >= 0x20 && codePoint <= 0x7e) return true;
  if (ENGLISH_TYPOGRAPHY.has(character)) return true;
  return LATIN_LETTER.test(character);
}
