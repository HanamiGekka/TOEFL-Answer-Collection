import { describe, expect, it, vi } from 'vitest';
import { persistBeforeWindowClose } from '../windowClose';

describe('R006.1.2 Tauri close persistence', () => {
  it('prevents close and waits for persistence before destroying the window', async () => {
    let finishPersistence: (() => void) | undefined;
    const persist = vi.fn(() => new Promise<void>((resolve) => { finishPersistence = resolve; }));
    const event = { preventDefault: vi.fn() };
    const appWindow = { destroy: vi.fn(async () => undefined) };

    const closing = persistBeforeWindowClose(event, appWindow, persist);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledOnce();
    expect(appWindow.destroy).not.toHaveBeenCalled();

    finishPersistence?.();
    await closing;
    expect(appWindow.destroy).toHaveBeenCalledOnce();
  });

  it('keeps the window open when persistence fails', async () => {
    const event = { preventDefault: vi.fn() };
    const appWindow = { destroy: vi.fn(async () => undefined) };
    await expect(persistBeforeWindowClose(
      event,
      appWindow,
      async () => { throw new Error('synthetic save failure'); }
    )).rejects.toThrow('synthetic save failure');
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(appWindow.destroy).not.toHaveBeenCalled();
  });
});
