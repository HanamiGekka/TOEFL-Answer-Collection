import type {
  AnswerRecord,
  EventLogEntry,
  PracticeQuestion,
  PracticeSession,
  QuestionProgressStatus
} from '../types';
import { APP_VERSION } from '../constants';
import { renderQuestionState } from './answerState';
import { escapeMarkdownTableCell, fenceText, summarizeAnswer } from './markdown';
import { getQuestionProgressStatus } from './sessionEngine';
import { formatDuration } from './timer';
import { serializeEventForPersistence, serializeSessionForPersistence } from './persistedTime';
import {
  DYNAMIC_SECTION_ORDER,
  isDynamicSession,
  type DynamicPracticeSession
} from './dynamicSession';


export interface SessionExportBundle {
  directory: string;
  files: Record<string, string>;
}

export interface SessionMetrics {
  answered: number;
  unanswered: number;
  skipped: number;
  uncertain: number;
  overtime: number;
  encounteredUnanswered: number;
  partiallyAnswered: number;
}

export function buildSessionExportDirectory(session: PracticeSession): string {
  const createdAt = new Date(session.created_at);
  const safeDate = Number.isNaN(createdAt.valueOf()) ? new Date(0) : createdAt;
  const timestamp = [
    safeDate.getFullYear().toString().padStart(4, '0'),
    (safeDate.getMonth() + 1).toString().padStart(2, '0'),
    safeDate.getDate().toString().padStart(2, '0')
  ].join('-') +
    '_' +
    [
      safeDate.getHours().toString().padStart(2, '0'),
      safeDate.getMinutes().toString().padStart(2, '0'),
      safeDate.getSeconds().toString().padStart(2, '0')
    ].join('-');
  return `records/${safePathSegment(session.package_id)}/${timestamp}_${safePathSegment(session.session_id)}`;
}

export function buildSessionExportBundle(
  session: PracticeSession,
  events: EventLogEntry[]
): SessionExportBundle {
  const normalized = serializeSessionForPersistence(session);
  const normalizedEvents = events.map(serializeEventForPersistence);
  if (!isDynamicSession(normalized)) throw new Error('UNSUPPORTED_SESSION_SCHEMA');
  return buildDynamicSessionExportBundle(normalized, normalizedEvents);
}

function buildDynamicSessionExportBundle(
  session: DynamicPracticeSession,
  events: EventLogEntry[]
): SessionExportBundle {
  const files: Record<string, string> = {
    'session_summary.md': buildDynamicSessionSummaryMarkdown(session, events),
    'answers.json': JSON.stringify(buildDynamicAnswersDocument(session), null, 2),
    'events.jsonl': events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''),
    'item_metrics.csv': buildDynamicItemMetricsCsv(session),
    'section_metrics.csv': buildDynamicSectionMetricsCsv(session)
  };
  for (const section of session.selected_sections) {
    files[`${section}.md`] = buildDynamicSectionMarkdown(session, section);
  }
  return { directory: buildSessionExportDirectory(session), files };
}

function buildDynamicAnswersDocument(session: DynamicPracticeSession): Record<string, unknown> {
  return {
    schema_version: 'practice-session-v6',
    app_version: APP_VERSION,
    structure_mode: session.structure_mode,
    session_id: session.session_id,
    package_id: session.package_id,
    mode: session.mode,
    selected_sections: [...session.selected_sections],
    started_at: session.started_at ?? session.created_at,
    ended_at: session.completed_at ?? null,
    active_time_ms: session.active_ms,
    pause_time_ms: session.paused_ms,
    unattributed_active_time_ms: session.unattributed_active_time_ms ?? 0,
    current_section_id: session.current_section_id,
    current_item_id: session.current_question_id || null,
    sections: session.dynamic_sections.map((section) => ({
      section_id: section.section_id,
      status: section.status,
      created_item_count: section.item_ids.length,
      next_item_ordinal: section.next_item_ordinal,
      item_ids: [...section.item_ids],
      active_time_ms: section.active_time_ms,
      pause_time_ms: section.pause_time_ms,
      created_at: section.created_at,
      started_at: section.started_at,
      completed_at: section.completed_at
    })),
    item_type_registry: session.item_type_registry.map((config) => ({
      type_id: config.type_id,
      type_label: config.type_label,
      renderer: config.renderer,
      option_labels: [...config.option_labels],
      custom_time_limit_ms: config.custom_time_limit_ms,
      section_compatibility: [...config.section_compatibility],
      created_by: config.created_by,
      version: config.version
    })),
    items: orderedDynamicItems(session).map((item) => {
      const answer = session.answers[item.id];
      return {
        item_id: item.id,
        ordinal: item.ordinal,
        section_id: item.section_id,
        type_id: item.type_id,
        type_label: item.type_label,
        renderer: item.renderer,
        option_labels: [...(item.option_labels ?? [])],
        answer: answer?.answer_value ?? null,
        progress: getQuestionProgressStatus(item, answer),
        flags: {
          skipped: answer?.is_skipped ?? false,
          uncertain: answer?.is_uncertain ?? false,
          overtime: answer?.is_overtime ?? false
        },
        custom_time_limit_ms: item.custom_time_limit_ms ?? null,
        timing: {
          active_time_ms: answer?.active_time_ms ?? 0,
          pause_time_ms: item.pause_time_ms ?? 0,
          first_answer_elapsed_ms: answer?.first_answer_elapsed_ms ?? null,
          final_answer_elapsed_ms: answer?.final_answer_elapsed_ms ?? null,
          answer_change_count: answer?.modification_count ?? 0
        },
        lifecycle: {
          created_at: item.created_at ?? null,
          started_at: item.started_at ?? null,
          first_seen_at: item.first_seen_at ?? null,
          last_entered_at: item.last_entered_at ?? null,
          completed_at: item.completed_at ?? null
        },
        writing_metrics: item.writing_state ? {
          word_count: item.writing_state.word_count,
          character_count: item.writing_state.character_count,
          keyboard_cpm: item.writing_state.keyboard_cpm,
          keyboard_inserted_characters: item.writing_state.keyboard_inserted_characters,
          pasted_characters: item.writing_state.pasted_characters,
          deleted_characters: item.writing_state.deleted_characters,
          cut_count: item.writing_state.cut_count,
          paste_count: item.writing_state.paste_count,
          undo_count: item.writing_state.undo_count,
          redo_count: item.writing_state.redo_count,
          modification_count: item.writing_state.modification_count
        } : undefined
      };
    })
  };
}

