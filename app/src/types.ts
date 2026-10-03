export type SectionName = 'Reading' | 'Listening' | 'Writing';
export type DynamicSectionName = SectionName;
export type SessionStructureMode = 'dynamic_manual';

export type DynamicItemRenderer = 'single_choice' | 'multiple_choice' | 'short_text' | 'long_text';

export interface DynamicItemTypeConfig {
  type_id: string;
  type_label: string;
  renderer: DynamicItemRenderer;
  option_labels: string[];
  custom_time_limit_ms: number | null;
  section_compatibility: DynamicSectionName[];
  created_by: 'system_preset' | 'user';
  version: string;
}

export type DynamicSectionStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED_EMPTY';

export interface DynamicSectionRuntime {
  section_id: DynamicSectionName;
  status: DynamicSectionStatus;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  next_item_ordinal: number;
  item_ids: string[];
  active_time_ms: number;
  pause_time_ms: number;
}

export type PracticeMode = 'practice' | 'exam_simulation';

export type SessionView = 'PRACTICE' | 'SESSION_SUMMARY';

export type RuntimeScopeId = SectionName;

export type QuestionProgressStatus =
  | 'NOT_ENCOUNTERED'
  | 'ENCOUNTERED_UNANSWERED'
  | 'PARTIALLY_ANSWERED'
  | 'ANSWERED';

// Kept as an alias so existing callers can migrate without losing their type name.
export type QuestionStatus = QuestionProgressStatus;

export type AnswerMode = DynamicItemRenderer;

export interface PracticeQuestion {
  id: string;
  section: SectionName;
  section_id: SectionName;
  module_id: RuntimeScopeId;
  number: number;
  type_label: string;
  answer_mode: AnswerMode;
  option_count?: number;
  time_limit_ms?: number | null;
  remaining_ms?: number | null;
  timer_limit_ms?: number | null;
  passage_group_id?: string;
  listening_group_id?: string;
  encountered: boolean;
  visit_count: number;
  first_seen_at?: string;
  last_entered_at?: string;
  /** schema v6 dynamic_manual identity/configuration. */
  item_id?: string;
  ordinal?: number;
  type_id?: string;
  renderer?: DynamicItemRenderer;
  option_labels?: string[];
  custom_time_limit_ms?: number | null;
  type_config?: DynamicItemTypeConfig;
  created_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  pause_time_ms?: number;
  writing_state?: DynamicWritingState;
}

export interface DynamicWritingState {
  text: string;
  word_count: number;
  character_count: number;
  keyboard_cpm: number;
  keyboard_inserted_characters: number;
  pasted_characters: number;
  deleted_characters: number;
  cut_count: number;
  paste_count: number;
  undo_count: number;
  redo_count: number;
  modification_count: number;
  undo_stack: string[];
  redo_stack: string[];
}

export interface DynamicPracticeItem extends PracticeQuestion {
  item_id: string;
  ordinal: number;
  section: DynamicSectionName;
  section_id: DynamicSectionName;
  module_id: DynamicSectionName;
  type_id: string;
  renderer: DynamicItemRenderer;
  option_labels: string[];
  custom_time_limit_ms: number | null;
  type_config: DynamicItemTypeConfig;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  pause_time_ms: number;
}

export type InputControlKind = 'single_choice_buttons' | 'multiple_choice_controls' | 'single_line_text' | 'multi_line_text';

export interface AnswerRecord {
  question_id: string;
  answer_value: unknown;
  progress_status: QuestionProgressStatus;
  /** Retained by the published v6 format. */
  status: QuestionProgressStatus;
  is_overtime: boolean;
  is_skipped: boolean;
  is_uncertain: boolean;
  first_answer_elapsed_ms?: number | null;
  final_answer_elapsed_ms?: number | null;
  first_answer_at?: string;
  active_time_ms: number;
  /** Retained by the published v6 format. */
  total_active_ms: number;
  modification_count: number;
  /** Retained by the published v6 format. */
  revision_count: number;
  /** Retained by the published v6 format. */
  marked_review: boolean;
  last_changed_at: string;
  /** Retained by the published v6 format. */
  updated_at: string;
}

