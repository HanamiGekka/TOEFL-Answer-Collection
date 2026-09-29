import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GlobalShortcutController } from './components/GlobalShortcutController';
import { PackagePicker } from './components/PackagePicker';
import { PathSettings } from './components/PathSettings';
import { PracticeSetup } from './components/PracticeSetup';
import { PracticeShell } from './components/PracticeShell';
import { RecordManager } from './components/RecordManager';
import { RecoveryPanel } from './components/RecoveryPanel';
import { ShortcutSettings } from './components/ShortcutSettings';
import { TypingPractice } from './components/TypingPractice';
import { WindowCloseDialog } from './components/WindowCloseDialog';
import { LanguageSettings } from './components/LanguageSettings';
import { RuntimeNotice } from './components/RuntimeNotice';
import i18n, { hydrateLocale } from './i18n';
import { localizePathError } from './i18n/pathErrors';
import {
  ensureDataDirs,
  flushAppConfigurationMutations,
  getAppSetting,
  getRuntimeMode,
  hasPendingAppConfigurationMutations,
  initDatabase,
  saveAppSetting
} from './lib/storage';
import type { RuntimeNoticeCode } from './lib/storage';
import {
  hydrateHomeView,
  initialHomeViewState,
  requestHomeView,
  type PersistedHomeView
} from './lib/homeViewPersistence';
import { useAppStore } from './store/appStore';
import { loadTypingDraft } from './lib/typingDraft';
import {
  beginWindowCloseParticipantHold,
  cancelWindowCloseParticipantHold,
  createTauriWindowCloseAdapter,
  createWindowCloseCoordinator,
  hasWindowCloseParticipantWork,
  installWindowCloseListener,
  persistWindowCloseParticipants,
  type PreCloseRuntimeState
} from './lib/windowClose';

type HomeView = PersistedHomeView;

