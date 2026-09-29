import type { EventLogEntry, PracticeSession, TypingMinuteSample, TypingSnapshot } from '../types';
import { buildTypingMarkdown } from './markdown';
import {
  serializeSessionForPersistence,
  serializeTypingMinuteSampleForPersistence,
  serializeTypingSnapshotForPersistence
} from './persistedTime';
import { buildSessionExportBundle } from './sessionExport';
import {
  exportSessionBundleAtomic,
  exportSessionTextAtomic,
  exportTextAtomic,
  exportTypingBundleAtomic,
  writeRecordIndex
} from './storage';
import type { LocalRecordSummary } from './recordManager';
import { APP_VERSION } from '../constants';
import { isDynamicSession } from './dynamicSession';

export interface ExportFilePlan {
  name: string;
  relativePath: string;
  content: string;
}

export interface TypingExportPlan {
  relativeBase: string;
  files: ExportFilePlan[];
}

type ExportWriter = (relativePath: string, content: string) => Promise<void>;

export function csvEscape(value: unknown): string {
  const raw = String(value ?? '');
  if (/[",\r\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

export function typingSamplesToCsv(samples: TypingMinuteSample[]): string {
  const headers = [
    'active_minute_index',
    'timestamp',
    'active_ms',
    'retained_letters_cumulative',
    'retained_letters_delta',
    'retained_words_cumulative',
    'retained_words_delta',
    'retained_characters_cumulative',
    'retained_characters_delta',
    'keyboard_inserted_characters_cumulative',
    'keyboard_inserted_characters_delta',
    'keyboard_inserted_letters_cumulative',
    'keyboard_inserted_letters_delta',
    'deleted_characters_cumulative',
    'deleted_characters_delta',
    'deleted_letters_cumulative',
    'deleted_letters_delta',
    'pasted_characters_cumulative',
    'pasted_characters_delta',
    'pasted_letters_cumulative',
    'pasted_letters_delta',
    'retention_accuracy',
    'net_cpm',
    'gross_cpm',
    'actual_wpm',
    'standard_wpm'
  ] as const;
  const rows = samples.map((sample) => headers.map((header) => csvEscape(sample[header])).join(','));
  return [headers.join(','), ...rows].join('\n') + '\n';
}

export async function exportSessionRecord(
  session: PracticeSession,
  events: EventLogEntry[],
  writer: ExportWriter = exportSessionTextAtomic
): Promise<string> {
  const persistedSession = serializeSessionForPersistence(session);
  const bundle = buildSessionExportBundle(persistedSession, events);
  const index = buildSessionRecordIndex(persistedSession, bundle.directory, Object.keys(bundle.files));
  if (writer === exportSessionTextAtomic) {
    await exportSessionBundleAtomic(
      bundle.directory,
      Object.entries(bundle.files).map(([name, content]) => ({ name, content })),
      index
    );
    return bundle.directory;
  }
  for (const [name, content] of Object.entries(bundle.files)) {
    await writer(`${bundle.directory}/${name}`, content);
  }
  await writeRecordIndex(index);
  return bundle.directory;
}

export async function exportPracticeRecord(session: PracticeSession): Promise<void> {
  await exportSessionRecord(session, []);
}

export async function exportTypingRecord(
  sessionId: string,
  snapshot: TypingSnapshot,
  samples: TypingMinuteSample[],
  writer: ExportWriter = exportTextAtomic
): Promise<string> {
  const persistedSnapshot = serializeTypingSnapshotForPersistence(snapshot);
  const persistedSamples = samples.map(serializeTypingMinuteSampleForPersistence);
  const plan = buildTypingExportFiles(sessionId, persistedSnapshot, persistedSamples);
  const index = typingRecordIndex(
    sessionId,
    persistedSnapshot,
    plan.relativeBase,
    plan.files.map((file) => file.name)
  );
  if (writer === exportTextAtomic) {
    await exportTypingBundleAtomic(
      plan.relativeBase,
      plan.files.map(({ name, content }) => ({ name, content })),
      index
    );
    return plan.relativeBase;
  }
  for (const file of plan.files) {
    await writer(file.relativePath, file.content);
  }
  await writeRecordIndex(index);
  return plan.relativeBase;
}

export function buildTypingExportFiles(
  sessionId: string,
  snapshot: TypingSnapshot,
  samples: TypingMinuteSample[],
  month = typingSessionTimestamp(sessionId).slice(0, 7)
): TypingExportPlan {
  const relativeBase = `typing_records/${month}/${safeSegment(sessionId)}`;
  const persistedSnapshot = serializeTypingSnapshotForPersistence(snapshot);
  const persistedSamples = samples.map(serializeTypingMinuteSampleForPersistence);
  return {
    relativeBase,
    files: [
      {
        name: 'typing_summary.md',
        relativePath: `${relativeBase}/typing_summary.md`,
        content: buildTypingMarkdown(persistedSnapshot, persistedSamples)
      },
      {
        name: 'typing_session.json',
        relativePath: `${relativeBase}/typing_session.json`,
        content: JSON.stringify({ snapshot: persistedSnapshot, samples: persistedSamples }, null, 2)
      },
      {
        name: 'minute_samples.csv',
        relativePath: `${relativeBase}/minute_samples.csv`,
        content: typingSamplesToCsv(persistedSamples)
      },
      {
        name: 'final_text.txt',
        relativePath: `${relativeBase}/final_text.txt`,
        content: persistedSnapshot.text
      }
    ]
  };
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_');
}

export function buildSessionRecordIndex(
  session: PracticeSession,
  relativePath: string,
  fileNames: string[]
): LocalRecordSummary {
  const dynamic = isDynamicSession(session);
  return {
    record_id: `TOEFL:${session.session_id}`,
    record_type: 'TOEFL',
    session_id: session.session_id,
    package_id: session.package_id,
    created_at: session.created_at,
    mode: session.mode,
    profile_id: session.timing_profile_id,
    blueprint_id: session.blueprint_id,
    blueprint_version: session.blueprint_version,
    structure_mode: dynamic ? session.structure_mode : 'legacy_blueprint',
    section_item_counts: dynamic
      ? Object.fromEntries(session.dynamic_sections.map((section) => [section.section_id, section.item_ids.length]))
      : undefined,
    legacy_label: dynamic ? undefined : 'LEGACY V5',
    selected_sections: dynamic
      ? [...session.selected_sections]
      : [...new Set(session.questions.map((question) => question.section_id))],
    active_time_ms: session.active_ms,
    pause_time_ms: session.paused_ms,
    completion_status: session.completed_at ? 'COMPLETED' : 'INCOMPLETE',
    export_status: 'EXPORTED',
    schema_version: `practice-session-v${session.session_schema_version}`,
    app_version: APP_VERSION,
    directory_size_bytes: 0,
    relative_path: relativePath,
    file_names: fileNames
  };
}

function typingRecordIndex(
  sessionId: string,
  snapshot: TypingSnapshot,
  relativePath: string,
  fileNames: string[]
): LocalRecordSummary {
  return {
    record_id: `TYPING:${sessionId}`,
    record_type: 'TYPING',
    session_id: sessionId,
    created_at: typingSessionTimestamp(sessionId),
    selected_sections: [],
    active_time_ms: snapshot.active_ms,
    pause_time_ms: snapshot.paused_ms,
    completion_status: 'COMPLETED',
    export_status: 'EXPORTED',
    schema_version: 'typing-session-v1',
    app_version: APP_VERSION,
    directory_size_bytes: 0,
    relative_path: relativePath,
    file_names: fileNames
  };
}

function typingSessionTimestamp(sessionId: string): string {
  const raw = sessionId.startsWith('typing-') ? sessionId.slice('typing-'.length) : '';
  const epoch = /^\d+$/u.test(raw) ? Number(raw) : Number.NaN;
  const timestamp = new Date(epoch);
  return Number.isFinite(epoch) && Number.isFinite(timestamp.getTime())
    ? timestamp.toISOString()
    : new Date().toISOString();
}
