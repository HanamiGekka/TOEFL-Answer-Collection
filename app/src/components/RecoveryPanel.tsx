import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalRecordSummary } from '../lib/recordManager';
import { exportIncompleteRecovery } from '../lib/recoveryExport';
import { exportRecoveryRaw, listLocalRecords, moveRecordsToTrash } from '../lib/storage';
import { formatDuration } from '../lib/timer';
import { useAppStore } from '../store/appStore';

export function RecoveryPanel() {
  const { t } = useTranslation();
  const recoverSession = useAppStore((state) => state.recoverSession);
  const [records, setRecords] = useState<LocalRecordSummary[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ key: string; values?: Record<string, string> }>();
  const [recoveringSessionId, setRecoveringSessionId] = useState<string>();

  async function refresh() {
    try {
      const all = await listLocalRecords();
      setRecords(all.filter((item) => item.record_type === 'RECOVERY' && item.completion_status !== 'COMPLETED'));
    } catch (error) {
      setMessage({ key: 'recovery.scanFailed', values: { detail: error instanceof Error ? error.message : String(error) } });
    }
  }
  useEffect(() => { void refresh(); }, []);

  async function continueRecovery(sessionId: string) {
    if (recoveringSessionId) return;
    setRecoveringSessionId(sessionId);
    setMessage({ key: 'recovery.checking', values: { sessionId } });
    try {
      const result = await recoverSession(sessionId);
      if (!result.ok) setMessage({ key: 'recovery.cannotContinue', values: { sessionId, detail: result.error ?? 'RECOVERY_FAILED: no diagnostic provided.' } });
    } catch (error) {
      setMessage({ key: 'recovery.cannotContinue', values: { sessionId, detail: `RECOVERY_UI_FAILED: ${error instanceof Error ? error.message : String(error)}` } });
    } finally {
      setRecoveringSessionId(undefined);
    }
  }

  const shown = records.filter((item) => !dismissed.has(item.record_id));
  if (!shown.length && !message) return null;

  return (
    <section className="card recovery-panel">
      <p className="eyebrow">Session Recovery</p><h2>{t('recovery.title')}</h2>
      <p className="muted">{t('recovery.help')}</p>
      {message ? <p aria-live="polite" className="warning">{t(message.key, message.values)}</p> : null}
      {shown.map((record) => <article key={record.record_id} className="recovery-card">
        <div><strong>{record.session_id}</strong><span>{record.package_id ?? '—'} · {record.mode ?? '—'}</span></div>
        <p>{t('recovery.current')}: {record.current_section_id ?? '—'} / {record.current_scope_id ?? '—'} / {record.current_task_id ?? '—'}</p>
        <p>{t('recovery.saved')} {formatDuration(record.active_time_ms)} · {t('recovery.lastSaved')} {record.last_saved_at ?? '—'} · {record.schema_version ?? t('recovery.unknownSchema')} · {t(record.needs_migration ? 'recovery.needsMigration' : 'recovery.noMigration')} · {record.export_status}</p>
        {record.diagnostic ? <p className="danger-text">{record.diagnostic}</p> : null}
        <details><summary>{t('recovery.readOnlySummary')}</summary><p>{t('recovery.path')}: {record.relative_path}</p><p>{t('recovery.files')}: {record.file_names.join(', ') || '—'}</p></details>
        <div className="record-actions">
          {record.completion_status !== 'CORRUPT' ? <button className="primary" disabled={Boolean(recoveringSessionId)} onClick={() => void continueRecovery(record.session_id)}>{t(recoveringSessionId === record.session_id ? 'recovery.recovering' : 'recovery.continue')}</button> : null}
          {record.completion_status !== 'CORRUPT' ? <button disabled={Boolean(recoveringSessionId)} onClick={() => void exportIncompleteRecovery(record.session_id).then((path) => setMessage({ key: 'recovery.incompleteExported', values: { path } })).catch((error) => setMessage({ key: 'recovery.error', values: { detail: String(error) } }))}>{t('recovery.exportIncomplete')}</button> : null}
          <button disabled={Boolean(recoveringSessionId)} onClick={() => void exportRecoveryRaw(record.session_id).then((path) => setMessage({ key: 'recovery.rawExported', values: { path } })).catch((error) => setMessage({ key: 'recovery.error', values: { detail: String(error) } }))}>{t('recovery.exportRaw')}</button>
          <button onClick={() => {
            if (!window.confirm(t('recovery.confirmTrash', { sessionId: record.session_id })) || !window.confirm(t('recovery.confirmTrashAgain'))) return;
            void moveRecordsToTrash([{
              record_id: record.record_id, record_type: record.record_type, session_id: record.session_id, relative_path: record.relative_path
            }]).then(() => refresh());
          }}>{t('recovery.moveTrash')}</button>
          <button disabled={Boolean(recoveringSessionId)} onClick={() => setDismissed((current) => new Set(current).add(record.record_id))}>{t('common.cancel')}</button>
        </div>
      </article>)}
    </section>
  );
}
