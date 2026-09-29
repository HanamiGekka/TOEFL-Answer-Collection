import { getCurrentWindow } from '@tauri-apps/api/window';
import type { UnlistenFn } from '@tauri-apps/api/event';

export interface CloseRequestEventLike {
  preventDefault(): void;
}

export interface CloseWindowLike {
  destroy(): Promise<void>;
}

export type WindowClosePhase = 'IDLE' | 'CONFIRMING' | 'SAVING' | 'FAILED' | 'DESTROYING';

export type PreCloseRuntimeState =
  | { kind: 'NO_SESSION' }
  | { kind: 'ACTIVE_SESSION' }
  | { kind: 'PAUSED_SESSION' }
  | { kind: 'TYPING_ACTIVE' }
  | { kind: 'TYPING_PAUSED' };

export type WindowCloseState =
  | { phase: Exclude<WindowClosePhase, 'FAILED'> }
  | { phase: 'FAILED'; error: string };

export interface WindowCloseCoordinator {
  getState(): WindowCloseState;
  getPreCloseRuntimeState(): PreCloseRuntimeState | undefined;
  subscribe(listener: (state: WindowCloseState) => void): () => void;
  requestClose(event: CloseRequestEventLike, source?: string): void;
  saveAndClose(): Promise<void>;
  retry(): Promise<void>;
  cancel(): void;
}

export interface WindowCloseAdapter extends CloseWindowLike {
  onCloseRequested(listener: (event: CloseRequestEventLike) => void): Promise<UnlistenFn>;
}

interface WindowCloseCoordinatorDependencies {
  hasPendingWork(): boolean;
  beginHold(): PreCloseRuntimeState;
  cancelHold(state: PreCloseRuntimeState): void;
  persist(): Promise<void>;
  destroy(): Promise<void>;
  onStateChange?(state: WindowCloseState): void;
}

export interface WindowCloseParticipant {
  hasPendingWork(): boolean;
  beginHold?(): PreCloseRuntimeState | undefined;
  cancelHold?(state: PreCloseRuntimeState): void;
  persist(): void | Promise<void>;
}

const closeParticipants = new Set<WindowCloseParticipant>();
const closeParticipantHolds = new Map<WindowCloseParticipant, PreCloseRuntimeState>();

export function createWindowCloseCoordinator(
  dependencies: WindowCloseCoordinatorDependencies
): WindowCloseCoordinator {
  let state: WindowCloseState = { phase: 'IDLE' };
  let preCloseRuntimeState: PreCloseRuntimeState | undefined;
  let closeOperation: Promise<void> | undefined;
  const listeners = new Set<(nextState: WindowCloseState) => void>();

  function transition(nextState: WindowCloseState): void {
    state = nextState;
    dependencies.onStateChange?.(state);
    listeners.forEach((listener) => listener(state));
  }

  function runCloseOperation(): Promise<void> {
    if (closeOperation) return closeOperation;
    if (state.phase !== 'CONFIRMING' && state.phase !== 'FAILED') return Promise.resolve();

    closeOperation = (async () => {
      transition({ phase: 'SAVING' });
      try {
        await dependencies.persist();
        transition({ phase: 'DESTROYING' });
        await dependencies.destroy();
      } catch (error) {
        transition({
          phase: 'FAILED',
          error: error instanceof Error ? error.message : String(error)
        });
      } finally {
        if (state.phase === 'FAILED') closeOperation = undefined;
      }
    })();
    return closeOperation;
  }

  return {
    getState: () => state,
    getPreCloseRuntimeState: () => preCloseRuntimeState,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    requestClose(event) {
      if (state.phase === 'DESTROYING') {
        event.preventDefault();
        return;
      }
      if (state.phase === 'IDLE' && !dependencies.hasPendingWork()) return;

      event.preventDefault();
      if (state.phase === 'IDLE') {
        preCloseRuntimeState = dependencies.beginHold();
        transition({ phase: 'CONFIRMING' });
      }
    },
    saveAndClose: runCloseOperation,
    retry: runCloseOperation,
    cancel() {
      if (state.phase !== 'CONFIRMING' && state.phase !== 'FAILED') return;
      if (preCloseRuntimeState) dependencies.cancelHold(preCloseRuntimeState);
      preCloseRuntimeState = undefined;
      closeOperation = undefined;
      transition({ phase: 'IDLE' });
    }
  };
}

export function createTauriWindowCloseAdapter(): WindowCloseAdapter {
  if (!isTauriRuntime()) {
    return {
      onCloseRequested: async () => () => undefined,
      destroy: async () => undefined
    };
  }
  const appWindow = getCurrentWindow();
  return {
    onCloseRequested: (listener) => appWindow.onCloseRequested(listener),
    destroy: () => appWindow.destroy()
  };
}

export function installWindowCloseListener(
  adapter: WindowCloseAdapter,
  coordinator: WindowCloseCoordinator,
  onRegistrationError?: (error: string) => void
): () => void {
  let disposed = false;
  let unlisten: UnlistenFn | undefined;
  void adapter.onCloseRequested((event) => coordinator.requestClose(event)).then(
    (registeredUnlisten) => {
      if (disposed) {
        registeredUnlisten();
      } else {
        unlisten = registeredUnlisten;
      }
    },
    (error) => {
      if (!disposed) onRegistrationError?.(error instanceof Error ? error.message : String(error));
    }
  );
  return () => {
    disposed = true;
    unlisten?.();
    unlisten = undefined;
  };
}

export function registerWindowCloseParticipant(participant: WindowCloseParticipant): () => void {
  closeParticipants.add(participant);
  return () => { closeParticipants.delete(participant); };
}

export function beginWindowCloseParticipantHold(): PreCloseRuntimeState | undefined {
  const existing = closeParticipantHolds.values().next().value as PreCloseRuntimeState | undefined;
  if (existing) return existing;
  for (const participant of closeParticipants) {
    if (!participant.hasPendingWork()) continue;
    const state = participant.beginHold?.();
    if (state) {
      closeParticipantHolds.set(participant, state);
      return state;
    }
  }
  return undefined;
}

export function cancelWindowCloseParticipantHold(state: PreCloseRuntimeState | undefined): void {
  if (!state) return;
  for (const [participant, heldState] of closeParticipantHolds) {
    participant.cancelHold?.(heldState);
  }
  closeParticipantHolds.clear();
}

export function hasWindowCloseParticipantWork(): boolean {
  return Array.from(closeParticipants).some((participant) => {
    try {
      return participant.hasPendingWork();
    } catch {
      return true;
    }
  });
}

export async function persistWindowCloseParticipants(): Promise<void> {
  for (const participant of closeParticipants) {
    if (participant.hasPendingWork()) await participant.persist();
  }
}

export async function persistBeforeWindowClose(
  event: CloseRequestEventLike,
  appWindow: CloseWindowLike,
  persist: () => Promise<void>
): Promise<void> {
  event.preventDefault();
  await persist();
  await appWindow.destroy();
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
