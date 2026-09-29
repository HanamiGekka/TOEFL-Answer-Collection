import i18n from '../i18n';

export interface ShortcutValidation {
  ok: boolean;
  errors: string[];
}

export function validateShortcuts(shortcuts: Record<string, string>): ShortcutValidation {
  const errors: string[] = [];
  const seen = new Map<string, string>();

  for (const [action, shortcut] of Object.entries(shortcuts)) {
    const normalized = normalizeShortcut(shortcut);
    if (!normalized) {
      errors.push(i18n.t('shortcut.emptyBinding', { action }));
      continue;
    }
    if (normalized.includes('ALT+SHIFT')) {
      errors.push(i18n.t('shortcut.altShiftConflict', { action }));
    }
    const previous = seen.get(normalized);
    if (previous) {
      errors.push(i18n.t('shortcut.duplicateBinding', { action, previous, shortcut }));
    }
    seen.set(normalized, action);
  }

  return { ok: errors.length === 0, errors };
}

export function normalizeShortcut(value: string): string {
  return value
    .split('+')
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean)
    .sort(modifierAwareSort)
    .join('+');
}

function modifierAwareSort(a: string, b: string): number {
  const order = ['CTRL', 'CONTROL', 'ALT', 'SHIFT', 'META', 'CMD'];
  const ai = order.indexOf(a);
  const bi = order.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}
