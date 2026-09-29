import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  flushAppConfigurationMutations,
  saveAppPaths,
  saveAppSetting,
  type AppPaths
} from '../storage';
import {
  hydrateHomeView,
  initialHomeViewState,
  requestHomeView
} from '../homeViewPersistence';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

const defaultPaths: AppPaths = {
  app_root: 'E:\\Answer_Collection',
  source_root: 'E:\\TOEFL_Source',
  records_root: 'E:\\Answer_Collection\\records',
  typing_records_root: 'E:\\Answer_Collection\\typing_records',
  trash_root: 'E:\\Answer_Collection\\trash'
};

const temporaryPaths: AppPaths = {
  app_root: 'E:\\r0064-revalidate-v3\\app',
  source_root: defaultPaths.source_root,
  records_root: 'E:\\r0064-revalidate-v3\\app\\records',
  typing_records_root: 'E:\\r0064-revalidate-v3\\app\\typing_records',
  trash_root: 'E:\\r0064-revalidate-v3\\app\\trash'
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {}
  });
});

describe('R006.4.4 formal root remains pristine across the directed flow', () => {
  it('persists only real temporary-root transitions and creates no default-root setting mutation', async () => {
    let context = { app_root: defaultPaths.app_root, generation: 0 };
    vi.mocked(invoke).mockImplementation(async (command, payload) => {
      if (command === 'get_app_configuration_context') return context;
      if (command === 'save_app_paths') {
        const next = (payload as { paths: AppPaths }).paths;
        context = {
          app_root: next.app_root,
          generation: context.generation + 1
        };
        return next;
      }
      return undefined;
    });

    let home = hydrateHomeView(initialHomeViewState(), 'settings');
    expect(home.persist).toBeUndefined();
    home = requestHomeView(home.state, 'settings');
    expect(home.persist).toBeUndefined();

    await saveAppPaths(temporaryPaths, true);
    home = requestHomeView(home.state, 'records');
    if (home.persist) await saveAppSetting('home_view', home.persist);
    await saveAppSetting('record_filters', {
      type: 'ALL',
      completion: 'ALL',
      search: '',
      sort: 'OLDEST',
      page: 1
    });
    home = requestHomeView(home.state, 'settings');
    if (home.persist) await saveAppSetting('home_view', home.persist);
    home = requestHomeView(home.state, 'settings');
    expect(home.persist).toBeUndefined();

    await saveAppPaths(defaultPaths, true);
    const restarted = hydrateHomeView(initialHomeViewState(), 'settings');
    expect(restarted.persist).toBeUndefined();
    await flushAppConfigurationMutations();

    const settingPayloads = vi.mocked(invoke).mock.calls
      .filter(([command]) => command === 'save_app_setting')
      .map(([, payload]) => payload as {
        key: string;
        expectedAppRoot: string;
        expectedGeneration: number;
      });
    expect(settingPayloads.map(({ key }) => key)).toEqual([
      'home_view',
      'record_filters',
      'home_view'
    ]);
    expect(settingPayloads.every(
      ({ expectedAppRoot, expectedGeneration }) =>
        expectedAppRoot === temporaryPaths.app_root
        && expectedGeneration === 1
    )).toBe(true);
  });
});
