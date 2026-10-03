import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAppPaths, openDataFolder, previewAppPaths, saveAppPaths, selectAppRootDirectory } from '../../lib/storage';
import { PathSettings } from '../PathSettings';
import i18n from '../../i18n';

const oldPaths = { app_root: 'E:\\Synthetic\\Old', source_root: 'E:\\LegacySource', records_root: 'E:\\Synthetic\\Old\\records', typing_records_root: 'E:\\Synthetic\\Old\\typing_records', trash_root: 'E:\\Synthetic\\Old\\trash' };
const newRoot = 'E:\\Synthetic\\New';
const newPaths = { ...oldPaths, app_root: newRoot, records_root: `${newRoot}\\records`, typing_records_root: `${newRoot}\\typing_records`, trash_root: `${newRoot}\\trash` };

vi.mock('../../lib/storage', () => ({
  getAppPaths: vi.fn(), openDataFolder: vi.fn(), previewAppPaths: vi.fn(), saveAppPaths: vi.fn(), selectAppRootDirectory: vi.fn()
}));

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
  vi.mocked(getAppPaths).mockResolvedValue(oldPaths);
  vi.mocked(selectAppRootDirectory).mockResolvedValue(newRoot);
  vi.mocked(previewAppPaths).mockResolvedValue({ ok: true, paths: newPaths, creates: [], warnings: ['APP_PATHS_NO_MIGRATION'], errors: [], migrates_existing_data: false, writable: true, inside_app_root: true });
  vi.mocked(saveAppPaths).mockResolvedValue(newPaths);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('R009 Data folder', () => {
  it('shows one folder and opens the configured root', async () => {
    render(<PathSettings />);
    expect(await screen.findByText(oldPaths.app_root)).toBeInTheDocument();
    expect(screen.queryByText(/SOURCE_ROOT|records_root|SQLite database/u)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open data folder' }));
    await waitFor(() => expect(openDataFolder).toHaveBeenCalledOnce());
  });

  it('validates, confirms, and saves a new root without changing the legacy source path', async () => {
    render(<PathSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose another folder' }));
    expect(await screen.findByText(`Proposed: ${newRoot}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm and save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Validate and preview' }));
    await waitFor(() => expect(previewAppPaths).toHaveBeenCalledWith(newPaths));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
    await waitFor(() => expect(saveAppPaths).toHaveBeenCalledWith(newPaths, true));
    expect(window.confirm).toHaveBeenCalledOnce();
  });
});
