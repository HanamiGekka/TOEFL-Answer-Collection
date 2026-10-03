import type { PracticeSession } from '../types';

export function getNavigationRules(session: Pick<PracticeSession, 'mode'>) {
  return { listening_can_return: session.mode === 'practice' };
}
