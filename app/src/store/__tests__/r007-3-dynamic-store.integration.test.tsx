import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import i18n from '../../i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PracticeSetup } from '../../components/PracticeSetup';
import { PracticeShell } from '../../components/PracticeShell';
import { DynamicItemDialog } from '../../components/DynamicItemDialog';
import { createDynamicItem, createDynamicSession } from '../../lib/dynamicSession';
import { createCustomItemType, getItemTypePreset } from '../../lib/itemTypeRegistry';
import { serializeSessionForPersistence } from '../../lib/persistedTime';
import { prepareRecoverySession } from '../../lib/recovery';
import { createActivityTimer } from '../../lib/timeLedger';
import {
  getRecoveryEventSeq,
  getAppSetting,
  loadRecoveryEvents,
  loadRecoverySnapshot,
  saveSessionSnapshot,
  saveAppSetting
} from '../../lib/storage';
import type { PackageSummary } from '../../types';
import { useAppStore } from '../appStore';

vi.mock('../../lib/storage', () => ({
  scanPackages: vi.fn(async () => []),
  appendEvent: vi.fn(async () => undefined),
  cleanupTerminalRecovery: vi.fn(async () => 0),
  saveSessionSnapshot: vi.fn(async () => undefined),
  loadRecoverySnapshot: vi.fn(),
  loadRecoveryEvents: vi.fn(async () => []),
  getRecoveryEventSeq: vi.fn(async () => 0),
  getAppPaths: vi.fn(async () => ({ source_root: 'readonly' })),
  getAppSetting: vi.fn(async () => undefined),
  saveAppSetting: vi.fn(async () => undefined),
  openSessionExportDirectory: vi.fn(async () => undefined)
}));

const packageSummary: PackageSummary = {
  package_id: '01.21.A.1',
  source_path: 'readonly',
  modules: []
};

function resetStore() {
  useAppStore.setState({
    packages: [packageSummary],
    selectedPackage: packageSummary,
    selectedSections: ['Reading', 'Listening', 'Writing'],
    mode: 'practice',
    blueprintStatus: 'error',
    blueprintErrors: ['legacy blueprint intentionally unavailable'],
    session: undefined,
    events: [],
    eventSeq: 0,
    timer: undefined,
    activeMs: 0,
    pausedMs: 0,
    questionActiveMs: 0,
    scopeActiveMs: 0,
    taskActiveMs: 0,
    taskRemainingMs: null,
    isPaused: false,
    sessionNotice: undefined,
    dynamicItemDialog: undefined,
    batchPending: false,
    itemTemplates: { schema_version: 1, templates: [] },
    itemTemplateError: undefined,
    itemTemplateSaveError: undefined,
    templateMutationPending: false,
    lastCreationOperations: {},
    navigationLockedUntil: 0,
    windowClosePhase: 'IDLE'
  });
}

