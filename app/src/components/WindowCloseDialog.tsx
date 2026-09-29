import type { WindowCloseState } from '../lib/windowClose';
import { useTranslation } from 'react-i18next';

interface WindowCloseDialogProps {
  state: WindowCloseState;
  onSave(): void;
  onRetry(): void;
  onCancel(): void;
}

export function WindowCloseDialog({ state, onSave, onRetry, onCancel }: WindowCloseDialogProps) {
  const { t } = useTranslation();
  if (state.phase === 'IDLE') return null;
  const saving = state.phase === 'SAVING';
  const destroying = state.phase === 'DESTROYING';
  const failed = state.phase === 'FAILED';

  return (
    <div className="window-close-overlay" role="presentation" data-window-close-dialog>
      <section className="window-close-dialog" role="dialog" aria-modal="true" aria-label={t('close.title')}>
        <h2>{t(failed ? 'close.saveFailed' : 'close.title')}</h2>
        {state.phase === 'CONFIRMING' ? <p>{t('close.unfinished')}</p> : null}
        {saving ? <p aria-live="polite">{t('close.savingAndClosing')}</p> : null}
        {destroying ? <p aria-live="polite">{t('close.closing')}</p> : null}
        {failed ? <p className="danger-text" role="alert">{state.error}</p> : null}
        <div className="dialog-actions">
          {failed ? (
            <button className="primary" onClick={onRetry} autoFocus>{t('close.retry')}</button>
          ) : (
            <button className="primary" onClick={onSave} disabled={saving || destroying} autoFocus>
              {t(saving ? 'close.saving' : destroying ? 'close.closingShort' : 'close.saveAndClose')}
            </button>
          )}
          <button onClick={onCancel} disabled={saving || destroying}>{t('common.cancel')}</button>
        </div>
      </section>
    </div>
  );
}
