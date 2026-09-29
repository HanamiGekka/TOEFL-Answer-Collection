import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  flushAppConfigurationMutations,
  hasPendingAppConfigurationMutations,
  saveAppPaths,
  saveAppSetting,
  type AppPaths
} from '../storage';

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

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {}
  });
});

describe('R006.4.1 APP_ROOT mutation ordering', () => {
  it('waits for an earlier UI setting write before switching APP_ROOT', async () => {
    const commands: string[] = [];
    let releaseSetting: () => void = () => undefined;
    let markSettingStarted: () => void = () => undefined;
    const settingStarted = new Promise<void>((resolve) => {
      markSettingStarted = resolve;
    });
    vi.mocked(invoke).mockImplementation(async (command) => {
      commands.push(command);
      if (command === 'get_app_configuration_context') {
        return { app_root: 'E:\\temporary-root', generation: 4 };
      }
      if (command === 'save_app_setting') {
        markSettingStarted();
        await new Promise<void>((resolve) => {
          releaseSetting = resolve;
        });
        return undefined;
      }
      if (command === 'save_app_paths') return defaultPaths;
      return undefined;
    });

    const settingSave = saveAppSetting('home_view', 'settings');
    const pathSave = saveAppPaths(defaultPaths, true);
    await settingStarted;
    const commandsBeforeSettingCompleted = [...commands];
    releaseSetting();
    await Promise.all([settingSave, pathSave]);

    expect(commandsBeforeSettingCompleted).toEqual([
      'get_app_configuration_context',
      'save_app_setting'
    ]);
    expect(commands).toEqual([
      'get_app_configuration_context',
      'save_app_setting',
      'get_app_configuration_context',
      'save_app_paths'
    ]);
  });

  it('does not start a later setting write until the APP_ROOT switch completes', async () => {
    const commands: string[] = [];
    let releaseFirstSetting: () => void = () => undefined;
    let releasePathSwitch: () => void = () => undefined;
    let markFirstSettingStarted: () => void = () => undefined;
    let markPathSwitchStarted: () => void = () => undefined;
    const firstSettingStarted = new Promise<void>((resolve) => {
      markFirstSettingStarted = resolve;
    });
    const pathSwitchStarted = new Promise<void>((resolve) => {
      markPathSwitchStarted = resolve;
    });
    let contextCount = 0;
    vi.mocked(invoke).mockImplementation(async (command, payload) => {
      commands.push(`${command}:${JSON.stringify(payload)}`);
      if (command === 'get_app_configuration_context') {
        contextCount += 1;
        return contextCount < 3
          ? { app_root: 'E:\\temporary-root', generation: 9 }
          : { app_root: defaultPaths.app_root, generation: 10 };
      }
      if (command === 'save_app_setting' && contextCount === 1) {
        markFirstSettingStarted();
        await new Promise<void>((resolve) => {
          releaseFirstSetting = resolve;
        });
      }
      if (command === 'save_app_paths') {
        markPathSwitchStarted();
        await new Promise<void>((resolve) => {
          releasePathSwitch = resolve;
        });
        return defaultPaths;
      }
      return undefined;
    });

    const oldRootSetting = saveAppSetting('home_view', 'settings');
    const pathSwitch = saveAppPaths(defaultPaths, true);
    const newRootSetting = saveAppSetting('home_view', 'records');
    await firstSettingStarted;
    expect(commands).toHaveLength(2);
    releaseFirstSetting();
    await pathSwitchStarted;
    const commandsBeforePathCompleted = [...commands];
    releasePathSwitch();
    await Promise.all([oldRootSetting, pathSwitch, newRootSetting]);

    expect(commandsBeforePathCompleted.map((entry) => entry.split(':')[0]))
      .toEqual([
        'get_app_configuration_context',
        'save_app_setting',
        'get_app_configuration_context',
        'save_app_paths'
      ]);
    expect(commands.map((entry) => entry.split(':')[0]))
      .toEqual([
        'get_app_configuration_context',
        'save_app_setting',
        'get_app_configuration_context',
        'save_app_paths',
        'get_app_configuration_context',
        'save_app_setting'
      ]);
    const payloads = commands
      .filter((entry) => entry.startsWith('save_app_'))
      .map((entry) => JSON.parse(entry.slice(entry.indexOf(':') + 1)));
    expect(payloads[0]).toMatchObject({
      expectedAppRoot: 'E:\\temporary-root',
      expectedGeneration: 9
    });
    expect(payloads[1]).toMatchObject({
      expectedAppRoot: 'E:\\temporary-root',
      expectedGeneration: 9
    });
    expect(payloads[2]).toMatchObject({
      expectedAppRoot: defaultPaths.app_root,
      expectedGeneration: 10
    });
  });

  it('exposes a drain barrier while a root-bound mutation is pending', async () => {
    let release: () => void = () => undefined;
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'get_app_configuration_context') {
        return { app_root: 'E:\\temporary-root', generation: 12 };
      }
      if (command === 'save_app_setting') {
        markStarted();
        await new Promise<void>((resolve) => { release = resolve; });
      }
      return undefined;
    });

    const mutation = saveAppSetting('home_view', 'settings');
    await started;
    expect(hasPendingAppConfigurationMutations()).toBe(true);
    let drained = false;
    const drain = flushAppConfigurationMutations().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await Promise.all([mutation, drain]);
    expect(hasPendingAppConfigurationMutations()).toBe(false);
  });
});
