import { describe, expect, it } from 'vitest';
import {
  SHORTCUT_REGISTRY,
  configuredShortcutRegistry,
  defaultShortcutBindings,
  resolveShortcutAction,
  validateShortcutBindings,
  type ShortcutContext,
  type ShortcutEventLike
} from '../shortcutRegistry';

const baseContext: ShortcutContext = {
  page: 'practice',
  target_kind: 'other',
  answer_mode: 'single_choice',
  is_composing: false,
  clipboard_active: false,
  modal_open: false,
  task_transition_pending: false,
  paused: false
};

function event(key: string, overrides: Partial<ShortcutEventLike> = {}): ShortcutEventLike {
  return { key, code: key, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false, repeat: false, isComposing: false, ...overrides };
}

describe('R006 central shortcut registry', () => {
  it('does not expose the removed open_review action or an Alt+R default', () => {
    expect(SHORTCUT_REGISTRY.map((item) => item.action_id)).not.toContain('open_review');
    expect(Object.values(defaultShortcutBindings())).not.toContain('Alt+R');
    expect(resolveShortcutAction(event('r', { altKey: true }), defaultShortcutBindings(), baseContext)).toBeNull();
  });

  it('does not expose a legacy open_review property through the configured Registry', () => {
    const legacy = {
      ...defaultShortcutBindings(),
      toggle_pause: 'F1',
      open_review: 'Alt+R'
    } as ReturnType<typeof defaultShortcutBindings>;
    expect(configuredShortcutRegistry(legacy).map((item) => item.action_id)).not.toContain('open_review');
    expect(configuredShortcutRegistry(legacy).find((item) => item.action_id === 'toggle_pause')?.current_binding).toBe('F1');
  });

  it('has globally unique action ids', () => {
    expect(new Set(SHORTCUT_REGISTRY.map((item) => item.action_id)).size).toBe(SHORTCUT_REGISTRY.length);
  });

  it('detects duplicate current bindings', () => {
    const bindings = { ...defaultShortcutBindings(), next_question: 'F8' };
    expect(validateShortcutBindings(bindings).errors.some((error) => error.code === 'DUPLICATE')).toBe(true);
  });

  it('exposes the saved current binding on every configured Registry item', () => {
    const bindings = { ...defaultShortcutBindings(), next_question: 'Alt+N' };
    expect(configuredShortcutRegistry(bindings).find((item) => item.action_id === 'next_question')?.current_binding).toBe('Alt+N');
  });

  it.each(['textarea', 'input', 'contenteditable'] as const)('protects ordinary %s targets', (target_kind) => {
    expect(resolveShortcutAction(event('F8'), defaultShortcutBindings(), { ...baseContext, target_kind })).toBeNull();
  });

  it('allows only toggle_pause in an active Typing text area', () => {
    const context = { ...baseContext, target_kind: 'textarea', typing_active: true } as ShortcutContext;
    expect(resolveShortcutAction(event('F8'), defaultShortcutBindings(), context)).toBe('toggle_pause');
    expect(resolveShortcutAction(event('ArrowRight', { altKey: true }), defaultShortcutBindings(), context)).toBeNull();
    expect(resolveShortcutAction(event('a'), defaultShortcutBindings(), context)).toBeNull();
  });

  it('routes a customized toggle_pause binding by action id in Typing', () => {
    const context = { ...baseContext, target_kind: 'textarea', typing_active: true } as ShortcutContext;
    const bindings = { ...defaultShortcutBindings(), toggle_pause: 'F1' };
    expect(resolveShortcutAction(event('F1'), bindings, context)).toBe('toggle_pause');
    expect(resolveShortcutAction(event('F8'), bindings, context)).toBeNull();
  });

  it('does not trigger during IME composition', () => {
    expect(resolveShortcutAction(event('F8', { isComposing: true }), defaultShortcutBindings(), baseContext)).toBeNull();
  });

  it('does not dispatch repeated keydown events', () => {
    expect(resolveShortcutAction(event('r', { altKey: true, repeat: true }), defaultShortcutBindings(), baseContext)).toBeNull();
  });

  it('does not trigger during Clipboard operations', () => {
    expect(resolveShortcutAction(event('F8'), defaultShortcutBindings(), { ...baseContext, clipboard_active: true })).toBeNull();
  });

  it('does not trigger while a modal is open', () => {
    expect(resolveShortcutAction(event('F8'), defaultShortcutBindings(), { ...baseContext, modal_open: true })).toBeNull();
  });

  it('does not repeat actions during a Task transition', () => {
    expect(resolveShortcutAction(event('ArrowRight', { altKey: true }), defaultShortcutBindings(), {
      ...baseContext,
      task_transition_pending: true
    })).toBeNull();
  });

  it('keeps F8 pause available while paused', () => {
    expect(resolveShortcutAction(event('F8'), defaultShortcutBindings(), { ...baseContext, paused: true })).toBe('toggle_pause');
  });

  it.each(['x', 'c', 'v', 'z', 'y', 'a'])('never overrides Ctrl+%s', (key) => {
    expect(resolveShortcutAction(event(key, { ctrlKey: true }), defaultShortcutBindings(), baseContext)).toBeNull();
  });

  it('maps A to answer A only on a non-text choice page', () => {
    expect(resolveShortcutAction(event('a'), defaultShortcutBindings(), baseContext)).toBe('answer_a');
  });

  it('does not map A on a text answer page', () => {
    expect(resolveShortcutAction(event('a'), defaultShortcutBindings(), { ...baseContext, answer_mode: 'short_text' })).toBeNull();
  });

  it('uses Alt+Left and Alt+Right navigation defaults', () => {
    const bindings = defaultShortcutBindings();
    expect(resolveShortcutAction(event('ArrowLeft', { altKey: true }), bindings, baseContext)).toBe('previous_question');
    expect(resolveShortcutAction(event('ArrowRight', { altKey: true }), bindings, baseContext)).toBe('next_question');
  });

  it('rejects protected browser and editing bindings', () => {
    const bindings = { ...defaultShortcutBindings(), next_question: 'Ctrl+R', skip_question: 'Ctrl+V' };
    expect(validateShortcutBindings(bindings).errors.filter((error) => error.code === 'RESERVED')).toHaveLength(2);
  });

  it('permits clearing a high-risk action binding', () => {
    const bindings = { ...defaultShortcutBindings(), complete_scope: '' };
    expect(validateShortcutBindings(bindings).errors.some((error) => error.action_id === 'complete_scope')).toBe(false);
  });
});
