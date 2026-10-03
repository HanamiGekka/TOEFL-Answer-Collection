import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAppPaths, openDataFolder, previewAppPaths, saveAppPaths, selectAppRootDirectory, type AppPaths, type AppPathsPreview } from '../lib/storage';
import { deriveAppPaths } from '../lib/appPaths';
import { localizePathError } from '../i18n/pathErrors';

export function PathSettings() {
  const { t, i18n } = useTranslation();
  const [persistedPaths, setPersistedPaths] = useState<AppPaths>();
  const [draftPaths, setDraftPaths] = useState<AppPaths>();
  const [preview, setPreview] = useState<AppPathsPreview>();
  const [status, setStatus] = useState('');

  useEffect(() => {
    void getAppPaths().then((loaded) => {
      setPersistedPaths(loaded);
      setDraftPaths(loaded);
    }).catch((error) => setStatus(t('paths.readFailed', { detail: localizePathError(error, t) })));
  }, [t]);
  useEffect(() => { setStatus(''); }, [i18n.language]);

  if (!persistedPaths || !draftPaths) {
    return <section className="card"><h2>{t('paths.title')}</h2><p role="status">{status || t('paths.loading')}</p></section>;
  }
  const dirty = draftPaths.app_root !== persistedPaths.app_root;

  async function pickRoot() {
    try {
      const selected = await selectAppRootDirectory(persistedPaths!.app_root, t('paths.selectAppRoot'));
      if (selected) {
        setDraftPaths(deriveAppPaths(selected, persistedPaths!.source_root));
        setPreview(undefined);
        setStatus('');
      }
    } catch (error) {
      setStatus(t('paths.pickRootFailed', { detail: localizePathError(error, t) }));
    }
  }

  async function openRoot() {
    try { await openDataFolder(); }
    catch (error) { setStatus(t('paths.openFailed', { detail: localizePathError(error, t) })); }
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
    if (!preview?.ok || preview.paths.app_root !== draftPaths!.app_root) return;
    if (!window.confirm(t('paths.confirmApply', { appRoot: draftPaths!.app_root }))) return;
    try {
      const saved = await saveAppPaths(draftPaths!, true);
      setPersistedPaths(saved);
      setDraftPaths(saved);
      setPreview(undefined);
      setStatus(t('paths.saved'));
      window.dispatchEvent(new Event('app-paths-saved'));
    } catch (error) {
      setStatus(t('paths.saveFailed', { detail: localizePathError(error, t) }));
    }
  }

  return (
    <section className="card settings-section">
      <h2>{t('paths.title')}</h2>
      <p className="muted">{t('paths.help')}</p>
      <p className="path-current"><strong>{t('paths.dataFolder')}:</strong> <span>{persistedPaths.app_root}</span></p>
      <div className="path-picker-row">
        <button onClick={() => void pickRoot()}>{t('paths.chooseRoot')}</button>
        <button onClick={() => void openRoot()}>{t('paths.openFolder')}</button>
      </div>
      {dirty ? <>
        <p>{t('paths.proposed', { path: draftPaths.app_root })}</p>
        <p className="muted">{t('paths.noMigrationWarning')}</p>
        <div className="settings-actions">
          <button onClick={() => void validate()}>{t('paths.preview')}</button>
          <button className="primary" disabled={!preview?.ok} onClick={() => void persist()}>{t('paths.confirmSave')}</button>
        </div>
      </> : null}
      {preview && !preview.ok ? <div className="danger-text">{preview.errors.map((error) => <p key={error}>{localizePathError(error, t)}</p>)}</div> : null}
      <span role="status" aria-live="polite">{status}</span>
    </section>
  );
}
