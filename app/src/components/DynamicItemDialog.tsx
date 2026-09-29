import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DynamicItemRenderer, DynamicItemTypeConfig, DynamicSectionName } from '../types';
import {
  createCustomItemType,
  listItemTypePresets,
  validateItemTypeConfig
} from '../lib/itemTypeRegistry';
import { useAppStore } from '../store/appStore';
import { BUILT_IN_BATCHES } from '../lib/itemBatchRegistry';
import { resolveTemplateBlocks, type ItemBatchTemplate, type ItemTemplateBlock } from '../lib/itemTemplate';
import { getItemTypeDisplayLabel, getPresetDisplayLabel } from '../i18n/displayLabels';

const DEFAULT_OPTIONS = ['A', 'B', 'C', 'D'];

export function DynamicItemDialog() {
  const dialog = useAppStore((state) => state.dynamicItemDialog);
  if (!dialog) return null;
  return <DynamicItemDialogContents key={`${dialog.mode}:${dialog.item_id ?? dialog.section_id}:${dialog.ordinal}`} />;
}

function DynamicItemDialogContents() {
  const { t, i18n } = useTranslation();
  const dialog = useAppStore((state) => state.dynamicItemDialog);
  const session = useAppStore((state) => state.session);
  const createItem = useAppStore((state) => state.createDynamicItemFromConfig);
  const createBatch = useAppStore((state) => state.createDynamicBatch);
  const batchPending = useAppStore((state) => state.batchPending);
  const createSame = useAppStore((state) => state.repeatDynamicCreationOperation);
  const previousOperation = useAppStore((state) => dialog ? state.lastCreationOperations[dialog.section_id] : undefined);
  const changeType = useAppStore((state) => state.changeDynamicItemTypeFromConfig);
  const cancel = useAppStore((state) => state.cancelDynamicItemDialog);
  const finishSection = useAppStore((state) => state.finishDynamicCurrentSection);
  const presets = useMemo(
    () => dialog ? listItemTypePresets(dialog.section_id) : [],
    [dialog]
  );
  const editingItem = dialog?.mode === 'edit'
    ? session?.questions.find((item) => item.id === dialog.item_id)
    : undefined;
  const initial = editingItem?.type_config ?? presets[0];
  const [presetId, setPresetId] = useState(
    editingItem?.type_config?.created_by === 'user' ? 'custom' : editingItem?.type_id ?? initial?.type_id ?? 'custom'
  );
  const missingEditConfig = dialog?.mode === 'edit' && !editingItem?.type_config &&
    !presets.some((preset) => preset.type_id === presetId);
  const missingPreset = editingItem?.type_config?.created_by === 'system_preset' &&
    presetId === editingItem.type_id && !presets.some((preset) => preset.type_id === presetId);
  const [typeLabel, setTypeLabel] = useState(initial?.type_label ?? 'Custom Item Type');
  const [renderer, setRenderer] = useState<DynamicItemRenderer>(initial?.renderer ?? 'single_choice');
  const [optionLabels, setOptionLabels] = useState<string[]>(initial?.option_labels ?? DEFAULT_OPTIONS);
  const [useTimeLimit, setUseTimeLimit] = useState(initial?.custom_time_limit_ms != null);
  const [timeLimitSeconds, setTimeLimitSeconds] = useState(
    initial?.custom_time_limit_ms ? String(initial.custom_time_limit_ms / 1_000) : '60'
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [count, setCount] = useState('1');
  const submitting = useRef(false);

  if (!dialog) return null;
  const localizedSection = t(`section.${dialog.section_id.toLowerCase()}`);
  const title = dialog.mode === 'create'
    ? t('dynamicItem.addTitle', { section: localizedSection, ordinal: dialog.ordinal })
    : t('dynamicItem.editTitle', { section: localizedSection, itemId: dialog.item_id });
  const choiceRenderer = renderer === 'single_choice' || renderer === 'multiple_choice';
  const hasPrevious = !!previousOperation;
  const completesSession = session?.dynamic_sections?.every((item) =>
    item.section_id === dialog.section_id || item.status === 'COMPLETED' || item.status === 'SKIPPED_EMPTY') ?? false;
  const finishLabel = t(completesSession ? 'dynamicItem.finishAndSession' : 'dynamicItem.finishSection', { section: localizedSection });

  const selectPreset = (nextId: string) => {
    setPresetId(nextId);
    if (nextId === 'custom') return;
    const preset = presets.find((candidate) => candidate.type_id === nextId);
    if (!preset) {
      setErrors([`Unknown ${dialog.section_id} item type preset: ${nextId}`]);
      return;
    }
    setErrors([]);
    setTypeLabel(preset.type_label);
    setRenderer(preset.renderer);
    setOptionLabels([...preset.option_labels]);
  };

  const buildConfig = (): DynamicItemTypeConfig => {
    const limitNumber = Number(timeLimitSeconds);
    const customTimeLimitMs = useTimeLimit && Number.isFinite(limitNumber)
      ? Math.round(limitNumber * 1_000)
      : null;
    if (presetId !== 'custom') {
      const preset = presets.find((candidate) => candidate.type_id === presetId);
      if (!preset) throw new Error(`Unknown ${dialog.section_id} item type preset: ${presetId}`);
      const labels = choiceRenderer ? [...optionLabels] : [];
      const matchesPresetShape =
        renderer === preset.renderer &&
        labels.join('\u0000') === preset.option_labels.join('\u0000') &&
        customTimeLimitMs === preset.custom_time_limit_ms;
      if (matchesPresetShape && typeLabel.trim() === preset.type_label) return preset;
      // Keep a valid persisted v6 system label unchanged when editing its old metadata.
      if (matchesPresetShape && editingItem?.type_config?.created_by === 'system_preset' &&
          editingItem.type_config.type_id === presetId && typeLabel.trim() === editingItem.type_config.type_label) {
        return editingItem.type_config;
      }
    }
    if (presetId === 'custom' && editingItem?.type_config?.created_by === 'user' &&
        typeLabel.trim() === editingItem.type_config.type_label &&
        renderer === editingItem.type_config.renderer &&
        (choiceRenderer ? optionLabels : []).join('\u0000') === editingItem.type_config.option_labels.join('\u0000') &&
        customTimeLimitMs === editingItem.type_config.custom_time_limit_ms) {
      return editingItem.type_config;
    }
    return createCustomItemType({
      section: dialog.section_id,
      type_label: typeLabel,
      renderer,
      option_labels: choiceRenderer ? optionLabels : [],
      custom_time_limit_ms: customTimeLimitMs
    });
  };

  const submit = async () => {
    if (submitting.current || batchPending) return;
    if (missingEditConfig || missingPreset) {
      setErrors([missingPreset ? `Unknown ${dialog.section_id} item type preset: ${editingItem?.type_id}` : 'Item type configuration is missing.']);
      return;
    }
    try {
      const config = buildConfig();
      const validation = validateItemTypeConfig(config);
      if (!validation.ok) {
        setErrors(validation.errors);
        return;
      }
      if (dialog.mode === 'create') {
        const countNumber = Number(count);
        if (!Number.isSafeInteger(countNumber) || countNumber < 1 || countNumber > 100) {
          setErrors([t('dynamicItem.countInvalid')]);
          return;
        }
        submitting.current = true;
        if (countNumber === 1) createItem(config);
        else await createBatch([{ config, count: countNumber }]);
        return;
      }
      if (changeType(config, false)) return;
      if (window.confirm(t('dynamicItem.confirmRendererChange'))) {
        changeType(config, true);
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    } finally {
      submitting.current = false;
    }
  };

  return (
    <div className="session-notice-overlay" role="presentation">
      <section className="session-notice-dialog dynamic-item-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {dialog.mode === 'create' && hasPrevious ? (
          <button disabled={batchPending} onClick={() => void createSame().catch((error) => setErrors([String(error)]))}>
            {t('dynamicItem.repeatPreviousOperation', { count: previousOperation?.reduce((sum, block) => sum + block.count, 0) })}
          </button>
        ) : null}

        {dialog.mode === 'create' ? (
          <>
            <fieldset className="dynamic-quick-batches">
              <legend>{t('batch.quickBatches')}</legend>
              <div className="dialog-actions">
                {BUILT_IN_BATCHES.filter((batch) => batch.section === dialog.section_id).map((batch) => (
                  <button key={batch.id} type="button" disabled={batchPending} onClick={() => {
                    selectPreset(batch.type_id);
                    setCount(String(batch.count));
                  }}>{t(batch.label_key)}</button>
                ))}
              </div>
            </fieldset>
            <label>{t('dynamicItem.count')}
              <input type="number" min="1" max="100" step="1" value={count} onChange={(event) => setCount(event.target.value)} />
            </label>
          </>
        ) : null}

        <label>
          {t('dynamicItem.preset')}
          <select value={presetId} onChange={(event) => selectPreset(event.target.value)}>
            {presets.map((preset) => (
              <option key={preset.type_id} value={preset.type_id}>{getItemTypeDisplayLabel(preset, i18n.language)}</option>
            ))}
            <option value="custom">{t('dynamicItem.customType')}</option>
          </select>
        </label>
        <label>
          {t('dynamicItem.displayName')}
          <input value={presetId !== 'custom' && (typeLabel === initial?.type_label || typeLabel === presets.find((preset) => preset.type_id === presetId)?.type_label) ? getPresetDisplayLabel(presetId, i18n.language) : typeLabel} maxLength={80} onChange={(event) => setTypeLabel(event.target.value)} />
        </label>
        <label>
          {t('dynamicItem.renderer')}
          <select
            value={renderer}
            onChange={(event) => {
              const next = event.target.value as DynamicItemRenderer;
              setRenderer(next);
              if ((next === 'single_choice' || next === 'multiple_choice') && optionLabels.length < 2) {
                setOptionLabels(DEFAULT_OPTIONS);
              }
            }}
          >
            <option value="single_choice">single_choice</option>
            <option value="multiple_choice">multiple_choice</option>
            <option value="short_text">short_text</option>
            <option value="long_text">long_text</option>
          </select>
        </label>

        {choiceRenderer ? (
          <fieldset className="dynamic-options-editor">
            <legend>{t('dynamicItem.optionLabelsHelp')}</legend>
            {optionLabels.map((label, index) => (
              <div key={index} className="dynamic-option-row">
                <label>
                  {t('dynamicItem.optionLabel', { index: index + 1 })}
                  <input
                    value={label}
                    maxLength={40}
                    onChange={(event) => setOptionLabels((items) => items.map((item, itemIndex) =>
                      itemIndex === index ? event.target.value : item))}
                  />
                </label>
                <button
                  disabled={optionLabels.length <= 2}
                  onClick={() => setOptionLabels((items) => items.filter((_, itemIndex) => itemIndex !== index))}
                >{t('common.delete')}</button>
              </div>
            ))}
            <div className="dialog-actions">
              <button
                disabled={optionLabels.length >= 10}
                onClick={() => setOptionLabels((items) => [...items, String.fromCharCode(65 + items.length)])}
              >{t('dynamicItem.addOption')}</button>
              <button onClick={() => setOptionLabels(DEFAULT_OPTIONS)}>{t('dynamicItem.restoreOptions')}</button>
            </div>
          </fieldset>
        ) : null}

        <label>
          <input
            type="checkbox"
            checked={useTimeLimit}
            onChange={(event) => setUseTimeLimit(event.target.checked)}
          />
          {t('dynamicItem.customTimeLimit')}
        </label>
        {useTimeLimit ? (
          <label>
            {t('dynamicItem.timeLimitSeconds')}
            <input
              type="number"
              min="1"
              step="1"
              value={timeLimitSeconds}
              onChange={(event) => setTimeLimitSeconds(event.target.value)}
            />
          </label>
        ) : null}

        {dialog.mode === 'create' ? (
          <TemplateEditor section={dialog.section_id} buildConfig={buildConfig} createBatch={createBatch} disabled={batchPending} />
        ) : null}
        {errors.length > 0 ? <p className="danger-text" role="alert">{errors.join('; ')}</p> : null}
        <div className="dialog-actions">
          <button className="primary" disabled={batchPending} onClick={() => void submit()}>
            {dialog.mode === 'create' ? count === '1' ? t('dynamicItem.createAndEnter') : t('dynamicItem.createManyAndEnter', { count }) : t('dynamicItem.saveType')}
          </button>
          {dialog.mode === 'create' ? (
            <button onClick={() => { cancel(); void finishSection(false); }}>{finishLabel}</button>
          ) : null}
          <button onClick={cancel}>{t('common.cancel')}</button>
        </div>
      </section>
    </div>
  );
}

