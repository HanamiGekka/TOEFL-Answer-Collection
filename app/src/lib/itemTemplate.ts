import type { DynamicItemTypeConfig, DynamicSectionName } from '../types';
import { cloneItemTypeConfig, getItemTypePreset, validateItemTypeConfig } from './itemTypeRegistry';
import type { DynamicBatchBlock } from './dynamicSession';

export type ItemTemplateBlock =
  | { source: 'system_preset'; type_id: string; count: number }
  | { source: 'custom_config'; config: DynamicItemTypeConfig; count: number };

export interface ItemBatchTemplate {
  template_id: string;
  name: string;
  section: DynamicSectionName;
  blocks: ItemTemplateBlock[];
}

export interface ItemBatchTemplateCollection {
  schema_version: 1;
  templates: ItemBatchTemplate[];
}

export const EMPTY_ITEM_TEMPLATES: ItemBatchTemplateCollection = { schema_version: 1, templates: [] };

export function creationRecipeFromBlocks(blocks: readonly DynamicBatchBlock[]): ItemTemplateBlock[] {
  return blocks.map(({ config, count }) => config.created_by === 'system_preset'
    ? { source: 'system_preset', type_id: config.type_id, count }
    : { source: 'custom_config', config: cloneItemTypeConfig(config), count });
}

export function normalizeTemplateName(name: string): string {
  return name.trim().toLowerCase();
}

export function canonicalTemplateRecipe(blocks: readonly ItemTemplateBlock[]): string {
  return JSON.stringify(blocks.map((block) => block.source === 'system_preset'
    ? ['system_preset', block.type_id, block.count]
    : ['custom_config', block.config.type_id, block.config.type_label, block.config.renderer,
      block.config.option_labels, block.config.custom_time_limit_ms,
      block.config.section_compatibility, block.config.created_by, block.config.version, block.count]));
}

export function validateItemTemplate(value: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: ['Template must be an object.'] };
  const template = value as Record<string, unknown>;
  if (!hasOnlyKeys(template, ['template_id', 'name', 'section', 'blocks'])) errors.push('Template contains unsupported fields.');
  if (typeof template.template_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(template.template_id)) errors.push('Template ID is invalid.');
  if (typeof template.name !== 'string' || !template.name.trim() || template.name.trim().length > 80 ||
      Array.from(template.name).some((character) => (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127)) {
    errors.push('Template name must be 1–80 safe characters.');
  }
  const section = template.section;
  if (section !== 'Reading' && section !== 'Listening' && section !== 'Writing') errors.push('Template Section is invalid.');
  if (!Array.isArray(template.blocks) || template.blocks.length < 1 || template.blocks.length > 20) {
    errors.push('Template requires 1–20 blocks.');
  } else {
    let total = 0;
    for (const block of template.blocks) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) { errors.push('Template block is invalid.'); continue; }
      const entry = block as Record<string, unknown>;
      if (!Number.isSafeInteger(entry.count) || (entry.count as number) < 1 || (entry.count as number) > 100) errors.push('Template block count must be 1–100.');
      else total += entry.count as number;
      if (entry.source === 'system_preset') {
        if (!hasOnlyKeys(entry, ['source', 'type_id', 'count'])) errors.push('Preset block contains unsupported fields.');
        if (typeof entry.type_id !== 'string' || typeof section !== 'string' || !['Reading', 'Listening', 'Writing'].includes(section)) errors.push('Template preset is invalid.');
        else {
          try { getItemTypePreset(section as DynamicSectionName, entry.type_id); }
          catch { errors.push(`Unknown or incompatible preset: ${entry.type_id}`); }
        }
      } else if (entry.source === 'custom_config') {
        if (!hasOnlyKeys(entry, ['source', 'config', 'count'])) errors.push('Custom block contains unsupported fields.');
        const config = entry.config as DynamicItemTypeConfig | undefined;
        try {
          if (!config || !hasOnlyKeys(config as unknown as Record<string, unknown>, [
            'type_id', 'type_label', 'renderer', 'option_labels', 'custom_time_limit_ms',
            'section_compatibility', 'created_by', 'version'
          ]) || config.created_by !== 'user' || !validateItemTypeConfig(config).ok || !config.section_compatibility.includes(section as DynamicSectionName)) errors.push('Template custom config is invalid or incompatible.');
        } catch { errors.push('Template custom config is invalid.'); }
      } else errors.push('Template block source is invalid.');
    }
    if (total > 100) errors.push('Template total must be at most 100 Items.');
  }
  return { ok: errors.length === 0, errors };
}

export function parseItemTemplates(value: unknown): { collection: ItemBatchTemplateCollection; error?: string } {
  if (value === undefined || value === null) return { collection: { schema_version: 1, templates: [] } };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { collection: { schema_version: 1, templates: [] }, error: 'Saved templates are corrupt; original setting was preserved.' };
  const candidate = value as Record<string, unknown>;
  if (candidate.schema_version !== 1 || !Array.isArray(candidate.templates) ||
      !hasOnlyKeys(candidate, ['schema_version', 'templates'])) return { collection: { schema_version: 1, templates: [] }, error: 'Saved templates have an unsupported format; original setting was preserved.' };
  const ids = new Set<string>();
  for (const template of candidate.templates) {
    const validation = validateItemTemplate(template);
    if (!validation.ok) return { collection: { schema_version: 1, templates: [] }, error: `Saved templates are corrupt: ${validation.errors.join(' ')}` };
    const id = (template as ItemBatchTemplate).template_id;
    if (ids.has(id)) return { collection: { schema_version: 1, templates: [] }, error: 'Saved templates contain duplicate IDs.' };
    ids.add(id);
  }
  return { collection: candidate as unknown as ItemBatchTemplateCollection };
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function resolveTemplateBlocks(template: ItemBatchTemplate): DynamicBatchBlock[] {
  const validation = validateItemTemplate(template);
  if (!validation.ok) throw new Error(validation.errors.join(' '));
  return template.blocks.map((block) => ({
    config: block.source === 'system_preset'
      ? getItemTypePreset(template.section, block.type_id)
      : cloneItemTypeConfig(block.config),
    count: block.count
  }));
}