export type WritingInputType =
  | 'insertText'
  | 'insertLineBreak'
  | 'insertCompositionText'
  | 'insertFromPaste'
  | 'deleteByCut'
  | 'deleteContentBackward'
  | 'deleteContentForward'
  | 'historyUndo'
  | 'historyRedo'
  | string;

export interface SessionNotice {
  kind: 'info' | 'warning' | 'error';
  message: string;
  messageKey?: string;
  messageValues?: Record<string, string | number>;
  questionIds?: string[];
  retryAction?:
    | 'EXPORT_SESSION'
    | 'CLEANUP_TERMINAL_RECOVERY'
    | 'CONFIRM_DYNAMIC_SECTION';
}

export interface PracticeSession {
  session_schema_version: number;
  structure_mode?: SessionStructureMode;
  session_id: string;
  package_id: string;
  /** source_path is invalid v6 input; retained here only for validation. */
  source_path?: string;
  /** Optional safe metadata retained by published v1.0.0 v6 records. */
  source_relative_path?: string;
  mode: PracticeMode;
  timing_profile_id: string;
  timing_profile_version: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  completed_sections?: SectionName[];
  selected_sections?: SectionName[];
  active_ms: number;
  paused_ms: number;
  unattributed_active_time_ms?: number;

  current_section_id: SectionName;
  current_module_id: RuntimeScopeId;
  current_scope_id: RuntimeScopeId;
  current_question_id: string;
  current_task_id: string | null;
  active_scope_question_ids: string[];
  active_module_question_ids: string[];
  active_section_question_ids: string[];
  all_session_question_ids: string[];

  /** Retained by the published v6 format. */
  current_section: SectionName;
  /** Retained by the published v6 format. */
  current_question_index: number;

  questions: PracticeQuestion[];
  answers: Record<string, AnswerRecord>;
  /** Empty collections retained by the published v6 format. */
  modules: never[];
  tasks: never[];
  dynamic_sections?: DynamicSectionRuntime[];
  item_type_registry?: DynamicItemTypeConfig[];
  view: SessionView;
}

export interface QuestionNavItem {
  id: string;
  index: number;
  label: string;
  section: SectionName;
  moduleId: RuntimeScopeId;
  number: number;
  status: QuestionProgressStatus;
  isCurrent: boolean;
  isUncertain: boolean;
  isMarked: boolean;
  isSkipped: boolean;
  isOvertime: boolean;
  isDisabled?: boolean;
  isLocked?: boolean;
  ariaCurrent?: 'true';
}

export interface EventLogEntry {
  session_id: string;
  seq: number;
  monotonic_elapsed_ms: number;
  wall_clock: string;
  event_type: string;
  payload: Record<string, unknown>;
  schema_version: string;
}

export interface TypingMinuteSample {
  active_minute_index: number | 'FINAL';
  timestamp: string;
  active_ms: number;
  retained_letters_cumulative: number;
  retained_letters_delta: number;
  retained_words_cumulative: number;
  retained_words_delta: number;
  retained_characters_cumulative: number;
  retained_characters_delta: number;
  keyboard_inserted_characters_cumulative: number;
  keyboard_inserted_characters_delta: number;
  keyboard_inserted_letters_cumulative: number;
  keyboard_inserted_letters_delta: number;
  deleted_characters_cumulative: number;
  deleted_characters_delta: number;
  deleted_letters_cumulative: number;
  deleted_letters_delta: number;
  pasted_characters_cumulative: number;
  pasted_characters_delta: number;
  pasted_letters_cumulative: number;
  pasted_letters_delta: number;
  retention_accuracy: number;
  net_cpm: number;
  gross_cpm: number;
  actual_wpm: number;
  standard_wpm: number;
}

export interface TypingSnapshot {
  text: string;
  active_ms: number;
  paused_ms: number;
  retained_letters: number;
  retained_words: number;
  retained_characters: number;
  retained_typed_characters: number;
  retained_spaces: number;
  retained_line_breaks: number;
  retained_typed_letters: number;
  keyboard_inserted_characters: number;
  keyboard_inserted_letters: number;
  deleted_characters: number;
  deleted_letters: number;
  pasted_characters: number;
  pasted_letters: number;
  paste_count: number;
  retention_accuracy: number;
  net_cpm: number;
  gross_cpm: number;
  actual_wpm: number;
  standard_wpm: number;
}