describe('R007.3 dynamic Store and UI entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('removes Speaking and Blueprint gating from the new Session setup', () => {
    render(<PracticeSetup />);
    expect(screen.queryByLabelText('Speaking')).toBeNull();
    expect(screen.queryByText(/Blueprint 校验失败/)).toBeNull();
    expect((screen.getByRole('button', { name: '开始练习' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('starts an empty schema v6 Session and creates R1/R2 only after confirmation', () => {
    useAppStore.getState().startSession();
    expect(useAppStore.getState().session).toMatchObject({
      session_schema_version: 6,
      structure_mode: 'dynamic_manual',
      questions: [],
      modules: [],
      tasks: []
    });
    expect(useAppStore.getState().timer).toBeUndefined();

    useAppStore.getState().openDynamicItemCreator();
    expect(useAppStore.getState().dynamicItemDialog).toMatchObject({ section_id: 'Reading', ordinal: 1 });
    useAppStore.getState().createDynamicItemFromConfig(getItemTypePreset('Reading', 'reading_single_choice'));
    expect(useAppStore.getState().session?.current_question_id).toBe('R1');
    expect(useAppStore.getState().timer?.currentActivityId).toBe('R1');

    useAppStore.getState().answerCurrent('B');
    useAppStore.setState({ navigationLockedUntil: 0 });
    useAppStore.getState().nextQuestion();
    expect(useAppStore.getState().dynamicItemDialog).toMatchObject({ section_id: 'Reading', ordinal: 2 });
    useAppStore.getState().repeatDynamicCreationOperation();
    expect(useAppStore.getState().session?.questions.map((item) => item.id)).toEqual(['R1', 'R2']);
    expect(useAppStore.getState().session?.answers.R1?.answer_value).toBe('B');
    expect(useAppStore.getState().session?.answers.R2).toBeUndefined();

    useAppStore.getState().nextQuestion();
    useAppStore.getState().cancelDynamicItemDialog();
    expect(useAppStore.getState().session?.questions).toHaveLength(2);
    expect(useAppStore.getState().session?.dynamic_sections?.[0].next_item_ordinal).toBe(3);
  });

  it('commits one batch despite rapid duplicate submission and leaves future Items unvisited', async () => {
    useAppStore.getState().startSession();
    useAppStore.getState().openDynamicItemCreator();
    const block = { config: getItemTypePreset('Reading', 'reading_word_blank'), count: 10 };
    const first = useAppStore.getState().createDynamicBatch([block]);
    const second = useAppStore.getState().createDynamicBatch([block]);
    expect(await second).toBe(false);
    expect(await first).toBe(true);
    const state = useAppStore.getState();
    expect(state.session?.questions).toHaveLength(10);
    expect(state.session?.current_question_id).toBe('R1');
    expect(state.session?.questions[1]).toMatchObject({ encountered: false, visit_count: 0, started_at: null });
    expect(state.events.filter((event) => event.event_type === 'item_entered')).toHaveLength(1);
    expect(state.events.filter((event) => event.event_type === 'item_created')).toHaveLength(10);
  });

  it('keeps the same batch in memory after save failure and retries its snapshot without new IDs', async () => {
    useAppStore.getState().startSession();
    await waitFor(() => expect(saveSessionSnapshot).toHaveBeenCalled());
    await useAppStore.getState().persist();
    useAppStore.getState().openDynamicItemCreator();
    vi.mocked(saveSessionSnapshot).mockRejectedValueOnce(new Error('synthetic disk failure'));
    await useAppStore.getState().createDynamicBatch([{ config: getItemTypePreset('Reading', 'reading_word_blank'), count: 10 }]);
    expect(useAppStore.getState().saveStatus).toBe('error');
    const ids = useAppStore.getState().session?.questions.map((item) => item.id);
    expect(ids).toEqual(Array.from({ length: 10 }, (_, index) => `R${index + 1}`));
    await useAppStore.getState().persist();
    expect(useAppStore.getState().saveStatus).toBe('saved');
    expect(useAppStore.getState().session?.questions.map((item) => item.id)).toEqual(ids);
  });

  it('repeats the complete last Reading batch instead of its final Item', async () => {
    useAppStore.getState().startSession();
    useAppStore.getState().openDynamicItemCreator();
    await useAppStore.getState().createDynamicBatch([{ config: getItemTypePreset('Reading', 'reading_academic_single_choice'), count: 5 }]);
    useAppStore.getState().openDynamicItemCreator();
    useAppStore.getState().repeatDynamicCreationOperation();
    expect(useAppStore.getState().session?.questions.map((item) => item.id)).toEqual(Array.from({ length: 10 }, (_, index) => `R${index + 1}`));
    expect(useAppStore.getState().session?.questions.slice(5).map((item) => item.type_id)).toEqual(Array(5).fill('reading_academic_single_choice'));
    expect(useAppStore.getState().session?.questions.slice(6).every((item) => !item.encountered && item.visit_count === 0)).toBe(true);
  });

  it('repeats one single Item and a ten-blank batch with continuous ordinals', async () => {
    useAppStore.getState().startSession();
    useAppStore.getState().openDynamicItemCreator();
    useAppStore.getState().createDynamicItemFromConfig(getItemTypePreset('Reading', 'reading_single_choice'));
    useAppStore.getState().openDynamicItemCreator();
    expect(await useAppStore.getState().repeatDynamicCreationOperation()).toBe(true);
    expect(useAppStore.getState().session?.questions.map((item) => item.id)).toEqual(['R1', 'R2']);
    useAppStore.getState().openDynamicItemCreator();
    await useAppStore.getState().createDynamicBatch([{ config: getItemTypePreset('Reading', 'reading_word_blank'), count: 10 }]);
    useAppStore.getState().openDynamicItemCreator();
    expect(await useAppStore.getState().repeatDynamicCreationOperation()).toBe(true);
    const questions = useAppStore.getState().session?.questions ?? [];
    expect(questions).toHaveLength(22);
    expect(questions.map((item) => item.id)).toEqual(Array.from({ length: 22 }, (_, index) => `R${index + 1}`));
    expect(questions.slice(12).every((item) => item.type_id === 'reading_word_blank')).toBe(true);
    expect(questions[12]).toMatchObject({ encountered: true, visit_count: 1 });
    expect(questions.slice(13).every((item) => !item.encountered && item.visit_count === 0)).toBe(true);
  });

  it('repeats an ordered multi-block creation operation', async () => {
    useAppStore.getState().startSession();
    useAppStore.getState().openDynamicItemCreator();
    const recipe = [
      { config: getItemTypePreset('Reading', 'reading_short_text'), count: 2 },
      { config: getItemTypePreset('Reading', 'reading_single_choice'), count: 3 }
    ];
    await useAppStore.getState().createDynamicBatch(recipe);
    useAppStore.getState().openDynamicItemCreator();
    useAppStore.getState().repeatDynamicCreationOperation();
    expect(useAppStore.getState().session?.questions.map((item) => item.type_id)).toEqual([
      'reading_short_text', 'reading_short_text', 'reading_single_choice', 'reading_single_choice', 'reading_single_choice',
      'reading_short_text', 'reading_short_text', 'reading_single_choice', 'reading_single_choice', 'reading_single_choice'
    ]);
  });

  it('repeats a validated custom config snapshot without using current form state', async () => {
    useAppStore.getState().startSession();
    const config = createCustomItemType({ section: 'Reading', type_label: 'Synthetic choice',
      renderer: 'single_choice', option_labels: ['X', 'Y'] });
    useAppStore.getState().openDynamicItemCreator();
    await useAppStore.getState().createDynamicBatch([{ config, count: 2 }]);
    config.option_labels[0] = 'mutated after creation';
    useAppStore.getState().openDynamicItemCreator();
    expect(await useAppStore.getState().repeatDynamicCreationOperation()).toBe(true);
    expect(useAppStore.getState().session?.questions.slice(2).map((item) => item.option_labels)).toEqual([['X', 'Y'], ['X', 'Y']]);
  });

  it('keeps the previous operation after cancel, validation failure and template-only save', async () => {
    useAppStore.getState().startSession();
    useAppStore.getState().openDynamicItemCreator();
    await useAppStore.getState().createDynamicBatch([{ config: getItemTypePreset('Reading', 'reading_academic_single_choice'), count: 5 }]);
    const previous = useAppStore.getState().lastCreationOperations.Reading;
    useAppStore.getState().openDynamicItemCreator();
    useAppStore.getState().cancelDynamicItemDialog();
    expect(useAppStore.getState().lastCreationOperations.Reading).toEqual(previous);
    useAppStore.getState().openDynamicItemCreator();
    await expect(useAppStore.getState().createDynamicBatch([{ config: getItemTypePreset('Reading', 'reading_word_blank'), count: 0 }])).rejects.toThrow();
    expect(useAppStore.getState().lastCreationOperations.Reading).toEqual(previous);
    expect(await useAppStore.getState().saveItemTemplate({ template_id: 'only-save', name: 'Only save', section: 'Reading',
      blocks: [{ source: 'system_preset', type_id: 'reading_word_blank', count: 2 }] })).toBe(true);
    expect(useAppStore.getState().lastCreationOperations.Reading).toEqual(previous);
    useAppStore.getState().cancelDynamicItemDialog();
    useAppStore.getState().openDynamicItemEditor();
    expect(useAppStore.getState().changeDynamicItemTypeFromConfig(getItemTypePreset('Reading', 'reading_short_text'))).toBe(true);
    expect(useAppStore.getState().lastCreationOperations.Reading).toEqual(previous);
    useAppStore.getState().openDynamicItemCreator();
    expect(await useAppStore.getState().repeatDynamicCreationOperation()).toBe(true);
    expect(useAppStore.getState().session?.questions).toHaveLength(10);
  });

  it('isolates previous operations by Section and blocks rapid duplicate repeats', async () => {
    useAppStore.getState().startSession();
    useAppStore.getState().openDynamicItemCreator();
    await useAppStore.getState().createDynamicBatch([{ config: getItemTypePreset('Reading', 'reading_academic_single_choice'), count: 5 }]);
    useAppStore.getState().openDynamicItemCreator();
    const first = useAppStore.getState().repeatDynamicCreationOperation();
    const second = useAppStore.getState().repeatDynamicCreationOperation();
    expect(await second).toBe(false);
    expect(await first).toBe(true);
    expect(useAppStore.getState().session?.questions).toHaveLength(10);
    await useAppStore.getState().finishDynamicCurrentSection(true);
    useAppStore.getState().openDynamicItemCreator();
    expect(useAppStore.getState().dynamicItemDialog?.section_id).toBe('Listening');
    expect(useAppStore.getState().lastCreationOperations.Listening).toBeUndefined();
    expect(await useAppStore.getState().repeatDynamicCreationOperation()).toBe(false);
    render(<DynamicItemDialog />);
    expect(screen.queryByRole('button', { name: /与上一个操作相同/ })).toBeNull();
  });

  it('fails closed on Recovery even when old batch events exist', async () => {
    useAppStore.getState().startSession();
    useAppStore.getState().openDynamicItemCreator();
    await useAppStore.getState().createDynamicBatch([{ config: getItemTypePreset('Reading', 'reading_academic_single_choice'), count: 5 }]);
    const session = useAppStore.getState().session!;
    vi.mocked(loadRecoverySnapshot).mockResolvedValue(JSON.stringify(serializeSessionForPersistence(session)));
    vi.mocked(loadRecoveryEvents).mockResolvedValue(useAppStore.getState().events);
    vi.mocked(getRecoveryEventSeq).mockResolvedValue(useAppStore.getState().eventSeq);
    expect(await useAppStore.getState().recoverSession(session.session_id)).toEqual({ ok: true });
    expect(useAppStore.getState().lastCreationOperations.Reading).toBeUndefined();
    useAppStore.getState().togglePause();
    useAppStore.getState().openDynamicItemCreator();
    expect(await useAppStore.getState().repeatDynamicCreationOperation()).toBe(false);
    useAppStore.getState().createDynamicItemFromConfig(getItemTypePreset('Reading', 'reading_short_text'));
    expect(useAppStore.getState().lastCreationOperations.Reading).toBeTruthy();
    useAppStore.getState().openDynamicItemCreator();
    expect(await useAppStore.getState().repeatDynamicCreationOperation()).toBe(true);
  });

  it('rejects a second same-name or same-recipe template in one Section', async () => {
    const first = { template_id: 'first', name: 'My Template', section: 'Reading' as const,
      blocks: [{ source: 'system_preset' as const, type_id: 'reading_word_blank', count: 2 }] };
    expect(await useAppStore.getState().saveItemTemplate(first)).toBe(true);
    expect(await useAppStore.getState().saveItemTemplate({ ...first, template_id: 'second', name: ' my template ' })).toBe(false);
    expect(useAppStore.getState().itemTemplateSaveError?.key).toBe('template.duplicateName');
    expect(await useAppStore.getState().saveItemTemplate({ ...first, template_id: 'third', name: 'Different' })).toBe(false);
    expect(useAppStore.getState().itemTemplateSaveError).toEqual({ key: 'template.duplicateRecipe', values: { name: 'My Template' } });
    expect(useAppStore.getState().itemTemplates.templates).toHaveLength(1);
  });

  it('allows the same template name in different Sections and rejects conflicting updates', async () => {
    const reading = { template_id: 'reading', name: 'Shared', section: 'Reading' as const,
      blocks: [{ source: 'system_preset' as const, type_id: 'reading_word_blank', count: 2 }] };
    const listening = { template_id: 'listening', name: 'Shared', section: 'Listening' as const,
      blocks: [{ source: 'system_preset' as const, type_id: 'listening_single_choice', count: 2 }] };
    const other = { template_id: 'other', name: 'Other', section: 'Reading' as const,
      blocks: [{ source: 'system_preset' as const, type_id: 'reading_single_choice', count: 3 }] };
    expect(await useAppStore.getState().saveItemTemplate(reading)).toBe(true);
    expect(await useAppStore.getState().saveItemTemplate(listening)).toBe(true);
    expect(await useAppStore.getState().saveItemTemplate(other)).toBe(true);
    expect(await useAppStore.getState().saveItemTemplate({ ...reading, blocks: [{ ...reading.blocks[0], count: 4 }] }, 'update')).toBe(true);
    expect(await useAppStore.getState().saveItemTemplate({ ...reading, name: 'Renamed', blocks: [{ ...reading.blocks[0], count: 4 }] }, 'update')).toBe(true);
    expect(await useAppStore.getState().saveItemTemplate({ ...reading, name: 'other' }, 'update')).toBe(false);
    expect(await useAppStore.getState().saveItemTemplate({ ...reading, blocks: other.blocks }, 'update')).toBe(false);
    expect(useAppStore.getState().itemTemplates.templates).toHaveLength(3);
  });

  it('rejects a concurrent second template save before the first completes', async () => {
    let release!: () => void;
    vi.mocked(saveAppSetting).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const template = { template_id: 'first', name: 'Concurrent', section: 'Reading' as const,
      blocks: [{ source: 'system_preset' as const, type_id: 'reading_word_blank', count: 2 }] };
    const first = useAppStore.getState().saveItemTemplate(template);
    expect(useAppStore.getState().templateMutationPending).toBe(true);
    expect(await useAppStore.getState().saveItemTemplate({ ...template, template_id: 'second' })).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(useAppStore.getState().itemTemplates.templates).toHaveLength(1);
  });

  it('saves, reloads, updates and deletes templates through app_settings', async () => {
    const template = { template_id: 'test', name: 'Test', section: 'Reading' as const,
      blocks: [{ source: 'system_preset' as const, type_id: 'reading_word_blank', count: 2 }] };
    expect(await useAppStore.getState().saveItemTemplate(template)).toBe(true);
    expect(saveAppSetting).toHaveBeenCalledWith('item_templates', { schema_version: 1, templates: [template] });
    vi.mocked(getAppSetting).mockResolvedValueOnce({ schema_version: 1, templates: [template] });
    await useAppStore.getState().loadItemTemplates();
    expect(useAppStore.getState().itemTemplates.templates).toEqual([template]);
    expect(await useAppStore.getState().saveItemTemplate({ ...template, name: 'Updated' }, 'update')).toBe(true);
    expect(useAppStore.getState().itemTemplates.templates).toHaveLength(1);
    expect(await useAppStore.getState().deleteItemTemplate('test')).toBe(true);
    expect(useAppStore.getState().itemTemplates.templates).toEqual([]);
  });

  it('keeps corrupt template storage untouched and prevents edits', async () => {
    vi.mocked(getAppSetting).mockResolvedValueOnce({ schema_version: 99, templates: [] });
    await useAppStore.getState().loadItemTemplates();
    expect(useAppStore.getState().itemTemplateError?.values?.detail).toMatch(/unsupported format/);
    expect(await useAppStore.getState().saveItemTemplate({ template_id: 'x', name: 'X', section: 'Reading',
      blocks: [{ source: 'system_preset', type_id: 'reading_word_blank', count: 1 }] })).toBe(false);
    expect(saveAppSetting).not.toHaveBeenCalled();
  });

  it('shows Section-specific quick batches, count and saved templates only while creating', () => {
    useAppStore.getState().startSession();
    useAppStore.setState({ itemTemplates: { schema_version: 1, templates: [{
      template_id: 'reading_test', name: 'Reading test', section: 'Reading',
      blocks: [{ source: 'system_preset', type_id: 'reading_word_blank', count: 2 }]
    }] } });
    useAppStore.getState().openDynamicItemCreator();
    const rendered = render(<DynamicItemDialog />);
    expect(screen.getByRole('button', { name: '填词 × 10' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Academic Reading × 5' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Academic Lecture × 4' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '填词 × 10' }));
    expect((screen.getByLabelText('数量 Count') as HTMLInputElement).value).toBe('10');
    expect(screen.getByRole('button', { name: '创建 10 题并进入第 1 题' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Reading test' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(useAppStore.getState().session?.questions).toHaveLength(0);
    expect(useAppStore.getState().session?.dynamic_sections?.[0].next_item_ordinal).toBe(1);
    rendered.unmount();
    useAppStore.getState().openDynamicItemCreator();
    useAppStore.getState().createDynamicItemFromConfig(getItemTypePreset('Reading', 'reading_single_choice'));
    useAppStore.getState().openDynamicItemEditor();
    render(<DynamicItemDialog />);
    expect(screen.queryByLabelText('数量 Count')).toBeNull();
    expect(screen.queryByText('Saved Templates / 可复用模板')).toBeNull();
  });

  it('labels the repeat action by creation operation and disables template save while pending', () => {
    useAppStore.getState().startSession();
    useAppStore.getState().openDynamicItemCreator();
    useAppStore.getState().createDynamicItemFromConfig(getItemTypePreset('Reading', 'reading_single_choice'));
    useAppStore.getState().openDynamicItemCreator();
    useAppStore.setState({ templateMutationPending: true });
    render(<DynamicItemDialog />);
    expect(screen.getByRole('button', { name: '与上一个操作相同（共 1 题）' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '保存为新模板' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the empty-Section add action and a safe creation modal', async () => {
    useAppStore.getState().startSession();
    await waitFor(() => expect(saveSessionSnapshot).toHaveBeenCalled());
    render(<PracticeShell />);

    fireEvent.click(screen.getAllByRole('button', { name: '添加第 1 题' })[0]);
    expect(screen.getByRole('dialog', { name: '添加 Reading 第 1 题' })).toBeTruthy();
    expect((screen.getByLabelText('安全 renderer') as HTMLSelectElement).value).toBe('single_choice');
    expect((screen.getByLabelText('题型显示名称') as HTMLInputElement).value).toBe('单选题');
    expect(screen.getByRole('button', { name: '创建并进入下一题' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '完成 Reading' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
  });

  it('R008.1 edits a custom item through the dialog without treating its ID as a preset', () => {
    const base = createDynamicSession({
      session_id: 'synthetic-custom-edit', package_id: packageSummary.package_id,
      source_relative_path: 'Synthetic.01', mode: 'practice', selected_sections: ['Reading']
    });
    const custom = createCustomItemType({
      section: 'Reading', type_label: 'Synthetic blank', renderer: 'short_text', custom_time_limit_ms: 60_000
    });
    const session = createDynamicItem(base, 'Reading', { ...custom, type_id: 'custom_short_text_legacy' }).session;
    useAppStore.setState({ session });
    useAppStore.getState().openDynamicItemEditor();
    render(<DynamicItemDialog />);
    expect((screen.getByLabelText('预设题型') as HTMLSelectElement).value).toBe('custom');
    fireEvent.click(screen.getByRole('button', { name: '保存题型设置' }));
    expect(useAppStore.getState().dynamicItemDialog).toBeUndefined();
    expect(useAppStore.getState().session?.questions[0].type_config).toEqual(session.questions[0].type_config);
  });

  it('R008.5 keeps a persisted Chinese system label when editing after a locale switch', async () => {
    const oldConfig = { ...getItemTypePreset('Reading', 'reading_single_choice'), type_label: '单选题' };
    const base = createDynamicSession({
      session_id: 'synthetic-old-label', package_id: packageSummary.package_id,
      source_relative_path: 'Synthetic.01', mode: 'practice', selected_sections: ['Reading']
    });
    const session = createDynamicItem(base, 'Reading', oldConfig).session;
    useAppStore.setState({ session });
    useAppStore.getState().openDynamicItemEditor();
    render(<DynamicItemDialog />);
    await act(async () => { await i18n.changeLanguage('ja'); });
    expect(screen.getByLabelText('問題形式の表示名')).toHaveValue('単一選択');
    fireEvent.click(screen.getByRole('button', { name: '問題形式を保存' }));
    expect(useAppStore.getState().session?.questions[0].type_config).toEqual(oldConfig);
    expect(useAppStore.getState().session?.questions[0].type_label).toBe('单选题');
  });

  it('R008.1 changes a custom label and recovers the edited v6 snapshot', () => {
    const base = createDynamicSession({
      session_id: 'synthetic-custom-rename', package_id: packageSummary.package_id,
      source_relative_path: 'Synthetic.01', mode: 'practice', selected_sections: ['Reading']
    });
    const session = createDynamicItem(base, 'Reading', createCustomItemType({
      section: 'Reading', type_label: 'Old synthetic label', renderer: 'short_text'
    })).session;
    useAppStore.setState({ session });
    useAppStore.getState().openDynamicItemEditor();
    render(<DynamicItemDialog />);
    fireEvent.change(screen.getByLabelText('题型显示名称'), { target: { value: 'New synthetic label' } });
    fireEvent.click(screen.getByRole('button', { name: '保存题型设置' }));
    const edited = useAppStore.getState().session!;
    expect(edited.questions[0].type_label).toBe('New synthetic label');
    expect(edited.questions[0].type_id).not.toBe(session.questions[0].type_id);
    expect(prepareRecoverySession(JSON.stringify(serializeSessionForPersistence(edited)), []).ok).toBe(true);
  });

  it('R008.1 edits a system preset without changing its stable ID', () => {
    const base = createDynamicSession({
      session_id: 'synthetic-preset-edit', package_id: packageSummary.package_id,
      source_relative_path: 'Synthetic.01', mode: 'practice', selected_sections: ['Reading']
    });
    const session = createDynamicItem(base, 'Reading', getItemTypePreset('Reading', 'reading_single_choice')).session;
    useAppStore.setState({ session });
    useAppStore.getState().openDynamicItemEditor();
    render(<DynamicItemDialog />);
    expect((screen.getByLabelText('预设题型') as HTMLSelectElement).value).toBe('reading_single_choice');
    fireEvent.click(screen.getByRole('button', { name: '保存题型设置' }));
    expect(useAppStore.getState().dynamicItemDialog).toBeUndefined();
    expect(useAppStore.getState().session?.questions[0].type_id).toBe('reading_single_choice');
  });

  it('R008.1 reports an unknown preset in the editor without crashing', () => {
    const base = createDynamicSession({
      session_id: 'synthetic-unknown-edit', package_id: packageSummary.package_id,
      source_relative_path: 'Synthetic.01', mode: 'practice', selected_sections: ['Reading']
    });
    const created = createDynamicItem(base, 'Reading', getItemTypePreset('Reading', 'reading_single_choice')).session;
    const session = { ...created, questions: created.questions.map((item) => ({
      ...item, type_id: 'missing_preset', type_config: { ...item.type_config!, type_id: 'missing_preset' }
    })) };
    useAppStore.setState({ session });
    useAppStore.getState().openDynamicItemEditor();
    render(<DynamicItemDialog />);
    fireEvent.click(screen.getByRole('button', { name: '保存题型设置' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(useAppStore.getState().dynamicItemDialog).toBeTruthy();
    fireEvent.change(screen.getByLabelText('预设题型'), { target: { value: 'reading_single_choice' } });
    fireEvent.click(screen.getByRole('button', { name: '保存题型设置' }));
    expect(useAppStore.getState().dynamicItemDialog).toBeUndefined();
  });

  it('R008.1 reports a missing custom configuration and allows choosing a valid preset', () => {
    const base = createDynamicSession({
      session_id: 'synthetic-missing-custom', package_id: packageSummary.package_id,
      source_relative_path: 'Synthetic.01', mode: 'practice', selected_sections: ['Reading']
    });
    const created = createDynamicItem(base, 'Reading', getItemTypePreset('Reading', 'reading_short_text')).session;
    const session = { ...created, questions: created.questions.map((item) => ({
      ...item, type_id: 'custom_missing', type_config: undefined
    })) };
    useAppStore.setState({ session });
    useAppStore.getState().openDynamicItemEditor();
    render(<DynamicItemDialog />);
    fireEvent.click(screen.getByRole('button', { name: '保存题型设置' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('预设题型'), { target: { value: 'reading_short_text' } });
    fireEvent.click(screen.getByRole('button', { name: '保存题型设置' }));
    expect(useAppStore.getState().session?.questions[0].type_id).toBe('reading_short_text');
  });

  it('makes the final Section action explicitly complete the Session', async () => {
    useAppStore.setState({ selectedSections: ['Reading'] });
    useAppStore.getState().startSession();
    await waitFor(() => expect(saveSessionSnapshot).toHaveBeenCalled());
    render(<PracticeShell />);

    expect(screen.getByRole('button', { name: '完成 Reading 并完成 Session' })).toBeTruthy();
  });

  it('continues a v6 Recovery paused and creates the next stable ordinal after resume', async () => {
    const initial = createDynamicSession({
      session_id: 'r0073-store-recovery',
      package_id: packageSummary.package_id,
      source_path: packageSummary.source_path,
      mode: 'practice',
      selected_sections: ['Reading'],
      created_at: '2026-08-03T03:00:00.000Z'
    });
    const saved = createDynamicItem(
      initial,
      'Reading',
      getItemTypePreset('Reading', 'reading_multiple_choice'),
      '2026-08-03T03:00:01.000Z'
    ).session;
    vi.mocked(loadRecoverySnapshot).mockResolvedValue(JSON.stringify(serializeSessionForPersistence(saved)));
    vi.mocked(loadRecoveryEvents).mockResolvedValue([{ session_id: saved.session_id, seq: 7 } as never]);
    vi.mocked(getRecoveryEventSeq).mockResolvedValue(7);

    const result = await useAppStore.getState().recoverSession(saved.session_id);
    expect(result).toEqual({ ok: true });
    expect(useAppStore.getState()).toMatchObject({ isPaused: true, eventSeq: 8 });
    expect(useAppStore.getState().timer).toMatchObject({ currentActivityId: 'R1' });
    expect(useAppStore.getState().session?.questions[0]).toMatchObject({
      id: 'R1', renderer: 'multiple_choice', option_labels: ['A', 'B', 'C', 'D']
    });

    useAppStore.getState().togglePause();
    useAppStore.setState({ navigationLockedUntil: 0 });
    useAppStore.getState().nextQuestion();
    expect(useAppStore.getState().dynamicItemDialog).toMatchObject({ section_id: 'Reading', ordinal: 2 });
  });

  it('emits one custom-limit overtime event without advancing or overwriting answer flags', () => {
    const initial = createDynamicSession({
      session_id: 'r0073-overtime', package_id: packageSummary.package_id,
      source_path: packageSummary.source_path, mode: 'practice', selected_sections: ['Reading']
    });
    const limited = createDynamicItem(initial, 'Reading', createCustomItemType({
      section: 'Reading', type_label: 'One second', renderer: 'single_choice',
      option_labels: ['A', 'B'], custom_time_limit_ms: 1000
    })).session;
    const session = {
      ...limited,
      answers: {
        R1: {
          question_id: 'R1', answer_value: 'A', progress_status: 'ANSWERED' as const, status: 'ANSWERED' as const,
          is_overtime: false, is_skipped: false, is_uncertain: true, active_time_ms: 0, total_active_ms: 0,
          modification_count: 1, revision_count: 1, marked_review: true,
          last_changed_at: '2026-08-03T03:10:00.000Z', updated_at: '2026-08-03T03:10:00.000Z'
        }
      }
    };
    useAppStore.setState({
      session, timer: createActivityTimer('R1', 0), events: [], eventSeq: 0,
      questionActiveMs: 0, isPaused: false
    });
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    useAppStore.getState().tick();
    clock.mockReturnValue(1500);
    useAppStore.getState().tick();

    expect(useAppStore.getState().session?.current_question_id).toBe('R1');
    expect(useAppStore.getState().session?.answers.R1).toMatchObject({
      answer_value: 'A', progress_status: 'ANSWERED', is_uncertain: true, is_skipped: false, is_overtime: true
    });
    expect(useAppStore.getState().events.filter((event) => event.event_type === 'item_overtime')).toHaveLength(1);
    clock.mockRestore();
  });

  it('attributes pause time to the current dynamic Item and Section without increasing active time', () => {
    const initial = createDynamicSession({
      session_id: 'r0073-pause', package_id: packageSummary.package_id,
      source_path: packageSummary.source_path, mode: 'practice', selected_sections: ['Reading']
    });
    const session = createDynamicItem(
      initial, 'Reading', getItemTypePreset('Reading', 'reading_short_text')
    ).session;
    useAppStore.setState({
      session, timer: createActivityTimer('R1', 0), events: [], eventSeq: 0,
      activeMs: 0, pausedMs: 0, questionActiveMs: 0, isPaused: false
    });
    const clock = vi.spyOn(performance, 'now').mockReturnValue(400);
    useAppStore.getState().togglePause();
    clock.mockReturnValue(10_400);
    useAppStore.getState().tick();
    useAppStore.getState().togglePause();

    const current = useAppStore.getState().session!;
    expect(current.answers.R1.active_time_ms).toBe(400);
    expect(current.questions[0].pause_time_ms).toBe(10_000);
    expect(current.dynamic_sections?.[0]).toMatchObject({ active_time_ms: 400, pause_time_ms: 10_000 });
    expect(current.paused_ms).toBe(10_000);
    clock.mockRestore();
  });
});
