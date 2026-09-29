export type PersistedHomeView = 'practice' | 'records' | 'settings';

export interface HomeViewPersistenceState {
  view: PersistedHomeView;
  hydrated: boolean;
  userNavigated: boolean;
}

export interface HomeViewPersistenceResult {
  state: HomeViewPersistenceState;
  persist?: PersistedHomeView;
}

export function initialHomeViewState(): HomeViewPersistenceState {
  return {
    view: 'practice',
    hydrated: false,
    userNavigated: false
  };
}

export function hydrateHomeView(
  state: HomeViewPersistenceState,
  savedView: PersistedHomeView | undefined
): HomeViewPersistenceResult {
  return {
    state: {
      ...state,
      view: !state.userNavigated && savedView ? savedView : state.view,
      hydrated: true
    }
  };
}

export function requestHomeView(
  state: HomeViewPersistenceState,
  nextView: PersistedHomeView
): HomeViewPersistenceResult {
  if (nextView === state.view) return { state };
  return {
    state: {
      ...state,
      view: nextView,
      userNavigated: true
    },
    persist: state.hydrated ? nextView : undefined
  };
}
