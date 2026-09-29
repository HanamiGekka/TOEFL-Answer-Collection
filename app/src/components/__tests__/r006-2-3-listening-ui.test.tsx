import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PracticeSession } from '../../types';
import { DEFAULT_BLUEPRINT, createQuestionsFromBlueprint } from '../../lib/blueprint';
import {
  advanceFromCurrent,
  buildInitialSessionRuntime,
  finalizeCurrentScope,
  markQuestionEncountered
} from '../../lib/sessionEngine';
import { useAppStore } from '../../store/appStore';
import { BottomBar } from '../BottomBar';
import { ReviewPanel } from '../ReviewPanel';
import { TopBar } from '../TopBar';

vi.mock('../../lib/storage', () => ({
  appendEvent: vi.fn(async () => undefined),
  exportSessionTextAtomic: vi.fn(async () => undefined),
  exportTextAtomic: vi.fn(async () => undefined),
  openSessionExportDirectory: vi.fn(async () => undefined),
  openTypingExportDirectory: vi.fn(async () => undefined),
  saveSessionSnapshot: vi.fn(async () => undefined),
  scanPackages: vi.fn(async () => [])
}));

function listeningSession(): PracticeSession {
  return buildInitialSessionRuntime({
    session_schema_version: 5,
    session_id: 'r006-2-3-ui',
    package_id: 'Mock.01.A.1',
    source_path: 'readonly-fixture',
    mode: 'practice',
    timing_profile_id: 'toefl-2026-practice',
    timing_profile_version: '1.0.0',
    blueprint_id: DEFAULT_BLUEPRINT.blueprint_id,
    blueprint_version: DEFAULT_BLUEPRINT.version,
    created_at: '2026-07-22T00:00:00.000Z',
    active_ms: 0,
    paused_ms: 0,
    questions: createQuestionsFromBlueprint(DEFAULT_BLUEPRINT, ['Listening']),
    answers: {},
    modules: [],
    view: 'PRACTICE'
  });
}

function encounterCurrentScope(session: PracticeSession): PracticeSession {
  return session.active_scope_question_ids.reduce(
    (current, questionId) => markQuestionEncountered(current, questionId),
    session
  );
}

function advanceBy(session: PracticeSession, count: number): PracticeSession {
  let current = session;
  for (let index = 0; index < count; index += 1) current = advanceFromCurrent(current, 100).session;
  return current;
}

function renderListening(session: PracticeSession) {
  useAppStore.setState({ session, isPaused: false, scopeActiveMs: 0, questionActiveMs: 0 });
  return render(
    <>
      <TopBar />
      <ReviewPanel />
      <BottomBar />
    </>
  );
}

beforeEach(() => {
  useAppStore.setState({
    session: undefined,
    events: [],
    eventSeq: 0,
    timer: undefined,
    activeMs: 0,
    pausedMs: 0,
    questionActiveMs: 0,
    scopeActiveMs: 0,
    taskActiveMs: 0,
    taskRemainingMs: null,
    isPaused: false,
    navigationLockedUntil: 0,
    sessionNotice: undefined,
    windowClosePhase: 'IDLE'
  });
});

afterEach(cleanup);

describe('Listening Module UI with the current Blueprint', () => {
  it('shows Listening Module 1, the global 1/47 denominator, and one aria-current answer-card item at L1', () => {
    renderListening(listeningSession());
    expect(screen.getByText('Listening Module 1')).toBeInTheDocument();
    expect(screen.getByText('Listening · 第 1 / 47 题')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^L1 未/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByRole('button', { name: /^L33 / })).not.toBeInTheDocument();
    expect(screen.queryByText(/Alt\+R|open_review/i)).not.toBeInTheDocument();
  });

  it('uses dynamic Module/Section completion labels at L32 and L47', async () => {
    const atL32 = advanceBy(encounterCurrentScope(listeningSession()), 31);
    const module1View = renderListening(atL32);
    expect(screen.getByText('Listening Module 1')).toBeInTheDocument();
    expect(screen.getByText('Listening · 第 32 / 47 题')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '完成本模块' })).toBeEnabled();
    module1View.unmount();

    const module1 = await finalizeCurrentScope(atL32, 100, async () => undefined);
    expect(module1.session.current_question_id).toBe('Listening-33');
    const module2StartView = renderListening(module1.session);
    expect(screen.getByText('Listening Module 2')).toBeInTheDocument();
    expect(screen.getByText('Listening · 第 33 / 47 题')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^L33 未/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByRole('button', { name: /^L32 / })).not.toBeInTheDocument();
    module2StartView.unmount();

    const atL47 = advanceBy(encounterCurrentScope(module1.session), 14);
    renderListening(atL47);
    expect(screen.getByText('Listening Module 2')).toBeInTheDocument();
    expect(screen.getByText('Listening · 第 47 / 47 题')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '完成 Listening' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^L47 未/ })).toHaveAttribute('aria-current', 'true');
  });
});
