import type { TFunction } from 'i18next';

const PATH_ERROR_KEYS: Record<string, string> = {
  APP_PATHS_CONFIRMATION_REQUIRED: 'pathError.confirmationRequired',
  APP_PATHS_STATE_UNAVAILABLE: 'pathError.stateUnavailable',
  APP_PATHS_FIXTURE_WRITE_REFUSED: 'pathError.fixtureWriteRefused',
  APP_ROOT_NOT_WRITABLE: 'pathError.appRootNotWritable',
  APP_PATHS_ABSOLUTE_REQUIRED: 'pathError.absoluteRequired',
  CONTROLLED_ROOT_INVALID: 'pathError.controlledRootInvalid',
  APP_ROOT_UNRESOLVABLE: 'pathError.appRootUnresolvable',
  STALE_APP_CONFIGURATION: 'pathError.staleConfiguration',
  APP_CONFIGURATION_LOCK: 'pathError.stateUnavailable',
  APP_CONFIGURATION_STATE: 'pathError.stateUnavailable',
  APP_CONFIGURATION_GENERATION: 'pathError.stateUnavailable'
};

export function localizePathError(error: unknown, t: TFunction): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.split(';').map((part) => {
    const code = part.match(/\b[A-Z][A-Z0-9_]{2,}\b/u)?.[0] ?? '';
    return t(PATH_ERROR_KEYS[code] ?? 'pathError.unknown');
  }).join(' ');
}
