import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createWindowCloseCoordinator,
  installWindowCloseListener,
  type CloseRequestEventLike,
  type PreCloseRuntimeState,
  type WindowCloseAdapter
} from '../windowClose';

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function closeEvent() {
  let prevented = false;
  return {
    event: {
      preventDefault: vi.fn(() => { prevented = true; })
    },
    wasPrevented: () => prevented
  };
}

function createHarness(options: {
  hasPendingWork?: () => boolean;
  persist?: () => Promise<void>;
  destroy?: () => Promise<void>;
  runtimeState?: PreCloseRuntimeState;
} = {}) {
  const persist = vi.fn(options.persist ?? (async () => undefined));
  const destroy = vi.fn(options.destroy ?? (async () => undefined));
  const beginHold = vi.fn(() => options.runtimeState ?? ({ kind: 'ACTIVE_SESSION' } as const));
  const cancelHold = vi.fn();
  const coordinator = createWindowCloseCoordinator({
    hasPendingWork: options.hasPendingWork ?? (() => true),
    beginHold,
    cancelHold,
    persist,
    destroy
  });
  return { coordinator, persist, destroy, beginHold, cancelHold };
}

describe('R006.1.3 graceful close coordinator', () => {
  it.each(['title-bar X', 'Alt+F4'])('lets %s close normally when there is no session or draft', (source) => {
    const { coordinator, persist, destroy, beginHold } = createHarness({ hasPendingWork: () => false });
    const request = closeEvent();

    coordinator.requestClose(request.event, source);

    expect(request.event.preventDefault).not.toHaveBeenCalled();
    expect(coordinator.getState()).toEqual({ phase: 'IDLE' });
    expect(persist).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
    expect(beginHold).not.toHaveBeenCalled();
  });

  it('prevents an active Session close and enters one confirmation state', () => {
    const { coordinator } = createHarness();
    const request = closeEvent();

    coordinator.requestClose(request.event, 'title-bar X');

    expect(request.event.preventDefault).toHaveBeenCalledOnce();
    expect(coordinator.getState()).toEqual({ phase: 'CONFIRMING' });
  });

  it('cancels without persisting, destroying, or changing the pending Session', () => {
    const { coordinator, persist, destroy, cancelHold } = createHarness({
      runtimeState: { kind: 'PAUSED_SESSION' }
    });
    coordinator.requestClose(closeEvent().event, 'title-bar X');

    coordinator.cancel();

    expect(coordinator.getState()).toEqual({ phase: 'IDLE' });
    expect(persist).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
    expect(cancelHold).toHaveBeenCalledOnce();
    expect(cancelHold).toHaveBeenCalledWith({ kind: 'PAUSED_SESSION' });
  });

  it.each(['title-bar X', 'Alt+F4'])(
    'captures the paused pre-close state once for %s and does not overwrite it on a repeated request',
    (source) => {
      const { coordinator, beginHold, cancelHold } = createHarness({
        runtimeState: { kind: 'PAUSED_SESSION' }
      });

      coordinator.requestClose(closeEvent().event, source);
      coordinator.requestClose(closeEvent().event, source);

      expect(beginHold).toHaveBeenCalledOnce();
      expect(coordinator.getPreCloseRuntimeState()).toEqual({ kind: 'PAUSED_SESSION' });
      coordinator.cancel();
      expect(cancelHold).toHaveBeenCalledOnce();
      expect(coordinator.getPreCloseRuntimeState()).toBeUndefined();
    }
  );

  it('keeps an active pre-close hold across save failure and restores it only on cancel', async () => {
    const { coordinator, beginHold, cancelHold } = createHarness({
      runtimeState: { kind: 'ACTIVE_SESSION' },
      persist: async () => { throw new Error('synthetic save failure'); }
    });
    coordinator.requestClose(closeEvent().event, 'Alt+F4');

    await coordinator.saveAndClose();

    expect(coordinator.getState()).toEqual({ phase: 'FAILED', error: 'synthetic save failure' });
    expect(beginHold).toHaveBeenCalledOnce();
    expect(cancelHold).not.toHaveBeenCalled();
    expect(coordinator.getPreCloseRuntimeState()).toEqual({ kind: 'ACTIVE_SESSION' });

    coordinator.cancel();
    expect(cancelHold).toHaveBeenCalledWith({ kind: 'ACTIVE_SESSION' });
  });

  it('persists an active Session before destroying exactly once', async () => {
    const order: string[] = [];
    const { coordinator, destroy } = createHarness({
      persist: async () => { order.push('persist'); },
      destroy: async () => { order.push('destroy'); }
    });
    coordinator.requestClose(closeEvent().event, 'title-bar X');

    await coordinator.saveAndClose();

    expect(order).toEqual(['persist', 'destroy']);
    expect(destroy).toHaveBeenCalledOnce();
    expect(coordinator.getState()).toEqual({ phase: 'DESTROYING' });
  });

  it('uses the same settle-and-persist path for a paused Recovery Session', async () => {
    const persistRecovery = vi.fn(async () => undefined);
    const { coordinator, destroy } = createHarness({ persist: persistRecovery });
    coordinator.requestClose(closeEvent().event, 'Alt+F4');

    await coordinator.saveAndClose();

    expect(persistRecovery).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('coalesces duplicate close requests and duplicate save clicks', async () => {
    const pending = deferred();
    const { coordinator, persist, destroy } = createHarness({ persist: () => pending.promise });
    const first = closeEvent();
    const second = closeEvent();
    coordinator.requestClose(first.event, 'title-bar X');
    coordinator.requestClose(second.event, 'Alt+F4');

    const firstSave = coordinator.saveAndClose();
    const secondSave = coordinator.saveAndClose();
    expect(first.event.preventDefault).toHaveBeenCalledOnce();
    expect(second.event.preventDefault).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledOnce();
    expect(coordinator.getState()).toEqual({ phase: 'SAVING' });

    pending.resolve();
    await Promise.all([firstSave, secondSave]);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('keeps the window open on persistence failure and succeeds on retry', async () => {
    let attempts = 0;
    const { coordinator, destroy } = createHarness({
      persist: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('synthetic save failure');
      }
    });
    coordinator.requestClose(closeEvent().event, 'title-bar X');

    await coordinator.saveAndClose();
    expect(coordinator.getState()).toEqual({ phase: 'FAILED', error: 'synthetic save failure' });
    expect(destroy).not.toHaveBeenCalled();

    await coordinator.retry();
    expect(attempts).toBe(2);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('shows SAVING for a long pending save and never destroys early', async () => {
    const pending = deferred();
    const { coordinator, destroy } = createHarness({ persist: () => pending.promise });
    coordinator.requestClose(closeEvent().event, 'title-bar X');

    const closing = coordinator.saveAndClose();
    expect(coordinator.getState()).toEqual({ phase: 'SAVING' });
    expect(destroy).not.toHaveBeenCalled();

    pending.resolve();
    await closing;
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('does not recursively persist or destroy when destroy emits another close request', async () => {
    const recursiveRequest = closeEvent();
    const persist = vi.fn(async () => undefined);
    const destroy = vi.fn(async () => {
      coordinator.requestClose(recursiveRequest.event, 'destroy recursion');
    });
    const coordinator = createWindowCloseCoordinator({
      hasPendingWork: () => true,
      beginHold: () => ({ kind: 'ACTIVE_SESSION' }),
      cancelHold: () => undefined,
      persist,
      destroy
    });
    coordinator.requestClose(closeEvent().event, 'title-bar X');

    await coordinator.saveAndClose();

    expect(persist).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(recursiveRequest.event.preventDefault).toHaveBeenCalledOnce();
  });

  it('awaits the shared persistence promise already used by autosave', async () => {
    const sharedSave = deferred();
    const persist = vi.fn(() => sharedSave.promise);
    const autosave = persist();
    const { coordinator, destroy } = createHarness({ persist });
    coordinator.requestClose(closeEvent().event, 'title-bar X');

    const closing = coordinator.saveAndClose();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(destroy).not.toHaveBeenCalled();

    sharedSave.resolve();
    await Promise.all([autosave, closing]);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('cleans up a late listener registration after a StrictMode-style unmount', async () => {
    let resolveRegistration!: (unlisten: () => void) => void;
    const unlisten = vi.fn();
    const adapter: WindowCloseAdapter = {
      onCloseRequested: vi.fn(() => new Promise<() => void>((resolve) => { resolveRegistration = resolve; })),
      destroy: vi.fn(async () => undefined)
    };
    const { coordinator } = createHarness();

    const cleanup = installWindowCloseListener(adapter, coordinator);
    cleanup();
    resolveRegistration(unlisten);
    await Promise.resolve();

    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('keeps only one effective listener across repeated mount and unmount cycles', async () => {
    const listeners = new Set<(event: CloseRequestEventLike) => void>();
    const adapter: WindowCloseAdapter = {
      onCloseRequested: vi.fn(async (listener) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      }),
      destroy: vi.fn(async () => undefined)
    };
    const { coordinator } = createHarness();

    const cleanupFirst = installWindowCloseListener(adapter, coordinator);
    await Promise.resolve();
    cleanupFirst();
    const cleanupSecond = installWindowCloseListener(adapter, coordinator);
    await Promise.resolve();

    expect(listeners.size).toBe(1);
    cleanupSecond();
    expect(listeners.size).toBe(0);
  });

  it('runs the normal no-work and pending-work paths through a mock Tauri adapter', async () => {
    let listener: ((event: CloseRequestEventLike) => void) | undefined;
    let hasPendingWork = false;
    const adapter: WindowCloseAdapter = {
      onCloseRequested: vi.fn(async (nextListener) => {
        listener = nextListener;
        return () => { listener = undefined; };
      }),
      destroy: vi.fn(async () => undefined)
    };
    const persist = vi.fn(async () => undefined);
    const coordinator = createWindowCloseCoordinator({
      hasPendingWork: () => hasPendingWork,
      beginHold: () => ({ kind: 'ACTIVE_SESSION' }),
      cancelHold: () => undefined,
      persist,
      destroy: adapter.destroy
    });
    const cleanup = installWindowCloseListener(adapter, coordinator);
    await Promise.resolve();

    const noWork = closeEvent();
    listener?.(noWork.event);
    if (!noWork.wasPrevented()) await adapter.destroy();
    expect(adapter.destroy).toHaveBeenCalledOnce();
    expect(persist).not.toHaveBeenCalled();

    hasPendingWork = true;
    listener?.(closeEvent().event);
    await coordinator.saveAndClose();
    expect(persist).toHaveBeenCalledOnce();
    expect(adapter.destroy).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it('grants the Tauri main window the destroy capability used by both close paths', async () => {
    const capabilityPath = resolve(process.cwd(), 'src-tauri/capabilities/default.json');
    const capability = JSON.parse(await readFile(capabilityPath, 'utf8')) as { permissions: string[] };
    expect(capability.permissions).toContain('core:window:allow-destroy');
  });
});