function TemplateEditor({ section, buildConfig, createBatch, disabled }: {
  section: DynamicSectionName;
  buildConfig: () => DynamicItemTypeConfig;
  createBatch: ReturnType<typeof useAppStore.getState>['createDynamicBatch'];
  disabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const collection = useAppStore((state) => state.itemTemplates);
  const storageError = useAppStore((state) => state.itemTemplateError);
  const mutationPending = useAppStore((state) => state.templateMutationPending);
  const saveTemplate = useAppStore((state) => state.saveItemTemplate);
  const deleteTemplate = useAppStore((state) => state.deleteItemTemplate);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [blocks, setBlocks] = useState<ItemTemplateBlock[]>([]);
  const [blockCount, setBlockCount] = useState('1');
  const [error, setError] = useState<string | { key: string; values?: Record<string, string> }>('');
  const busy = useRef(false);
  const templates = collection.templates.filter((entry) => entry.section === section);
  const selected = templates.find((entry) => entry.template_id === selectedId);
  const total = blocks.reduce((sum, block) => sum + block.count, 0);

  const select = (id: string) => {
    const template = templates.find((entry) => entry.template_id === id);
    setSelectedId(id);
    setName(template?.name ?? '');
    setBlocks(template ? template.blocks.map((block) => ({ ...block })) : []);
    setError('');
  };
  const addBlock = () => {
    try {
      const count = Number(blockCount);
      if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error(t('template.blockCountInvalid'));
      const config = buildConfig();
      const validation = validateItemTypeConfig(config);
      if (!validation.ok) throw new Error(validation.errors.join(' '));
      setBlocks((items) => [...items, config.created_by === 'system_preset'
        ? { source: 'system_preset', type_id: config.type_id, count }
        : { source: 'custom_config', config, count }]);
      setError('');
    } catch (cause) { setError(String(cause)); }
  };
  const save = async (update: boolean) => {
    if (busy.current || disabled) return;
    busy.current = true;
    try {
      const template: ItemBatchTemplate = { template_id: update && selected ? selected.template_id
        : `template_${Date.now()}_${Math.random().toString(36).slice(2)}`, name: name.trim(), section, blocks };
      const ok = await saveTemplate(template, update ? 'update' : 'create');
      if (ok) { setSelectedId(template.template_id); setError(''); }
      else setError(useAppStore.getState().itemTemplateSaveError ?? useAppStore.getState().itemTemplateError ?? { key: 'template.saveFailed' });
    } finally { busy.current = false; }
  };
  const apply = async () => {
    if (!selected || busy.current || disabled) return;
    busy.current = true;
    try { await createBatch(resolveTemplateBlocks(selected)); }
    catch (cause) { setError(String(cause)); }
    finally { busy.current = false; }
  };
  const remove = async () => {
    if (!selected || busy.current || disabled || !window.confirm(t('template.confirmDelete', { name: selected.name }))) return;
    busy.current = true;
    try {
      if (await deleteTemplate(selected.template_id)) select('');
      else setError(useAppStore.getState().itemTemplateSaveError ?? useAppStore.getState().itemTemplateError ?? { key: 'template.deleteFailed' });
    } finally { busy.current = false; }
  };
  return <fieldset className="dynamic-template-editor">
    <legend>{t('template.savedTemplates')}</legend>
    {storageError ? <p className="danger-text" role="alert">{t(storageError.key, storageError.values)}</p> : null}
    <label>{t('template.saved')}
      <select value={selectedId} onChange={(event) => select(event.target.value)}>
        <option value="">{t('template.select')}</option>
        {templates.map((template) => <option key={template.template_id} value={template.template_id}>{template.name}</option>)}
      </select>
    </label>
    {selected ? <p>{t('template.summary', { name: selected.name, section: t(`section.${section.toLowerCase()}`), blocks: selected.blocks.length, count: selected.blocks.reduce((sum, block) => sum + block.count, 0) })}</p> : null}
    <div className="dialog-actions">
      <button type="button" disabled={!selected || disabled} onClick={() => void apply()}>{t('template.apply')}</button>
      <button type="button" disabled={!selected || disabled || !!storageError || mutationPending} onClick={() => void remove()}>{t('template.delete')}</button>
    </div>
    <label>{t('template.name')}<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
    <label>{t('template.newBlockCount')}<input type="number" min="1" max="100" step="1" value={blockCount} onChange={(event) => setBlockCount(event.target.value)} /></label>
    <button type="button" disabled={disabled || blocks.length >= 20} onClick={addBlock}>{t('template.addBlock')}</button>
    <ol>{blocks.map((block, index) => <li key={index}>
      {block.source === 'system_preset' ? getPresetDisplayLabel(block.type_id, i18n.language) : block.config.type_label}
      <label>{t('dynamicItem.count')}<input type="number" min="1" max="100" step="1" value={block.count} onChange={(event) => setBlocks((items) => items.map((entry, at) => at === index ? { ...entry, count: Number(event.target.value) } : entry))} /></label>
      <span className="dialog-actions">
        <button type="button" disabled={index === 0} onClick={() => setBlocks((items) => { const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>{t('template.moveUp')}</button>
        <button type="button" disabled={index === blocks.length - 1} onClick={() => setBlocks((items) => { const next = [...items]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })}>{t('template.moveDown')}</button>
        <button type="button" onClick={() => setBlocks((items) => items.filter((_, at) => at !== index))}>{t('common.delete')}</button>
      </span>
    </li>)}</ol>
    <p>{t('template.total', { count: total })}</p>
    <div className="dialog-actions">
      <button type="button" disabled={disabled || !!storageError || mutationPending || !blocks.length} onClick={() => void save(false)}>{t('template.saveNew')}</button>
      <button type="button" disabled={disabled || !!storageError || mutationPending || !selected || !blocks.length} onClick={() => void save(true)}>{t('template.update')}</button>
    </div>
    {error ? <p className="danger-text" role="alert">{typeof error === 'string' ? error : t(error.key, error.values)}</p> : null}
  </fieldset>;
}
