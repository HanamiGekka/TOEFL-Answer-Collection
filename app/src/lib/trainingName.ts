export type TrainingNameError = 'required' | 'tooLong' | 'unsafe';

const unsafeCharacters = /[<>:"/\\|?*\p{Cc}\p{Cf}]/u;
const reservedWindowsName = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu;

export function validateTrainingName(value: string): { name: string; error?: TrainingNameError } {
  const name = value.trim();
  if (!name) return { name, error: 'required' };
  if (/[\p{Cc}\p{Cf}]/u.test(value)) return { name, error: 'unsafe' };
  if ([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name)].length > 80) {
    return { name, error: 'tooLong' };
  }
  if (unsafeCharacters.test(name) || /^[. ]+$/u.test(name) || /[. ]$/u.test(name) || reservedWindowsName.test(name)) {
    return { name, error: 'unsafe' };
  }
  return { name };
}
