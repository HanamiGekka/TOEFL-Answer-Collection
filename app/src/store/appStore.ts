import { create } from 'zustand';
import type {
  DynamicItemTypeConfig,
  DynamicSectionName,
  EventLogEntry,
  PackageSummary,
  PracticeMode,
  PracticeSession,
  SectionName,
  SessionNotice,
  SpeakingTaskOutcome,
  WritingInputType
} from '../types';
import {
  advanceFromCurrent,
  canNavigateBackward,
  canNavigateToQuestion,
  createEvent,
  enterQuestion,
  finalizeCurrentScope as finalizeScope,
  finalizeQuestion,
  getCurrentModule,
  getCurrentQuestion,
  markUncertain,
  previousQuestionInSession,
  shouldQuestionBeOvertime,
  skipAndAdvance,
  skipQuestion,
  upsertAnswer
} from '../lib/sessionEngine';
import {
  appendEvent,
  cleanupTerminalRecovery,
  getAppSetting,
  getRecoveryEventSeq,
  loadBlueprintOverride,
  loadRecoveryEvents,
  loadRecoverySnapshot,
  openSessionExportDirectory,
  saveAppSetting,
  saveSessionSnapshot,
  scanPackages
} from '../lib/storage';
import type { PersistenceReason } from '../lib/storage';
import { exportSessionRecord } from '../lib/exporters';
import { NEW_SESSION_SECTION_ORDER, SCHEMA_VERSION } from '../constants';
import { serializeSessionForPersistence } from '../lib/persistedTime';
import {
  applyDerivedTiming,
  createActivityTimer,
  currentPausedMs,
  deriveTimingLedger,
  pauseActivityTimer,
  previewActivityDelta,
  resumeActivityTimer,
  settleActivityTimer,
  startActivity,
  type ActivityTimer
} from '../lib/timeLedger';
import {
  addCurrentTaskPause,
  advanceAfterSpeakingTask,
  applyTaskActivityDelta,
  enterTask,
  getCurrentTask,
  getTaskTimingState,
  getListenRepeatGroupTiming,
  isLongWritingTask,
  markTaskOvertimeEventRecorded,
  markSpeakingTask,
  MINIMUM_SPEAKING_TRANSITION_GUARD_MS,
  pauseCurrentTask,
  redoWritingText as redoWritingTextInSession,
  resumeCurrentTask,
  retrySpeakingTask,
  speakingRetryTaskIdsInCurrentScope,
  startSpeakingTask,
  taskIdForQuestion,
  undoWritingText as undoWritingTextInSession,
  updateWritingText as updateWritingTextInSession
} from '../lib/taskRuntime';
import {
  DEFAULT_BLUEPRINT,
  mergeBlueprintOverride,
  validateBlueprint,
  type ToeflBlueprint
} from '../lib/blueprint';
import { prepareRecoverySession } from '../lib/recovery';
import {
  defaultShortcutBindings,
  migrateShortcutBindings,
  validateShortcutBindings,
  type ShortcutBindings
} from '../lib/shortcutRegistry';
import type { PreCloseRuntimeState, WindowClosePhase } from '../lib/windowClose';
import { sanitizeWritingText } from '../lib/writingTextPolicy';
import {
  changeDynamicItemType,
  addDynamicPauseTime,
  createDynamicItem,
  createDynamicItemBatch,
  createDynamicSession,
  enterDynamicItem,
  finishDynamicSection,
  getDynamicNextAction,
  isDynamicSession,
  previousDynamicItem,
  redoDynamicWritingText,
  reopenDynamicSection as reopenDynamicSectionRuntime,
  undoDynamicWritingText,
  updateDynamicWritingText,
  type DynamicPracticeSession
} from '../lib/dynamicSession';
import type { DynamicBatchBlock } from '../lib/dynamicSession';
import { EMPTY_ITEM_TEMPLATES, canonicalTemplateRecipe, creationRecipeFromBlocks, normalizeTemplateName, parseItemTemplates, resolveTemplateBlocks, validateItemTemplate, type ItemBatchTemplate, type ItemBatchTemplateCollection, type ItemTemplateBlock } from '../lib/itemTemplate';

export interface DynamicItemDialogState {
  mode: 'create' | 'edit';
  section_id: DynamicSectionName;
  ordinal: number;
  item_id?: string;
}

type RuntimeTimer = ActivityTimer;

let persistenceRequested: PersistenceReason | undefined;
let persistenceInFlight: Promise<void> | undefined;
let eventPersistenceTail: Promise<void> = Promise.resolve();
let eventPersistenceFailure: string | undefined;

export interface AppState {
  packages: PackageSummary[];
  packageLoadError?: string;
  blueprint: ToeflBlueprint;
  blueprintStatus: 'ready' | 'loading' | 'error';
  blueprintErrors: string[];
  blueprintOverridePackageId?: string;
  shortcutBindings: ShortcutBindings;
  selectedPackage?: PackageSummary;
  mode: PracticeMode;
  selectedSections: SectionName[];
  session?: PracticeSession;
  events: EventLogEntry[];
  eventSeq: number;
  timer?: RuntimeTimer;
  activeMs: number;
  pausedMs: number;
  questionActiveMs: number;
  scopeActiveMs: number;
  taskActiveMs: number;
  taskRemainingMs: number | null;
  speakingTransitionPending: boolean;
  speakingTransitionGuardUntil: number;
  speakingTransitionGuardTaskId?: string;
  speakingTransitionGuardAttempt?: number;
  isPaused: boolean;
  hideTimes: boolean;
  navigationLockedUntil: number;
  windowClosePhase: WindowClosePhase;
  preCloseRuntimeState?: PreCloseRuntimeState;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  saveError?: string;
  exportStatus: 'idle' | 'exporting' | 'exported' | 'error';
  exportError?: string;
  exportDirectory?: string;
  sessionNotice?: SessionNotice;
  dynamicItemDialog?: DynamicItemDialogState;
  batchPending: boolean;
  itemTemplates: ItemBatchTemplateCollection;
  itemTemplateError?: { key: string; values?: Record<string, string> };
  itemTemplateSaveError?: { key: string; values?: Record<string, string> };
  templateMutationPending: boolean;
  lastCreationOperations: Partial<Record<DynamicSectionName, ItemTemplateBlock[]>>;
  initialize: () => Promise<void>;
  selectPackage: (packageId: string) => void;
  saveShortcutBindings: (bindings: ShortcutBindings) => Promise<boolean>;
  setMode: (mode: PracticeMode) => void;
  toggleSection: (section: SectionName) => void;
  startSession: () => void;
  openDynamicItemCreator: () => void;
  openDynamicItemEditor: () => void;
  cancelDynamicItemDialog: () => void;
  createDynamicItemFromConfig: (config: DynamicItemTypeConfig) => void;
  createDynamicBatch: (blocks: DynamicBatchBlock[]) => Promise<boolean>;
  loadItemTemplates: () => Promise<void>;
  saveItemTemplate: (template: ItemBatchTemplate, mode?: 'create' | 'update') => Promise<boolean>;
  deleteItemTemplate: (templateId: string) => Promise<boolean>;
  repeatDynamicCreationOperation: () => Promise<boolean>;
  changeDynamicItemTypeFromConfig: (config: DynamicItemTypeConfig, confirmClear?: boolean) => boolean;
  finishDynamicCurrentSection: (confirmed?: boolean) => Promise<void>;
  reopenDynamicSection: (section: DynamicSectionName) => void;
  recoverSession: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
  tick: () => void;
  togglePause: () => void;
  answerCurrent: (answer: unknown) => void;
  updateWritingText: (text: string, inputType: WritingInputType) => void;
  undoWritingText: () => boolean;
  redoWritingText: () => boolean;
  updateWritingAnswerFromHistory: (text: string, inputType: 'historyUndo' | 'historyRedo') => boolean;
  updateDynamicLongText: (text: string, inputType: WritingInputType) => void;
  undoDynamicLongText: () => boolean;
  redoDynamicLongText: () => boolean;
  startSpeakingCurrent: () => Promise<void>;
  markSpeakingCurrent: (outcome: SpeakingTaskOutcome) => Promise<void>;
  advanceSpeakingCurrent: () => Promise<void>;
  retrySpeakingCurrent: () => Promise<void>;
  skipCurrent: () => void;
  nextQuestion: () => void;
  finalizeCurrentScope: (options?: { allowSpeakingRetries?: boolean }) => Promise<void>;
  finalizeCurrentModule: () => Promise<void>;
  goToFirstSpeakingRetry: () => void;
  confirmFinalizeWithSpeakingRetries: () => Promise<void>;
  previousQuestion: () => void;
  goToQuestion: (index: number) => void;
  goToFirstUnencountered: () => void;
  toggleReview: () => void;
  toggleHideTimes: () => void;
  dismissSessionNotice: () => void;
  exportSession: () => Promise<void>;
  retryTerminalRecoveryCleanup: () => Promise<void>;
  openCurrentExportDirectory: () => Promise<void>;
  returnHome: () => void;
  beginWindowCloseHold: () => PreCloseRuntimeState;
  cancelWindowCloseHold: (state: PreCloseRuntimeState) => void;
  setWindowClosePhase: (phase: WindowClosePhase) => void;
  persist: (reason?: PersistenceReason) => Promise<void>;
}

let answerAutosaveTimer: number | undefined;

