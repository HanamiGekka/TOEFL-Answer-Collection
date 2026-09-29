import { useAppStore } from '../store/appStore';
import { useTranslation } from 'react-i18next';
import { localizePathError } from '../i18n/pathErrors';

export function PackagePicker() {
  const { t } = useTranslation();
  const packages = useAppStore((state) => state.packages);
  const selected = useAppStore((state) => state.selectedPackage);
  const selectPackage = useAppStore((state) => state.selectPackage);
  const error = useAppStore((state) => state.packageLoadError);

  return (
    <div className="stack">
      <label className="label" htmlFor="package-select">{t('package.package')}</label>
      <select
        id="package-select"
        value={selected?.package_id ?? ''}
        onChange={(event) => selectPackage(event.target.value)}
      >
        {packages.map((item) => (
          <option key={item.package_id} value={item.package_id}>
            {item.package_id}
          </option>
        ))}
      </select>
      {error ? <p className="warning">{t('package.scanFailed', { detail: localizePathError(error, t) })}</p> : null}
      {selected ? (
        <div className="package-meta">
          <p title={selected.source_relative_path ?? selected.package_id}>
            {t('package.source', { path: selected.source_relative_path ?? selected.package_id })}
          </p>
        </div>
      ) : (
        <p className="muted">{t('package.chooseSource')}</p>
      )}
    </div>
  );
}
