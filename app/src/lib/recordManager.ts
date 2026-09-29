import i18n from '../i18n';

export type LocalRecordType = 'TOEFL' | 'TYPING' | 'RECOVERY' | 'TRASH';
export type RecordCompletionStatus = 'COMPLETED' | 'INCOMPLETE' | 'CORRUPT' | 'UNKNOWN';
export type RecordExportStatus = 'EXPORTED' | 'RETRYABLE' | 'NOT_EXPORTED' | 'UNKNOWN';
export type RecoveryClassification = 'LIVE_RECOVERY' | 'STALE_TERMINAL_RECOVERY';

export interface LocalRecordSummary {
  record_id: string;
  record_type: LocalRecordType;
  session_id: string;
  package_id?: string;
  created_at?: string;
  mode?: string;
  profile_id?: string;
  blueprint_id?: string;
  blueprint_version?: string;
  structure_mode?: string;
  section_item_counts?: Record<string, number>;
  legacy_label?: 'LEGACY V5';
  selected_sections: string[];
  active_time_ms: number;
  pause_time_ms: number;
  completion_status: RecordCompletionStatus;
  export_status: RecordExportStatus;
  schema_version?: string;
  app_version?: string;
  directory_size_bytes: number;
  relative_path: string;
  file_names: string[];
  current_section_id?: string;
  current_scope_id?: string;
  current_task_id?: string;
  last_saved_at?: string;
  needs_migration?: boolean;
  diagnostic?: string;
  recovery_classification?: RecoveryClassification;
  recovery_artifact_count?: number;
  trash_id?: string;
  original_relative_path?: string;
  original_record_type?: Exclude<LocalRecordType, 'TRASH'>;
}

export interface RecordQuery {
  type?: LocalRecordType | 'ALL';
  completion?: RecordCompletionStatus | 'ALL';
  search?: string;
  sort?: 'NEWEST' | 'OLDEST';
  page: number;
  page_size?: number;
}

export interface RecordPage {
  items: LocalRecordSummary[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export const RECORD_PAGE_SIZE = 10;

export interface RecordActionResult {
  record_id: string;
  ok: boolean;
  error?: string;
  relative_path?: string;
}

export function formatLocalTimestamp(timestamp?: string, timeZone?: string): string {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return i18n.t('records.invalidTime');
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((part) => [part.type, part.value])
    );
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  } catch {
    return i18n.t('records.invalidTime');
  }
}

export function filterAndPageRecords(records: LocalRecordSummary[], query: RecordQuery): RecordPage {
  const search = query.search?.trim().toLocaleLowerCase() ?? '';
  const filtered = records.filter((record) => {
    if (query.type && query.type !== 'ALL' && record.record_type !== query.type) return false;
    if (query.completion && query.completion !== 'ALL' && record.completion_status !== query.completion) return false;
    if (!search) return true;
    return [record.package_id, record.session_id, record.relative_path]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(search));
  }).sort((left, right) => {
    const leftEpoch = parseTimestampEpoch(left.created_at);
    const rightEpoch = parseTimestampEpoch(right.created_at);
    if (leftEpoch === null && rightEpoch === null) return compareRecordIdentity(left, right);
    if (leftEpoch === null) return 1;
    if (rightEpoch === null) return -1;
    const comparison = leftEpoch - rightEpoch;
    if (comparison !== 0) return query.sort === 'OLDEST' ? comparison : -comparison;
    return compareRecordIdentity(left, right);
  });
  const pageSize = RECORD_PAGE_SIZE;
  const totalPages = Math.ceil(filtered.length / pageSize);
  const requestedPage = Math.max(1, Math.trunc(query.page || 1));
  const page = totalPages === 0 ? 0 : Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;
  return {
    items: totalPages === 0 ? [] : filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    page_size: pageSize,
    total_pages: totalPages
  };
}

function compareRecordIdentity(left: LocalRecordSummary, right: LocalRecordSummary): number {
  return left.record_id.localeCompare(right.record_id, 'en') ||
    left.relative_path.localeCompare(right.relative_path, 'en');
}

function parseTimestampEpoch(timestamp?: string): number | null {
  if (!timestamp) return null;
  const epoch = Date.parse(timestamp);
  return Number.isFinite(epoch) ? epoch : null;
}

export function canMutateRecord(
  record: Pick<LocalRecordSummary, 'session_id'>,
  activeSessionId?: string
): { ok: true } | { ok: false; reason: 'ACTIVE_SESSION' } {
  return activeSessionId && record.session_id === activeSessionId
    ? { ok: false, reason: 'ACTIVE_SESSION' }
    : { ok: true };
}

export function summarizeBatchResults(results: RecordActionResult[]): {
  succeeded: number;
  failed: number;
  failures: Array<{ record_id: string; error: string }>;
} {
  const failures = results
    .filter((result) => !result.ok)
    .map((result) => ({ record_id: result.record_id, error: result.error ?? 'Unknown error' }));
  return { succeeded: results.length - failures.length, failed: failures.length, failures };
}

export function validateControlledRelativePath(
  relativePath: string,
  type: LocalRecordType
): { ok: boolean; error?: string } {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    return { ok: false, error: 'Absolute paths are not allowed.' };
  }
  const components = normalized.split('/');
  if (components.some((component) => !component || component === '.' || component === '..')) {
    return { ok: false, error: 'Only normal relative path components are allowed.' };
  }
  const expected: { root: string; minComponents: number } = type === 'TOEFL'
    ? { root: 'records', minComponents: 3 }
    : type === 'TYPING'
      ? { root: 'typing_records', minComponents: 3 }
      : type === 'RECOVERY'
        ? { root: 'data', minComponents: 3 }
        : { root: 'trash', minComponents: 3 };
  if (components[0] !== expected.root || components.length < expected.minComponents) {
    return { ok: false, error: `Path is outside the ${expected.root} root.` };
  }
  if (type === 'RECOVERY' && components[1] !== 'recovery') {
    return { ok: false, error: 'Recovery paths must remain under data/recovery.' };
  }
  return { ok: true };
}
