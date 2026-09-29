import type { AnswerMode } from '../types';

export type ShortcutActionId =
  | 'toggle_pause'
  | 'next_question'
  | 'previous_question'
  | 'skip_question'
  | 'toggle_uncertain'
  | 'answer_a'
  | 'answer_b'
  | 'answer_c'
  | 'answer_d'
  | 'complete_scope'
  | 'speaking_start'
  | 'speaking_complete'
  | 'speaking_retry';

export interface ShortcutDefinition {
  action_id: ShortcutActionId;
  default_binding: string;
  current_binding: string;
  scopes: Array<'global' | 'practice' | 'choice' | 'speaking'>;
  description: string;
  enabled: boolean;
  destructive: boolean;
}

export type ShortcutBindings = Record<ShortcutActionId, string>;

export const SHORTCUT_REGISTRY: ShortcutDefinition[] = [
  { action_id: 'toggle_pause', default_binding: 'F8', current_binding: 'F8', scopes: ['global'], description: 'Pause / resume', enabled: true, destructive: false },
  { action_id: 'previous_question', default_binding: 'Alt+ArrowLeft', current_binding: 'Alt+ArrowLeft', scopes: ['practice'], description: 'Previous question', enabled: true, destructive: false },
  { action_id: 'next_question', default_binding: 'Alt+ArrowRight', current_binding: 'Alt+ArrowRight', scopes: ['practice'], description: 'Next question', enabled: true, destructive: false },
  { action_id: 'skip_question', default_binding: 'Alt+S', current_binding: 'Alt+S', scopes: ['practice'], description: 'Skip', enabled: true, destructive: false },
  { action_id: 'toggle_uncertain', default_binding: 'Alt+U', current_binding: 'Alt+U', scopes: ['practice'], description: 'Uncertain', enabled: true, destructive: false },
  { action_id: 'answer_a', default_binding: 'A', current_binding: 'A', scopes: ['choice'], description: 'Choose A', enabled: true, destructive: false },
  { action_id: 'answer_b', default_binding: 'B', current_binding: 'B', scopes: ['choice'], description: 'Choose B', enabled: true, destructive: false },
  { action_id: 'answer_c', default_binding: 'C', current_binding: 'C', scopes: ['choice'], description: 'Choose C', enabled: true, destructive: false },
  { action_id: 'answer_d', default_binding: 'D', current_binding: 'D', scopes: ['choice'], description: 'Choose D', enabled: true, destructive: false },
  { action_id: 'complete_scope', default_binding: '', current_binding: '', scopes: ['practice'], description: 'Complete current scope', enabled: true, destructive: true },
  { action_id: 'speaking_start', default_binding: 'Alt+Enter', current_binding: 'Alt+Enter', scopes: ['speaking'], description: 'Start Speaking', enabled: true, destructive: false },
  { action_id: 'speaking_complete', default_binding: '', current_binding: '', scopes: ['speaking'], description: 'Complete Speaking', enabled: true, destructive: true },
  { action_id: 'speaking_retry', default_binding: '', current_binding: '', scopes: ['speaking'], description: 'Retry Speaking', enabled: true, destructive: true }
];

export interface ShortcutValidationError {
  action_id: ShortcutActionId;
  code: 'DUPLICATE' | 'RESERVED' | 'INVALID';
  message: string;
}

export interface ShortcutEventLike {
  key: string;
  code?: string;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  isComposing: boolean;
}

export interface ShortcutContext {
  page: 'home' | 'practice' | 'summary' | 'records' | 'settings';
  target_kind: 'textarea' | 'input' | 'contenteditable' | 'other';
  answer_mode?: AnswerMode;
  is_composing: boolean;
  clipboard_active: boolean;
  modal_open: boolean;
  task_transition_pending: boolean;
  paused: boolean;
  typing_active?: boolean;
}

const RESERVED = new Set([
  'CTRL+A', 'CTRL+C', 'CTRL+F', 'CTRL+L', 'CTRL+N', 'CTRL+P', 'CTRL+R', 'CTRL+T', 'CTRL+V', 'CTRL+W',
  'CTRL+X', 'CTRL+Y', 'CTRL+Z', 'F5', 'F11', 'F12', 'ALT+F4'
]);

