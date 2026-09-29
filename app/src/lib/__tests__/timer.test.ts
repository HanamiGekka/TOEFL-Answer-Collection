import { describe, expect, it } from 'vitest';
import { ManualClock, MonotonicTimer } from '../timer';

describe('MonotonicTimer', () => {
  it('excludes explicit pause time from active time', () => {
    const clock = new ManualClock();
    const timer = new MonotonicTimer(clock, 1_000);
    clock.advance(400);
    expect(timer.activeMs()).toBe(400);
    expect(timer.pause()).toBe(true);
    clock.advance(10_000);
    expect(timer.activeMs()).toBe(400);
    expect(timer.pausedMs()).toBe(10_000);
    expect(timer.resume()).toBe(true);
    clock.advance(700);
    expect(timer.activeMs()).toBe(1_100);
    expect(timer.isOvertime()).toBe(true);
    expect(timer.overtimeMs()).toBe(100);
  });

  it('does not auto advance or mutate state on timeout checks', () => {
    const clock = new ManualClock();
    const timer = new MonotonicTimer(clock, 100);
    clock.advance(150);
    const before = timer.snapshot();
    const after = timer.snapshot();
    expect(before.active_ms).toBe(after.active_ms);
    expect(after.is_overtime).toBe(true);
  });
});
