import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAppPaths,
  getDefaultAppRoot,
  previewAppPaths,
  saveAppPaths,
  selectAppRootDirectory,
  selectSourceRootDirectory
} from '../../lib/storage';
import { PathSettings } from '../PathSettings';
import i18n from '../../i18n';

const savedPaths = {
  app_root: 'E:\\Synthetic\\AnswerCollection',
  source_root: 'E:\\Synthetic\\Source',
  records_root: 'E:\\Synthetic\\AnswerCollection\\records',
  typing_records_root: 'E:\\Synthetic\\AnswerCollection\\typing_records',
  trash_root: 'E:\\Synthetic\\AnswerCollection\\trash'
};

const proposedRoot = 'E:\\Synthetic\\NewApp';
const proposedSource = 'E:\\Synthetic\\OtherSource';
const proposedPaths = {
  ...savedPaths,
  app_root: proposedRoot,
  records_root: `${proposedRoot}\\records`,
  typing_records_root: `${proposedRoot}\\typing_records`,
  trash_root: `${proposedRoot}\\trash`
};

vi.mock('../../lib/storage', () => ({
  getAppPaths: vi.fn(),
  getDefaultAppRoot: vi.fn(),
  previewAppPaths: vi.fn(),
  saveAppPaths: vi.fn(),
  selectAppRootDirectory: vi.fn(),
  selectSourceRootDirectory: vi.fn()
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAppPaths).mockResolvedValue(savedPaths);
  vi.mocked(getDefaultAppRoot).mockResolvedValue(savedPaths.app_root);
  vi.mocked(selectAppRootDirectory).mockResolvedValue(proposedRoot);
  vi.mocked(selectSourceRootDirectory).mockResolvedValue(proposedSource);
  vi.mocked(previewAppPaths).mockResolvedValue({
    ok: true,
    paths: proposedPaths,
    creates: [proposedRoot],
    warnings: ['APP_PATHS_NO_MIGRATION'],
    errors: [],
    migrates_existing_data: false,
    writable: true,
    inside_app_root: true,
    source_status: 'VALID',
    source_package_count: 2
  });
  vi.mocked(saveAppPaths).mockResolvedValue(proposedPaths);
});

