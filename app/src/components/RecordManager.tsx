import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import {
  filterAndPageRecords,
  formatLocalTimestamp,
  summarizeBatchResults,
  type LocalRecordSummary,
  type RecordActionResult,
  type RecordQuery
} from '../lib/recordManager';
import { exportIncompleteRecovery } from '../lib/recoveryExport';
import {
  cleanupTerminalRecovery,
  exportRecoveryRaw,
  getAppSetting,
  listLocalRecords,
  moveRecordsToTrash,
  openRecordDirectory,
  permanentlyDeleteTrashRecords,
  restoreTrashRecords,
  saveAppSetting,
  type RecordReference
} from '../lib/storage';
import { formatDuration } from '../lib/timer';
import { useAppStore } from '../store/appStore';

const DEFAULT_QUERY: RecordQuery = {
  type: 'ALL', completion: 'ALL', search: '', sort: 'NEWEST', page: 1
};

function persistedRecordFilters(query: RecordQuery) {
  return {
    type: query.type,
    completion: query.completion,
    search: query.search,
    sort: query.sort,
    page: 1
  };
}

export function RecordManager() {
  const { t, i18n: activeI18n } = useTranslation();
  const activeSessionId = useAppStore((state) => state.session?.session_id);
  const recoverSession = useAppStore((state) => state.recoverSession);
  const [records, setRecords] = useState<LocalRecordSummary[]>([]);
  const [query, setQuery] = useState<RecordQuery>(DEFAULT_QUERY);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [recoveringSessionId, setRecoveringSessionId] = useState<string>();
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const persistedFilters = useRef<string>();
  const page = useMemo(() => filterAndPageRecords(records, query), [records, query]);

  const refresh = useCallback(async () => {
    setSelected(new Set());
    setLoading(true);
    try {
      setRecords(await listLocalRecords());
      setMessage('');
    } catch (error) {
      setMessage(t('records.readFailed', { detail: error instanceof Error ? error.message : String(error) }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void getAppSetting<Partial<RecordQuery>>('record_filters').then((saved) => {
      const restored = saved ? { ...DEFAULT_QUERY, ...saved, page: 1 } : DEFAULT_QUERY;
      persistedFilters.current = JSON.stringify(persistedRecordFilters(restored));
      if (saved) setQuery((current) => ({ ...current, ...saved, page: 1 }));
    }).catch(() => {
      persistedFilters.current = JSON.stringify(persistedRecordFilters(DEFAULT_QUERY));
    }).finally(() => {
      setFiltersHydrated(true);
      void refresh();
    });
  }, [refresh]);

  useEffect(() => { setMessage(''); }, [activeI18n.language]);

  useEffect(() => {
    if (!filtersHydrated) return;
    const filters = {
      type: query.type,
      completion: query.completion,
      search: query.search,
      sort: query.sort,
      page: 1
    };
    const serialized = JSON.stringify(filters);
    if (serialized === persistedFilters.current) return;
    const previous = persistedFilters.current;
    persistedFilters.current = serialized;
    void saveAppSetting('record_filters', filters).catch(() => {
      persistedFilters.current = previous;
    });
  }, [filtersHydrated, query.type, query.completion, query.search, query.sort]);

  const chosen = page.items.filter((record) => selected.has(record.record_id));

  async function trash(items: LocalRecordSummary[]) {
    const movable = items.filter((item) => item.record_type !== 'TRASH');
    if (!movable.length || !doubleConfirm(t('records.moveToTrash'), movable)) return;
    await runAction(() => moveRecordsToTrash(movable.map(toReference), activeSessionId));
  }

  async function restore(items: LocalRecordSummary[]) {
    const trashItems = items.filter((item) => item.record_type === 'TRASH');
    if (!trashItems.length) return;
    await runAction(() => restoreTrashRecords(trashItems.map(toReference)));
  }

  async function permanentlyDelete(items: LocalRecordSummary[]) {
    const trashItems = items.filter((item) => item.record_type === 'TRASH');
    if (!trashItems.length || !doubleConfirm(t('records.permanentDelete'), trashItems)) return;
    await runAction(() => permanentlyDeleteTrashRecords(trashItems.map(toReference), true));
  }

  async function cleanupStaleTerminalRecovery(items: LocalRecordSummary[]) {
    const candidates = items.filter((item) =>
      item.record_type === 'TOEFL' &&
      item.recovery_classification === 'STALE_TERMINAL_RECOVERY'
    );
    if (!candidates.length || !doubleConfirm(t('records.cleanupStale'), candidates)) return;
    const results: RecordActionResult[] = [];
    for (const item of candidates) {
      try {
        await cleanupTerminalRecovery(item.session_id, item.relative_path, activeSessionId);
        results.push({ record_id: item.record_id, ok: true, relative_path: item.relative_path });
      } catch (error) {
        results.push({
          record_id: item.record_id,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    showBatch(results);
    await refresh();
  }

  async function retryExports(items: LocalRecordSummary[]) {
    const candidates = items.filter((item) => item.record_type === 'RECOVERY');
    if (!candidates.length) return;
    const results: RecordActionResult[] = [];
    for (const item of candidates) {
      try {
        const relativePath = await exportIncompleteRecovery(item.session_id);
        results.push({ record_id: item.record_id, ok: true, relative_path: relativePath });
      } catch (error) {
        results.push({ record_id: item.record_id, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    showBatch(results);
    await refresh();
  }

  async function continueRecovery(sessionId: string) {
    if (recoveringSessionId) return;
    setRecoveringSessionId(sessionId);
    setMessage(t('records.recovering', { sessionId }));
    try {
      const result = await recoverSession(sessionId);
      if (!result.ok) setMessage(t('records.cannotContinue', { sessionId, detail: result.error ?? 'RECOVERY_FAILED: no diagnostic provided.' }));
    } catch (error) {
      setMessage(t('records.cannotContinue', { sessionId, detail: `RECOVERY_UI_FAILED: ${error instanceof Error ? error.message : String(error)}` }));
    } finally {
      setRecoveringSessionId(undefined);
    }
  }

  async function runAction(action: () => Promise<RecordActionResult[]>) {
    try {
      showBatch(await action());
      setSelected(new Set());
      await refresh();
    } catch (error) {
      setMessage(t('records.actionFailed', { detail: error instanceof Error ? error.message : String(error) }));
    }
  }

  function showBatch(results: RecordActionResult[]) {
    const summary = summarizeBatchResults(results);
    setMessage(summary.failed
      ? t('records.batchPartial', { succeeded: summary.succeeded, failed: summary.failed, detail: summary.failures.map((item) => `${item.record_id} — ${item.error}`).join('; ') })
      : t('records.batchSuccess', { count: summary.succeeded }));
  }

  function updateQuery(partial: Partial<RecordQuery>) {
    setSelected(new Set());
    setQuery((current) => ({ ...current, ...partial, page: partial.page ?? 1 }));
  }

  return (
    <section className="card records-page">
      <div className="section-title">
        <div><p className="eyebrow">{t('records.localIndex')}</p><h2>{t('app.records')}</h2></div>
        <button onClick={() => void refresh()} disabled={loading}>{t(loading ? 'records.refreshing' : 'records.refresh')}</button>
      </div>
      <div className="record-filters">
        <label>{t('records.type')}<select value={query.type} onChange={(event) => updateQuery({ type: event.target.value as RecordQuery['type'] })}>
          <option value="ALL">{t('records.all')}</option><option value="TOEFL">TOEFL</option><option value="TYPING">{t('records.typing')}</option>
          <option value="RECOVERY">{t('records.recovery')}</option><option value="TRASH">{t('records.trash')}</option>
        </select></label>
        <label>{t('records.completion')}<select value={query.completion} onChange={(event) => updateQuery({ completion: event.target.value as RecordQuery['completion'] })}>
          <option value="ALL">{t('records.all')}</option><option value="COMPLETED">{t('status.completed')}</option><option value="INCOMPLETE">{t('status.incomplete')}</option>
          <option value="CORRUPT">{t('records.corrupt')}</option><option value="UNKNOWN">{t('records.unknown')}</option>
        </select></label>
        <label>{t('records.date')}<select value={query.sort} onChange={(event) => updateQuery({ sort: event.target.value as RecordQuery['sort'] })}>
          <option value="NEWEST">{t('records.newest')}</option><option value="OLDEST">{t('records.oldest')}</option>
        </select></label>
        <label>{t('records.search')}<input value={query.search} onChange={(event) => updateQuery({ search: event.target.value })} /></label>
      </div>

      <div className="record-batch-actions">
        <label><input type="checkbox" checked={page.items.length > 0 && page.items.every((item) => selected.has(item.record_id))} onChange={(event) => {
          setSelected((current) => {
            const next = new Set(current);
            page.items.forEach((item) => event.target.checked ? next.add(item.record_id) : next.delete(item.record_id));
            return next;
          });
        }} />{t('records.selectPage')}</label>
        <span>{t('records.selected', { count: chosen.length })}</span>
        <button disabled={!chosen.some((item) => item.record_type !== 'TRASH')} onClick={() => void trash(chosen)}>{t('records.batchTrash')}</button>
        <button disabled={!chosen.some((item) => item.record_type === 'TRASH')} onClick={() => void restore(chosen)}>{t('records.batchRestore')}</button>
        <button disabled={!chosen.some((item) => item.record_type === 'TRASH')} onClick={() => void permanentlyDelete(chosen)}>{t('records.batchDelete')}</button>
        <button disabled={!chosen.some((item) => item.record_type === 'RECOVERY')} onClick={() => void retryExports(chosen)}>{t('records.batchExport')}</button>
        <button disabled={!chosen.some((item) => item.recovery_classification === 'STALE_TERMINAL_RECOVERY')} onClick={() => void cleanupStaleTerminalRecovery(chosen)}>{t('records.batchCleanup')}</button>
        <button disabled={!records.some((item) => item.record_type === 'TRASH')} onClick={() => void permanentlyDelete(records.filter((item) => item.record_type === 'TRASH'))}>{t('records.emptyTrash')}</button>
      </div>
      <p className="muted" aria-live="polite">{message || t('records.total', { count: page.total })}</p>

      <div className="record-list">
        {page.total === 0 ? <p className="record-empty-state">{t('records.empty')}</p> : null}
        {page.items.map((record) => {
          const active = record.session_id === activeSessionId;
          return (
            <article className="record-card" key={record.record_id}>
              <label className="record-select"><input type="checkbox" checked={selected.has(record.record_id)} onChange={(event) => setSelected((current) => {
                const next = new Set(current); event.target.checked ? next.add(record.record_id) : next.delete(record.record_id); return next;
              })} /><strong>{record.record_type}{record.record_type === 'TRASH' && record.original_record_type ? t('records.originalType', { type: record.original_record_type }) : ''}</strong>{record.legacy_label ? <span className="status-pill">{record.legacy_label}</span> : null}{active ? <span className="status-pill">{t('records.activeSession')}</span> : null}</label>
              <div className="record-summary-grid">
                <span>Session<strong>{record.session_id}</strong></span><span>Package<strong>{record.package_id ?? '—'}</strong></span>
                <span>{t('records.date')}<strong title={record.created_at}>{formatLocalTimestamp(record.created_at)}</strong></span><span>Mode / profile<strong>{[record.mode, record.profile_id].filter(Boolean).join(' / ') || '—'}</strong></span>
                <span>{t('records.sections')}<strong>{record.selected_sections.join(', ') || '—'}</strong></span><span>{t('records.activePause')}<strong>{formatDuration(record.active_time_ms)} / {formatDuration(record.pause_time_ms)}</strong></span>
                <span>{t('records.status')}<strong>{record.completion_status} / {record.export_status}</strong></span><span>Schema / Structure / App<strong>{record.schema_version ?? '—'} / {record.structure_mode ?? '—'} / {record.app_version ?? '—'}</strong></span>
                <span>{t('records.size')}<strong>{formatBytes(record.directory_size_bytes)}</strong></span><span>{t('records.relativePath')}<strong>{record.relative_path}</strong></span>
              </div>
              {record.section_item_counts ? <p className="muted">Created Items：{Object.entries(record.section_item_counts).map(([section, count]) => `${section} ${count}`).join(' · ')}</p> : null}
              {record.diagnostic && record.recovery_classification !== 'STALE_TERMINAL_RECOVERY'
                ? <p className="danger-text">{t('records.diagnostic', { detail: record.diagnostic })}</p>
                : null}
              {record.recovery_classification === 'STALE_TERMINAL_RECOVERY' ? (
                <p className="danger-text">{t('records.staleRecovery')}</p>
              ) : null}
              <details><summary>{t('records.viewDetails')}</summary>
                <p>{t('records.current', { scope: `${record.current_section_id ?? '—'} / ${record.current_scope_id ?? '—'} / ${record.current_task_id ?? '—'}` })}; {t('records.lastSaved')} <span title={record.last_saved_at}>{formatLocalTimestamp(record.last_saved_at)}</span>; {t('records.needsMigration', { value: t(record.needs_migration ? 'common.yes' : 'common.no') })}</p>
                <ul>{record.file_names.map((name) => <li key={name}>{name}</li>)}</ul>
              </details>
              <div className="record-actions">
                <button onClick={() => void openRecordDirectory(toReference(record)).catch((error) => setMessage(String(error)))}>{t('records.openDirectory')}</button>
                {record.record_type === 'RECOVERY' && record.completion_status !== 'CORRUPT' && record.recovery_classification !== 'STALE_TERMINAL_RECOVERY' ? <button className="primary" disabled={Boolean(recoveringSessionId)} onClick={() => void continueRecovery(record.session_id)}>{t(recoveringSessionId === record.session_id ? 'records.recoveringShort' : 'records.continue')}</button> : null}
                {record.record_type === 'RECOVERY' ? <button onClick={() => void retryExports([record])}>{t('records.exportRetry')}</button> : null}
                {record.record_type === 'RECOVERY' ? <button onClick={() => void exportRecoveryRaw(record.session_id).then((path) => setMessage(t('records.rawExported', { path }))).catch((error) => setMessage(String(error)))}>{t('records.exportRaw')}</button> : null}
                {record.record_type === 'TOEFL' && record.recovery_classification === 'STALE_TERMINAL_RECOVERY' ? <button onClick={() => void cleanupStaleTerminalRecovery([record])}>{t('records.cleanupStale')}</button> : null}
                {record.record_type === 'TRASH'
                  ? <><button onClick={() => void restore([record])}>{t('records.restore')}</button><button onClick={() => void permanentlyDelete([record])}>{t('records.permanentDelete')}</button></>
                  : <button disabled={active} onClick={() => void trash([record])}>{t('records.moveToTrash')}</button>}
              </div>
            </article>
          );
        })}
      </div>
      {page.total_pages > 0 ? (
        <div className="pagination">
          <button disabled={page.page <= 1} onClick={() => updateQuery({ page: page.page - 1 })}>{t('records.previousPage')}</button>
          <span>{t('records.page', { page: page.page, total: page.total_pages })}</span>
          <button disabled={page.page >= page.total_pages} onClick={() => updateQuery({ page: page.page + 1 })}>{t('records.nextPage')}</button>
        </div>
      ) : null}
    </section>
  );
}

function toReference(record: LocalRecordSummary): RecordReference {
  return { record_id: record.record_id, record_type: record.record_type, session_id: record.session_id, relative_path: record.relative_path };
}

function doubleConfirm(action: string, items: LocalRecordSummary[]): boolean {
  const types = [...new Set(items.map((item) => item.record_type))].join(' / ');
  const logicalIdentities = new Set(items.map(logicalIdentity)).size;
  const physicalArtifacts = items.reduce(
    (count, item) => count + 1 + (item.recovery_artifact_count ?? 0),
    0
  );
  return window.confirm(i18n.t('records.confirmAction', { action, logicalIdentities, physicalArtifacts, types })) &&
    window.confirm(i18n.t('records.confirmAgain', { action, logicalIdentities }));
}

function logicalIdentity(record: LocalRecordSummary): string {
  const primaryType = record.record_type === 'TRASH'
    ? record.original_record_type ?? 'TRASH'
    : record.record_type;
  const family = primaryType === 'RECOVERY' ? 'TOEFL' : primaryType;
  return `${family}:${record.session_id}`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}
