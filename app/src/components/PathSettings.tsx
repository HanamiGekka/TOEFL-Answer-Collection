import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getAppPaths,
  getDefaultAppRoot,
  previewAppPaths,
  saveAppPaths,
  selectAppRootDirectory,
  selectSourceRootDirectory,
  type AppPaths,
  type AppPathsPreview
} from '../lib/storage';
import { deriveAppPaths, derivedDisplayPaths } from '../lib/appPaths';
import { localizePathError } from '../i18n/pathErrors';

export function PathSettings() {
  const { t, i18n } = useTranslation();
  const [persistedPaths, setPersistedPaths] = useState<AppPaths>();
  const [draftPaths, setDraftPaths] = useState<AppPaths>();
  const [preview, setPreview] = useState<AppPathsPreview>();
  const [defaultAppRoot, setDefaultAppRoot] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    void Promise.all([getAppPaths(), getDefaultAppRoot()])
      .then(([loaded, defaultRoot]) => {
        setPersistedPaths(loaded);
        setDraftPaths(loaded);
        setDefaultAppRoot(defaultRoot);
      })
      .catch((error) => setStatus(t('paths.readFailed', { detail: localizePathError(error, t) })));
  }, [t]);

  useEffect(() => { setStatus(''); }, [i18n.language]);

  if (!persistedPaths || !draftPaths) {
    return <section className="card"><h2>{t('paths.title')}</h2><p role="status">{status || t('paths.loading')}</p></section>;
  }
  const displayPaths = derivedDisplayPaths(draftPaths);
  const dirty = draftPaths.app_root !== persistedPaths.app_root
    || draftPaths.source_root !== persistedPaths.source_root;

  function updateRoot(value: string) {
    setDraftPaths(deriveAppPaths(value, draftPaths!.source_root));
    setPreview(undefined);
    setStatus('');
  }

  function updateSourceRoot(value: string) {
    setDraftPaths(deriveAppPaths(draftPaths!.app_root, value));
    setPreview(undefined);
    setStatus('');
  }

  async function pickRoot() {
    try {
      const selected = await selectAppRootDirectory(draftPaths!.app_root, t('paths.selectAppRoot'));
      if (selected) updateRoot(selected);
    } catch (error) {
      setStatus(t('paths.pickRootFailed', { detail: localizePathError(error, t) }));
    }
  }

  async function pickSourceRoot() {
    try {
      const selected = await selectSourceRootDirectory(draftPaths!.source_root, t('paths.selectSourceRoot'));
      if (selected) updateSourceRoot(selected);
    } catch (error) {
      setStatus(t('paths.pickSourceFailed', { detail: localizePathError(error, t) }));
    }
  }

  async function validate() {
    try {
      const result = await previewAppPaths(draftPaths!);
      setPreview(result);
      setStatus(t(result.ok ? 'paths.validationPassed' : 'paths.validationFailed'));
    } catch (error) {
      setStatus(t('paths.validationError', { detail: localizePathError(error, t) }));
    }
  }

  async function persist() {
    if (!preview?.ok) return;
    const confirmed = window.confirm(
      t('paths.confirmApply', { appRoot: draftPaths!.app_root, sourceRoot: draftPaths!.source_root || t('common.notConfigured') })
    );
    if (!confirmed) return;
    try {
      const saved = await saveAppPaths(draftPaths!, true);
      setPersistedPaths(saved);
      setDraftPaths(saved);
      setStatus(t('paths.saved'));
      window.dispatchEvent(new Event('app-paths-saved'));
    } catch (error) {
      setStatus(t('paths.saveFailed', { detail: localizePathError(error, t) }));
    }
  }

  return (
    <section className="card settings-section">
      <p className="eyebrow">APP_ROOT / SOURCE_ROOT</p>
      <h2>{t('paths.title')}</h2>
      <p className="muted">{t('paths.help')}</p>
      <p>{t('paths.savedRoot', { path: persistedPaths.app_root })}</p>
      <p>{t('paths.savedSource', { path: persistedPaths.source_root || t('common.notConfigured') })}</p>
      <div className="path-picker-row">
        <button onClick={() => void pickRoot()}>{t('paths.chooseRoot')}</button>
        <button onClick={() => updateRoot(defaultAppRoot)}>{t('paths.restoreDefault')}</button>
        <button onClick={() => void pickSourceRoot()}>{t('paths.chooseSource')}</button>
        <button onClick={() => updateSourceRoot('')}>{t('paths.clearSource')}</button>
      </div>
      <div className="path-grid" data-testid="app-path-grid">
        <PathInput label={t('paths.appRoot')} value={draftPaths.app_root} onChange={updateRoot} />
        <ReadOnlyPath label={t('paths.recordsRoot')} value={draftPaths.records_root} />
        <ReadOnlyPath label={t('paths.typingRoot')} value={draftPaths.typing_records_root} />
        <ReadOnlyPath label={t('paths.trashRoot')} value={draftPaths.trash_root} />
        <ReadOnlyPath label={t('paths.recoveryRoot')} value={displayPaths.recovery_root} />
        <ReadOnlyPath label={t('paths.database')} value={displayPaths.database_path} />
        <ReadOnlyPath label={t('paths.logsRoot')} value={displayPaths.logs_root} />
        <PathInput label={t('paths.sourceRoot')} value={draftPaths.source_root} onChange={updateSourceRoot} />
      </div>
      {dirty ? <p className="warning-text">{t('paths.unsaved')}</p> : null}
      {preview ? (
        <div className={preview.ok ? 'path-preview success-text' : 'path-preview danger-text'}>
          <strong>{t(preview.ok ? 'paths.valid' : 'paths.invalid')}</strong>
          <p>{t('paths.current', { path: persistedPaths.app_root })}</p>
          <p>{t('paths.proposed', { path: preview.paths.app_root })}</p>
          <p>{t('paths.sourceStatus', { status: t(preview.source_status === 'UNCONFIGURED' ? 'common.notConfigured' : preview.source_status === 'VALID' ? 'paths.valid' : 'paths.invalid') })}</p>
          <p>{t('paths.packageCount', { count: preview.source_package_count })}</p>
          {preview.creates.length ? <p>{t('paths.willCreate', { paths: preview.creates.join('; ') })}</p> : null}
          {preview.warnings.map((warning) => <p key={warning}>{warning === 'APP_PATHS_NO_MIGRATION' ? t('paths.noMigrationWarning') : warning}</p>)}
          {preview.errors.map((error) => <p key={error}>{localizePathError(error, t)}</p>)}
          <p>{t('paths.migration', { value: t(preview.migrates_existing_data ? 'common.yes' : 'common.no') })}</p>
          <p>{t('paths.writable', { value: t(preview.writable ? 'common.yes' : 'common.no') })}</p>
          <p>{t('paths.insideRoot', { value: t(preview.inside_app_root ? 'common.yes' : 'common.no') })}</p>
          <p>{t('paths.effective')}</p>
        </div>
      ) : null}
      <div className="settings-actions">
        <button onClick={() => void validate()}>{t('paths.preview')}</button>
        <button className="primary" disabled={!preview?.ok} onClick={() => void persist()}>{t('paths.confirmSave')}</button>
        <span aria-live="polite">{status}</span>
      </div>
    </section>
  );
}

function PathInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="path-row"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function ReadOnlyPath({ label, value }: { label: string; value: string }) {
  return <label className="path-row"><span>{label}</span><input value={value} readOnly /></label>;
}
