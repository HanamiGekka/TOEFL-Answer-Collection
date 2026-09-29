import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackageSummary } from '../../types';
import { enterTask } from '../../lib/taskRuntime';
import { useAppStore } from '../../store/appStore';
import { startLegacySessionForTest } from '../../test/legacySession';
import { PracticeShell } from '../PracticeShell';
import { WindowCloseDialog } from '../WindowCloseDialog';

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

const pkg: PackageSummary = {
  package_id: 'Theme.01.A.1',
  source_path: 'readonly-theme-fixture',
  modules: []
};

beforeEach(() => {
  useAppStore.setState({
    packages: [pkg],
    selectedPackage: pkg,
    selectedSections: ['Reading'],
    mode: 'practice',
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
    saveStatus: 'idle',
    exportStatus: 'idle',
    exportError: undefined,
    exportDirectory: undefined
  });
});

afterEach(cleanup);

describe('R007.2 stable visual DOM contracts', () => {
  it('keeps the question workspace in the shared chrome without mutating session state', async () => {
    await startSettledSession();
    const beforeRender = useAppStore.getState().session;
    const { container } = render(<PracticeShell />);

    expect(container.querySelector('.practice-layout')).toBeInTheDocument();
    expect(container.querySelector('.top-bar')).toBeInTheDocument();
    expect(container.querySelector('.answer-panel.card')).toBeInTheDocument();
    expect(container.querySelector('.review-panel.card')).toBeInTheDocument();
    expect(container.querySelector('.bottom-bar')).toBeInTheDocument();
    expect(useAppStore.getState().session).toBe(beforeRender);
  });

  it('uses the shared light-theme structure for the long Writing workspace', async () => {
    useAppStore.setState({ selectedSections: ['Writing'] });
    await startSettledSession();
    const session = useAppStore.getState().session;
    if (!session) throw new Error('missing Writing session');
    useAppStore.setState({ session: enterTask(session, 'WRITING_EMAIL') });

    const { container } = render(<PracticeShell />);

    expect(container.querySelector('.practice-main.task-only')).toBeInTheDocument();
    expect(container.querySelector('.writing-task-editor')).toBeInTheDocument();
    expect(container.querySelector('.writing-toolbar')).toBeInTheDocument();
    expect(container.querySelector('.writing-input')).toBe(screen.getByRole('textbox'));
    expect(container.querySelector('.writing-metrics')).toBeInTheDocument();
  });

  it('keeps summary and pause modal surfaces on their semantic class contracts', async () => {
    await startSettledSession();
    const session = useAppStore.getState().session;
    if (!session) throw new Error('missing session');
    useAppStore.setState({ session: { ...session, view: 'SESSION_SUMMARY' } });
    const summary = render(<PracticeShell />);

    expect(summary.container.querySelector('.session-summary.card')).toBeInTheDocument();
    expect(summary.container.querySelector('.summary-metrics')).toBeInTheDocument();
    expect(summary.container.querySelector('.summary-actions')).toBeInTheDocument();
    summary.unmount();

    useAppStore.setState({ session, isPaused: true });
    const paused = render(<PracticeShell />);
    expect(screen.getByRole('dialog', { name: '练习已暂停' })).toHaveClass('pause-overlay');
    expect(paused.container.querySelector('.pause-card')).toBeInTheDocument();
  });

  it('keeps close protection in the common overlay and dialog structure', () => {
    const { container } = render(
      <WindowCloseDialog
        state={{ phase: 'FAILED', error: 'synthetic save failure' }}
        onSave={vi.fn()}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(container.querySelector('.window-close-overlay')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '关闭应用' })).toHaveClass('window-close-dialog');
    expect(screen.getByRole('alert')).toHaveClass('danger-text');
  });
});

async function startSettledSession(): Promise<void> {
  await act(async () => {
    startLegacySessionForTest();
    await vi.waitFor(() => expect(useAppStore.getState().saveStatus).toBe('saved'));
  });
}