function buildDynamicItemMetricsCsv(session: DynamicPracticeSession): string {
  const header = [
    'session_id', 'package_id', 'section_id', 'item_id', 'ordinal', 'type_id', 'type_label',
    'renderer', 'option_count', 'answered', 'skipped', 'uncertain', 'overtime', 'active_time_ms',
    'pause_time_ms', 'first_answer_elapsed_ms', 'final_answer_elapsed_ms', 'answer_change_count'
  ];
  const rows = orderedDynamicItems(session).map((item) => {
    const answer = session.answers[item.id];
    return [
      session.session_id,
      session.package_id,
      item.section_id,
      item.id,
      item.ordinal,
      item.type_id,
      item.type_label,
      item.renderer,
      item.option_labels?.length ?? 0,
      getQuestionProgressStatus(item, answer) === 'ANSWERED' ||
        getQuestionProgressStatus(item, answer) === 'PARTIALLY_ANSWERED',
      answer?.is_skipped ?? false,
      answer?.is_uncertain ?? false,
      answer?.is_overtime ?? false,
      answer?.active_time_ms ?? 0,
      item.pause_time_ms ?? 0,
      answer?.first_answer_elapsed_ms ?? '',
      answer?.final_answer_elapsed_ms ?? '',
      answer?.modification_count ?? 0
    ].map(csvEscape).join(',');
  });
  return [header.join(','), ...rows].join('\n') + '\n';
}

function buildDynamicSectionMetricsCsv(session: DynamicPracticeSession): string {
  const header = [
    'session_id', 'package_id', 'section_id', 'status', 'created_item_count', 'answered_item_count',
    'skipped_item_count', 'uncertain_item_count', 'overtime_item_count', 'active_time_ms', 'pause_time_ms'
  ];
  const rows = session.dynamic_sections.map((section) => {
    const items = section.item_ids.map((itemId) => session.questions.find((item) => item.id === itemId)!)
      .filter(Boolean);
    const answers = section.item_ids.map((itemId) => session.answers[itemId]);
    return [
      session.session_id,
      session.package_id,
      section.section_id,
      section.status,
      items.length,
      items.filter((item) => {
        const status = getQuestionProgressStatus(item, session.answers[item.id]);
        return status === 'ANSWERED' || status === 'PARTIALLY_ANSWERED';
      }).length,
      answers.filter((answer) => answer?.is_skipped).length,
      answers.filter((answer) => answer?.is_uncertain).length,
      answers.filter((answer) => answer?.is_overtime).length,
      section.active_time_ms,
      section.pause_time_ms
    ].map(csvEscape).join(',');
  });
  return [header.join(','), ...rows].join('\n') + '\n';
}