describe('R006.2.2 APP_ROOT settings', () => {
  it('keeps APP_ROOT and SOURCE_ROOT independently editable while deriving controlled children', async () => {
    render(<PathSettings />);
    const appRoot = await screen.findByLabelText('应用数据根目录 APP_ROOT');
    const sourceRoot = screen.getByLabelText('TOEFL 资料目录 SOURCE_ROOT（只读）');
    const pathRegion = screen.getByTestId('app-path-grid');
    const inputs = within(pathRegion).getAllByRole('textbox');

    expect(appRoot).toBeEnabled();
    expect(sourceRoot).toBeEnabled();
    expect(inputs).toHaveLength(8);
    expect(inputs.filter((input) => !(input as HTMLInputElement).readOnly)).toEqual([appRoot, sourceRoot]);

    fireEvent.change(appRoot, { target: { value: proposedRoot } });
    expect(sourceRoot).toHaveValue(savedPaths.source_root);
    expect(screen.getByDisplayValue(`${proposedRoot}\\records`)).toBeVisible();
    expect(screen.getByDisplayValue(`${proposedRoot}\\typing_records`)).toBeVisible();
    expect(screen.getByDisplayValue(`${proposedRoot}\\trash`)).toBeVisible();
    expect(screen.getByDisplayValue(`${proposedRoot}\\data\\recovery`)).toBeVisible();
    expect(screen.getByDisplayValue(`${proposedRoot}\\data\\answer_collection.sqlite3`)).toBeVisible();
    expect(screen.getByDisplayValue(`${proposedRoot}\\logs`)).toBeVisible();
  });

  it('uses the directory picker, previews saved versus proposed paths, and saves only after validation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PathSettings />);
    await screen.findByDisplayValue(savedPaths.app_root);

    fireEvent.click(screen.getByRole('button', { name: '选择数据目录' }));
    await waitFor(() => expect(selectAppRootDirectory).toHaveBeenCalledWith(savedPaths.app_root, i18n.t('paths.selectAppRoot')));
    fireEvent.click(screen.getByRole('button', { name: '校验并预览' }));

    await waitFor(() => expect(previewAppPaths).toHaveBeenCalledWith(proposedPaths));
    expect(screen.getByText(`当前已保存：${savedPaths.app_root}`)).toBeVisible();
    expect(screen.getByText(`拟保存：${proposedRoot}`)).toBeVisible();
    expect(screen.getByText(i18n.t('paths.noMigrationWarning'))).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '确认保存' }));
    await waitFor(() => expect(saveAppPaths).toHaveBeenCalledWith(proposedPaths, true));
  });

  it('discards an unsaved invalid draft when closed and keeps the saved path after save failure', async () => {
    const first = render(<PathSettings />);
    const appRoot = await screen.findByLabelText('应用数据根目录 APP_ROOT');
    fireEvent.change(appRoot, { target: { value: 'relative\\invalid' } });
    expect(screen.getByText('当前更改尚未保存；关闭后将继续使用原路径。')).toBeVisible();
    first.unmount();

    render(<PathSettings />);
    expect(await screen.findByDisplayValue(savedPaths.app_root)).toBeVisible();
    fireEvent.change(screen.getByLabelText('应用数据根目录 APP_ROOT'), { target: { value: proposedRoot } });
    fireEvent.click(screen.getByRole('button', { name: '校验并预览' }));
    await screen.findByText(`拟保存：${proposedRoot}`);

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(saveAppPaths).mockRejectedValueOnce(new Error('原子写入失败'));
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }));
    expect(await screen.findByText('保存失败：无法校验这些路径。')).toBeVisible();
    expect(screen.getByText(`已保存应用数据目录：${savedPaths.app_root}`)).toBeVisible();
  });

  it('keeps an unsaved SOURCE_ROOT draft local and saves an independently selected source', async () => {
    const first = render(<PathSettings />);
    const sourceRoot = await screen.findByLabelText('TOEFL 资料目录 SOURCE_ROOT（只读）');
    fireEvent.change(sourceRoot, { target: { value: proposedSource } });
    expect(screen.getByLabelText('应用数据根目录 APP_ROOT')).toHaveValue(savedPaths.app_root);
    expect(screen.getByText('当前更改尚未保存；关闭后将继续使用原路径。')).toBeVisible();
    first.unmount();

    render(<PathSettings />);
    expect(await screen.findByLabelText('TOEFL 资料目录 SOURCE_ROOT（只读）')).toHaveValue(savedPaths.source_root);
    fireEvent.click(screen.getByRole('button', { name: '选择资料目录' }));
    await waitFor(() => expect(selectSourceRootDirectory).toHaveBeenCalledWith(savedPaths.source_root, i18n.t('paths.selectSourceRoot')));
    const sourceOnly = { ...savedPaths, source_root: proposedSource };
    vi.mocked(previewAppPaths).mockResolvedValueOnce({
      ok: true, paths: sourceOnly, creates: [], warnings: [], errors: [],
      migrates_existing_data: false, writable: true, inside_app_root: true,
      source_status: 'VALID', source_package_count: 1
    });
    fireEvent.click(screen.getByRole('button', { name: '校验并预览' }));
    await waitFor(() => expect(previewAppPaths).toHaveBeenCalledWith(sourceOnly));
    expect(screen.getByText('Detected packages：1')).toBeVisible();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(saveAppPaths).mockResolvedValueOnce(sourceOnly);
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }));
    await waitFor(() => expect(saveAppPaths).toHaveBeenCalledWith(sourceOnly, true));
  });
});

describe('R008.6 public path error localization', () => {
  it.each([
    ['en', 'The selected app data directory is unavailable or not writable.'],
    ['zh-CN', '所选应用数据目录不存在或无法写入。'],
    ['ja', '選択したアプリのデータフォルダーが存在しないか、書き込めません。'],
    ['zh-TW', '所選應用程式資料目錄不存在或無法寫入。']
  ])('renders a stable backend code in %s', async (locale, expected) => {
    await i18n.changeLanguage(locale);
    vi.mocked(previewAppPaths).mockResolvedValueOnce({
      ok: false, paths: savedPaths, creates: [], warnings: [], errors: ['APP_ROOT_NOT_WRITABLE'],
      migrates_existing_data: false, writable: false, inside_app_root: true,
      source_status: 'UNCONFIGURED', source_package_count: 0
    });
    try {
      render(<PathSettings />);
      await screen.findByDisplayValue(savedPaths.app_root);
      fireEvent.click(screen.getByRole('button', { name: i18n.t('paths.preview') }));
      expect(await screen.findByText(expected)).toBeVisible();
      expect(screen.queryByText('APP_ROOT_NOT_WRITABLE')).not.toBeInTheDocument();
    } finally {
      await i18n.changeLanguage('zh-CN');
    }
  });

  it('shows a safe English fallback for unexpected backend prose', async () => {
    await i18n.changeLanguage('en');
    vi.mocked(previewAppPaths).mockResolvedValueOnce({
      ok: false, paths: savedPaths, creates: [], warnings: [], errors: ['原始后端错误'],
      migrates_existing_data: false, writable: false, inside_app_root: true,
      source_status: 'UNCONFIGURED', source_package_count: 0
    });
    try {
      render(<PathSettings />);
      await screen.findByDisplayValue(savedPaths.app_root);
      fireEvent.click(screen.getByRole('button', { name: i18n.t('paths.preview') }));
      expect(await screen.findByText('Could not validate these paths.')).toBeVisible();
      expect(screen.queryByText('原始后端错误')).not.toBeInTheDocument();
    } finally {
      await i18n.changeLanguage('zh-CN');
    }
  });
});
