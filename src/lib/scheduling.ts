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
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

// Map a raw DB row (where subtasks is Json) into our canonical Task.
// This is the single boundary that translates DB shape -> app type.
export function rowToTask(row: any): Task {
  const raw = row?.subtasks;
  const subtasks: Subtask[] = Array.isArray(raw) ? raw as Subtask[] : [];
  return { ...row, subtasks } as Task;
}

export function rowsToTasks(rows: any[] | null | undefined): Task[] {
  return (rows || []).map(rowToTask);
}

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

// Open, non-rest tasks scheduled for the given day.
export function getTodayTasks(tasks: Task[], today: string): Task[] {
  return tasks.filter(
    t => t.scheduled_date === today && !t.is_rest && t.status !== 'done'
  );
}

// Same shape as getTodayTasks but for an arbitrary "tomorrow" date.
export function getTomorrowTasks(tasks: Task[], tomorrow: string): Task[] {
  return tasks.filter(
    t => t.scheduled_date === tomorrow && !t.is_rest && t.status !== 'done'
  );
}

// Rest blocks for a given date — includes rest blocks with no scheduled_date
// (treated as recurring/today defaults).
export function getRestBlocksForDate(tasks: Task[], date: string): Task[] {
  return tasks.filter(
    t => t.is_rest && (!t.scheduled_date || t.scheduled_date === date)
  );
}

// Tasks completed on the given day. Prefers completed_at (set when status
// transitions to done) and falls back to updated_at for legacy rows.
export function getDoneOnDate(tasks: Task[], date: string): Task[] {
  return tasks.filter(t => {
    if (t.status !== 'done') return false;
    const ts = t.completed_at ?? t.updated_at ?? '';
    return ts.slice(0, 10) === date;
  });
}

// ---------- Capacity helpers ----------
export const ENERGY_MULTIPLIER = { Low: 0.75, Med: 1, High: 1.1 } as const;
export type EnergyLevel = keyof typeof ENERGY_MULTIPLIER;

export function effectiveCapacityMinutes(
  dailyOverride: { available_hours: number; energy_level: string } | null,
  profileDefaultMinutes: number,
): number {
  const baseMin = dailyOverride
    ? Number(dailyOverride.available_hours) * 60
    : profileDefaultMinutes;
  const energyKey = (dailyOverride?.energy_level ?? 'Med') as EnergyLevel;
  const mult = ENERGY_MULTIPLIER[energyKey] ?? 1;
  return Math.round(baseMin * mult);
}

export type CapacityState = 'balanced' | 'close' | 'over';
export function capacityState(plannedMin: number, capMin: number): CapacityState {
  const ratio = plannedMin / Math.max(1, capMin);
  if (ratio > 1) return 'over';
  if (ratio > 0.85) return 'close';
  return 'balanced';
}

// ---------- Workload math ----------
// 15% rounded up. Tasks without an estimate contribute no buffer.
export function bufferMinutes(task: Pick<Task, 'duration_minutes'>): number {
  const d = task.duration_minutes ?? 0;
  if (d <= 0) return 0;
  return Math.ceil(d * 0.15);
}

// Same shape as calculateDailyWorkload but adds the per-task buffer.
export function calculateDailyWorkloadWithBuffer(tasks: Task[]): number {
  return tasks.reduce((sum, t) => sum + (t.duration_minutes || 0) + bufferMinutes(t), 0);
}

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

// ---------- Conflict detection (task vs rest/meal/sleep blocks) ----------
// Returns the set of task event ids that overlap any non-task event in the
// same calendar day. Use on the *unfiltered* day events so hiding domains
// in the UI doesn't make a real conflict disappear.
export function getTaskRestConflicts(events: CalEvent[]): Set<string> {
  const out = new Set<string>();
  // Bucket by date so we only compare events on the same day.
  const byDate: Record<string, CalEvent[]> = {};
  events.forEach(e => { (byDate[e.date] ||= []).push(e); });
  Object.values(byDate).forEach(list => {
    const tasks = list.filter(e => e.kind === 'task');
    const rests = list.filter(e => e.kind !== 'task');
    tasks.forEach(t => {
      rests.forEach(r => {
        if (t.startMin < r.endMin && t.endMin > r.startMin) out.add(t.id);
      });
    });
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
// Statuses that are NOT in this map (e.g. 'rescheduled') intentionally
// preserve the task's current progress — see progressForStatus().
export const STATUS_PROGRESS: Record<string, number> = {
  not_started: 0,
  started: 10,
  in_progress: 50,
  blocked: 50,
  nearly_done: 80,
  done: 100,
};

// Used by automated transitions (subtask completion, tab visibility, etc.)
// where we want to preserve recorded forward progress.
export function progressForStatus(status: string, current = 0): number {
  const target = STATUS_PROGRESS[status];
  if (target === undefined) return current;
  return Math.max(target, current);
}

// Used when the user explicitly selects a status. Returns the canonical
// target value so progress can decrease (e.g. Done → Nearly done drops
// 100 → 80). Statuses outside STATUS_PROGRESS preserve current progress.
export function progressForStatusExplicit(status: string, current = 0): number {
  const target = STATUS_PROGRESS[status];
  if (target === undefined) return current;
  return target;
}

// ---------- Reschedule patch ----------
// Progress-preserving reschedule: bumps the date + reschedule_count and
// records optional reason/mood, but never touches progress, subtasks,
// next_action, or notes.
import type { ReplanReason, Mood } from './pace';

export function buildReschedulePatch(
  task: Task,
  newDate: string,
  opts: { reason?: ReplanReason; mood?: Mood } = {},
): Partial<Task> {
  return {
    scheduled_date: newDate,
    reschedule_count: (task.reschedule_count || 0) + 1,
    status: 'rescheduled',
    last_mood: opts.mood ?? null,
    replanning_reason: opts.reason ?? null,
    // progress, subtasks, next_action, notes intentionally untouched
  };
}

// ---------- Calendar event layout (sweep-line column allocation) ----------
// Given a day's events, assigns each event a `column` index and `columnCount`
// (the number of columns in its overlap cluster) so overlapping events render
// side by side instead of stacked.
export type LaidOutEvent<E extends { id: string; startMin: number; endMin: number }> =
  E & { column: number; columnCount: number };

export function layoutEventsForDay<E extends { id: string; startMin: number; endMin: number }>(
  events: E[],
): LaidOutEvent<E>[] {
  const sorted = [...events].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const out = new Map<string, { column: number; columnCount: number }>();
  // Process in clusters: a cluster is a maximal run of events where each
  // overlaps at least one other in the cluster.
  let cluster: E[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    if (!cluster.length) return;
    // Assign first-available column per event using sweep over starts.
    const columns: number[] = []; // columns[i] = endMin of last event placed in column i
    const placed: Array<{ e: E; col: number }> = [];
    cluster.forEach(e => {
      let col = columns.findIndex(end => end <= e.startMin);
      if (col === -1) { col = columns.length; columns.push(e.endMin); }
      else columns[col] = e.endMin;
      placed.push({ e, col });
    });
    const count = columns.length;
    placed.forEach(({ e, col }) => out.set(e.id, { column: col, columnCount: count }));
  };
  sorted.forEach(e => {
    if (e.startMin >= clusterEnd) { flush(); cluster = []; clusterEnd = -Infinity; }
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.endMin);
  });
  flush();
  return sorted.map(e => ({ ...e, ...(out.get(e.id) ?? { column: 0, columnCount: 1 }) }));
}
