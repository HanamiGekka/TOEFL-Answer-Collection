import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { RecordManager } from '../RecordManager';
import { PracticeShell } from '../PracticeShell';
import { ShortcutSettings } from '../ShortcutSettings';
import { useAppStore } from '../../store/appStore';
import { buildSessionRecordIndex } from '../../lib/exporters';
import { prepareRecoverySession } from '../../lib/recovery';
import golden from '../../lib/__tests__/fixtures/v1.0.0-dynamic-v6.json';
import { defaultShortcutBindings } from '../../lib/shortcutRegistry';

vi.mock('../../lib/storage', () => ({
  getAppSetting: vi.fn(async () => undefined), saveAppSetting: vi.fn(async () => undefined),
  listLocalRecords: vi.fn(async () => {
    const prepared = prepareRecoverySession(golden);
    if (!prepared.ok) throw new Error(prepared.diagnostic);
    return [buildSessionRecordIndex(prepared.session, 'records/Synthetic.01/synthetic-v100-v6', ['answers.json'])];
  }),
  openRecordDirectory: vi.fn(), moveRecordsToTrash: vi.fn(), restoreTrashRecords: vi.fn(),
  permanentlyDeleteTrashRecords: vi.fn(), cleanupTerminalRecovery: vi.fn(), exportRecoveryRaw: vi.fn()
}));

beforeEach(async () => {
  await i18n.changeLanguage('en');
  useAppStore.setState({ session: undefined, shortcutBindings: defaultShortcutBindings() });
});
afterEach(cleanup);

describe('R009 current Settings and Record Manager', () => {
  it('shows friendly shortcut names and bindings without internal action IDs or scopes', () => {
    render(<ShortcutSettings />);
    expect(screen.getByText('Pause / resume')).toBeVisible();
    expect(screen.getByRole('textbox', { name: /Pause \/ resume/ })).toHaveValue('F8');
    expect(document.body.textContent).not.toMatch(/Speaking|speaking_|toggle_pause|previous_question|Active scopes|inactive on this settings page|Central Shortcut Registry/);
    expect(screen.getByText('Shortcut help and safeguards')).toBeVisible();
  });

  it.each(['en', 'zh-CN', 'ja', 'zh-TW'])('keeps record identity accessible but collapsed in %s', async (locale) => {
    await i18n.changeLanguage(locale);
    render(<RecordManager />);
    await screen.findByText('Synthetic.01');
    expect(screen.getByText(/^Session ID: synthetic-v100-v6$/)).not.toBeVisible();
    expect(screen.getByText(/practice-session-v6/)).not.toBeVisible();
    expect(screen.getByText(/records\/Synthetic\.01\//)).not.toBeVisible();
    const summary = screen.getByText(i18n.t('records.viewDetails'));
    fireEvent.click(summary);
    // jsdom does not implement the native summary click toggle.
    summary.closest('details')!.open = true;
    expect(screen.getByText(/^Session ID: synthetic-v100-v6$/)).toBeVisible();
    expect(screen.getByText(/practice-session-v6/)).toBeVisible();
  });

  it.each(['en', 'zh-CN', 'ja', 'zh-TW'])('keeps a successful export path private in the Summary in %s', async (locale) => {
    await i18n.changeLanguage(locale);
    const prepared = prepareRecoverySession(golden);
    if (!prepared.ok) throw new Error(prepared.diagnostic);
    const exportDirectory = 'records/Synthetic.01/synthetic-v100-v6';
    const openCurrentExportDirectory = vi.fn(async () => undefined);
    useAppStore.setState({ session: { ...prepared.session, view: 'SESSION_SUMMARY' },
      exportStatus: 'exported', exportDirectory, exportError: undefined, openCurrentExportDirectory });
    render(<PracticeShell />);
    expect(screen.queryByText(exportDirectory, { exact: false })).not.toBeInTheDocument();
    expect(screen.getByText(i18n.t('summary.exportSuccess'))).toBeVisible();
    const openButton = screen.getByRole('button', { name: i18n.t('summary.openExportDirectory') });
    expect(openButton).toBeEnabled();
    fireEvent.click(openButton);
    expect(openCurrentExportDirectory).toHaveBeenCalledOnce();
  });
});
