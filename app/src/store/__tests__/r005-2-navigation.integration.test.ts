import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackageSummary } from '../../types';
import { useAppStore } from '../appStore';
import { startLegacySessionForTest } from '../../test/legacySession';

vi.mock('../../lib/storage', () => ({
  scanPackages: vi.fn(async () => []),
  appendEvent: vi.fn(async () => undefined),
  saveSessionSnapshot: vi.fn(async () => undefined),
  exportSessionTextAtomic: vi.fn(async () => undefined),
  openSessionExportDirectory: vi.fn(async () => undefined),
  openTypingExportDirectory: vi.fn(async () => undefined)
}));

const packageSummary: PackageSummary = { package_id: '01.21.A.1', source_path: 'readonly', modules: [] };

function reset(mode: 'practice' | 'exam_simulation', section: 'Reading' | 'Listening') {
  useAppStore.setState({
    packages: [packageSummary],
    selectedPackage: packageSummary,
    mode,
    selectedSections: [section],
    session: undefined,
    events: [],
    eventSeq: 0,
    timer: undefined,
    activeMs: 0,
    pausedMs: 0,
    questionActiveMs: 0,
    scopeActiveMs: 0,
    isPaused: false,
    navigationLockedUntil: 0,
    saveStatus: 'idle',
    exportStatus: 'idle',
    exportError: undefined,
    exportDirectory: undefined,
    sessionNotice: undefined
  });
    startLegacySessionForTest();
}

describe('R005.2 Store Listening navigation guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows practice to return to an encountered Listening question but not jump to a future one', () => {
    reset('practice', 'Listening');
    useAppStore.getState().nextQuestion();
    useAppStore.setState({ navigationLockedUntil: 0 });
    useAppStore.getState().goToQuestion(2);
    expect(useAppStore.getState().session?.current_question_id).toBe('Listening-2');

    useAppStore.getState().goToQuestion(0);
    expect(useAppStore.getState().session?.current_question_id).toBe('Listening-1');
    useAppStore.setState({ navigationLockedUntil: 0 });
    useAppStore.getState().goToQuestion(1);
    expect(useAppStore.getState().session?.current_question_id).toBe('Listening-2');
  });

  it('rejects previous and answer-card back-navigation in exam simulation at the Store layer', () => {
    reset('exam_simulation', 'Listening');
    useAppStore.getState().nextQuestion();
    useAppStore.setState({ navigationLockedUntil: 0 });
    useAppStore.getState().previousQuestion();
    expect(useAppStore.getState().session?.current_question_id).toBe('Listening-2');

    useAppStore.getState().goToQuestion(0);
    expect(useAppStore.getState().session?.current_question_id).toBe('Listening-2');
  });

  it('keeps Reading back-navigation available in exam simulation', () => {
    reset('exam_simulation', 'Reading');
    useAppStore.getState().nextQuestion();
    useAppStore.getState().previousQuestion();
    expect(useAppStore.getState().session?.current_question_id).toBe('Reading-1');
  });
});
