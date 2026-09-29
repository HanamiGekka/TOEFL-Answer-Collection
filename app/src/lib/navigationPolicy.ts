import type { PracticeSession, TimingProfile } from '../types';
import { DEFAULT_BLUEPRINT } from './blueprint';

export type NavigationRules = TimingProfile['navigation_rules'];

export function getNavigationRules(session: Pick<PracticeSession, 'mode'>): NavigationRules {
  return DEFAULT_BLUEPRINT.navigation_profiles[session.mode];
}
