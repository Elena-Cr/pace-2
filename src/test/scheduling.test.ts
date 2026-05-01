import { describe, it, expect } from 'vitest';
import {
  getBacklog, getMissed, getTodayTasks,
  getScheduledEvents, calculateDailyWorkload,
} from '@/lib/scheduling';
import type { Task } from '@/lib/scheduling';

const make = (p: Partial<Task> = {}): Task => ({
  id: 'x', user_id: 'u', title: 't', domain: 'academic', priority: 'should',
  status: 'not_started', deadline: null, scheduled_date: null,
  duration_minutes: null, start_time: null, end_time: null,
  is_rest: false, effort_level: null, energy: null,
  next_action: null, notes: null, progress: 0, reschedule_count: 0,
  involves_others: false, others_rely: false, subtasks: [],
  replanning_reason: null, last_mood: null,
  created_at: '', updated_at: '',
  ...p,
});

describe('scheduling helpers', () => {
  it('getTodayTasks excludes rest, done, and other dates', () => {
    const tasks = [
      make({ id: 'a', scheduled_date: '2026-05-01' }),
      make({ id: 'b', scheduled_date: '2026-05-01', is_rest: true }),
      make({ id: 'c', scheduled_date: '2026-05-01', status: 'done' }),
      make({ id: 'd', scheduled_date: '2026-05-02' }),
    ];
    expect(getTodayTasks(tasks, '2026-05-01').map(t => t.id)).toEqual(['a']);
  });

  it('getMissed excludes rest blocks and done tasks', () => {
    const tasks = [
      make({ id: 'a', scheduled_date: '2026-04-30' }),
      make({ id: 'b', scheduled_date: '2026-04-30', is_rest: true }),
      make({ id: 'c', scheduled_date: '2026-04-30', status: 'done' }),
    ];
    expect(getMissed(tasks, '2026-05-01').map(t => t.id)).toEqual(['a']);
  });

  it('getBacklog returns only unscheduled, non-done', () => {
    const tasks = [
      make({ id: 'a', scheduled_date: null }),
      make({ id: 'b', scheduled_date: null, status: 'done' }),
      make({ id: 'c', scheduled_date: '2026-05-01' }),
    ];
    expect(getBacklog(tasks).map(t => t.id)).toEqual(['a']);
  });

  it('getScheduledEvents honours start_time when present', () => {
    const tasks = [make({
      id: 'a', scheduled_date: '2026-05-01',
      start_time: '14:00:00', end_time: '15:00:00', duration_minutes: 60,
    })];
    const ev = getScheduledEvents(tasks)[0];
    expect(ev.startMin).toBe(14 * 60);
    expect(ev.endMin).toBe(15 * 60);
  });

  it('calculateDailyWorkload sums duration_minutes', () => {
    const tasks = [
      make({ duration_minutes: 30 }),
      make({ duration_minutes: 45 }),
      make({ duration_minutes: null }),
    ];
    expect(calculateDailyWorkload(tasks)).toBe(75);
  });
});

import { effectiveCapacityMinutes, capacityState } from '@/lib/scheduling';

describe('capacity helpers', () => {
  it('uses profile default when no daily override exists', () => {
    expect(effectiveCapacityMinutes(null, 330)).toBe(330);
  });
  it('applies the Low energy multiplier', () => {
    expect(effectiveCapacityMinutes(
      { available_hours: 6, energy_level: 'Low' },
      330,
    )).toBe(Math.round(6 * 60 * 0.75));
  });
  it('applies the High energy multiplier', () => {
    expect(effectiveCapacityMinutes(
      { available_hours: 6, energy_level: 'High' },
      330,
    )).toBe(Math.round(6 * 60 * 1.1));
  });
  it('classifies capacity state at the boundary', () => {
    expect(capacityState(85, 100)).toBe('balanced');
    expect(capacityState(86, 100)).toBe('close');
    expect(capacityState(100, 100)).toBe('close');
    expect(capacityState(101, 100)).toBe('over');
  });
});

import { buildReschedulePatch, progressForStatus } from '@/lib/scheduling';

describe('reschedule', () => {
  it('preserves progress, subtasks, notes, next_action', () => {
    const task = make({
      id: 'a', progress: 50, subtasks: [{ id: 's1', title: 'x', done: true }],
      next_action: 'open the doc', notes: 'hi', reschedule_count: 1,
    });
    const patch = buildReschedulePatch(task, '2026-05-02');
    expect(patch.scheduled_date).toBe('2026-05-02');
    expect(patch.reschedule_count).toBe(2);
    expect(patch.status).toBe('rescheduled');
    expect((patch as any).progress).toBeUndefined();
    expect((patch as any).subtasks).toBeUndefined();
    expect((patch as any).next_action).toBeUndefined();
    expect((patch as any).notes).toBeUndefined();
  });
});

describe('progressForStatus', () => {
  it('does not lower progress when moving forward', () => {
    expect(progressForStatus('in_progress', 80)).toBe(80);
  });
  it('returns current for rescheduled', () => {
    expect(progressForStatus('rescheduled', 40)).toBe(40);
  });
});
