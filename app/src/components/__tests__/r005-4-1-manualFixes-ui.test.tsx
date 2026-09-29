import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackageSummary } from '../../types';
import { enterTask, startSpeakingTask } from '../../lib/taskRuntime';
import { useAppStore } from '../../store/appStore';
import { startLegacySessionForTest } from '../../test/legacySession';
import { AnswerPanel } from '../AnswerPanel';
import { BottomBar } from '../BottomBar';
import { ReviewPanel } from '../ReviewPanel';
import { TopBar } from '../TopBar';

vi.mock('../../lib/storage', () => ({
  scanPackages: vi.fn(async () => []), appendEvent: vi.fn(async () => undefined),
  saveSessionSnapshot: vi.fn(async () => undefined), exportSessionTextAtomic: vi.fn(async () => undefined),
  exportTextAtomic: vi.fn(async () => undefined), openSessionExportDirectory: vi.fn(async () => undefined),
  openTypingExportDirectory: vi.fn(async () => undefined)
}));

const pkg: PackageSummary = { package_id: 'Mock.01.A.1', source_path: 'readonly', modules: [] };

beforeEach(() => {
  useAppStore.setState({
    packages: [pkg], selectedPackage: pkg, mode: 'practice', selectedSections: ['Writing'],
    session: undefined, events: [], eventSeq: 0, timer: undefined, activeMs: 0, pausedMs: 0,
    questionActiveMs: 0, scopeActiveMs: 0, taskActiveMs: 0, taskRemainingMs: null,
    isPaused: false, navigationLockedUntil: 0, saveStatus: 'idle', exportStatus: 'idle', sessionNotice: undefined
  });
});

afterEach(cleanup);

function moveTo(taskId: string): void {
    startLegacySessionForTest();
  const current = useAppStore.getState().session;
  if (!current) throw new Error('missing session');
  useAppStore.setState({ session: enterTask(current, taskId) });
}

describe('R005.4.1 Writing Task controls', () => {
  it.each(['上一题', '跳过', '不确定'])('hides %s for Email', (label) => {
    moveTo('WRITING_EMAIL');
    render(<BottomBar />);
    expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '完成当前 Writing Task' })).toBeInTheDocument();
  });

  it('hides generic navigation for Academic Discussion', () => {
    moveTo('WRITING_ACADEMIC_DISCUSSION');
    render(<BottomBar />);
    expect(screen.queryByRole('button', { name: /上一题|下一题|跳过|不确定/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '完成当前 Writing Task' })).toBeInTheDocument();
  });

  it('removes the generic Review jump panel for long Writing', () => {
    moveTo('WRITING_EMAIL');
    render(<ReviewPanel />);
    expect(screen.queryByRole('heading', { name: '答题卡' })).not.toBeInTheDocument();
  });

  it('keeps Build a Sentence question navigation', () => {
    moveTo('WRITING_BUILD_SENTENCE');
    render(<BottomBar />);
    expect(screen.getByRole('button', { name: '下一题' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '跳过' })).toBeInTheDocument();
  });

  it.each(['Reading', 'Listening'] as const)('keeps %s BottomBar behavior', (section) => {
    useAppStore.setState({ selectedSections: [section] });
    startLegacySessionForTest();
    render(<BottomBar />);
    expect(screen.getByRole('button', { name: '跳过' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '不确定' })).toBeInTheDocument();
  });

  it('uses Task timing for the red badge even when Email Question retains 450000ms', () => {
    moveTo('WRITING_EMAIL');
    const current = useAppStore.getState().session!;
    useAppStore.setState({
      session: {
        ...current,
        questions: current.questions.map((question) => question.id === 'Writing-11'
          ? { ...question, time_limit_ms: 450_000 }
          : question)
      },
      taskActiveMs: 420_000,
      taskRemainingMs: 0,
      questionActiveMs: 420_000
    });
    render(<AnswerPanel />);
    expect(screen.getByText('⏱ 超时')).toBeInTheDocument();
  });

  it('keeps an explicit sticky overtime badge visible at the exact Discussion boundary', async () => {
    moveTo('WRITING_ACADEMIC_DISCUSSION');
    await vi.waitFor(() => expect(useAppStore.getState().saveStatus).toBe('saved'));
    useAppStore.setState({ taskActiveMs: 600_000, taskRemainingMs: 0 });
    render(<TopBar />);
    expect(screen.getByText('⏱ 超时')).toHaveClass('danger');
  });

  it.each(['WRITING_EMAIL', 'WRITING_ACADEMIC_DISCUSSION'])('blocks direct generic Store actions in %s', (taskId) => {
    moveTo(taskId);
    const before = useAppStore.getState().session!;
    const beforeId = before.current_question_id;
    useAppStore.getState().skipCurrent();
    useAppStore.getState().toggleReview();
    useAppStore.getState().previousQuestion();
    useAppStore.getState().nextQuestion();
    useAppStore.getState().goToQuestion(0);
    const after = useAppStore.getState().session!;
    expect(after.current_question_id).toBe(beforeId);
    expect(after.answers[beforeId]?.is_skipped ?? false).toBe(false);
    expect(after.answers[beforeId]?.is_uncertain ?? false).toBe(false);
  });

  it('disables newly rendered Speaking result buttons during pending and guard', () => {
    useAppStore.setState({ selectedSections: ['Speaking'] });
    startLegacySessionForTest();
    const current = useAppStore.getState().session!;
    const started = startSpeakingTask(current, 'SR1');
    useAppStore.setState({
      session: started,
      speakingTransitionPending: true,
      speakingTransitionGuardUntil: performance.now() + 750,
      speakingTransitionGuardTaskId: 'SR1',
      speakingTransitionGuardAttempt: 1
    });
    render(<AnswerPanel />);
    expect(screen.getByRole('button', { name: '标记完成' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '需重练' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('状态切换进行中');
  });
});
