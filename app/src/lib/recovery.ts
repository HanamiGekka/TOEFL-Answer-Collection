import type { PracticeSession } from '../types';
import {
  isDynamicSession,
  type DynamicPracticeSession,
  validateDynamicSession
} from './dynamicSession';
import { migratePracticeSession } from './sessionEngine';
import { writingTextNeedsCompatibilityNotice } from './writingTextPolicy';

export type RecoveryPreparation =
  | {
      ok: true;
      session: PracticeSession;
      resume_policy: { paused: true; reuse_monotonic_anchor: false };
      migrated: boolean;
      writing_policy_compatibility_warning: boolean;
    }
  | {
      ok: false;
      code: 'CORRUPT_SNAPSHOT' | 'UNSUPPORTED_SCHEMA' | 'BLUEPRINT_MISSING' | 'INVALID_SNAPSHOT';
      diagnostic: string;
      raw_snapshot?: string;
    };

const DEFAULT_BLUEPRINT_ID = 'toefl-2026-r006-1-question-blueprint';
const DEFAULT_BLUEPRINT_ALIASES = new Set([
  DEFAULT_BLUEPRINT_ID,
  'toefl-2026-default-question-blueprint',
  'toefl-2026-default'
]);

export function prepareRecoverySession(raw: unknown, availableBlueprintIds: string[]): RecoveryPreparation {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        code: 'CORRUPT_SNAPSHOT',
        diagnostic: error instanceof Error ? error.message : String(error),
        raw_snapshot: raw
      };
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, code: 'INVALID_SNAPSHOT', diagnostic: 'Snapshot is not a JSON object.' };
  }
  const candidate = parsed as Record<string, unknown>;
  const schema = Number(candidate.session_schema_version ?? 1);
  if (!Number.isInteger(schema) || schema < 2 || schema > 6) {
    return { ok: false, code: 'UNSUPPORTED_SCHEMA', diagnostic: `Unsupported Session schema: ${schema}` };
  }
  if (schema === 6) {
    try {
      const session = candidate as unknown as DynamicPracticeSession;
      if (!isDynamicSession(session)) {
        return {
          ok: false,
          code: 'INVALID_SNAPSHOT',
          diagnostic: 'Session schema v6 requires structure_mode dynamic_manual.'
        };
      }
      const validation = validateDynamicSession(session);
      if (!validation.ok) {
        return {
          ok: false,
          code: 'INVALID_SNAPSHOT',
          diagnostic: validation.errors.join(' ')
        };
      }
      return {
        ok: true,
        session,
        resume_policy: { paused: true, reuse_monotonic_anchor: false },
        migrated: false,
        writing_policy_compatibility_warning: writingTextNeedsCompatibilityNotice(session)
      };
    } catch (error) {
      return {
        ok: false,
        code: 'INVALID_SNAPSHOT',
        diagnostic: error instanceof Error ? error.message : String(error)
      };
    }
  }
  const blueprintId = String(candidate.blueprint_id ?? DEFAULT_BLUEPRINT_ID);
  const blueprintAvailable = availableBlueprintIds.includes(blueprintId) ||
    (DEFAULT_BLUEPRINT_ALIASES.has(blueprintId) && availableBlueprintIds.some((id) => DEFAULT_BLUEPRINT_ALIASES.has(id)));
  if (!blueprintAvailable) {
    return { ok: false, code: 'BLUEPRINT_MISSING', diagnostic: `Blueprint is unavailable: ${blueprintId}` };
  }
  try {
    const session = migratePracticeSession(candidate);
    return {
      ok: true,
      session,
      resume_policy: { paused: true, reuse_monotonic_anchor: false },
      migrated: schema < 5,
      writing_policy_compatibility_warning: writingTextNeedsCompatibilityNotice(session)
    };
  } catch (error) {
    return {
      ok: false,
      code: 'INVALID_SNAPSHOT',
      diagnostic: error instanceof Error ? error.message : String(error)
    };
  }
}
