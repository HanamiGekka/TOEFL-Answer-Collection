import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { exportTypingRecord } from '../lib/exporters';
import { getAppPaths, openTypingExportDirectory } from '../lib/storage';
import { filterTypingInput } from '../lib/typingInput';
import { clearTypingDraft, loadTypingDraft, saveTypingDraft, type TypingPracticeDraft } from '../lib/typingDraft';
import { TypingStatsAccumulator } from '../lib/typingStats';
import { formatDuration } from '../lib/timer';
import { registerWindowCloseParticipant, type PreCloseRuntimeState } from '../lib/windowClose';
import { registerTypingPauseParticipant } from '../lib/typingPause';

type TypingStatus = 'idle' | 'running' | 'paused' | 'ended';
type TypingMessage = { key: string; values?: Record<string, string>; error?: boolean } | null;

export function TypingPractice() {
  const { t } = useTranslation();
  const [initialDraft] = useState(() => loadTypingDraft());
  const [initialTracker] = useState(() =>
    initialDraft ? TypingStatsAccumulator.fromState(initialDraft.tracker_state) : new TypingStatsAccumulator()
  );
  const trackerRef = useRef(initialTracker);
  const trackedTextRef = useRef(initialDraft?.tracker_state.text ?? '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingInputTypeRef = useRef('insertText');
  const isComposingRef = useRef(false);
  const justCommittedCompositionRef = useRef<string | null>(null);
  const draftRef = useRef<Omit<TypingPracticeDraft, 'saved_at' | 'tracker_state'> | null>(null);
  const draftWarningShownRef = useRef(false);
  const draftDisabledRef = useRef(false);
  const closeHoldRef = useRef<PreCloseRuntimeState | undefined>(undefined);
  const closeHoldStartedAtRef = useRef<number | null>(null);
  const [status, setStatus] = useState<TypingStatus>(() => {
    if (!initialDraft) return 'idle';
    return initialDraft.status === 'ended' ? 'ended' : 'paused';
  });
  const [sessionId, setSessionId] = useState(initialDraft?.session_id ?? '');
  const [text, setText] = useState(initialDraft?.tracker_state.text ?? '');
  const [activeBaseMs, setActiveBaseMs] = useState(initialDraft?.active_ms ?? 0);
  const [pausedMs, setPausedMs] = useState(initialDraft?.paused_ms ?? 0);
  const [lastStart, setLastStart] = useState<number | null>(null);
  const [pauseStartedAt, setPauseStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const [sampleCount, setSampleCount] = useState(initialDraft?.tracker_state.samples.length ?? 0);
  const [isExporting, setIsExporting] = useState(false);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [exportDirectory, setExportDirectory] = useState('');
  const [exportMessage, setExportMessage] = useState<TypingMessage>(() => {
    if (!initialDraft) return null;
    return initialDraft.status === 'ended'
      ? { key: 'typing.resumedEnded' }
      : { key: 'typing.resumedDraft' };
  });
  const runtimeRef = useRef({ status, activeBaseMs, pausedMs, lastStart, pauseStartedAt });
  runtimeRef.current = { status, activeBaseMs, pausedMs, lastStart, pauseStartedAt };
  const interactionBlockedRef = useRef(false);
  interactionBlockedRef.current = isExporting || closeHoldRef.current !== undefined;
  const activeMs =
    status === 'running' && lastStart !== null
      ? activeBaseMs + Math.max(0, now - lastStart)
      : activeBaseMs;
  const displayPausedMs =
    status === 'paused' && pauseStartedAt !== null
      ? pausedMs + Math.max(0, now - pauseStartedAt)
      : pausedMs;
  const snapshot = trackerRef.current.snapshot(activeMs, displayPausedMs);

  draftRef.current =
    status === 'idle' || !sessionId
      ? null
      : {
          schema_version: 1,
          session_id: sessionId,
          status,
          active_ms: activeMs,
          paused_ms: displayPausedMs
        };

  const persistDraft = useCallback((requiredForClose = false) => {
    const draft = draftRef.current;
    if (!draft || draftDisabledRef.current) return;
    const saved = saveTypingDraft({
      ...draft,
      saved_at: new Date().toISOString(),
      tracker_state: trackerRef.current.serializeState()
    });
    if (!saved && !draftWarningShownRef.current) {
      draftWarningShownRef.current = true;
      setExportMessage({ key: 'typing.draftSaveFailed', error: true });
    }
    if (!saved && requiredForClose) throw new Error(i18n.t('typing.closeSaveFailed'));
  }, []);

  const beginCloseHold = useCallback((): PreCloseRuntimeState | undefined => {
    if (closeHoldRef.current) return closeHoldRef.current;
    const runtime = runtimeRef.current;
    if (runtime.status === 'running') {
      const holdAt = performance.now();
      const activeAtHold = runtime.lastStart === null
        ? runtime.activeBaseMs
        : runtime.activeBaseMs + Math.max(0, holdAt - runtime.lastStart);
      const heldState = { kind: 'TYPING_ACTIVE' } as const;
      closeHoldRef.current = heldState;
      closeHoldStartedAtRef.current = holdAt;
      runtimeRef.current = {
        status: 'paused',
        activeBaseMs: activeAtHold,
        pausedMs: runtime.pausedMs,
        lastStart: null,
        pauseStartedAt: holdAt
      };
      setActiveBaseMs(activeAtHold);
      setLastStart(null);
      setPauseStartedAt(holdAt);
      setNow(holdAt);
      setStatus('paused');
      return heldState;
    }
    if (runtime.status === 'paused' || runtime.status === 'ended') {
      const heldState = { kind: 'TYPING_PAUSED' } as const;
      closeHoldRef.current = heldState;
      return heldState;
    }
    return undefined;
  }, []);

  const cancelCloseHold = useCallback((preCloseState: PreCloseRuntimeState): void => {
    const heldState = closeHoldRef.current;
    if (!heldState || heldState.kind !== preCloseState.kind) return;
    if (heldState.kind === 'TYPING_ACTIVE') {
      const resumeAt = performance.now();
      const holdStartedAt = closeHoldStartedAtRef.current ?? resumeAt;
      const runtime = runtimeRef.current;
      const nextPausedMs = runtime.pausedMs + Math.max(0, resumeAt - holdStartedAt);
      runtimeRef.current = {
        status: 'running',
        activeBaseMs: runtime.activeBaseMs,
        pausedMs: nextPausedMs,
        lastStart: resumeAt,
        pauseStartedAt: null
      };
      setPausedMs(nextPausedMs);
      setLastStart(resumeAt);
      setPauseStartedAt(null);
      setNow(resumeAt);
      setStatus('running');
    }
    closeHoldRef.current = undefined;
    closeHoldStartedAtRef.current = null;
  }, []);

  useEffect(() => {
    if (status !== 'running' && status !== 'paused') return undefined;
    const id = window.setInterval(() => {
      const nextNow = performance.now();
      setNow(nextNow);
      if (status === 'running' && lastStart !== null) {
        const nextActiveMs = activeBaseMs + Math.max(0, nextNow - lastStart);
        const sample = trackerRef.current.sample(nextActiveMs, pausedMs, new Date().toISOString());
        if (sample) setSampleCount(trackerRef.current.getSamples().length);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [activeBaseMs, lastStart, pausedMs, status]);

  useEffect(() => {
    if (status === 'running') textareaRef.current?.focus();
  }, [status]);

  useEffect(() => {
    if (status === 'idle') return undefined;
    const persistForUnload = () => persistDraft();
    persistDraft();
    const id = window.setInterval(persistDraft, 5_000);
    window.addEventListener('beforeunload', persistForUnload);
    return () => {
      persistDraft();
      window.clearInterval(id);
      window.removeEventListener('beforeunload', persistForUnload);
    };
  }, [persistDraft, status]);

  useEffect(() => registerWindowCloseParticipant({
    hasPendingWork: () => draftRef.current !== null && !draftDisabledRef.current,
    beginHold: beginCloseHold,
    cancelHold: cancelCloseHold,
    persist: () => persistDraft(true)
  }), [beginCloseHold, cancelCloseHold, persistDraft]);

  const toggleTypingPause = useCallback(() => {
    if (interactionBlockedRef.current) return;
    const runtime = runtimeRef.current;
    const changedAt = performance.now();
    if (runtime.status === 'running') {
      const nextActiveMs = runtime.lastStart === null
        ? runtime.activeBaseMs
        : runtime.activeBaseMs + Math.max(0, changedAt - runtime.lastStart);
      runtimeRef.current = {
        status: 'paused',
        activeBaseMs: nextActiveMs,
        pausedMs: runtime.pausedMs,
        lastStart: null,
        pauseStartedAt: changedAt
      };
      setActiveBaseMs(nextActiveMs);
      setLastStart(null);
      setPauseStartedAt(changedAt);
      setNow(changedAt);
      setStatus('paused');
    } else if (runtime.status === 'paused') {
      const nextPausedMs = runtime.pauseStartedAt === null
        ? runtime.pausedMs
        : runtime.pausedMs + Math.max(0, changedAt - runtime.pauseStartedAt);
      runtimeRef.current = {
        status: 'running',
        activeBaseMs: runtime.activeBaseMs,
        pausedMs: nextPausedMs,
        lastStart: changedAt,
        pauseStartedAt: null
      };
      setPausedMs(nextPausedMs);
      setLastStart(changedAt);
      setPauseStartedAt(null);
      setNow(changedAt);
      setStatus('running');
    }
  }, []);

  useEffect(() => registerTypingPauseParticipant({
    canToggle: () => {
      const runtime = runtimeRef.current;
      return !interactionBlockedRef.current && (runtime.status === 'running' || runtime.status === 'paused');
    },
    toggle: toggleTypingPause
  }), [toggleTypingPause]);

  function startPractice() {
    if (status !== 'idle') return;
    clearTypingDraft();
    draftDisabledRef.current = false;
    closeHoldRef.current = undefined;
    closeHoldStartedAtRef.current = null;
    trackerRef.current = new TypingStatsAccumulator();
    trackedTextRef.current = '';
    const start = performance.now();
    setSessionId(`typing-${Date.now()}`);
    setText('');
    setActiveBaseMs(0);
    setPausedMs(0);
    setLastStart(start);
    setPauseStartedAt(null);
    setNow(start);
    setSampleCount(0);
    setIsExporting(false);
    setRejectedCount(0);
    setExportDirectory('');
    setExportMessage(null);
    draftWarningShownRef.current = false;
    setStatus('running');
  }

  function endPractice() {
    if (status !== 'running' && status !== 'paused') return;
    const endedAt = performance.now();
    const finalActiveMs =
      status === 'running' && lastStart !== null
        ? activeBaseMs + Math.max(0, endedAt - lastStart)
        : activeBaseMs;
    const finalPausedMs =
      status === 'paused' && pauseStartedAt !== null
        ? pausedMs + Math.max(0, endedAt - pauseStartedAt)
        : pausedMs;
    trackerRef.current.sample(finalActiveMs, finalPausedMs, new Date().toISOString(), true);
    setActiveBaseMs(finalActiveMs);
    setPausedMs(finalPausedMs);
    setLastStart(null);
    setPauseStartedAt(null);
    setNow(endedAt);
    setSampleCount(trackerRef.current.getSamples().length);
    setStatus('ended');
    setExportMessage({ key: 'typing.endedMessage' });
  }

  function resetPractice() {
    if (status === 'running' || status === 'paused' || isExporting) return;
    clearTypingDraft();
    draftDisabledRef.current = true;
    closeHoldRef.current = undefined;
    closeHoldStartedAtRef.current = null;
    trackerRef.current = new TypingStatsAccumulator();
    trackedTextRef.current = '';
    setStatus('idle');
    setSessionId('');
    setText('');
    setActiveBaseMs(0);
    setPausedMs(0);
    setLastStart(null);
    setPauseStartedAt(null);
    setSampleCount(0);
    setRejectedCount(0);
    setExportDirectory('');
    setExportMessage(null);
  }

  async function exportRecord() {
    if (status !== 'ended' || !sessionId || isExporting) {
      if (status !== 'ended') setExportMessage({ key: 'typing.endBeforeExport', error: true });
      return;
    }
    setIsExporting(true);
    try {
      const relativeBase = await exportTypingRecord(
        sessionId,
        trackerRef.current.snapshot(activeBaseMs, pausedMs),
        trackerRef.current.getSamples()
      );
      clearTypingDraft();
      draftDisabledRef.current = true;
      setExportDirectory(relativeBase);
      const paths = await getAppPaths();
      const relativeWithinTypingRoot = relativeBase
        .replace(/^typing_records[\\/]/, '')
        .replace(/[\\/]/g, '\\');
      setExportMessage({ key: 'typing.exportSuccess', values: { path: `${paths.typing_records_root.replace(/[\\/]+$/, '')}\\${relativeWithinTypingRoot}` } });
    } catch (error) {
      setExportMessage({ key: 'typing.exportFailed', values: { detail: error instanceof Error ? error.message : String(error) }, error: true });
    } finally {
      setIsExporting(false);
    }
  }

  async function openCurrentTypingExportDirectory() {
    if (!exportDirectory) return;
    try {
      await openTypingExportDirectory(exportDirectory);
    } catch (error) {
      setExportMessage({ key: 'typing.openExportFailed', values: { detail: error instanceof Error ? error.message : String(error) }, error: true });
    }
  }

  function applyFilteredInput(rawValue: string, inputType: string) {
    const filtered = filterTypingInput(rawValue);
    trackerRef.current.applyTextChange(trackedTextRef.current, filtered.text, inputType);
    trackedTextRef.current = filtered.text;
    pendingInputTypeRef.current = 'insertText';
    setText(filtered.text);
    if (filtered.rejectedCount > 0) {
      setRejectedCount((count) => count + filtered.rejectedCount);
    }
  }

  return (
    <section className="card typing-card">
      <div className="section-title">
        <h2>{t('typing.title')}</h2>
        <span className="status-pill">{t(`typing.status.${status}`)}</span>
      </div>
      <p className="muted">
        {t('typing.help')}
      </p>
      <div className="typing-controls">
        <button className="primary" onClick={startPractice} disabled={status !== 'idle'}>
          {t('typing.start')}
        </button>
        <button
          onClick={toggleTypingPause}
          disabled={status !== 'running' && status !== 'paused'}
        >
          {t(status === 'paused' ? 'bottomBar.resume' : 'bottomBar.pause')}
        </button>
        <button onClick={endPractice} disabled={status !== 'running' && status !== 'paused'}>
          {t('typing.end')}
        </button>
        <button onClick={resetPractice} disabled={status === 'running' || status === 'paused' || isExporting}>
          {t('typing.reset')}
        </button>
        <button onClick={() => void exportRecord()} disabled={status !== 'ended' || isExporting}>
          {t(isExporting ? 'typing.exporting' : 'typing.export')}
        </button>
        <button onClick={() => void openCurrentTypingExportDirectory()} disabled={!exportDirectory || isExporting}>
          {t('typing.openExport')}
        </button>
      </div>
      <textarea
        ref={textareaRef}
        className="typing-input"
        aria-label={t('typing.inputArea')}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        value={text}
        disabled={status !== 'running'}
        placeholder={t(status === 'idle' ? 'typing.idlePlaceholder' : 'typing.activePlaceholder')}
        onKeyDown={(event) => {
          if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return;
          event.preventDefault();
          const start = event.currentTarget.selectionStart;
          const end = event.currentTarget.selectionEnd;
          const current = trackedTextRef.current;
          applyFilteredInput(`${current.slice(0, start)}\t${current.slice(end)}`, 'insertText');
          window.requestAnimationFrame(() => textareaRef.current?.setSelectionRange(start + 4, start + 4));
        }}
        onPaste={() => {
          pendingInputTypeRef.current = 'insertFromPaste';
        }}
        onCut={() => {
          pendingInputTypeRef.current = 'deleteByCut';
        }}
        onDrop={() => {
          pendingInputTypeRef.current = 'insertFromDrop';
        }}
        onBeforeInput={(event) => {
          pendingInputTypeRef.current = (event.nativeEvent as InputEvent).inputType || pendingInputTypeRef.current;
        }}
        onCompositionStart={() => {
          isComposingRef.current = true;
          justCommittedCompositionRef.current = null;
        }}
        onCompositionEnd={(event) => {
          const rawValue = event.currentTarget.value;
          isComposingRef.current = false;
          justCommittedCompositionRef.current = rawValue;
          applyFilteredInput(rawValue, 'insertCompositionText');
        }}
        onChange={(event) => {
          const next = event.target.value;
          if (isComposingRef.current) {
            setText(next);
            return;
          }
          if (justCommittedCompositionRef.current === next) {
            justCommittedCompositionRef.current = null;
            return;
          }
          const nativeInputType = (event.nativeEvent as InputEvent).inputType;
          const inputType = nativeInputType || pendingInputTypeRef.current || 'insertText';
          applyFilteredInput(next, inputType);
        }}
      />
      <p className="muted" aria-live="polite">{t('typing.rejected', { count: rejectedCount })}</p>
      <div className="metric-grid">
        <span>{t('typing.activeTime', { time: formatDuration(snapshot.active_ms) })}</span>
        <span>{t('typing.pausedTime', { time: formatDuration(snapshot.paused_ms) })}</span>
        <span>{t('typing.characters', { count: snapshot.retained_characters })}</span>
        <span>{t('typing.words', { count: snapshot.retained_words })}</span>
        <span>{t('typing.spaces', { count: snapshot.retained_spaces })}</span>
        <span>{t('typing.lineBreaks', { count: snapshot.retained_line_breaks })}</span>
        <span>{t('typing.keyboardCharacters', { count: snapshot.keyboard_inserted_characters })}</span>
        <span>{t('typing.deletedCharacters', { count: snapshot.deleted_characters })}</span>
        <span>{t('typing.pastedCharacters', { count: snapshot.pasted_characters })}</span>
        <span>{t('typing.retention', { percent: snapshot.retention_accuracy.toFixed(1) })}</span>
        <span>{t('typing.cpm', { value: snapshot.net_cpm.toFixed(1) })}</span>
        <span>{t('typing.wpm', { value: snapshot.actual_wpm.toFixed(1) })}</span>
        <span>{t('typing.samples', { count: sampleCount })}</span>
      </div>
      {status === 'ended' ? <p className="muted">{t('typing.nextPractice')}</p> : null}
      {exportMessage ? (
        <p className={exportMessage.error ? 'danger-text' : 'success-text'}>{t(exportMessage.key, exportMessage.values)}</p>
      ) : null}
    </section>
  );
}
