import type { AppPaths } from './storage';

function stripTrailingSeparators(value: string): string {
  const trimmed = value.trim();
  if (/^[A-Za-z]:[\\/]?$/.test(trimmed)) return `${trimmed.slice(0, 2)}\\`;
  return trimmed.replace(/[\\/]+$/u, '');
}

function appendWindowsPath(root: string, relative: string): string {
  const normalized = stripTrailingSeparators(root);
  return normalized.endsWith('\\') ? `${normalized}${relative}` : `${normalized}\\${relative}`;
}

export function deriveAppPaths(appRoot: string, sourceRoot: string): AppPaths {
  const normalizedRoot = stripTrailingSeparators(appRoot);
  return {
    app_root: normalizedRoot,
    source_root: stripTrailingSeparators(sourceRoot),
    records_root: appendWindowsPath(normalizedRoot, 'records'),
    typing_records_root: appendWindowsPath(normalizedRoot, 'typing_records'),
    trash_root: appendWindowsPath(normalizedRoot, 'trash')
  };
}

export function derivedDisplayPaths(paths: AppPaths) {
  return {
    recovery_root: appendWindowsPath(paths.app_root, 'data\\recovery'),
    database_path: appendWindowsPath(paths.app_root, 'data\\answer_collection.sqlite3'),
    logs_root: appendWindowsPath(paths.app_root, 'logs')
  };
}
