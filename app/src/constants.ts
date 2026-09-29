export const SCHEMA_VERSION = '1.0.0';
export const APP_VERSION = '1.0.0';

/** Browser-only preview value; Tauri resolves the real default per user. */
export const BROWSER_PREVIEW_APP_ROOT = 'C:\\Synthetic\\AnswerCollection';

export const PACKAGE_ID_PATTERN = /^(?:\d{2}\.\d{2}\.[A-Z]\.\d+|Mock\.\d{2}\.[A-Z]\.\d+)$/;

export const DEFAULT_SHORTCUTS = {
  toggle_pause: 'Ctrl+Alt+P',
  next_question: 'Ctrl+Alt+N',
  previous_question: 'Ctrl+Alt+B',
  skip_question: 'Ctrl+Alt+S'
} as const;

export const SECTION_ORDER = ['Reading', 'Listening', 'Writing', 'Speaking'] as const;

export const NEW_SESSION_SECTION_ORDER = ['Reading', 'Listening', 'Writing'] as const;
