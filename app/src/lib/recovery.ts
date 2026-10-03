import type { PracticeSession } from '../types';
import {
  isDynamicSession,
  type DynamicPracticeSession,
  validateDynamicSession
} from './dynamicSession';
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
      code: 'CORRUPT_SNAPSHOT' | 'UNSUPPORTED_SESSION_SCHEMA' | 'INVALID_SNAPSHOT';
      diagnostic: string;
      raw_snapshot?: string;
    };

export function prepareRecoverySession(raw: unknown): RecoveryPreparation {
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
  if (schema !== 6) {
    return { ok: false, code: 'UNSUPPORTED_SESSION_SCHEMA', diagnostic: `Unsupported Session schema: ${schema}` };
  }
  {
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

}
