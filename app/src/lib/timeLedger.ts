import type { PracticeSession, RuntimeScopeId, SectionName } from '../types';
import { isDynamicSession } from './dynamicSession';

export interface ActivityTimer {
  currentActivityId: string;
  currentActivityStartedAtMonotonic: number | null;
  pausedAtMonotonic: number | null;
  pausedMs: number;
}

export interface SettledActivity {
  timer: ActivityTimer;
  activityId: string;
  deltaMs: number;
}

export interface TimingLedger {
  questions: Record<string, number>;
  tasks: Record<string, number>;
  scopes: Partial<Record<RuntimeScopeId, number>>;
  sections: Record<SectionName, number>;
  attributedActiveMs: number;
  unattributedActiveMs: number;
  sessionActiveMs: number;
}

export interface LiveActivityDelta {
  activityId: string;
  deltaMs: number;
}

export function createActivityTimer(activityId: string, now: number, pausedMs = 0): ActivityTimer {
  return {
    currentActivityId: activityId,
    currentActivityStartedAtMonotonic: finiteNow(now),
    pausedAtMonotonic: null,
    pausedMs: nonNegative(pausedMs)
  };
}

export function previewActivityDelta(timer: ActivityTimer, now: number): number {
  if (timer.pausedAtMonotonic !== null || timer.currentActivityStartedAtMonotonic === null) return 0;
  return Math.max(0, finiteNow(now) - timer.currentActivityStartedAtMonotonic);
}

export function settleActivityTimer(timer: ActivityTimer, now: number): SettledActivity {
  const settledAt = finiteNow(now);
  const deltaMs = previewActivityDelta(timer, settledAt);
  return {
    activityId: timer.currentActivityId,
    deltaMs,
    timer: {
      ...timer,
      currentActivityStartedAtMonotonic:
        timer.currentActivityStartedAtMonotonic === null
          ? null
          : timer.pausedAtMonotonic === null
            ? settledAt
            : null
    }
  };
}

export function startActivity(timer: ActivityTimer, activityId: string, now: number): ActivityTimer {
  return {
    ...timer,
    currentActivityId: activityId,
    currentActivityStartedAtMonotonic: timer.pausedAtMonotonic === null ? finiteNow(now) : null
  };
}

export function pauseActivityTimer(timer: ActivityTimer, now: number): SettledActivity {
  if (timer.pausedAtMonotonic !== null) {
    return { timer, activityId: timer.currentActivityId, deltaMs: 0 };
  }
  const settled = settleActivityTimer(timer, now);
  return {
    ...settled,
    timer: {
      ...settled.timer,
      currentActivityStartedAtMonotonic: null,
      pausedAtMonotonic: finiteNow(now)
    }
  };
}

export function resumeActivityTimer(timer: ActivityTimer, now: number): ActivityTimer {
  if (timer.pausedAtMonotonic === null) return timer;
  const resumedAt = finiteNow(now);
  return {
    ...timer,
    currentActivityStartedAtMonotonic: resumedAt,
    pausedAtMonotonic: null,
    pausedMs: timer.pausedMs + Math.max(0, resumedAt - timer.pausedAtMonotonic)
  };
}

export function currentPausedMs(timer: ActivityTimer, now: number): number {
  return timer.pausedAtMonotonic === null
    ? timer.pausedMs
    : timer.pausedMs + Math.max(0, finiteNow(now) - timer.pausedAtMonotonic);
}

export function deriveTimingLedger(
  session: PracticeSession,
  liveActivity?: LiveActivityDelta
): TimingLedger {
  const questions: Record<string, number> = {};
  for (const question of session.questions) {
    const answer = session.answers[question.id];
    questions[question.id] = nonNegative(answer?.active_time_ms ?? answer?.total_active_ms ?? 0);
  }
  if (liveActivity && liveActivity.activityId in questions) {
    questions[liveActivity.activityId] += nonNegative(liveActivity.deltaMs);
  }

  const tasks: Record<string, number> = {};
  const scopes: Partial<Record<RuntimeScopeId, number>> = {};
  const sections: Record<SectionName, number> = { Reading: 0, Listening: 0, Writing: 0 };
  if (isDynamicSession(session)) {
    for (const section of session.dynamic_sections) {
      const sectionTime = section.item_ids.reduce((sum, itemId) => sum + (questions[itemId] ?? 0), 0);
      scopes[section.section_id] = sectionTime;
      sections[section.section_id] = sectionTime;
    }
  }
  const attributedActiveMs = Object.values(sections).reduce((sum, value) => sum + value, 0);
  const unattributedActiveMs = nonNegative(session.unattributed_active_time_ms ?? 0);
  return {
    questions,
    tasks,
    scopes,
    sections,
    attributedActiveMs,
    unattributedActiveMs,
    sessionActiveMs: attributedActiveMs + unattributedActiveMs
  };
}

export function applyDerivedTiming(session: PracticeSession): PracticeSession {
  const ledger = deriveTimingLedger(session);
  return {
    ...session,
    active_ms: ledger.sessionActiveMs,
    unattributed_active_time_ms: ledger.unattributedActiveMs,
    tasks: [],
    modules: [],
    dynamic_sections: session.dynamic_sections?.map((section) => ({
      ...section,
      active_time_ms: ledger.sections[section.section_id]
    }))
  };
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function finiteNow(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