export const useAppStore = create<AppState>((set, get) => ({
  packages: [],
  blueprint: DEFAULT_BLUEPRINT,
  blueprintStatus: 'ready',
  blueprintErrors: [],
  blueprintOverridePackageId: undefined,
  shortcutBindings: defaultShortcutBindings(),
  events: [],
  eventSeq: 0,
  mode: 'practice',
  selectedSections: ['Reading', 'Listening', 'Writing'],
  activeMs: 0,
  pausedMs: 0,
  questionActiveMs: 0,
  scopeActiveMs: 0,
  taskActiveMs: 0,
  taskRemainingMs: null,
  speakingTransitionPending: false,
  speakingTransitionGuardUntil: 0,
  isPaused: false,
  hideTimes: false,
  navigationLockedUntil: 0,
  windowClosePhase: 'IDLE',
  preCloseRuntimeState: undefined,
  saveStatus: 'idle',
  saveError: undefined,
  exportStatus: 'idle',
  dynamicItemDialog: undefined,
  batchPending: false,
  itemTemplates: EMPTY_ITEM_TEMPLATES,
  itemTemplateError: undefined,
  itemTemplateSaveError: undefined,
  templateMutationPending: false,
  lastCreationOperations: {},

  async initialize() {
    let packages: PackageSummary[] = [];
    let packageLoadError: string | undefined;
    try {
      packages = await scanPackages();
    } catch (error) {
      packageLoadError = String(error);
    }
    try {
      let savedShortcuts: Partial<ShortcutBindings> | undefined;
      try {
        savedShortcuts = await getAppSetting<Partial<ShortcutBindings>>('shortcuts');
      } catch {
        // Keep safe defaults available while the path recovery UI is being used.
      }
      const shortcuts = migrateShortcutBindings(savedShortcuts);
      const shortcutBindings = validateShortcutBindings(shortcuts).ok ? shortcuts : defaultShortcutBindings();
      set({
        packages,
        selectedPackage: packages[0],
        shortcutBindings,
        packageLoadError,
        blueprintStatus: 'ready',
        blueprintErrors: [],
        blueprintOverridePackageId: undefined,
        lastCreationOperations: {}
      });
      await get().loadItemTemplates();
    } catch (error) {
      set({ packages, selectedPackage: packages[0], packageLoadError: packageLoadError ?? String(error) });
    }
  },

  selectPackage(packageId) {
    const selected = get().packages.find((item) => item.package_id === packageId);
    if (!selected) return;
    set({
      selectedPackage: selected,
      blueprintStatus: 'ready',
      blueprintErrors: [],
      blueprintOverridePackageId: undefined
    });
  },

  async saveShortcutBindings(bindings) {
    const migrated = migrateShortcutBindings(bindings);
    const validation = validateShortcutBindings(migrated);
    if (!validation.ok) return false;
    await saveAppSetting('shortcuts', migrated);
    set({ shortcutBindings: migrated });
    return true;
  },

  setMode(mode) {
    set({ mode });
  },

  toggleSection(section) {
    if (section === 'Speaking') return;
    set((state) => {
      const selected = state.selectedSections.includes(section)
        ? state.selectedSections.filter((item) => item !== section)
        : [...state.selectedSections, section];
      return { selectedSections: selected.length === 0 ? [section] : selected };
    });
  },

  startSession() {
    const state = get();
    const selectedPackage = state.selectedPackage;
    if (!selectedPackage) return;
    if (answerAutosaveTimer !== undefined && typeof window !== 'undefined') {
      window.clearTimeout(answerAutosaveTimer);
      answerAutosaveTimer = undefined;
    }
    const now = new Date().toISOString();
    const selectedSet = new Set(get().selectedSections);
    const selectedSections = NEW_SESSION_SECTION_ORDER.filter((section) => selectedSet.has(section));
    const sessionId = `${selectedPackage.package_id}-${Date.now()}`;
    const runtimeSession = createDynamicSession({
      session_id: sessionId,
      package_id: selectedPackage.package_id,
      source_relative_path: selectedPackage.source_relative_path ?? selectedPackage.package_id,
      mode: get().mode,
      created_at: now,
      selected_sections: selectedSections
    });
    set({
      session: runtimeSession,
      lastCreationOperations: {},
      events: [],
      eventSeq: 0,
      activeMs: 0,
      pausedMs: 0,
      questionActiveMs: 0,
      scopeActiveMs: 0,
      taskActiveMs: 0,
      taskRemainingMs: null,
      speakingTransitionPending: false,
      speakingTransitionGuardUntil: 0,
      speakingTransitionGuardTaskId: undefined,
      speakingTransitionGuardAttempt: undefined,
      isPaused: false,
      navigationLockedUntil: 0,
      windowClosePhase: 'IDLE',
      preCloseRuntimeState: undefined,
      sessionNotice: undefined,
      dynamicItemDialog: undefined,
      saveStatus: 'idle',
      saveError: undefined,
      exportStatus: 'idle',
      exportError: undefined,
      exportDirectory: undefined,
      timer: undefined
    });
    recordEvent('session_started', {
      schema_version: SCHEMA_VERSION,
      session_schema_version: 6,
      structure_mode: 'dynamic_manual',
      selected_sections: selectedSections
    });
    void get().persist();
  },

  openDynamicItemCreator() {
    const state = get();
    if (isInteractionFrozen(state) || !state.session || !isDynamicSession(state.session)) return;
    const section = state.session.dynamic_sections.find((item) => item.section_id === state.session?.current_section_id);
    if (!section || section.status === 'COMPLETED' || section.status === 'SKIPPED_EMPTY') return;
    set({
      dynamicItemDialog: {
        mode: 'create',
        section_id: section.section_id,
        ordinal: section.next_item_ordinal
      }
    });
  },

  openDynamicItemEditor() {
    const state = get();
    if (isInteractionFrozen(state) || !state.session || !isDynamicSession(state.session)) return;
    const item = getCurrentQuestion(state.session);
    if (!item) return;
    set({
      dynamicItemDialog: {
        mode: 'edit',
        section_id: item.section_id as DynamicSectionName,
        ordinal: item.number,
        item_id: item.id
      }
    });
  },

  cancelDynamicItemDialog() {
    if (get().batchPending) return;
    set({ dynamicItemDialog: undefined });
  },

  async loadItemTemplates() {
    try {
      const raw = await getAppSetting<unknown>('item_templates');
      const parsed = parseItemTemplates(raw);
      set({ itemTemplates: parsed.collection, itemTemplateError: parsed.error ? { key: 'template.corruptStorage', values: { detail: parsed.error } } : undefined, itemTemplateSaveError: undefined });
    } catch (error) {
      set({ itemTemplates: { schema_version: 1, templates: [] }, itemTemplateError: { key: 'template.readFailed', values: { detail: String(error) } } });
    }
  },

  async saveItemTemplate(template, mode = 'create') {
    const state = get();
    if (state.itemTemplateError || state.templateMutationPending) return false;
    const validation = validateItemTemplate(template);
    if (!validation.ok) { set({ itemTemplateSaveError: { key: 'template.invalid', values: { detail: validation.errors.join(' ') } } }); return false; }
    const existing = state.itemTemplates.templates.find((entry) => entry.template_id === template.template_id);
    if (mode === 'update' && (!existing || existing.section !== template.section)) {
      set({ itemTemplateSaveError: { key: 'template.updateMissing' } });
      return false;
    }
    if (mode === 'create' && existing) {
      set({ itemTemplateSaveError: { key: 'template.duplicateId' } });
      return false;
    }
    const others = state.itemTemplates.templates.filter((entry) => entry.template_id !== (mode === 'update' ? template.template_id : ''));
    if (others.some((entry) => entry.section === template.section && normalizeTemplateName(entry.name) === normalizeTemplateName(template.name))) {
      set({ itemTemplateSaveError: { key: 'template.duplicateName' } });
      return false;
    }
    const recipe = canonicalTemplateRecipe(template.blocks);
    const duplicate = others.find((entry) => entry.section === template.section && canonicalTemplateRecipe(entry.blocks) === recipe);
    if (duplicate) {
      set({ itemTemplateSaveError: { key: 'template.duplicateRecipe', values: { name: duplicate.name } } });
      return false;
    }
    const collection: ItemBatchTemplateCollection = { schema_version: 1, templates: mode === 'create'
      ? [...state.itemTemplates.templates, template]
      : state.itemTemplates.templates.map((entry) => entry.template_id === template.template_id ? template : entry) };
    set({ templateMutationPending: true });
    try {
      await saveAppSetting('item_templates', collection);
      set({ itemTemplates: collection, itemTemplateSaveError: undefined });
      return true;
    } catch (error) {
      set({ itemTemplateSaveError: { key: 'template.saveError', values: { detail: String(error) } } });
      return false;
    } finally {
      set({ templateMutationPending: false });
    }
  },

  async deleteItemTemplate(templateId) {
    const state = get();
    if (state.itemTemplateError || state.templateMutationPending) return false;
    const collection: ItemBatchTemplateCollection = { schema_version: 1, templates: state.itemTemplates.templates.filter((entry) => entry.template_id !== templateId) };
    set({ templateMutationPending: true });
    try {
      await saveAppSetting('item_templates', collection);
      set({ itemTemplates: collection, itemTemplateSaveError: undefined });
      return true;
    } catch (error) {
      set({ itemTemplateSaveError: { key: 'template.deleteError', values: { detail: String(error) } } });
      return false;
    } finally {
      set({ templateMutationPending: false });
    }
  },

  async createDynamicBatch(blocks) {
    const state = get();
    if (state.batchPending || !state.session || !isDynamicSession(state.session) || state.dynamicItemDialog?.mode !== 'create') return false;
    set({ batchPending: true });
    try {
      const now = nowMonotonic();
      const settled = state.timer ? settleCurrentActivity(state, now) : undefined;
      const sourceSession = (settled?.session ?? state.session) as DynamicPracticeSession;
      const created = createDynamicItemBatch(sourceSession, state.dynamicItemDialog.section_id, blocks);
      const timer = settled?.timer
        ? startActivity(settled.timer, created.first_item.item_id, now)
        : createActivityTimer(created.first_item.item_id, now, state.pausedMs);
      const session = applyDerivedTiming(created.session);
      set({ session, timer, ...calculateLiveTimingState(session, timer, now), dynamicItemDialog: undefined, sessionNotice: undefined,
        lastCreationOperations: { ...state.lastCreationOperations,
          [state.dynamicItemDialog.section_id]: creationRecipeFromBlocks(blocks) } });
      created.items.forEach((item, index) => recordEvent('item_created', {
        section_id: item.section_id, item_id: item.item_id, ordinal: item.ordinal,
        type_id: item.type_id, renderer: item.renderer, batch_id: created.batch_id,
        batch_index: index + 1, batch_size: created.items.length
      }));
      recordEvent('batch_created', { batch_id: created.batch_id, section_id: state.dynamicItemDialog.section_id,
        count: created.items.length, first_item_id: created.items[0].id, last_item_id: created.items.at(-1)!.id });
      recordQuestionEntered(created.first_item.item_id, 'batch_created');
      await get().persist();
      return true;
    } finally {
      set({ batchPending: false });
    }
  },

  createDynamicItemFromConfig(config) {
    const state = get();
    if (state.batchPending || !state.session || !isDynamicSession(state.session) || state.dynamicItemDialog?.mode !== 'create') return;
    const now = nowMonotonic();
    const settled = state.timer ? settleCurrentActivity(state, now) : undefined;
    const sourceSession = (settled?.session ?? state.session) as DynamicPracticeSession;
    const created = createDynamicItem(sourceSession, state.dynamicItemDialog.section_id, config);
    const timer = settled?.timer
      ? startActivity(settled.timer, created.item.item_id, now)
      : createActivityTimer(created.item.item_id, now, state.pausedMs);
    const session = applyDerivedTiming(created.session);
    set({
      session,
      timer,
      ...calculateLiveTimingState(session, timer, now),
      dynamicItemDialog: undefined,
      sessionNotice: undefined,
      lastCreationOperations: { ...state.lastCreationOperations,
        [state.dynamicItemDialog.section_id]: creationRecipeFromBlocks([{ config, count: 1 }]) }
    });
    recordEvent('item_created', {
      section_id: created.item.section_id,
      item_id: created.item.item_id,
      ordinal: created.item.ordinal,
      type_id: created.item.type_id,
      renderer: created.item.renderer
    });
    recordQuestionEntered(created.item.item_id, 'item_created');
    void get().persist();
  },

  async repeatDynamicCreationOperation() {
    const state = get();
    if (!state.session || !isDynamicSession(state.session) || state.dynamicItemDialog?.mode !== 'create') return false;
    const sectionId = state.dynamicItemDialog.section_id;
    const recipe = state.lastCreationOperations[sectionId];
    if (!recipe) return false;
    return get().createDynamicBatch(resolveTemplateBlocks({
      template_id: 'previous_operation', name: 'Previous operation', section: sectionId,
      blocks: recipe
    }));
  },

  changeDynamicItemTypeFromConfig(config, confirmClear = false) {
    const state = get();
    if (!state.session || !isDynamicSession(state.session) || state.dynamicItemDialog?.mode !== 'edit') return false;
    const now = nowMonotonic();
    const settled = state.timer ? settleCurrentActivity(state, now) : undefined;
    const sourceSession = (settled?.session ?? state.session) as DynamicPracticeSession;
    const itemId = state.dynamicItemDialog.item_id!;
    const changed = changeDynamicItemType(sourceSession, itemId, config, { confirm_clear: confirmClear });
    if (!changed.ok) return false;
    const session = applyDerivedTiming(changed.session);
    const timer = settled?.timer ?? state.timer;
    set({
      session,
      timer,
      ...(timer ? calculateLiveTimingState(session, timer, now) : {}),
      dynamicItemDialog: undefined,
      sessionNotice: undefined
    });
    recordEvent('type_changed', {
      item_id: itemId,
      type_id: config.type_id,
      renderer: config.renderer,
      answer_cleared: changed.answer_cleared
    });
    void get().persist();
    return true;
  },

  async finishDynamicCurrentSection(confirmed = false) {
    const state = get();
    if (!state.session || !isDynamicSession(state.session) || state.dynamicItemDialog) return;
    const now = nowMonotonic();
    const settled = state.timer ? settleCurrentActivity(state, now) : undefined;
    const sourceSession = (settled?.session ?? state.session) as DynamicPracticeSession;
    const sectionId = sourceSession.current_section_id as DynamicSectionName;
    const result = finishDynamicSection(sourceSession, sectionId, { confirmed });
    if (!result.ok) {
      set({
        session: sourceSession,
        timer: settled?.timer ?? state.timer,
        ...(settled ? calculateLiveTimingState(sourceSession, settled.timer, now) : {}),
        sessionNotice: {
          kind: 'warning',
          message: 'Confirm completion of this section.',
          messageKey: result.reason === 'CONFIRM_EMPTY' ? 'notice.emptySection' : 'notice.dynamicSectionSummary',
          messageValues: { sectionId, created: result.inspection.created, unanswered: result.inspection.unanswered.length, skipped: result.inspection.skipped.length, uncertain: result.inspection.uncertain.length },
          questionIds: Array.from(new Set([
            ...result.inspection.unanswered,
            ...result.inspection.skipped,
            ...result.inspection.uncertain
          ])),
          retryAction: 'CONFIRM_DYNAMIC_SECTION'
        }
      });
      return;
    }
    set({ saveStatus: 'saving', sessionNotice: undefined });
    try {
      const candidate = serializeSessionForPersistence(applyDerivedTiming(result.session));
      await saveSessionSnapshot(candidate);
      const resumedAt = nowMonotonic();
      const timer = result.next === 'SESSION_SUMMARY' || !candidate.current_question_id
        ? undefined
        : createActivityTimer(candidate.current_question_id, resumedAt, candidate.paused_ms);
      set({
        session: candidate,
        timer,
        ...(timer
          ? calculateLiveTimingState(candidate, timer, resumedAt)
          : timingStateFromSettledSession(candidate, candidate.paused_ms)),
        saveStatus: 'saved',
        dynamicItemDialog: undefined
      });
      recordEvent('section_completed', {
        section_id: sectionId,
        empty: sourceSession.active_section_question_ids.length === 0,
        next: result.next
      });
      if (result.next === 'SESSION_SUMMARY') {
        recordEvent('session_completed', { completed_sections: candidate.completed_sections ?? [] });
        await get().exportSession();
      }
    } catch (error) {
      set({
        session: sourceSession,
        timer: settled?.timer ?? state.timer,
        saveStatus: 'error',
        sessionNotice: {
          kind: 'error',
          message: 'Save failed; current section remains unfinished.',
          messageKey: 'notice.sectionSaveFailed',
          messageValues: { detail: error instanceof Error ? error.message : String(error) }
        }
      });
    }
  },

  reopenDynamicSection(sectionId) {
    const state = get();
    if (!state.session || !isDynamicSession(state.session)) return;
    const now = nowMonotonic();
    const session = reopenDynamicSectionRuntime(state.session, sectionId);
    const timer = session.current_question_id
      ? createActivityTimer(session.current_question_id, now, session.paused_ms)
      : undefined;
    set({
      session,
      timer,
      ...(timer ? calculateLiveTimingState(session, timer, now) : timingStateFromSettledSession(session, session.paused_ms)),
      sessionNotice: undefined,
      exportStatus: 'idle',
      exportError: undefined,
      exportDirectory: undefined
    });
    recordEvent('section_reopened', { section_id: sectionId });
    void get().persist();
  },

  async recoverSession(sessionId) {
    try {
      const [raw, eventSeq, historicEvents] = await Promise.all([
        recoveryLoadStep('RECOVERY_SNAPSHOT_LOAD_FAILED', loadRecoverySnapshot(sessionId)),
        recoveryLoadStep('RECOVERY_EVENT_SEQ_LOAD_FAILED', getRecoveryEventSeq(sessionId)),
        recoveryLoadStep('RECOVERY_EVENTS_LOAD_FAILED', loadRecoveryEvents(sessionId))
      ]);
      const prepared = prepareRecoverySession(raw, [DEFAULT_BLUEPRINT.blueprint_id, get().blueprint.blueprint_id]);
      if (!prepared.ok) return { ok: false, error: `${prepared.code}: ${prepared.diagnostic}` };
      const recoveredEventSeq = historicEvents.reduce(
        (maximum, event) => Math.max(maximum, event.seq),
        eventSeq
      );
      let recoveryBlueprint = DEFAULT_BLUEPRINT;
      if (prepared.session.blueprint_override_package_id) {
        const requiredOverride = await loadBlueprintOverride(prepared.session.blueprint_override_package_id);
        if (!requiredOverride) {
          return {
            ok: false,
            error: `PACKAGE_OVERRIDE_MISSING: ${prepared.session.blueprint_override_package_id}`
          };
        }
        recoveryBlueprint = mergeBlueprintOverride(
          DEFAULT_BLUEPRINT,
          requiredOverride,
          prepared.session.blueprint_override_package_id
        );
        const recoveryValidation = validateBlueprint(recoveryBlueprint);
        if (!recoveryValidation.ok) {
          return { ok: false, error: `PACKAGE_OVERRIDE_INVALID: ${recoveryValidation.errors.map((item) => item.message).join('; ')}` };
        }
      }
      const recovered = applyDerivedTiming(pauseCurrentTask(prepared.session));
      const now = nowMonotonic();
      const pausedTimer = pauseActivityTimer(
        createActivityTimer(recovered.current_question_id, now, recovered.paused_ms),
        now
      ).timer;
      set({
        session: recovered,
        lastCreationOperations: {},
        blueprint: recoveryBlueprint,
        blueprintStatus: 'ready',
        blueprintErrors: [],
        blueprintOverridePackageId: prepared.session.blueprint_override_package_id,
        selectedPackage: get().packages.find((item) => item.package_id === recovered.package_id) ?? get().selectedPackage,
        events: historicEvents,
        eventSeq: recoveredEventSeq,
        timer: pausedTimer,
        ...timingStateFromSettledSession(recovered, recovered.paused_ms),
        speakingTransitionPending: false,
        speakingTransitionGuardUntil: 0,
        speakingTransitionGuardTaskId: undefined,
        speakingTransitionGuardAttempt: undefined,
        isPaused: true,
        navigationLockedUntil: 0,
        windowClosePhase: 'IDLE',
        preCloseRuntimeState: undefined,
        sessionNotice: prepared.writing_policy_compatibility_warning
          ? {
              kind: 'warning',
              message: 'The recovered record contains historical non-English Writing content.',
              messageKey: 'notice.legacyWriting'
            }
          : prepared.migrated
            ? { kind: 'warning', message: 'Legacy recovery migrated; review the paused session before continuing.', messageKey: 'notice.legacyRecovery' }
            : undefined,
        saveStatus: 'saving',
        saveError: undefined,
        exportStatus: 'idle',
        exportError: undefined,
        exportDirectory: undefined
      });
      recordEvent('session_recovered', {
        migrated: prepared.migrated,
        resume_policy: prepared.resume_policy
      });
      await saveSessionSnapshot(serializeSessionForPersistence(recovered));
      set({ saveStatus: 'saved', saveError: undefined });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ saveStatus: 'error', saveError: message });
      return { ok: false, error: message };
    }
  },

  tick() {
    const state = get();
    if (state.windowClosePhase === 'SAVING' || state.windowClosePhase === 'DESTROYING') return;
    if (!state.timer || !state.session) return;
    const now = nowMonotonic();
    const live = calculateLiveTimingState(state.session, state.timer, now);
    const task = getCurrentTask(state.session);
    if (task && live.taskRemainingMs === 0 && !task.is_overtime) {
      const settled = settleCurrentActivity(state, now);
      set(settled);
    } else {
      set(live);
    }
    recordPendingTaskOvertimeEvent();
    recordPendingDynamicOvertimeEvent();
  },

  togglePause() {
    const state = get();
    if (state.windowClosePhase !== 'IDLE') return;
    const timer = state.timer;
    if (!timer || !state.session || state.session.view === 'SESSION_SUMMARY') return;
    const now = nowMonotonic();
    if (timer.pausedAtMonotonic === null) {
      const paused = pauseActivityTimer(timer, now);
      const session = pauseCurrentTask(applyActivityDelta(state.session, paused.activityId, paused.deltaMs));
      const timing = calculateLiveTimingState(session, paused.timer, now);
      set({
        session,
        timer: paused.timer,
        ...timing,
        isPaused: true
      });
      recordEvent('session_paused', { active_ms: Math.round(timing.activeMs) });
    } else {
      const pausedDelta = Math.max(0, now - timer.pausedAtMonotonic);
      const resumedTimer = resumeActivityTimer(timer, now);
      const withPause = isDynamicSession(state.session)
        ? addDynamicPauseTime(state.session, state.session.current_question_id, pausedDelta)
        : addCurrentTaskPause(state.session, pausedDelta);
      const session = applyDerivedTiming({
        ...resumeCurrentTask(withPause),
        paused_ms: resumedTimer.pausedMs
      });
      const nextTimer = applyActivityStartPolicy(resumedTimer, session, now);
      set({
        session,
        timer: nextTimer,
        ...calculateLiveTimingState(session, nextTimer, now),
        isPaused: false
      });
      recordEvent('session_resumed', { paused_delta_ms: Math.round(pausedDelta) });
    }
    void get().persist();
  },

  answerCurrent(answer) {
    const state = get();
    if (isInteractionFrozen(state) || !state.session) return;
    const now = nowMonotonic();
    const settled = settleCurrentActivity(state, now);
    const question = getCurrentQuestion(settled.session);
    if (!question) return;
    const task = getCurrentTask(settled.session);
    const writingBuildSentence = task?.task_id === 'WRITING_BUILD_SENTENCE' && typeof answer === 'string';
    const dynamicItem = isDynamicSession(settled.session) ? question : undefined;
    const acceptedAnswer = dynamicItem
      ? normalizeDynamicAnswer(dynamicItem, answer)
      : writingBuildSentence
      ? sanitizeWritingText(answer, { allow_line_breaks: false }).text
      : answer;
    if (acceptedAnswer === DYNAMIC_ANSWER_REJECTED) return;
    if (
      writingBuildSentence &&
      String(settled.session.answers[question.id]?.answer_value ?? '') === acceptedAnswer
    ) {
      set({
        session: settled.session,
        timer: settled.timer,
        ...calculateLiveTimingState(settled.session, settled.timer, now)
      });
      return;
    }
    const updated = applyDerivedTiming(upsertAnswer(
      settled.session,
      question,
      acceptedAnswer,
      settled.session.answers[question.id]?.active_time_ms ?? 0,
      shouldQuestionBeOvertime(
        settled.session,
        question,
        settled.session.answers[question.id]?.active_time_ms ?? 0
      )
    ));
    set({
      session: updated,
      timer: settled.timer,
      ...calculateLiveTimingState(updated, settled.timer, now)
    });
    recordEvent(dynamicItem ? 'item_answer_changed' : 'answer_changed', dynamicItem
      ? {
          item_id: question.id,
          renderer: question.renderer,
          modification_count: updated.answers[question.id]?.modification_count ?? 0
        }
      : {
          question_id: question.id,
          answer_mode: question.answer_mode,
          modification_count: updated.answers[question.id]?.modification_count ?? 0
        });
    scheduleAnswerAutosave();
  },

  updateDynamicLongText(text, inputType) {
    mutateDynamicLongTextState(
      get,
      set,
      (session, itemId, activeMs) => updateDynamicWritingText(session, itemId, text, inputType, activeMs),
      inputType
    );
  },

  undoDynamicLongText() {
    return mutateDynamicLongTextState(get, set, undoDynamicWritingText, 'historyUndo');
  },

  redoDynamicLongText() {
    return mutateDynamicLongTextState(get, set, redoDynamicWritingText, 'historyRedo');
  },

  updateWritingText(text, inputType) {
    const state = get();
    if (isInteractionFrozen(state) || !state.session || !state.timer) return;
    const now = nowMonotonic();
    const settled = settleCurrentActivity(state, now);
    const edited = updateWritingTextInSession(settled.session, text, inputType);
    if (edited === settled.session) {
      set({
        session: settled.session,
        timer: settled.timer,
        ...calculateLiveTimingState(settled.session, settled.timer, now)
      });
      return;
    }
    const updated = applyDerivedTiming(edited);
    set({
      session: updated,
      timer: settled.timer,
      ...calculateLiveTimingState(updated, settled.timer, now)
    });
    const task = getCurrentTask(updated);
    recordEvent('writing_text_changed', {
      task_id: task?.task_id,
      input_type: inputType,
      word_count: task?.word_count ?? 0,
      character_count: task?.character_count ?? 0,
      modification_count: task?.modification_count ?? 0
    });
    scheduleAnswerAutosave();
  },

  undoWritingText() {
    return mutateWritingSession(get, set, undoWritingTextInSession, 'writing_undo');
  },

  redoWritingText() {
    return mutateWritingSession(get, set, redoWritingTextInSession, 'writing_redo');
  },

  updateWritingAnswerFromHistory(text, inputType) {
    const state = get();
    if (isInteractionFrozen(state) || state.sessionNotice || !state.session || !state.timer) return false;
    const task = getCurrentTask(state.session);
    const question = getCurrentQuestion(state.session);
    const scope = state.session.modules.find((item) => item.id === state.session?.current_scope_id);
    if (task?.task_id !== 'WRITING_BUILD_SENTENCE' || !question || scope?.status === 'FINALIZED') return false;
    const now = nowMonotonic();
    const settled = settleCurrentActivity(state, now);
    const prior = settled.session.answers[question.id];
    const accepted = sanitizeWritingText(text, { allow_line_breaks: false }).text;
    if (String(prior?.answer_value ?? '') === accepted) {
      set({
        session: settled.session,
        timer: settled.timer,
        ...calculateLiveTimingState(settled.session, settled.timer, now)
      });
      return false;
    }
    let updated = upsertAnswer(
      settled.session,
      question,
      accepted,
      prior?.active_time_ms ?? 0,
      shouldQuestionBeOvertime(settled.session, question, prior?.active_time_ms ?? 0)
    );
    if (updated === settled.session) return false;
    if (prior) {
      updated = {
        ...updated,
        answers: {
          ...updated.answers,
          [question.id]: {
            ...updated.answers[question.id],
            is_skipped: prior.is_skipped,
            is_uncertain: prior.is_uncertain,
            marked_review: prior.marked_review
          }
        }
      };
    }
    updated = applyDerivedTiming(updated);
    set({
      session: updated,
      timer: settled.timer,
      ...calculateLiveTimingState(updated, settled.timer, now)
    });
    recordEvent('answer_changed', {
      question_id: question.id,
      answer_mode: question.answer_mode,
      input_type: inputType,
      modification_count: updated.answers[question.id]?.modification_count ?? 0
    });
    scheduleAnswerAutosave();
    return true;
  },

  async startSpeakingCurrent() {
    const state = get();
    if (isInteractionFrozen(state) || state.speakingTransitionPending || !state.session || !state.timer) return;
    const task = getCurrentTask(state.session);
    if (!task || task.section_id !== 'Speaking') return;
    const now = nowMonotonic();
    const session = startSpeakingTask(state.session, task.task_id);
    if (session === state.session) return;
    const timer = startActivity(state.timer, state.session.current_question_id, now);
    const startedTask = session.tasks.find((item) => item.task_id === task.task_id);
    set({
      session,
      timer,
      ...calculateLiveTimingState(session, timer, now),
      speakingTransitionPending: true,
      speakingTransitionGuardUntil: now + MINIMUM_SPEAKING_TRANSITION_GUARD_MS,
      speakingTransitionGuardTaskId: task.task_id,
      speakingTransitionGuardAttempt: startedTask?.attempt_count,
      saveStatus: 'saving',
      sessionNotice: undefined
    });
    recordEvent('speaking_task_started', {
      task_id: task.task_id,
      attempt_count: startedTask?.attempt_count ?? 0
    });
    try {
      await saveSessionSnapshot(serializeSessionForPersistence(session));
      set({ speakingTransitionPending: false, saveStatus: 'saved' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        speakingTransitionPending: false,
        saveStatus: 'error',
        sessionNotice: { kind: 'error', message: `Speaking task started but save failed: ${message}`, messageKey: 'notice.speakingStartSaveFailed', messageValues: { detail: message } }
      });
      recordEvent('speaking_task_persistence_error', { task_id: task.task_id, phase: 'start', message });
    }
  },

  async markSpeakingCurrent(outcome) {
    const state = get();
    if (isInteractionFrozen(state) || state.speakingTransitionPending || !state.session || !state.timer) return;
    const now = nowMonotonic();
    const guardedTask = getCurrentTask(state.session);
    if (!guardedTask || guardedTask.section_id !== 'Speaking') return;
    if (
      state.speakingTransitionGuardTaskId === guardedTask.task_id &&
      state.speakingTransitionGuardAttempt === guardedTask.attempt_count &&
      now < state.speakingTransitionGuardUntil
    ) return;
    const settled = settleCurrentActivity(state, now);
    const task = getCurrentTask(settled.session);
    if (!task || task.section_id !== 'Speaking' || !['ACTIVE', 'OVERTIME'].includes(task.status)) return;
    const marked = ['ACTIVE', 'OVERTIME'].includes(task.status)
      ? markSpeakingTask(settled.session, task.task_id, outcome)
      : settled.session;
    const suspendedTimer = { ...settled.timer, currentActivityStartedAtMonotonic: null };
    set({
      session: marked,
      timer: suspendedTimer,
      ...calculateLiveTimingState(marked, suspendedTimer, now),
      speakingTransitionPending: true,
      saveStatus: 'saving'
    });
    try {
      await saveSessionSnapshot(serializeSessionForPersistence(marked));
      const transitioned = outcome === 'COMPLETED'
        ? applyDerivedTiming(advanceAfterSpeakingTask(marked))
        : applyDerivedTiming(marked);
      await saveSessionSnapshot(serializeSessionForPersistence(transitioned));
      const switched = transitioned.current_question_id !== marked.current_question_id;
      const transitionNow = nowMonotonic();
      const nextTimer = applyActivityStartPolicy(
        switched ? startActivity(settled.timer, transitioned.current_question_id, transitionNow) : suspendedTimer,
        transitioned,
        transitionNow
      );
      const nextTask = getCurrentTask(transitioned);
      const nextGuarded = nextTask?.section_id === 'Speaking' && ['ACTIVE', 'OVERTIME'].includes(nextTask.status);
      set({
        session: transitioned,
        timer: nextTimer,
        ...calculateLiveTimingState(transitioned, nextTimer, transitionNow),
        speakingTransitionPending: false,
        speakingTransitionGuardUntil: nextGuarded ? transitionNow + MINIMUM_SPEAKING_TRANSITION_GUARD_MS : 0,
        speakingTransitionGuardTaskId: nextGuarded ? nextTask?.task_id : undefined,
        speakingTransitionGuardAttempt: nextGuarded ? nextTask?.attempt_count : undefined,
        saveStatus: 'saved',
        sessionNotice: undefined
      });
      recordEvent('speaking_task_result', {
        task_id: task.task_id,
        outcome,
        attempt_count: marked.tasks.find((item) => item.task_id === task.task_id)?.attempt_count ?? 0,
        is_overtime: marked.tasks.find((item) => item.task_id === task.task_id)?.is_overtime ?? false
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        session: marked,
        timer: suspendedTimer,
        speakingTransitionPending: false,
        saveStatus: 'error',
        sessionNotice: { kind: 'error', message: `Save failed; Speaking task did not change: ${message}`, messageKey: 'notice.speakingSwitchSaveFailed', messageValues: { detail: message } }
      });
      recordEvent('speaking_task_persistence_error', { task_id: task.task_id, message });
    }
  },

  async advanceSpeakingCurrent() {
    const state = get();
    if (isInteractionFrozen(state) || state.speakingTransitionPending || !state.session || !state.timer) return;
    const currentTask = getCurrentTask(state.session);
    if (
      !currentTask ||
      currentTask.section_id !== 'Speaking' ||
      !['COMPLETED', 'NEEDS_RETRY'].includes(currentTask.status)
    ) return;
    const now = nowMonotonic();
    const settled = settleCurrentActivity(state, now);
    const transitioned = applyDerivedTiming(advanceAfterSpeakingTask(settled.session));
    if (transitioned.current_question_id === settled.session.current_question_id) return;
    const suspendedTimer = { ...settled.timer, currentActivityStartedAtMonotonic: null };
    set({
      session: settled.session,
      timer: suspendedTimer,
      ...calculateLiveTimingState(settled.session, suspendedTimer, now),
      speakingTransitionPending: true,
      saveStatus: 'saving',
      sessionNotice: undefined
    });
    try {
      await saveSessionSnapshot(serializeSessionForPersistence(transitioned));
      const transitionNow = nowMonotonic();
      const nextTimer = applyActivityStartPolicy(
        startActivity(settled.timer, transitioned.current_question_id, transitionNow),
        transitioned,
        transitionNow
      );
      const nextTask = getCurrentTask(transitioned);
      const nextGuarded = nextTask?.section_id === 'Speaking' && ['ACTIVE', 'OVERTIME'].includes(nextTask.status);
      set({
        session: transitioned,
        timer: nextTimer,
        ...calculateLiveTimingState(transitioned, nextTimer, transitionNow),
        speakingTransitionPending: false,
        speakingTransitionGuardUntil: nextGuarded ? transitionNow + MINIMUM_SPEAKING_TRANSITION_GUARD_MS : 0,
        speakingTransitionGuardTaskId: nextGuarded ? nextTask?.task_id : undefined,
        speakingTransitionGuardAttempt: nextGuarded ? nextTask?.attempt_count : undefined,
        saveStatus: 'saved',
        sessionNotice: undefined
      });
      recordEvent('speaking_task_advanced', {
        from_task_id: currentTask.task_id,
        to_task_id: nextTask?.task_id
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        speakingTransitionPending: false,
        saveStatus: 'error',
        sessionNotice: { kind: 'error', message: `Save failed; Speaking task did not change: ${message}`, messageKey: 'notice.speakingSwitchSaveFailed', messageValues: { detail: message } }
      });
      recordEvent('speaking_task_persistence_error', {
        task_id: currentTask.task_id,
        phase: 'advance',
        message
      });
    }
  },

  async retrySpeakingCurrent() {
    const state = get();
    if (isInteractionFrozen(state) || state.speakingTransitionPending || !state.session || !state.timer) return;
    const task = getCurrentTask(state.session);
    if (!task || task.section_id !== 'Speaking' || !task.needs_retry) return;
    const now = nowMonotonic();
    const session = retrySpeakingTask(state.session, task.task_id);
    if (session === state.session) return;
    const timer = startActivity(state.timer, state.session.current_question_id, now);
    const retriedTask = session.tasks.find((item) => item.task_id === task.task_id);
    set({
      session,
      timer,
      ...calculateLiveTimingState(session, timer, now),
      speakingTransitionPending: true,
      speakingTransitionGuardUntil: now + MINIMUM_SPEAKING_TRANSITION_GUARD_MS,
      speakingTransitionGuardTaskId: task.task_id,
      speakingTransitionGuardAttempt: retriedTask?.attempt_count,
      saveStatus: 'saving',
      sessionNotice: undefined
    });
    recordEvent('speaking_task_retried', {
      task_id: task.task_id,
      attempt_count: retriedTask?.attempt_count ?? 0
    });
    try {
      await saveSessionSnapshot(serializeSessionForPersistence(session));
      set({ speakingTransitionPending: false, saveStatus: 'saved' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        speakingTransitionPending: false,
        saveStatus: 'error',
        sessionNotice: { kind: 'error', message: `Speaking retry started but save failed: ${message}`, messageKey: 'notice.speakingRetrySaveFailed', messageValues: { detail: message } }
      });
      recordEvent('speaking_task_persistence_error', { task_id: task.task_id, phase: 'retry', message });
    }
  },

  skipCurrent() {
    const state = get();
    if (isInteractionFrozen(state) || !state.session || isNavigationLocked(state.navigationLockedUntil)) return;
    if (isLongWritingTask(getCurrentTask(state.session))) return;
    const question = getCurrentQuestion(state.session);
    if (!question) return;
    if (isDynamicSession(state.session)) {
      if (!state.timer) return;
      const now = nowMonotonic();
      const settled = settleCurrentActivity(state, now);
      const activeTimeMs = settled.session.answers[question.id]?.active_time_ms ?? 0;
      const skipped = skipQuestion(settled.session, question, activeTimeMs) as DynamicPracticeSession;
      const action = getDynamicNextAction(skipped);
      if (action.kind === 'NAVIGATED') {
        setNavigationResult(set, settled, action.session, true, now);
        recordQuestionEntered(action.session.current_question_id, 'skip');
      } else {
        set({
          session: applyDerivedTiming(skipped),
          timer: settled.timer,
          ...calculateLiveTimingState(skipped, settled.timer, now),
          dynamicItemDialog: {
            mode: 'create',
            section_id: action.section_id,
            ordinal: action.next_ordinal
          }
        });
      }
      recordEvent('item_skipped', { item_id: question.id, active_time_ms: Math.round(activeTimeMs) });
      void get().persist();
      return;
    }
    lockNavigation(set);
    const now = nowMonotonic();
    const settled = settleCurrentActivity(state, now);
    const questionActiveMs = settled.session.answers[question.id]?.active_time_ms ?? 0;
    const result = skipAndAdvance(settled.session, questionActiveMs);
    const target = getCurrentQuestion(result.session);
    setNavigationResult(set, settled, result.session, target?.id !== question.id, now);
    recordEvent('question_skipped', { question_id: question.id, active_time_ms: Math.round(questionActiveMs) });
    if (target?.id !== question.id) recordQuestionEntered(target?.id, 'skip');
    void get().persist();
  },

  nextQuestion() {
    const state = get();
    if (isInteractionFrozen(state) || !state.session || isNavigationLocked(state.navigationLockedUntil)) return;
    if (isLongWritingTask(getCurrentTask(state.session))) return;
    const question = getCurrentQuestion(state.session);
    if (isDynamicSession(state.session)) {
      if (!question) {
        get().openDynamicItemCreator();
        return;
      }
      const action = getDynamicNextAction(state.session);
      if (action.kind === 'CREATE_REQUIRED') {
        set({
          dynamicItemDialog: {
            mode: 'create',
            section_id: action.section_id,
            ordinal: action.next_ordinal
          }
        });
        return;
      }
      if (!state.timer) return;
      const now = nowMonotonic();
      const settled = settleCurrentActivity(state, now);
      const moved = getDynamicNextAction(settled.session as DynamicPracticeSession);
      if (moved.kind !== 'NAVIGATED') return;
      setNavigationResult(set, settled, moved.session, true, now);
      recordQuestionEntered(moved.session.current_question_id, 'next');
      void get().persist();
      return;
    }
    if (!question) return;
    lockNavigation(set);
    const now = nowMonotonic();
    const settled = settleCurrentActivity(state, now);
    const questionActiveMs = settled.session.answers[question.id]?.active_time_ms ?? 0;
    const result = advanceFromCurrent(settled.session, questionActiveMs);
    const target = getCurrentQuestion(result.session);
    setNavigationResult(set, settled, result.session, target?.id !== question.id, now);
    if (target?.id !== question.id) recordQuestionEntered(target?.id, 'next');
    void get().persist();
  },

  async finalizeCurrentScope(options) {
    const state = get();
    if (isInteractionFrozen(state) || state.speakingTransitionPending || !state.session) return;
    const speakingRetryTaskIds = speakingRetryTaskIdsInCurrentScope(state.session);
    if (speakingRetryTaskIds.length > 0 && !options?.allowSpeakingRetries) {
      set({
        sessionNotice: {
          kind: 'warning',
          message: 'Speaking tasks still need retry.',
          messageKey: 'notice.speakingNeedsRetry',
          messageValues: { count: speakingRetryTaskIds.length },
          taskIds: speakingRetryTaskIds,
          retryAction: 'CONFIRM_SPEAKING_RETRIES'
        }
      });
      recordEvent('scope_finalize_blocked_speaking_retries', {
        module_id: state.session.current_scope_id,
        task_ids: speakingRetryTaskIds
      });
      return;
    }
    const settledAt = nowMonotonic();
    const settled = settleCurrentActivity(state, settledAt);
    const question = getCurrentQuestion(settled.session);
    const scope = getCurrentModule(settled.session);
    if (!question || !scope) return;
    const suspendedTimer = { ...settled.timer, currentActivityStartedAtMonotonic: null };
    set({
      session: settled.session,
      timer: suspendedTimer,
      ...calculateLiveTimingState(settled.session, suspendedTimer, settledAt),
      saveStatus: 'saving',
      saveError: undefined,
      speakingTransitionPending: scope.section === 'Speaking'
    });
    const questionActiveMs = settled.session.answers[question.id]?.active_time_ms ?? 0;
    const result = await finalizeScope(
      settled.session,
      questionActiveMs,
      async (snapshot) => saveSessionSnapshot(serializeSessionForPersistence(snapshot)),
      new Date().toISOString()
    );
    const resumedAt = nowMonotonic();
    const nextSession = applyDerivedTiming(result.session);
    const timer =
      nextSession.view === 'SESSION_SUMMARY'
        ? undefined
        : applyActivityStartPolicy(
            startActivity(settled.timer, nextSession.current_question_id, resumedAt),
            nextSession,
            resumedAt
          );
    const timing = timer
      ? calculateLiveTimingState(nextSession, timer, resumedAt)
      : timingStateFromSettledSession(nextSession, currentPausedMs(settled.timer, resumedAt));
    set({
      session: nextSession,
      timer,
      ...timing,
      speakingTransitionPending: false
    });

    if (result.ok) {
      set({ saveStatus: 'saved', sessionNotice: undefined });
      recordEvent('scope_finalized', {
        question_id: question.id,
        section_id: scope.section,
        module_id: result.finalizedScopeId,
        next: result.next
      });
      if (result.next === 'SESSION_SUMMARY') {
        recordEvent('session_completed', { completed_sections: nextSession.completed_sections ?? [] });
        await get().exportSession();
      } else {
        recordQuestionEntered(nextSession.current_question_id, 'scope_transition');
      }
    } else if (result.reason === 'UNENCOUNTERED_ITEMS') {
      set({
        saveStatus: 'saved',
        sessionNotice: {
          kind: 'warning',
          message: 'This scope still has unvisited questions.',
          messageKey: 'notice.unvisitedQuestions',
          messageValues: { count: result.questionIds.length },
          questionIds: result.questionIds
        }
      });
      recordEvent('scope_finalize_blocked_unencountered', {
        module_id: scope.id,
        question_ids: result.questionIds
      });
    } else {
      set({
        saveStatus: 'error',
        sessionNotice: {
          kind: 'error',
          message: `Save failed; current scope remains unfinished: ${result.message}`,
          messageKey: 'notice.scopeSaveFailed',
          messageValues: { detail: result.message },
          retryAction: 'FINALIZE_SCOPE'
        }
      });
      recordEvent('scope_finalize_persistence_error', { module_id: scope.id, message: result.message });
    }
  },

  async finalizeCurrentModule() {
    await get().finalizeCurrentScope();
  },

  goToFirstSpeakingRetry() {
    const state = get();
    if (isInteractionFrozen(state) || state.speakingTransitionPending || !state.session || !state.timer) return;
    const taskId = state.sessionNotice?.taskIds?.[0] ?? speakingRetryTaskIdsInCurrentScope(state.session)[0];
    if (!taskId) return;
    const now = nowMonotonic();
    const settled = settleCurrentActivity(state, now);
    const entered = enterTask(settled.session, taskId);
    if (entered.current_task_id !== taskId) return;
    const timer = applyActivityStartPolicy(
      startActivity(settled.timer, entered.current_question_id, now),
      entered,
      now
    );
    set({
      session: entered,
      timer,
      ...calculateLiveTimingState(entered, timer, now),
      sessionNotice: undefined
    });
    recordEvent('speaking_retry_review_selected', { task_id: taskId });
    void get().persist();
  },

  async confirmFinalizeWithSpeakingRetries() {
    const notice = get().sessionNotice;
    if (notice?.retryAction !== 'CONFIRM_SPEAKING_RETRIES') return;
    await get().finalizeCurrentScope({ allowSpeakingRetries: true });
  },

  previousQuestion() {
    const state = get();
    if (isInteractionFrozen(state) || !state.session) return;
    if (isLongWritingTask(getCurrentTask(state.session))) return;
    const current = getCurrentQuestion(state.session);
    if (!current) return;
    if (isDynamicSession(state.session)) {
      if (!state.timer) return;
      const now = nowMonotonic();
      const settled = settleCurrentActivity(state, now);
      const previous = previousDynamicItem(settled.session as DynamicPracticeSession);
      if (previous.current_question_id === current.id) return;
      setNavigationResult(set, settled, previous, true, now);
      recordQuestionEntered(previous.current_question_id, 'previous');
      void get().persist();
      return;
    }
    if (!canNavigateBackward(state.session)) return;
    const currentPosition = state.session.active_scope_question_ids.indexOf(current.id);
    const targetId = state.session.active_scope_question_ids[Math.max(0, currentPosition - 1)];
    if (!targetId || !canNavigateToQuestion(state.session, targetId, 'previous')) return;
    const now = nowMonotonic();
    const settled = settleCurrentActivity(state, now);
    const nextSession = previousQuestionInSession(settled.session);
    if (nextSession.current_question_id === state.session.current_question_id) return;
    setNavigationResult(set, settled, nextSession, true, now);
    recordQuestionEntered(nextSession.current_question_id, 'previous');
    void get().persist();
  },

  goToQuestion(index) {
    const state = get();
    if (
      isInteractionFrozen(state) ||
      !state.session ||
      index < 0 ||
      index >= state.session.questions.length ||
      isNavigationLocked(state.navigationLockedUntil)
    ) {
      return;
    }
    if (isLongWritingTask(getCurrentTask(state.session))) return;
    const target = state.session.questions[index];
    if (isDynamicSession(state.session)) {
      if (!state.timer) return;
      const now = nowMonotonic();
      const settled = settleCurrentActivity(state, now);
      const entered = enterDynamicItem(settled.session as DynamicPracticeSession, target.id, 'answer_card');
      if (entered.current_question_id !== target.id) return;
      setNavigationResult(set, settled, entered, true, now);
      recordQuestionEntered(target.id, 'answer_card');
      void get().persist();
      return;
    }
    if (!canNavigateToQuestion(state.session, target.id, 'answer_card')) return;
    lockNavigation(set);
    const now = nowMonotonic();
    const settled = settleCurrentActivity(state, now);
    const nextSession = enterQuestion(settled.session, target.id, new Date().toISOString(), 'answer_card');
    if (nextSession.current_question_id !== target.id) return;
    setNavigationResult(set, settled, nextSession, true, now);
    recordQuestionEntered(target.id, 'answer_card');
    void get().persist();
  },

  goToFirstUnencountered() {
    const state = get();
    if (isInteractionFrozen(state) || !state.session) return;
    const firstId = state.sessionNotice?.questionIds?.find((id) => state.session?.active_scope_question_ids.includes(id));
    if (!firstId) return;
    const index = state.session.questions.findIndex((question) => question.id === firstId);
    if (index >= 0) {
      set({ navigationLockedUntil: 0 });
      get().goToQuestion(index);
    }
  },

  toggleReview() {
    const state = get();
    if (isInteractionFrozen(state) || !state.session) return;
    if (isLongWritingTask(getCurrentTask(state.session))) return;
    const question = getCurrentQuestion(state.session);
    if (!question) return;
    const existing = state.session.answers[question.id];
    const uncertain = !(existing?.is_uncertain ?? existing?.marked_review ?? false);
    const updated = markUncertain(state.session, question.id, uncertain);
    set({ session: updated });
    recordEvent(isDynamicSession(state.session) ? 'item_uncertainty_changed' : 'uncertainty_changed',
      isDynamicSession(state.session)
        ? { item_id: question.id, is_uncertain: uncertain }
        : { question_id: question.id, is_uncertain: uncertain });
    void get().persist();
  },

  toggleHideTimes() {
    set((state) => ({ hideTimes: !state.hideTimes }));
  },

  dismissSessionNotice() {
    set({ sessionNotice: undefined });
  },

  async exportSession() {
    const state = get();
    if (
      !state.session
      || state.session.view !== 'SESSION_SUMMARY'
      || state.exportStatus === 'exporting'
      || state.exportStatus === 'exported'
    ) return;
    const normalizedSession = applyDerivedTiming(state.session);
    set({ session: normalizedSession, activeMs: normalizedSession.active_ms });
    set({ exportStatus: 'exporting', exportError: undefined, sessionNotice: undefined });
    recordEvent('session_export_started', { retry: state.exportStatus === 'error' });
    const exportState = get();
    if (!exportState.session) return;
    try {
      const directory = await exportSessionRecord(exportState.session, exportState.events);
      set({ exportStatus: 'exported', exportDirectory: directory, exportError: undefined });
      recordEvent('session_exported', { directory });
      await get().persist('RUNTIME');
      try {
        await flushEventPersistence();
        if (get().saveStatus === 'error') {
          throw new Error(get().saveError ?? 'terminal Session persistence did not settle');
        }
        await cleanupTerminalRecovery(exportState.session.session_id, directory);
      } catch (cleanupError) {
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        set({
          sessionNotice: {
            kind: 'error',
            message: `Export succeeded but recovery cleanup failed: ${cleanupMessage}`,
            messageKey: 'notice.cleanupFailed',
            messageValues: { detail: cleanupMessage },
            retryAction: 'CLEANUP_TERMINAL_RECOVERY'
          }
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        exportStatus: 'error',
        exportError: message,
        sessionNotice: {
          kind: 'error',
          message: `Session export failed; practice record was retained: ${message}`,
          messageKey: 'notice.exportFailed',
          messageValues: { detail: message },
          retryAction: 'EXPORT_SESSION'
        }
      });
      recordEvent('session_export_failed', { message });
    }
  },

  async retryTerminalRecoveryCleanup() {
    const state = get();
    if (!state.session || state.session.view !== 'SESSION_SUMMARY' || !state.exportDirectory) return;
    try {
      await get().persist('RUNTIME');
      await flushEventPersistence();
      if (get().saveStatus === 'error') {
        throw new Error(get().saveError ?? 'terminal Session persistence did not settle');
      }
      await cleanupTerminalRecovery(state.session.session_id, state.exportDirectory);
      set({ sessionNotice: undefined });
    } catch (error) {
      set({
        sessionNotice: {
          kind: 'error',
          message: `Export succeeded but recovery cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
          messageKey: 'notice.cleanupFailed',
          messageValues: { detail: error instanceof Error ? error.message : String(error) },
          retryAction: 'CLEANUP_TERMINAL_RECOVERY'
        }
      });
    }
  },

  async openCurrentExportDirectory() {
    const directory = get().exportDirectory;
    if (!directory) return;
    try {
      await openSessionExportDirectory(directory);
    } catch (error) {
      set({
        sessionNotice: {
          kind: 'error',
          message: `Could not open export directory: ${error instanceof Error ? error.message : String(error)}`,
          messageKey: 'notice.openExportFailed',
          messageValues: { detail: error instanceof Error ? error.message : String(error) }
        }
      });
    }
  },

  returnHome() {
    set({
      session: undefined,
      lastCreationOperations: {},
      events: [],
      eventSeq: 0,
      timer: undefined,
      activeMs: 0,
      pausedMs: 0,
      questionActiveMs: 0,
      scopeActiveMs: 0,
      taskActiveMs: 0,
      taskRemainingMs: null,
      speakingTransitionPending: false,
      speakingTransitionGuardUntil: 0,
      speakingTransitionGuardTaskId: undefined,
      speakingTransitionGuardAttempt: undefined,
      isPaused: false,
      sessionNotice: undefined,
      dynamicItemDialog: undefined,
      exportStatus: 'idle',
      exportError: undefined,
      exportDirectory: undefined,
      windowClosePhase: 'IDLE',
      preCloseRuntimeState: undefined,
      saveError: undefined
    });
  },

  beginWindowCloseHold() {
    const state = get();
    if (state.preCloseRuntimeState) return state.preCloseRuntimeState;
    if (!state.session || !state.timer || state.session.view === 'SESSION_SUMMARY') {
      const preCloseRuntimeState = { kind: 'NO_SESSION' } as const;
      set({ preCloseRuntimeState });
      return preCloseRuntimeState;
    }

    const now = nowMonotonic();
    const wasPaused = state.isPaused || state.timer.pausedAtMonotonic !== null;
    if (wasPaused) {
      const timer = state.timer.pausedAtMonotonic === null
        ? { ...state.timer, currentActivityStartedAtMonotonic: null, pausedAtMonotonic: now }
        : state.timer;
      const preCloseRuntimeState = { kind: 'PAUSED_SESSION' } as const;
      set({
        timer,
        ...calculateLiveTimingState(state.session, timer, now),
        isPaused: true,
        preCloseRuntimeState
      });
      return preCloseRuntimeState;
    }

    const paused = pauseActivityTimer(state.timer, now);
    const session = applyDerivedTiming({
      ...pauseCurrentTask(applyActivityDelta(state.session, paused.activityId, paused.deltaMs)),
      paused_ms: currentPausedMs(paused.timer, now)
    });
    const preCloseRuntimeState = { kind: 'ACTIVE_SESSION' } as const;
    set({
      session,
      timer: paused.timer,
      ...calculateLiveTimingState(session, paused.timer, now),
      isPaused: false,
      preCloseRuntimeState
    });
    return preCloseRuntimeState;
  },

  cancelWindowCloseHold(preCloseRuntimeState) {
    const state = get();
    const heldState = state.preCloseRuntimeState ?? preCloseRuntimeState;
    const now = nowMonotonic();
    if (
      heldState.kind === 'ACTIVE_SESSION' &&
      state.session &&
      state.timer &&
      state.session.view !== 'SESSION_SUMMARY'
    ) {
      const pauseDelta = state.timer.pausedAtMonotonic === null
        ? 0
        : Math.max(0, now - state.timer.pausedAtMonotonic);
      const resumedTimer = resumeActivityTimer(state.timer, now);
      const withPause = isDynamicSession(state.session)
        ? addDynamicPauseTime(state.session, state.session.current_question_id, pauseDelta)
        : addCurrentTaskPause(state.session, pauseDelta);
      const session = applyDerivedTiming({
        ...resumeCurrentTask(withPause),
        paused_ms: resumedTimer.pausedMs
      });
      const timer = applyActivityStartPolicy(resumedTimer, session, now);
      set({
        session,
        timer,
        ...calculateLiveTimingState(session, timer, now),
        isPaused: false,
        preCloseRuntimeState: undefined
      });
      void get().persist();
      return;
    }
    if (
      heldState.kind === 'PAUSED_SESSION' &&
      state.session &&
      state.timer &&
      state.session.view !== 'SESSION_SUMMARY'
    ) {
      set({
        ...calculateLiveTimingState(state.session, state.timer, now),
        isPaused: true,
        preCloseRuntimeState: undefined
      });
      void get().persist();
      return;
    }
    set({ preCloseRuntimeState: undefined });
  },

  setWindowClosePhase(phase) {
    const state = get();
    if (state.windowClosePhase === phase) return;
    set({ windowClosePhase: phase });
  },

  async persist(reason = 'AUTOSAVE') {
    persistenceRequested = higherPriorityPersistenceReason(persistenceRequested, reason);
    if (!persistenceInFlight) {
      persistenceInFlight = (async () => {
        while (persistenceRequested) {
          const requestedReason = persistenceRequested;
          persistenceRequested = undefined;
          await persistLatestStoreSnapshot(get, set, requestedReason);
        }
      })().finally(() => {
        persistenceInFlight = undefined;
      });
    }
    await persistenceInFlight;
  }
}));

async function persistLatestStoreSnapshot(
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
  reason: PersistenceReason
): Promise<void> {
  const state = get();
  if (!state.session) return;
  set({ saveStatus: 'saving', saveError: undefined });
  try {
    if (!state.timer || state.session.view === 'SESSION_SUMMARY') {
      const snapshot = serializeSessionForPersistence(state.session);
      set({ session: snapshot, activeMs: snapshot.active_ms });
      await saveSessionSnapshot(snapshot, reason);
    } else {
      const now = nowMonotonic();
      const settled = settleCurrentActivity(state, now);
      const timer = state.windowClosePhase === 'SAVING'
        ? { ...settled.timer, currentActivityStartedAtMonotonic: null }
        : settled.timer;
      set({
        session: settled.session,
        timer,
        ...calculateLiveTimingState(settled.session, timer, now)
      });
      await saveSessionSnapshot(serializeSessionForPersistence(settled.session), reason);
    }
    set({ saveStatus: 'saved', saveError: undefined });
  } catch (error) {
    set({
      saveStatus: 'error',
      saveError: error instanceof Error ? error.message : String(error)
    });
  }
}

function higherPriorityPersistenceReason(
  current: PersistenceReason | undefined,
  requested: PersistenceReason
): PersistenceReason {
  if (current === 'WINDOW_CLOSE' || requested === 'WINDOW_CLOSE') return 'WINDOW_CLOSE';
  if (current === 'RUNTIME' || requested === 'RUNTIME') return 'RUNTIME';
  return 'AUTOSAVE';
}

async function recoveryLoadStep<T>(code: string, operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    const diagnostic = error instanceof Error ? error.message : String(error);
    throw new Error(`${code}: ${diagnostic}`);
  }
}

function recordQuestionEntered(questionId: string | undefined, via: string): void {
  const session = useAppStore.getState().session;
  const question = session?.questions.find((item) => item.id === questionId);
  if (!session || !question) return;
  if (isDynamicSession(session)) {
    recordEvent('item_entered', {
      item_id: question.id,
      section_id: question.section_id,
      visit_count: question.visit_count,
      via
    });
  } else {
    recordEvent('question_entered', {
      question_id: question.id,
      section_id: question.section_id,
      module_id: question.module_id,
      visit_count: question.visit_count,
      via
    });
  }
}

function recordEvent(eventType: string, payload: Record<string, unknown>): void {
  const state = useAppStore.getState();
  const session = state.session;
  if (!session) return;
  const seq = state.eventSeq + 1;
  const entry = createEvent(session.session_id, seq, Math.round(state.activeMs), eventType, payload);
  useAppStore.setState({ eventSeq: seq, events: [...state.events, entry] });
  eventPersistenceTail = eventPersistenceTail.then(async () => {
    try {
      await appendEvent(entry);
    } catch (error) {
      eventPersistenceFailure = error instanceof Error ? error.message : String(error);
      useAppStore.setState({ saveStatus: 'error', saveError: eventPersistenceFailure });
    }
  });
}

async function flushEventPersistence(): Promise<void> {
  await eventPersistenceTail;
  if (eventPersistenceFailure) {
    const failure = eventPersistenceFailure;
    eventPersistenceFailure = undefined;
    throw new Error(failure);
  }
}

interface SettledStoreTiming {
  session: PracticeSession;
  timer: RuntimeTimer;
  activeMs: number;
  pausedMs: number;
  questionActiveMs: number;
  scopeActiveMs: number;
  taskActiveMs: number;
  taskRemainingMs: number | null;
}

function settleCurrentActivity(state: AppState, now: number): SettledStoreTiming {
  if (!state.session || !state.timer) throw new Error('No active session activity.');
  const settled = settleActivityTimer(state.timer, now);
  const withActivity = applyActivityDelta(state.session, settled.activityId, settled.deltaMs);
  const session = applyDerivedTiming({
    ...withActivity,
    paused_ms: currentPausedMs(settled.timer, now)
  });
  const timer = applyActivityStartPolicy(settled.timer, session, now);
  return {
    session,
    timer,
    ...calculateLiveTimingState(session, timer, now)
  };
}

function applyActivityDelta(session: PracticeSession, activityId: string, deltaMs: number): PracticeSession {
  const question = session.questions.find((item) => item.id === activityId);
  if (!question || deltaMs <= 0) return applyDerivedTiming(session);
  if (taskIdForQuestion(question)) {
    return applyDerivedTiming(applyTaskActivityDelta(session, activityId, deltaMs));
  }
  const activeTimeMs = (session.answers[activityId]?.active_time_ms ?? 0) + Math.max(0, deltaMs);
  return applyDerivedTiming(
    finalizeQuestion(
      session,
      question,
      activeTimeMs,
      shouldQuestionBeOvertime(session, question, activeTimeMs)
    )
  );
}

function calculateLiveTimingState(
  session: PracticeSession,
  timer: RuntimeTimer,
  now: number
): Pick<AppState, 'activeMs' | 'pausedMs' | 'questionActiveMs' | 'scopeActiveMs' | 'taskActiveMs' | 'taskRemainingMs'> {
  const task = getCurrentTask(session);
  const rawLiveDelta = previewActivityDelta(timer, now);
  const capAtLimit = task && task.remaining_ms !== null &&
    ((task.section_id === 'Writing' && session.mode === 'exam_simulation') || task.task_id.startsWith('SI'));
  const liveDelta = capAtLimit ? Math.min(rawLiveDelta, task.remaining_ms ?? rawLiveDelta) : rawLiveDelta;
  const ledger = deriveTimingLedger(session, {
    activityId: timer.currentActivityId,
    deltaMs: liveDelta
  });
  const listenRepeat = task?.task_id.startsWith('SR') ? getListenRepeatGroupTiming(session) : undefined;
  const taskTiming = task && isLongWritingTask(task)
    ? getTaskTimingState(task, ledger.tasks[task.task_id] ?? task.active_time_ms)
    : undefined;
  return {
    activeMs: ledger.sessionActiveMs,
    pausedMs: currentPausedMs(timer, now),
    questionActiveMs: ledger.questions[session.current_question_id] ?? 0,
    scopeActiveMs: ledger.scopes[session.current_scope_id] ?? 0,
    taskActiveMs: task ? ledger.tasks[task.task_id] ?? 0 : 0,
    taskRemainingMs: taskTiming?.remaining_ms ?? (listenRepeat
      ? Math.max(0, listenRepeat.remaining_ms - liveDelta)
      : task?.remaining_ms === null || task?.remaining_ms === undefined
        ? null
        : Math.max(0, task.remaining_ms - liveDelta))
  };
}

function timingStateFromSettledSession(
  session: PracticeSession,
  pausedMs: number
): Pick<AppState, 'activeMs' | 'pausedMs' | 'questionActiveMs' | 'scopeActiveMs' | 'taskActiveMs' | 'taskRemainingMs'> {
  const ledger = deriveTimingLedger(session);
  const task = getCurrentTask(session);
  const listenRepeat = task?.task_id.startsWith('SR') ? getListenRepeatGroupTiming(session) : undefined;
  return {
    activeMs: ledger.sessionActiveMs,
    pausedMs,
    questionActiveMs: ledger.questions[session.current_question_id] ?? 0,
    scopeActiveMs: ledger.scopes[session.current_scope_id] ?? 0,
    taskActiveMs: task ? ledger.tasks[task.task_id] ?? 0 : 0,
    taskRemainingMs: listenRepeat?.remaining_ms ?? task?.remaining_ms ?? null
  };
}

function setNavigationResult(
  set: (partial: Partial<AppState>) => void,
  state: SettledStoreTiming,
  session: PracticeSession,
  enteredNewQuestion: boolean,
  now: number
): void {
  const normalizedSession = applyDerivedTiming(session);
  const questionId = session.current_question_id;
  const timer = enteredNewQuestion
    ? applyActivityStartPolicy(startActivity(state.timer, questionId, now), normalizedSession, now)
    : state.timer;
  set({
    session: normalizedSession,
    timer,
    ...calculateLiveTimingState(normalizedSession, timer, now),
    sessionNotice: undefined
  });
}

function applyActivityStartPolicy(timer: RuntimeTimer, session: PracticeSession, now: number): RuntimeTimer {
  const task = getCurrentTask(session);
  if (session.current_section_id !== 'Speaking') {
    const writingFrozen = task?.section_id === 'Writing' && session.mode === 'exam_simulation' &&
      (task.is_overtime || task.remaining_ms === 0);
    return {
      ...timer,
      currentActivityStartedAtMonotonic: !writingFrozen && timer.pausedAtMonotonic === null ? now : null
    };
  }
  const interviewExpired = task?.task_id.startsWith('SI') && task.remaining_ms === 0;
  const shouldRun = !interviewExpired && (task?.status === 'ACTIVE' || task?.status === 'OVERTIME');
  return { ...timer, currentActivityStartedAtMonotonic: shouldRun && timer.pausedAtMonotonic === null ? now : null };
}

function mutateWritingSession(
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
  transform: (session: PracticeSession) => PracticeSession,
  eventType: string
): boolean {
  const state = get();
  if (isInteractionFrozen(state) || state.sessionNotice || !state.session || !state.timer) return false;
  const now = nowMonotonic();
  const settled = settleCurrentActivity(state, now);
  const transformed = transform(settled.session);
  if (transformed === settled.session) {
    set({
      session: settled.session,
      timer: settled.timer,
      ...calculateLiveTimingState(settled.session, settled.timer, now)
    });
    return false;
  }
  const updated = applyDerivedTiming(transformed);
  set({ session: updated, timer: settled.timer, ...calculateLiveTimingState(updated, settled.timer, now) });
  const task = getCurrentTask(updated);
  recordEvent(eventType, {
    task_id: task?.task_id,
    modification_count: task?.modification_count ?? 0
  });
  scheduleAnswerAutosave();
  return true;
}

function mutateDynamicLongTextState(
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
  operation: (
    session: DynamicPracticeSession,
    itemId: string,
    activeMs: number
  ) => { session: DynamicPracticeSession; text?: string },
  inputType: WritingInputType
): boolean {
  const state = get();
  if (isInteractionFrozen(state) || state.sessionNotice || !state.session || !isDynamicSession(state.session) || !state.timer) {
    return false;
  }
  const item = getCurrentQuestion(state.session);
  if (!item || item.renderer !== 'long_text') return false;
  const now = nowMonotonic();
  const settled = settleCurrentActivity(state, now);
  const activeMs = settled.session.answers[item.id]?.active_time_ms ?? 0;
  const result = operation(settled.session as DynamicPracticeSession, item.id, activeMs);
  if (result.text === undefined || result.session === settled.session) {
    set({
      session: settled.session,
      timer: settled.timer,
      ...calculateLiveTimingState(settled.session, settled.timer, now)
    });
    return false;
  }
  const updatedItem = result.session.questions.find((question) => question.id === item.id)!;
  const updated = applyDerivedTiming(upsertAnswer(
    result.session,
    updatedItem,
    result.text,
    activeMs,
    shouldQuestionBeOvertime(result.session, updatedItem, activeMs)
  ));
  set({
    session: updated,
    timer: settled.timer,
    ...calculateLiveTimingState(updated, settled.timer, now)
  });
  const writing = updatedItem.writing_state;
  recordEvent('writing_text_changed', {
    item_id: item.id,
    input_type: inputType,
    word_count: writing?.word_count ?? 0,
    character_count: writing?.character_count ?? 0,
    modification_count: writing?.modification_count ?? 0
  });
  scheduleAnswerAutosave();
  return true;
}

function recordPendingTaskOvertimeEvent(): void {
  const state = useAppStore.getState();
  const task = state.session ? getCurrentTask(state.session) : undefined;
  if (!state.session || !task?.is_overtime || task.overtime_event_recorded) return;
  useAppStore.setState({ session: markTaskOvertimeEventRecorded(state.session, task.task_id) });
  recordEvent('task_overtime', {
    task_id: task.task_id,
    active_time_ms: task.active_time_ms,
    timer_limit_ms: task.timer_limit_ms
  });
}

function recordPendingDynamicOvertimeEvent(): void {
  const state = useAppStore.getState();
  if (!state.session || !isDynamicSession(state.session) || !state.timer || state.isPaused) return;
  const item = getCurrentQuestion(state.session);
  if (!item || item.custom_time_limit_ms === null || item.custom_time_limit_ms === undefined) return;
  const prior = state.session.answers[item.id];
  if (prior?.is_overtime || state.questionActiveMs < item.custom_time_limit_ms) return;
  const now = nowMonotonic();
  const settled = settleCurrentActivity(state, now);
  const activeMs = settled.session.answers[item.id]?.active_time_ms ?? 0;
  const session = applyDerivedTiming(finalizeQuestion(settled.session, item, activeMs, true));
  useAppStore.setState({
    session,
    timer: settled.timer,
    ...calculateLiveTimingState(session, settled.timer, now)
  });
  recordEvent('item_overtime', {
    item_id: item.id,
    active_time_ms: activeMs,
    custom_time_limit_ms: item.custom_time_limit_ms
  });
  void useAppStore.getState().persist();
}

function isInteractionFrozen(state: AppState): boolean {
  return state.windowClosePhase !== 'IDLE' || state.isPaused || Boolean(state.dynamicItemDialog) || state.session?.view === 'SESSION_SUMMARY';
}

function scheduleAnswerAutosave(): void {
  if (typeof window === 'undefined') return;
  if (answerAutosaveTimer !== undefined) window.clearTimeout(answerAutosaveTimer);
  answerAutosaveTimer = window.setTimeout(() => {
    answerAutosaveTimer = undefined;
    void useAppStore.getState().persist();
  }, 500);
}

function isNavigationLocked(lockedUntil: number): boolean {
  return nowMonotonic() < lockedUntil;
}

function lockNavigation(set: (partial: Partial<AppState>) => void): void {
  if (typeof window === 'undefined') return;
  const lockedUntil = nowMonotonic() + 250;
  set({ navigationLockedUntil: lockedUntil });
  window.setTimeout(() => {
    if (useAppStore.getState().navigationLockedUntil <= lockedUntil) {
      useAppStore.setState({ navigationLockedUntil: 0 });
    }
  }, 260);
}

function nowMonotonic(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

const DYNAMIC_ANSWER_REJECTED = Symbol('DYNAMIC_ANSWER_REJECTED');

function normalizeDynamicAnswer(question: PracticeSession['questions'][number], answer: unknown): unknown {
  const renderer = question.renderer;
  if (renderer === 'single_choice') {
    if (answer === null) return null;
    return typeof answer === 'string' && question.option_labels?.includes(answer)
      ? answer
      : DYNAMIC_ANSWER_REJECTED;
  }
  if (renderer === 'multiple_choice') {
    if (!Array.isArray(answer)) return DYNAMIC_ANSWER_REJECTED;
    const labels = answer.map(String);
    if (labels.some((label) => !question.option_labels?.includes(label))) return DYNAMIC_ANSWER_REJECTED;
    return Array.from(new Set(labels));
  }
  if (renderer === 'short_text' && typeof answer === 'string') {
    return sanitizeWritingText(answer, { allow_line_breaks: false }).text;
  }
  if (renderer === 'long_text' && typeof answer === 'string') {
    return sanitizeWritingText(answer, { allow_line_breaks: true }).text;
  }
  return DYNAMIC_ANSWER_REJECTED;
}
