import type { DynamicSectionName } from '../types';

export interface BuiltInBatch {
  id: string;
  section: DynamicSectionName;
  type_id: string;
  count: number;
  label_key: string;
}

export const BUILT_IN_BATCHES: readonly BuiltInBatch[] = [
  { id: 'reading_word_blank_10', section: 'Reading', type_id: 'reading_word_blank', count: 10, label_key: 'batch.readingWordBlank10' },
  { id: 'reading_academic_5', section: 'Reading', type_id: 'reading_academic_single_choice', count: 5, label_key: 'batch.academicReading5' },
  { id: 'listening_academic_lecture_4', section: 'Listening', type_id: 'listening_academic_lecture_single_choice', count: 4, label_key: 'batch.academicLecture4' },
  { id: 'writing_build_sentence_10', section: 'Writing', type_id: 'writing_build_sentence', count: 10, label_key: 'batch.buildSentence10' }
];

export function getBuiltInBatch(id: string): BuiltInBatch {
  const batch = BUILT_IN_BATCHES.find((entry) => entry.id === id);
  if (!batch) throw new Error(`Unknown built-in batch: ${id}`);
  return batch;
}
