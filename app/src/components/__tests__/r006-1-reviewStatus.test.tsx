import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackageSummary } from '../../types';
import { enterQuestion, markUncertain, skipQuestion, upsertAnswer } from '../../lib/sessionEngine';
import { useAppStore } from '../../store/appStore';
import { startLegacySessionForTest } from '../../test/legacySession';
import { ReviewPanel } from '../ReviewPanel';

vi.mock('../../lib/storage', () => ({
  scanPackages: vi.fn(async () => []),
  appendEvent: vi.fn(async () => undefined),
  saveSessionSnapshot: vi.fn(async () => undefined),
  exportSessionTextAtomic: vi.fn(async () => undefined),
  exportTextAtomic: vi.fn(async () => undefined),
  openSessionExportDirectory: vi.fn(async () => undefined),
  openTypingExportDirectory: vi.fn(async () => undefined),
  loadBlueprintOverride: vi.fn(async () => undefined)
}));

const pkg: PackageSummary = { package_id: 'Synthetic.01.A.1', source_path: 'readonly-fixture', modules: [] };

beforeEach(() => {
  useAppStore.setState({
    packages: [pkg], selectedPackage: pkg, selectedSections: ['Writing'], mode: 'practice',
    session: undefined, events: [], eventSeq: 0, timer: undefined, activeMs: 0, pausedMs: 0,
    questionActiveMs: 0, scopeActiveMs: 0, taskActiveMs: 0, taskRemainingMs: null,
    isPaused: false, navigationLockedUntil: 0, sessionNotice: undefined,
    saveStatus: 'idle', exportStatus: 'idle', exportError: undefined, exportDirectory: undefined
  });
});

afterEach(cleanup);

describe('R006.1 ReviewPanel Question progress', () => {
  it('keeps current highlighting independent from W7-W10 progress and flags', () => {
    startLegacySessionForTest();
    let session = useAppStore.getState().session;
    if (!session) throw new Error('missing Writing session');

    session = enterQuestion(session, 'Writing-7');
    const w7 = session.questions.find((question) => question.id === 'Writing-7');
    if (!w7) throw new Error('missing W7');
    session = upsertAnswer(session, w7, 'answered', 100, true);
    session = enterQuestion(session, 'Writing-9');
    const w9 = session.questions.find((question) => question.id === 'Writing-9');
    if (!w9) throw new Error('missing W9');
    session = skipQuestion(session, w9, 100);
    session = enterQuestion(session, 'Writing-10');
    session = markUncertain(session, 'Writing-10', true);
    session = enterQuestion(session, 'Writing-8');
    useAppStore.setState({ session });

    render(<ReviewPanel />);

    expect(screen.getByRole('button', { name: /^W7 已作答 · 超时$/ }))
      .toHaveClass('answer-card-cell', 'answered', 'overtime');
    expect(screen.getByRole('button', { name: /^W8 未作答$/ }))
      .toHaveClass('answer-card-cell', 'current');
    expect(screen.getByRole('button', { name: /^W8 未作答$/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /^W9 未作答 · 跳过$/ }))
      .toHaveClass('answer-card-cell', 'skipped');
    expect(screen.getByRole('button', { name: /^W10 未作答 · 不确定$/ }))
      .toHaveClass('answer-card-cell', 'uncertain');
    expect(screen.queryByText('进行中')).not.toBeInTheDocument();
  });
});
