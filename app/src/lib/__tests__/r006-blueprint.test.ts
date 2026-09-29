import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLUEPRINT,
  createQuestionsFromBlueprint,
  mergeBlueprintOverride,
  validateBlueprint,
  type ToeflBlueprint
} from '../blueprint';
import { buildInitialSessionRuntime } from '../sessionEngine';
import { getNavigationRules } from '../navigationPolicy';

function clone(): ToeflBlueprint {
  return structuredClone(DEFAULT_BLUEPRINT);
}

describe('R006 versioned TOEFL blueprint', () => {
  it('accepts the bundled default blueprint', () => {
    expect(validateBlueprint(DEFAULT_BLUEPRINT).ok).toBe(true);
  });

  it('rejects duplicate slot ids', () => {
    const value = clone();
    value.sections[0].question_slots[1].slot_id = value.sections[0].question_slots[0].slot_id;
    expect(validateBlueprint(value).errors.some((error) => error.code === 'DUPLICATE_ID')).toBe(true);
  });

  it('rejects duplicate module ids', () => {
    const value = clone();
    value.sections[1].modules[0].module_id = value.sections[0].modules[0].module_id;
    expect(validateBlueprint(value).errors.some((error) => error.code === 'DUPLICATE_ID')).toBe(true);
  });

  it('rejects a question type without a renderer', () => {
    const value = clone();
    value.sections[0].question_slots[0].answer_mode = 'unknown' as never;
    expect(validateBlueprint(value).errors.some((error) => error.code === 'MISSING_RENDERER')).toBe(true);
  });

  it('rejects a negative task timer', () => {
    const value = clone();
    value.sections[2].task_slots[0].timer_limit_ms = -1;
    expect(validateBlueprint(value).errors.some((error) => error.code === 'INVALID_TIMER')).toBe(true);
  });

  it('rejects a missing timing profile reference', () => {
    const value = clone();
    value.sections[0].timing_profile = 'missing';
    expect(validateBlueprint(value).errors.some((error) => error.code === 'MISSING_PROFILE')).toBe(true);
  });

  it('rejects declared question counts that do not match slots', () => {
    const value = clone();
    value.sections[0].declared_question_count += 1;
    expect(validateBlueprint(value).errors.some((error) => error.code === 'COUNT_MISMATCH')).toBe(true);
  });

  it('rejects task references to missing question slots', () => {
    const value = clone();
    value.sections[2].task_slots[0].question_slot_ids.push('missing-slot');
    expect(validateBlueprint(value).errors.some((error) => error.code === 'MISSING_SLOT')).toBe(true);
  });

  it('maps every configured slot to an exportable PracticeQuestion', () => {
    const questions = createQuestionsFromBlueprint(DEFAULT_BLUEPRINT, ['Reading', 'Listening', 'Writing', 'Speaking']);
    expect(questions).toHaveLength(120);
    expect(new Set(questions.map((question) => question.id)).size).toBe(120);
  });

  it('merges a package override without mutating the default', () => {
    const before = DEFAULT_BLUEPRINT.sections[0].question_slots[0].type_label;
    const merged = mergeBlueprintOverride(DEFAULT_BLUEPRINT, {
      package_id: 'Mock.01.A.1',
      slot_overrides: { 'Reading-1': { type_label: 'Package-specific choice' } }
    });
    expect(merged.sections[0].question_slots[0].type_label).toBe('Package-specific choice');
    expect(DEFAULT_BLUEPRINT.sections[0].question_slots[0].type_label).toBe(before);
  });

  it('does not apply one package override to another package', () => {
    const merged = mergeBlueprintOverride(DEFAULT_BLUEPRINT, {
      package_id: 'Other.01.A.1',
      slot_overrides: { 'Reading-1': { type_label: 'Other' } }
    }, 'Mock.01.A.1');
    expect(merged).toEqual(DEFAULT_BLUEPRINT);
  });

  it('preserves unresolved official-order claims as NEEDS_USER_CONFIRMATION', () => {
    const unresolved = DEFAULT_BLUEPRINT.sections.flatMap((section) => section.question_slots)
      .filter((slot) => slot.confirmation_status === 'NEEDS_USER_CONFIRMATION');
    expect(unresolved.length).toBeGreaterThan(0);
  });

  it('rejects overrides that attempt to change safety policy', () => {
    expect(() => mergeBlueprintOverride(DEFAULT_BLUEPRINT, {
      package_id: 'Mock.01.A.1',
      slot_overrides: {},
      safety_policy: { reveal_question_text: true }
    } as never)).toThrow(/safety/i);
  });

  it('persists the Blueprint identity in a new Session runtime', () => {
    const questions = createQuestionsFromBlueprint(DEFAULT_BLUEPRINT, ['Reading']);
    const session = buildInitialSessionRuntime({
      session_schema_version: 5, session_id: 'blueprint-session', package_id: 'Mock.01.A.1', source_path: 'readonly',
      mode: 'practice', timing_profile_id: 'toefl-2026-practice', timing_profile_version: '1.0.0',
      blueprint_id: DEFAULT_BLUEPRINT.blueprint_id, blueprint_version: DEFAULT_BLUEPRINT.version,
      created_at: '2026-07-13T00:00:00Z', active_ms: 0, paused_ms: 0,
      questions, answers: {}, modules: [], view: 'PRACTICE'
    });
    expect(session).toMatchObject({ blueprint_id: DEFAULT_BLUEPRINT.blueprint_id, blueprint_version: DEFAULT_BLUEPRINT.version });
  });

  it('drives runtime navigation rules from the configured Blueprint profiles', () => {
    expect(getNavigationRules({ mode: 'practice' })).toEqual(DEFAULT_BLUEPRINT.navigation_profiles.practice);
    expect(getNavigationRules({ mode: 'exam_simulation' })).toEqual(DEFAULT_BLUEPRINT.navigation_profiles.exam_simulation);
  });
});