function buildDynamicSessionSummaryMarkdown(
  session: DynamicPracticeSession,
  events: EventLogEntry[]
): string {
  const lines = [
    '# TOEFL Dynamic Session Summary',
    '',
    `- Training name: ${session.package_id}`,
    `- Mode: ${session.mode}`,
    `- Session ID: ${session.session_id}`,
    `- Structure: ${session.structure_mode}`,
    `- Started: ${session.started_at ?? session.created_at}`,
    `- Ended: ${session.completed_at ?? 'Incomplete'}`,
    `- Session active: ${formatDuration(session.active_ms)}`,
    `- Session pause: ${formatDuration(session.paused_ms)}`,
    '',
    '## Sections',
    '',
    '| Section | Status | Created | Answered | Skipped | Uncertain | Overtime | Active | Pause |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|'
  ];
  for (const section of session.dynamic_sections) {
    const items = section.item_ids.map((id) => session.questions.find((item) => item.id === id)!).filter(Boolean);
    const answers = section.item_ids.map((id) => session.answers[id]);
    lines.push(
      `| ${section.section_id} | ${section.status} | ${items.length} | ${items.filter((item) => ['ANSWERED', 'PARTIALLY_ANSWERED'].includes(getQuestionProgressStatus(item, session.answers[item.id]))).length} | ${answers.filter((answer) => answer?.is_skipped).length} | ${answers.filter((answer) => answer?.is_uncertain).length} | ${answers.filter((answer) => answer?.is_overtime).length} | ${formatDuration(section.active_time_ms)} | ${formatDuration(section.pause_time_ms)} |`
    );
  }
  const counts = new Map<string, number>();
  for (const item of orderedDynamicItems(session)) {
    const key = `${item.renderer} / ${item.type_label}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  lines.push('', '## Item Types', '', '| Renderer / Type | Count |', '|---|---:|');
  if (counts.size === 0) lines.push('| None | 0 |');
  for (const [label, count] of counts) {
    lines.push(`| ${escapeMarkdownTableCell(label)} | ${count} |`);
  }
  lines.push(
    '',
    '## Data Integrity',
    '',
    `- Session schema: v${session.session_schema_version}`,
    `- App version: ${APP_VERSION}`,
    `- Dynamic Items: ${session.questions.length}`,
    `- Events: ${events.length}`,
    '- This export contains user-entered answers, state, configuration labels, and timing only; no source material or scoring reference is included.',
    ''
  );
  return lines.join('\n');
}

function buildDynamicSectionMarkdown(
  session: DynamicPracticeSession,
  sectionId: DynamicPracticeSession['selected_sections'][number]
): string {
  const section = session.dynamic_sections.find((candidate) => candidate.section_id === sectionId);
  const items = section?.item_ids.map((id) => session.questions.find((item) => item.id === id)!).filter(Boolean) ?? [];
  const lines = [
    `# ${sectionId} Answer Record`,
    '',
    `- Status: ${section?.status ?? 'NOT_STARTED'}`,
    `- Created Items: ${items.length}`,
    `- Active: ${formatDuration(section?.active_time_ms ?? 0)}`,
    `- Pause: ${formatDuration(section?.pause_time_ms ?? 0)}`,
    ''
  ];
  if (items.length === 0) lines.push('No Items were created.', '');
  for (const item of items) {
    const answer = session.answers[item.id];
    const state = renderAnswerState(getQuestionProgressStatus(item, answer), answer);
    lines.push(
      `## ${item.id} · ${item.type_label}`,
      '',
      `Renderer: ${item.renderer}`,
      `Status: ${state}`,
      `Active: ${formatDuration(answer?.active_time_ms ?? 0)}`,
      `Pause: ${formatDuration(item.pause_time_ms ?? 0)}`
    );
    if (item.renderer === 'long_text') {
      lines.push('', 'Answer:', '', '```text', fenceText(String(answer?.answer_value ?? '')), '```', '');
    } else {
      lines.push(`Answer: ${summarizeAnswer(answer?.answer_value)}`, '');
    }
  }
  lines.push('> This file contains user-entered answers, state, type labels, and timing only.', '');
  return lines.join('\n');
}

function orderedDynamicItems(session: DynamicPracticeSession): PracticeQuestion[] {
  const byId = new Map(session.questions.map((item) => [item.id, item]));
  return DYNAMIC_SECTION_ORDER.flatMap((sectionId) => {
    const section = session.dynamic_sections.find((candidate) => candidate.section_id === sectionId);
    return section?.item_ids.map((itemId) => byId.get(itemId)!).filter(Boolean) ?? [];
  });
}

export function summarizeSession(session: PracticeSession): SessionMetrics {
  const statuses = session.questions.map((question) => ({
    status: getQuestionProgressStatus(question, session.answers[question.id]),
    answer: session.answers[question.id],
    encountered: question.encountered
  }));
  return {
    answered: statuses.filter(({ status }) => status === 'ANSWERED' || status === 'PARTIALLY_ANSWERED').length,
    unanswered: statuses.filter(
      ({ status }) => status === 'NOT_ENCOUNTERED' || status === 'ENCOUNTERED_UNANSWERED'
    ).length,
    skipped: statuses.filter(({ answer }) => answer?.is_skipped).length,
    uncertain: statuses.filter(({ answer }) => answer?.is_uncertain).length,
    overtime: statuses.filter(({ answer }) => answer?.is_overtime).length,
    encounteredUnanswered: statuses.filter(
      ({ status, encountered }) => encountered && status === 'ENCOUNTERED_UNANSWERED'
    ).length,
    partiallyAnswered: statuses.filter(({ status }) => status === 'PARTIALLY_ANSWERED').length
  };
}

function renderAnswerState(status: QuestionProgressStatus, answer?: AnswerRecord): string {
  return renderQuestionState(status, {
    isSkipped: answer?.is_skipped ?? false,
    isUncertain: answer?.is_uncertain ?? false,
    isOvertime: answer?.is_overtime ?? false
  });
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function safePathSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+$/, '_');
  return sanitized || '_';
}
