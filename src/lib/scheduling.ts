// Single source of truth for task scheduling.
// All views (Home, Plan, Calendar, Workload) should use these helpers
// so a task always appears on the same day everywhere.

import type { Domain, Status, Subtask } from './pace';
import { toISODate } from './pace';

export type { Subtask } from './pace';
export { toISODate } from './pace';

export type Task = {
  id: string;
  user_id: string;
  title: string;
  domain: Domain | null;
  priority: 'must' | 'should' | 'could';
  status: Status;
  deadline: string | null;
  scheduled_date: string | null;          // YYYY-MM-DD — canonical
  duration_minutes: number | null;        // canonical unit
  start_time: string | null;              // HH:MM:SS
  end_time: string | null;
  parent_task_id: string | null;
  is_rest: boolean;
  effort_level: string | null;
  energy: string | null;
  next_action: string | null;
  notes: string | null;
  progress: number;                       // 0..100
  reschedule_count: number;
  involves_others: boolean;
  others_rely: boolean;
  subtasks: Subtask[];
  replanning_reason: string | null;
  last_mood: string | null;
  created_at: string;
  updated_at: string;
};

export type CalEventKind = 'task' | 'rest' | 'meal' | 'sleep' | 'recovery' | 'focus';

export type CalEvent = {
  id: string;
  taskId?: string;
  title: string;
  kind: CalEventKind;
  domain: Domain | 'rest';
  status?: Status;
  startMin: number;       // minutes from 00:00
  endMin: number;
  date: string;           // YYYY-MM-DD
  fixed?: boolean;        // sleep/meal/recovery aren't tasks
};

// ---------- Date helpers ----------
// toISODate is re-exported from ./pace above (single source of truth).

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d); x.setDate(x.getDate() + n); return x;
}

// ---------- Single source of truth: filtering ----------
export function getTasksForDate(tasks: Task[], date: string): Task[] {
  return tasks.filter(t => t.scheduled_date === date);
}

export function getBacklog(tasks: Task[]): Task[] {
  return tasks.filter(t => !t.scheduled_date && t.status !== 'done');
}

export function getMissed(tasks: Task[], today: string): Task[] {
  return tasks.filter(
    t => t.scheduled_date && t.scheduled_date < today && t.status !== 'done' && !t.is_rest
  );
}

// ---------- Workload math ----------
export function calculateDailyWorkload(tasks: Task[]): number {
  return tasks.reduce((sum, t) => sum + (t.duration_minutes || 0), 0);
}

export function workloadByDate(tasks: Task[]): Record<string, number> {
  const out: Record<string, number> = {};
  tasks.forEach(t => {
    if (!t.scheduled_date) return;
    out[t.scheduled_date] = (out[t.scheduled_date] || 0) + (t.duration_minutes || 0);
  });
  return out;
}

// ---------- Calendar event building ----------
// If a task has start_time, place it there. Otherwise stagger around 9am.
function timeStringToMin(s: string | null): number | null {
  if (!s) return null;
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function getScheduledEvents(tasks: Task[]): CalEvent[] {
  const out: CalEvent[] = [];
  // bucket by date so we can stagger only within a day
  const byDate: Record<string, Task[]> = {};
  tasks.forEach(t => {
    if (!t.scheduled_date) return;
    (byDate[t.scheduled_date] ||= []).push(t);
  });
  Object.entries(byDate).forEach(([date, list]) => {
    list.forEach((t, i) => {
      const dur = t.duration_minutes || 45;
      const explicit = timeStringToMin(t.start_time);
      const startMin = explicit ?? (9 * 60 + (i % 6) * 80);
      const endMin = (timeStringToMin(t.end_time) ?? (startMin + dur));
      out.push({
        id: `task-${t.id}`,
        taskId: t.id,
        title: t.title,
        kind: t.is_rest ? 'rest' : 'task',
        domain: (t.is_rest ? 'rest' : (t.domain || 'personal')) as Domain | 'rest',
        status: t.status,
        startMin,
        endMin,
        date,
      });
    });
  });
  return out;
}

// ---------- Default time blocks (sleep/meal/recovery) ----------
export type DefaultBlock = { label: string; start: string; end: string; kind: CalEventKind };

export function expandTimeBlocks(blocks: DefaultBlock[], date: string): CalEvent[] {
  return blocks.map((b, i) => {
    const startMin = timeStringToMin(b.start) ?? 0;
    const endMin = timeStringToMin(b.end) ?? startMin + 30;
    return {
      id: `block-${date}-${i}`,
      title: b.label,
      kind: b.kind,
      domain: 'rest',
      startMin,
      endMin: endMin <= startMin ? 24 * 60 : endMin,
      date,
      fixed: true,
    };
  });
}

// ---------- Status → progress mapping ----------
export const STATUS_PROGRESS: Record<string, number> = {
  not_started: 0,
  started: 10,
  in_progress: 50,
  blocked: 50,
  nearly_done: 80,
  rescheduled: 0,
  done: 100,
};

export function progressForStatus(status: string, current = 0): number {
  const target = STATUS_PROGRESS[status];
  if (target === undefined) return current;
  // Don't decrease user-recorded progress when moving forward
  return target;
}