export default function App() {
  const { t } = useTranslation();
  const session = useAppStore((state) => state.session);
  const initialize = useAppStore((state) => state.initialize);
  const tick = useAppStore((state) => state.tick);
  const [homeViewState, setHomeViewState] = useState(initialHomeViewState);
  const homeViewStateRef = useRef(homeViewState);
  const homeView = homeViewState.view;
  const [startupError, setStartupError] = useState('');
  const [closeListenerError, setCloseListenerError] = useState('');
  const [runtimeBanner, setRuntimeBanner] = useState('');
  const [startupNoticeCode, setStartupNoticeCode] = useState<RuntimeNoticeCode>();
  const [startupNotice, setStartupNotice] = useState('');
  const [closeAdapter] = useState(createTauriWindowCloseAdapter);
  const [closeCoordinator] = useState(() => createWindowCloseCoordinator({
    hasPendingWork: hasPendingCloseWork,
    beginHold: beginWindowCloseHold,
    cancelHold: cancelWindowCloseHold,
    persist: persistForWindowClose,
    destroy: closeAdapter.destroy,
    onStateChange: (state) => useAppStore.getState().setWindowClosePhase(state.phase)
  }));
  const [closeState, setCloseState] = useState(closeCoordinator.getState);

  useEffect(() => {
    void (async () => {
      try {
        const runtimeMode = await getRuntimeMode();
        setRuntimeBanner(runtimeMode.banner ?? '');
        setStartupNoticeCode(runtimeMode.startup_notice_code);
        setStartupNotice(runtimeMode.startup_notice ?? '');
        await ensureDataDirs();
        await initDatabase();
      } catch (error) {
        setStartupError(error instanceof Error ? error.message : String(error));
      }
      await initialize();
      let savedView: HomeView | undefined;
      try {
        const candidate = await getAppSetting<HomeView>('home_view');
        if (
          candidate
          && ['practice', 'records', 'settings'].includes(candidate)
        ) {
          savedView = candidate;
        }
      } catch {
        // Path recovery remains available through Settings even if the database root is unavailable.
      }
      const hydrated = hydrateHomeView(homeViewStateRef.current, savedView);
      homeViewStateRef.current = hydrated.state;
      setHomeViewState(hydrated.state);
    })();
  }, [initialize]);

  useEffect(() => {
    const reloadAfterPathChange = () => {
      void (async () => {
        try {
          await ensureDataDirs();
          await initDatabase();
          await hydrateLocale();
          setStartupError('');
          await initialize();
        } catch (error) {
          setStartupError(error instanceof Error ? error.message : String(error));
        }
      })();
    };
    window.addEventListener('app-paths-saved', reloadAfterPathChange);
    return () => window.removeEventListener('app-paths-saved', reloadAfterPathChange);
  }, [initialize]);

  useEffect(() => {
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [tick]);

  useEffect(() => {
    const id = window.setInterval(() => { void useAppStore.getState().persist(); }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    return closeCoordinator.subscribe(setCloseState);
  }, [closeCoordinator]);

  useEffect(() => installWindowCloseListener(
    closeAdapter,
    closeCoordinator,
    (error) => setCloseListenerError(String(error))
  ), [closeAdapter, closeCoordinator]);

  useEffect(() => {
    if ('__TAURI_INTERNALS__' in window) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      if (!hasPendingCloseWork()) return;
      void persistWindowCloseParticipants().catch(() => undefined);
      void useAppStore.getState().persist();
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  function navigate(view: HomeView) {
    const transition = requestHomeView(homeViewStateRef.current, view);
    if (transition.state === homeViewStateRef.current) return;
    homeViewStateRef.current = transition.state;
    setHomeViewState(transition.state);
    if (transition.persist) {
      void saveAppSetting('home_view', transition.persist)
        .catch(() => undefined);
    }
  }

  return (
    <main className="app-shell">
      <GlobalShortcutController homePage={homeView === 'records' ? 'records' : homeView === 'settings' ? 'settings' : 'home'} />
      <header className="home-header">
        <div><p className="eyebrow">TOEFL Local Practice</p><h1>{t('app.title')}</h1></div>
        <span className="offline-badge">{t('app.offline')}</span>
      </header>

      {runtimeBanner ? <div className="fixture-mode-banner" role="status">{runtimeBanner}</div> : null}
      {startupNoticeCode ? <RuntimeNotice code={startupNoticeCode} /> : null}
      {startupNotice ? <div className="warning startup-warning" role="alert">{startupNotice}</div> : null}

      {closeListenerError ? <div className="warning" role="alert">{t('app.closeGuardFailed', { detail: closeListenerError })}</div> : null}

      {session ? <PracticeShell /> : (
        <>
          <nav className="home-nav" aria-label={t('app.homeNavigation')}>
            <button className={homeView === 'practice' ? 'primary' : ''} onClick={() => navigate('practice')}>{t('app.practice')}</button>
            <button className={homeView === 'records' ? 'primary' : ''} onClick={() => navigate('records')}>{t('app.records')}</button>
            <button className={homeView === 'settings' ? 'primary' : ''} onClick={() => navigate('settings')}>{t('app.settings')}</button>
          </nav>
          {startupError ? (
            <div className="warning startup-warning" role="alert">
              {t('app.pathUnavailable', { detail: localizePathError(startupError, t) })}
              <button onClick={() => navigate('settings')}>{t('app.openPathSettings')}</button>
            </div>
          ) : null}
          {homeView === 'practice' ? (
            <>
              <RecoveryPanel />
              <div className="home-grid">
                <section className="card"><h2>{t('app.newPractice')}</h2><PackagePicker /><PracticeSetup /></section>
                <TypingPractice />
              </div>
            </>
          ) : null}
          {homeView === 'records' ? <RecordManager /> : null}
          {homeView === 'settings' ? <div className="settings-page"><LanguageSettings /><ShortcutSettings /><PathSettings /></div> : null}
        </>
      )}
      <WindowCloseDialog
        state={closeState}
        onSave={() => { void closeCoordinator.saveAndClose(); }}
        onRetry={() => { void closeCoordinator.retry(); }}
        onCancel={() => closeCoordinator.cancel()}
      />
    </main>
  );
}

function hasPendingCloseWork(): boolean {
  return Boolean(useAppStore.getState().session) ||
    hasWindowCloseParticipantWork() ||
    hasPendingAppConfigurationMutations() ||
    loadTypingDraft() !== null;
}

function beginWindowCloseHold(): PreCloseRuntimeState {
  const store = useAppStore.getState();
  if (store.session) return store.beginWindowCloseHold();
  const participantState = beginWindowCloseParticipantHold();
  if (participantState) return participantState;
  return loadTypingDraft() === null
    ? { kind: 'NO_SESSION' }
    : { kind: 'TYPING_PAUSED' };
}

function cancelWindowCloseHold(preCloseState: PreCloseRuntimeState): void {
  if (preCloseState.kind === 'ACTIVE_SESSION' || preCloseState.kind === 'PAUSED_SESSION') {
    useAppStore.getState().cancelWindowCloseHold(preCloseState);
    return;
  }
  cancelWindowCloseParticipantHold(preCloseState);
}

async function persistForWindowClose(): Promise<void> {
  await flushAppConfigurationMutations();
  await waitForCurrentStoreSave();
  await persistWindowCloseParticipants();
  await useAppStore.getState().persist('WINDOW_CLOSE');
  const latest = useAppStore.getState();
  if (latest.session && latest.saveStatus === 'error') {
    const detail = latest.saveError ? `：${latest.saveError}` : '';
    throw new Error(i18n.t('app.saveFailedKeepOpen', { detail }));
  }
}

async function waitForCurrentStoreSave(): Promise<void> {
  const isBusy = () => {
    const state = useAppStore.getState();
    return state.saveStatus === 'saving' || state.speakingTransitionPending;
  };
  if (!isBusy()) return;

  await new Promise<void>((resolve) => {
    let unsubscribe: () => void = () => undefined;
    const settleWhenReady = () => {
      if (isBusy()) return;
      unsubscribe();
      resolve();
    };
    unsubscribe = useAppStore.subscribe(settleWhenReady);
    settleWhenReady();
  });
}
