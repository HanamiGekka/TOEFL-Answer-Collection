export interface Clock {
  now(): number;
}

export interface TimerSnapshot {
  active_ms: number;
  paused_ms: number;
  is_paused: boolean;
  started_at_ms: number;
  last_started_at_ms: number | null;
  timeout_ms?: number;
  is_overtime: boolean;
  overtime_ms: number;
}

export class MonotonicTimer {
  private startedAt: number;
  private lastStartedAt: number | null;
  private accumulatedActiveMs = 0;
  private accumulatedPausedMs = 0;
  private pausedAt: number | null = null;
  private timeoutMs?: number;

  constructor(private readonly clock: Clock, timeoutMs?: number) {
    const now = clock.now();
    this.startedAt = now;
    this.lastStartedAt = now;
    this.timeoutMs = timeoutMs;
  }

  pause(): boolean {
    if (this.pausedAt !== null) return false;
    const now = this.clock.now();
    if (this.lastStartedAt !== null) {
      this.accumulatedActiveMs += Math.max(0, now - this.lastStartedAt);
    }
    this.pausedAt = now;
    this.lastStartedAt = null;
    return true;
  }

  resume(): boolean {
    if (this.pausedAt === null) return false;
    const now = this.clock.now();
    this.accumulatedPausedMs += Math.max(0, now - this.pausedAt);
    this.pausedAt = null;
    this.lastStartedAt = now;
    return true;
  }

  setTimeoutMs(timeoutMs?: number): void {
    this.timeoutMs = timeoutMs;
  }

  activeMs(): number {
    if (this.lastStartedAt === null) return this.accumulatedActiveMs;
    return this.accumulatedActiveMs + Math.max(0, this.clock.now() - this.lastStartedAt);
  }

  pausedMs(): number {
    if (this.pausedAt === null) return this.accumulatedPausedMs;
    return this.accumulatedPausedMs + Math.max(0, this.clock.now() - this.pausedAt);
  }

  isPaused(): boolean {
    return this.pausedAt !== null;
  }

  isOvertime(): boolean {
    return this.timeoutMs !== undefined && this.activeMs() >= this.timeoutMs;
  }

  overtimeMs(): number {
    if (this.timeoutMs === undefined) return 0;
    return Math.max(0, this.activeMs() - this.timeoutMs);
  }

  snapshot(): TimerSnapshot {
    return {
      active_ms: Math.round(this.activeMs()),
      paused_ms: Math.round(this.pausedMs()),
      is_paused: this.isPaused(),
      started_at_ms: this.startedAt,
      last_started_at_ms: this.lastStartedAt,
      timeout_ms: this.timeoutMs,
      is_overtime: this.isOvertime(),
      overtime_ms: Math.round(this.overtimeMs())
    };
  }
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

export class ManualClock implements Clock {
  private value = 0;

  now(): number {
    return this.value;
  }

  advance(ms: number): void {
    this.value += ms;
  }
}
