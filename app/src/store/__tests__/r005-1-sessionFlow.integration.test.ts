import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackageSummary, PracticeSession, SectionName } from '../../types';
import { useAppStore } from '../appStore';
import { startLegacySessionForTest } from '../../test/legacySession';
import { appendEvent, exportSessionBundleAtomic, saveSessionSnapshot } from '../../lib/storage';

vi.mock('../../lib/storage', () => ({
  scanPackages: vi.fn(async () => []),
  appendEvent: vi.fn(async () => undefined),
  saveSessionSnapshot: vi.fn(async () => undefined),
  exportSessionTextAtomic: vi.fn(async () => undefined),
  exportSessionBundleAtomic: vi.fn(async () => undefined),
  exportTextAtomic: vi.fn(async () => undefined),
  openSessionExportDirectory: vi.fn(async () => undefined),
  openTypingExportDirectory: vi.fn(async () => undefined)
}));

const packageSummary: PackageSummary = {
  package_id: '01.21.A.1',
  source_path: 'readonly',
  modules: []
};

type ScopedPracticeSession = PracticeSession & {
  current_section_id: SectionName;
  current_scope_id: string;
  current_question_id: string;
  active_scope_question_ids: string[];
};

type R0051Store = ReturnType<typeof useAppStore.getState> & {
  finalizeCurrentScope: () => Promise<void>;
};

function resetStore() {
  useAppStore.setState({
    packages: [packageSummary],
    selectedPackage: packageSummary,
    mode: 'practice',
    selectedSections: ['Reading', 'Listening'],
    session: undefined,
    eventSeq: 0,
    timer: undefined,
    activeMs: 0,
    pausedMs: 0,
    isPaused: false,
    hideTimes: false,
    navigationLockedUntil: 0,
    saveStatus: 'idle',
    sessionNotice: undefined
  });
}

function store(): R0051Store {
  return useAppStore.getState() as R0051Store;
}

function scopedSession(): ScopedPracticeSession {
  const session = useAppStore.getState().session;
  if (!session) throw new Error('expected an active practice session');
  return session as ScopedPracticeSession;
}

async function settleAsyncWrites() {
  await Promise.resolve();
  await Promise.resolve();
}

async function visitEveryQuestionInCurrentScope(expectedSection: SectionName) {
  const initial = scopedSession();
  expect(initial.active_scope_question_ids.length).toBeGreaterThan(0);

  for (const questionId of initial.active_scope_question_ids) {
    const current = scopedSession();
    const globalIndex = current.questions.findIndex((question) => question.id === questionId);
    expect(globalIndex, `missing ${questionId} from the session question collection`).toBeGreaterThanOrEqual(0);

    // The production navigation lock prevents accidental double-clicks. Resetting it
    // here represents distinct user clicks without slowing this integration test.
    useAppStore.setState({ navigationLockedUntil: 0 });
    if (expectedSection === 'Listening' && current.current_question_id !== questionId) {
      store().nextQuestion();
    } else {
      store().goToQuestion(globalIndex);
    }
    await settleAsyncWrites();

    const entered = scopedSession();
    const enteredQuestion = entered.questions.find((question) => question.id === questionId) as
      | (PracticeSession['questions'][number] & { visit_count?: number })
      | undefined;
    expect(entered.current_question_id).toBe(questionId);
    expect(entered.current_section_id).toBe(expectedSection);
    expect(enteredQuestion?.encountered).toBe(true);
    expect(enteredQuestion?.visit_count).toBeGreaterThan(0);
  }
}

