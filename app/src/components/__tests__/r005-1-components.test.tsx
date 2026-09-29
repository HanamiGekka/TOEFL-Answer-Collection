import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackageSummary } from '../../types';
import { finalizeCurrentScope, markUncertain, skipQuestion } from '../../lib/sessionEngine';
import { useAppStore } from '../../store/appStore';
import { startLegacySessionForTest } from '../../test/legacySession';
import { TopBar } from '../TopBar';
import { ReviewPanel } from '../ReviewPanel';
import { PracticeShell } from '../PracticeShell';
import { BottomBar } from '../BottomBar';

vi.mock('../../lib/storage', () => ({
  scanPackages: vi.fn(async () => []),
  appendEvent: vi.fn(async () => undefined),
  saveSessionSnapshot: vi.fn(async () => undefined),
  exportSessionTextAtomic: vi.fn(async () => undefined),
  exportTextAtomic: vi.fn(async () => undefined),
  openSessionExportDirectory: vi.fn(async () => undefined),
  openTypingExportDirectory: vi.fn(async () => undefined)
}));

const packageSummary: PackageSummary = {
  package_id: 'Mock.01.A.1',
  source_path: 'readonly',
  modules: []
};

beforeEach(() => {
  useAppStore.setState({
    packages: [packageSummary],
    selectedPackage: packageSummary,
    selectedSections: ['Reading', 'Listening'],
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
    sessionNotice: undefined,
    exportStatus: 'idle',
    exportError: undefined,
    exportDirectory: undefined
  });
});

afterEach(cleanup);

async function moveStoreSessionToListening() {
    startLegacySessionForTest();
  let session = useAppStore.getState().session;
  if (!session) throw new Error('session should exist');
  for (let count = 0; count < 2; count += 1) {
    const visited = {
      ...session,
      questions: session.questions.map((question) =>
        session?.active_scope_question_ids.includes(question.id)
          ? { ...question, encountered: true, visit_count: Math.max(1, question.visit_count) }
          : question
      )
    };
    const result = await finalizeCurrentScope(visited, 100, async () => undefined);
    session = result.session;
  }
  useAppStore.setState({ session });
}

describe('R005.1 scoped UI', () => {
  it('derives Listening TopBar and answer card from the Listening scope only', async () => {
    await moveStoreSessionToListening();
    useAppStore.setState({ activeMs: 50_000, scopeActiveMs: 0 });
    const { container } = render(
      <>
        <TopBar />
        <ReviewPanel />
      </>
    );

    expect(screen.getByText('Listening Module 1')).toBeInTheDocument();
    expect(screen.queryByText(/Reading Module/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^L1 未/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^R1 未/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /音频结束/ })).not.toBeInTheDocument();
    expect(container.querySelector('.timer')).toHaveTextContent('00:00');
  });

  it('keeps current highlighting separate from combined progress flags', () => {
    useAppStore.setState({ selectedSections: ['Listening'] });
    startLegacySessionForTest();
    const session = useAppStore.getState().session;
    if (!session) throw new Error('session should exist');
    const question = session.questions[0];
    const combined = markUncertain(skipQuestion(session, question, 1_000), question.id, true);
    useAppStore.setState({ session: combined });
    render(<ReviewPanel />);

    const current = screen.getByRole('button', { name: /^L1 未/ });
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(current).toHaveTextContent('未作答 · 跳过 · 不确定');
  });

  it('shows long unencountered lists in a fixed dialog with a collapsed remainder', async () => {
    await act(async () => {
    startLegacySessionForTest();
      await Promise.resolve();
      useAppStore.setState({
        sessionNotice: {
          kind: 'warning',
          message: '当前范围仍有未访问题。',
          questionIds: Array.from({ length: 30 }, (_, index) => `Reading-${index + 1}`)
        }
      });
    });
    render(<PracticeShell />);

    expect(screen.getByRole('dialog', { name: '完成前提示' })).toBeInTheDocument();
    expect(screen.getByText('另有 18 项')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消 / 关闭' })).toBeInTheDocument();
  });

  it('disables previous and old answer-card targets in exam-simulation Listening', () => {
    useAppStore.setState({ mode: 'exam_simulation', selectedSections: ['Listening'] });
    startLegacySessionForTest();
    useAppStore.getState().nextQuestion();
    render(
      <>
        <ReviewPanel />
        <BottomBar />
      </>
    );

    expect(screen.getByRole('button', { name: '上一题' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^L1 未/ })).toBeDisabled();
  });
});
