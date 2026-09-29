import { DEFAULT_BLUEPRINT, createQuestionsFromBlueprint } from '../lib/blueprint';
import { buildInitialSessionRuntime, createEvent } from '../lib/sessionEngine';
import { createActivityTimer } from '../lib/timeLedger';
import { useAppStore } from '../store/appStore';

/**
 * Starts the pre-v6 Blueprint runtime for compatibility tests only.
 * Production legacy Sessions enter through Recovery; new product Sessions use v6.
 */
export function startLegacySessionForTest(): void {
  const state = useAppStore.getState();
  const selectedPackage = state.selectedPackage;
  if (!selectedPackage) throw new Error('A Package fixture is required.');
  const blueprint = state.blueprint ?? DEFAULT_BLUEPRINT;
  const nowIso = new Date().toISOString();
  const now = typeof performance === 'undefined' ? Date.now() : performance.now();
  const session = buildInitialSessionRuntime({
    session_schema_version: 5,
    session_id: `${selectedPackage.package_id}-legacy-test-${Date.now()}`,
    package_id: selectedPackage.package_id,
    source_path: selectedPackage.source_path,
    mode: state.mode,
    timing_profile_id: 'toefl-2026-practice',
    timing_profile_version: '1.0.0',
    blueprint_id: blueprint.blueprint_id,
    blueprint_version: blueprint.version,
    blueprint_override_package_id: state.blueprintOverridePackageId,
    created_at: nowIso,
    started_at: nowIso,
    active_ms: 0,
    paused_ms: 0,
    questions: createQuestionsFromBlueprint(blueprint, state.selectedSections),
    answers: {},
    modules: [],
    tasks: [],
    current_section: state.selectedSections[0],
    current_question_index: 0,
    view: 'PRACTICE'
  });
  const started = createEvent(session.session_id, 1, 0, 'session_started', {
    session_schema_version: 5,
    legacy_test_fixture: true,
    selected_sections: state.selectedSections
  });
  useAppStore.setState({
    session,
    events: [started],
    eventSeq: 1,
    timer: createActivityTimer(session.current_question_id, now),
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
    exportDirectory: undefined
  });
  void useAppStore.getState().persist();
}