describe('R005.1 complete cross-section session flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('isolates Reading modules, completes Listening, reaches Summary, and exports the full session', async () => {
    startLegacySessionForTest();
    await settleAsyncWrites();

    expect(scopedSession()).toMatchObject({
      current_section_id: 'Reading',
      current_scope_id: 'READING_MODULE_1',
      current_question_id: 'Reading-1'
    });
    expect(scopedSession().active_scope_question_ids).toEqual(
      Array.from({ length: 35 }, (_, index) => `Reading-${index + 1}`)
    );

    await visitEveryQuestionInCurrentScope('Reading');
    useAppStore.setState({ activeMs: 35_000 });
    await store().finalizeCurrentScope();

    expect(scopedSession()).toMatchObject({
      current_section_id: 'Reading',
      current_scope_id: 'READING_MODULE_2',
      current_question_id: 'Reading-36'
    });
    expect(scopedSession().active_scope_question_ids).toEqual(
      Array.from({ length: 15 }, (_, index) => `Reading-${index + 36}`)
    );

    await visitEveryQuestionInCurrentScope('Reading');
    useAppStore.setState({ activeMs: 50_000 });
    await store().finalizeCurrentScope();

    const listening = scopedSession();
    expect(listening.current_section_id).toBe('Listening');
    expect(listening.current_scope_id).not.toMatch(/^READING_/);
    expect(listening.current_question_id).toBe('Listening-1');
    expect(listening.active_scope_question_ids.every((id) => id.startsWith('Listening-'))).toBe(true);
    expect(listening.active_scope_question_ids.some((id) => id.startsWith('Reading-'))).toBe(false);

    store().answerCurrent('B');
    await visitEveryQuestionInCurrentScope('Listening');
    useAppStore.setState({ activeMs: 60_000 });
    await store().finalizeCurrentScope();
    await settleAsyncWrites();

    expect(scopedSession()).toMatchObject({
      current_section_id: 'Listening',
      current_scope_id: 'LISTENING_MODULE_2',
      current_question_id: 'Listening-33'
    });
    expect(scopedSession().active_scope_question_ids).toEqual(
      Array.from({ length: 15 }, (_, index) => `Listening-${index + 33}`)
    );

    await visitEveryQuestionInCurrentScope('Listening');
    useAppStore.setState({ activeMs: 70_000 });
    await store().finalizeCurrentScope();
    await settleAsyncWrites();

    const summary = scopedSession();
    expect(summary.view).toBe('SESSION_SUMMARY');
    expect(summary.active_ms).toBeGreaterThan(0);
    expect(saveSessionSnapshot).toHaveBeenCalled();
    expect(appendEvent).toHaveBeenCalled();

    const bundleCall = vi.mocked(exportSessionBundleAtomic).mock.calls.at(-1);
    expect(bundleCall).toBeDefined();
    const [exportBase, bundleFiles] = bundleCall!;
    const exported = bundleFiles.map(({ name, content }) => ({
      relativePath: `${exportBase}/${name}`,
      content
    }));
    const exportedNames = exported.map(({ relativePath }) => relativePath.split('/').at(-1));
    expect(exportedNames).toEqual(
      expect.arrayContaining([
        'session_summary.md',
        'answers.json',
        'events.jsonl',
        'question_metrics.csv',
        'Reading.md',
        'Listening.md'
      ])
    );
    expect(exported.every(({ relativePath }) => relativePath.startsWith('records/01.21.A.1/'))).toBe(true);

    const exportBases = new Set(exported.map(({ relativePath }) => relativePath.slice(0, relativePath.lastIndexOf('/'))));
    expect(exportBases.size).toBe(1);
    expect([...exportBases][0]).toMatch(
      /^records\/01\.21\.A\.1\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_.+$/
    );

    const answersFile = exported.find(({ relativePath }) => relativePath.endsWith('/answers.json'));
    expect(answersFile).toBeDefined();
    const answers = JSON.parse(answersFile?.content ?? '{}') as Record<string, unknown>;
    expect(answers).toMatchObject({
      app_version: '1.0.0',
      session_id: summary.session_id,
      package_id: '01.21.A.1',
      mode: 'practice'
    });
    expect(Number(answers.active_time_ms)).toBeGreaterThan(0);
    expect(answersFile?.content).not.toMatch(/correct[_ ]?answer|standard[_ ]?answer|标准答案/i);
  });
});
