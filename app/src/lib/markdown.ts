import type { TypingMinuteSample, TypingSnapshot } from '../types';
import { formatDuration } from './timer';

export function escapeMarkdownTableCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

export function fenceText(value: string): string {
  return value.replace(/```/g, '`\\`\\`');
}

export function summarizeAnswer(answer: unknown): string {
  if (answer === null || answer === undefined || answer === '') return '—';
  if (Array.isArray(answer)) return answer.join(', ');
  if (typeof answer === 'object') return JSON.stringify(answer);
  return String(answer);
}

export function buildTypingMarkdown(snapshot: TypingSnapshot, samples: TypingMinuteSample[]): string {
  const lines: string[] = [
    '# TOEFL Typing Practice',
    '',
    `- Active Time: ${formatDuration(snapshot.active_ms)}`,
    `- Paused Time: ${formatDuration(snapshot.paused_ms)}`,
    `- Retained Letters: ${snapshot.retained_letters}`,
    `- Retained Words: ${snapshot.retained_words}`,
    `- Retained Characters (including spaces/newlines): ${snapshot.retained_characters}`,
    `- Retained Spaces: ${snapshot.retained_spaces}`,
    `- Retained Line Breaks: ${snapshot.retained_line_breaks}`,
    `- Keyboard Inserted Characters: ${snapshot.keyboard_inserted_characters}`,
    `- Keyboard Inserted Letters: ${snapshot.keyboard_inserted_letters}`,
    `- Deleted Characters: ${snapshot.deleted_characters}`,
    `- Deleted Letters: ${snapshot.deleted_letters}`,
    `- Pasted Characters: ${snapshot.pasted_characters}`,
    `- Pasted Letters: ${snapshot.pasted_letters}`,
    `- Retention Accuracy Proxy: ${snapshot.retention_accuracy.toFixed(2)}%`,
    `- Net CPM: ${snapshot.net_cpm.toFixed(2)}`,
    `- Gross CPM: ${snapshot.gross_cpm.toFixed(2)}`,
    `- Actual WPM: ${snapshot.actual_wpm.toFixed(2)}`,
    `- Standard WPM: ${snapshot.standard_wpm.toFixed(2)}`,
    '',
    '## Minute Trend',
    '',
    '| Active Minute | Characters Δ | Letters Δ | Words Δ | Deleted Chars Δ | Net CPM | Actual WPM | Accuracy Proxy |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|'
  ];

  for (const sample of samples) {
    lines.push(
      `| ${sample.active_minute_index} | ${sample.retained_characters_delta} | ${sample.retained_letters_delta} | ${sample.retained_words_delta} | ${sample.deleted_characters_delta} | ${sample.net_cpm.toFixed(2)} | ${sample.actual_wpm.toFixed(2)} | ${sample.retention_accuracy.toFixed(2)}% |`
    );
  }

  lines.push('', '## Final Text', '', '```text', fenceText(snapshot.text), '```', '');
  return lines.join('\n');
}
