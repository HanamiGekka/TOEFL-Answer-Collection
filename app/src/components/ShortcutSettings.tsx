import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  bindingFromEvent,
  configuredShortcutRegistry,
  defaultShortcutBindings,
  validateShortcutBindings,
  type ShortcutBindings
} from '../lib/shortcutRegistry';
import { useAppStore } from '../store/appStore';

export function ShortcutSettings() {
  const { t } = useTranslation();
  const saved = useAppStore((state) => state.shortcutBindings);
  const save = useAppStore((state) => state.saveShortcutBindings);
  const [draft, setDraft] = useState<ShortcutBindings>(saved);
  const [status, setStatus] = useState<{ key: string; values?: Record<string, string> }>();
  useEffect(() => setDraft(saved), [saved]);
  const validation = validateShortcutBindings(draft);
  const configuredRegistry = configuredShortcutRegistry(draft);

  async function persist() {
    if (!validation.ok) return;
    try {
      const ok = await save(draft);
      setStatus({ key: ok ? 'shortcut.saved' : 'shortcut.notSaved' });
    } catch (error) {
      setStatus({ key: 'shortcut.saveFailed', values: { detail: error instanceof Error ? error.message : String(error) } });
    }
  }

  return (
    <section className="card settings-section">
      <div className="section-title">
        <div>
          <h2>{t('shortcut.title')}</h2>
        </div>
        <button onClick={() => { setDraft(defaultShortcutBindings()); setStatus({ key: 'shortcut.defaultsRestored' }); }}>
          {t('shortcut.restoreDefaults')}
        </button>
      </div>
      <p className="muted">{t('shortcut.help')}</p>
      <div className="shortcut-grid">
        {configuredRegistry.map((definition) => {
          const error = validation.errors.find((item) => item.action_id === definition.action_id);
          return (
            <label key={definition.action_id} className="shortcut-row">
              <span>
                <strong>{t(`shortcut.action.${definition.action_id}`)}</strong>
              </span>
              <input
                aria-label={t('shortcut.binding', { action: t(`shortcut.action.${definition.action_id}`) })}
                value={definition.current_binding}
                readOnly
                className={error ? 'input-error' : ''}
                onKeyDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if ((event.key === 'Backspace' || event.key === 'Delete') && !event.altKey && !event.ctrlKey && !event.metaKey) {
                    setDraft((value) => ({ ...value, [definition.action_id]: '' }));
                    return;
                  }
                  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
                  setDraft((value) => ({ ...value, [definition.action_id]: bindingFromEvent(event.nativeEvent) }));
                }}
              />
              {error ? <small className="danger-text">{t(`shortcut.error.${error.code.toLowerCase()}`)}</small> : null}
            </label>
          );
        })}
      </div>
      <div className="settings-actions">
        <button className="primary" disabled={!validation.ok} onClick={() => void persist()}>{t('shortcut.save')}</button>
        <span aria-live="polite">{status ? t(status.key, status.values) : ''}</span>
      </div>
      <details>
        <summary>{t('shortcut.protectionTitle')}</summary>
        <p className="muted">{t('shortcut.protectionHelp')}</p>
      </details>
    </section>
  );
}