export function defaultShortcutBindings(): ShortcutBindings {
  return Object.fromEntries(SHORTCUT_REGISTRY.map((item) => [item.action_id, item.default_binding])) as ShortcutBindings;
}

export function migrateShortcutBindings(value: unknown): ShortcutBindings {
  const saved = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(SHORTCUT_REGISTRY.map((definition) => [
    definition.action_id,
    typeof saved[definition.action_id] === 'string'
      ? saved[definition.action_id]
      : definition.default_binding
  ])) as ShortcutBindings;
}

export function configuredShortcutRegistry(bindings: ShortcutBindings): ShortcutDefinition[] {
  return SHORTCUT_REGISTRY.map((definition) => ({
    ...definition,
    current_binding: bindings[definition.action_id] ?? ''
  }));
}

export function normalizeBinding(value: string): string {
  const parts = value.split('+').map((part) => part.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) return '';
  const modifiers = new Set(parts.map(normalizeKey));
  return [
    modifiers.has('CTRL') ? 'CTRL' : '',
    modifiers.has('ALT') ? 'ALT' : '',
    modifiers.has('SHIFT') ? 'SHIFT' : '',
    modifiers.has('META') ? 'META' : '',
    normalizeKey(key)
  ].filter(Boolean).join('+');
}

export function validateShortcutBindings(bindings: ShortcutBindings): { ok: boolean; errors: ShortcutValidationError[] } {
  const errors: ShortcutValidationError[] = [];
  const seen = new Map<string, ShortcutActionId>();
  for (const definition of SHORTCUT_REGISTRY) {
    const raw = bindings[definition.action_id] ?? '';
    if (!raw) continue;
    const binding = normalizeBinding(raw);
    if (!binding || binding.endsWith('+')) {
      errors.push({ action_id: definition.action_id, code: 'INVALID', message: 'Invalid shortcut format.' });
      continue;
    }
    if (RESERVED.has(binding) || binding.includes('ALT+SHIFT')) {
      errors.push({ action_id: definition.action_id, code: 'RESERVED', message: `${raw} is reserved by the system, WebView, or editor.` });
    }
    const prior = seen.get(binding);
    if (prior) {
      errors.push({ action_id: definition.action_id, code: 'DUPLICATE', message: `${raw} conflicts with ${prior}.` });
    } else {
      seen.set(binding, definition.action_id);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function bindingFromEvent(event: ShortcutEventLike): string {
  return [
    event.ctrlKey ? 'CTRL' : '',
    event.altKey ? 'ALT' : '',
    event.shiftKey ? 'SHIFT' : '',
    event.metaKey ? 'META' : '',
    normalizeKey(event.key)
  ].filter(Boolean).join('+');
}

export function resolveShortcutAction(
  event: ShortcutEventLike,
  bindings: ShortcutBindings,
  context: ShortcutContext
): ShortcutActionId | null {
  if (event.repeat || event.isComposing || context.is_composing || context.clipboard_active || context.modal_open) return null;
  const binding = bindingFromEvent(event);
  if (RESERVED.has(binding)) return null;
  const action = SHORTCUT_REGISTRY.find((definition) =>
    definition.enabled && bindings[definition.action_id] && normalizeBinding(bindings[definition.action_id]) === binding
  );
  if (!action) return null;
  if (context.target_kind !== 'other' && !(context.typing_active && action.action_id === 'toggle_pause')) return null;
  if (context.paused && action.action_id !== 'toggle_pause') return null;
  if (context.task_transition_pending && action.action_id !== 'toggle_pause') return null;
  if (action.scopes.includes('global')) return action.action_id;
  if (context.page !== 'practice') return null;
  if (action.scopes.includes('choice') && !['single_choice', 'multiple_choice'].includes(String(context.answer_mode))) return null;
  if (action.scopes.includes('speaking') && context.answer_mode !== 'speaking_timer') return null;
  return action.action_id;
}

function normalizeKey(value: string): string {
  const upper = value.trim().toUpperCase();
  if (upper === 'CONTROL') return 'CTRL';
  if (upper === 'COMMAND' || upper === 'CMD') return 'META';
  if (upper === 'ARROWLEFT') return 'ARROWLEFT';
  if (upper === 'ARROWRIGHT') return 'ARROWRIGHT';
  if (upper === ' ') return 'SPACE';
  return upper;
}
