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
  next_action: string | null;
  notes: string | null;
  progress: number;                       // 0..100
  reschedule_count: number;
  involves_others: boolean;
  others_rely?: boolean;
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
  // Unscheduled open tasks, plus any blocked tasks (regardless of schedule)
  // so blocked work surfaces in the backlog instead of as a "missed" nudge.
  return tasks.filter(t => t.status !== 'done' && (!t.scheduled_date || t.status === 'blocked'));
}

export function getMissed(tasks: Task[], today: string): Task[] {
  return tasks.filter(
    t => t.scheduled_date && t.scheduled_date < today && t.status !== 'done' && t.status !== 'blocked' && !t.is_rest
  );
}

// Open, non-rest tasks without a deadline that are either marked "must"
// or whose title stem matches a recurring template from history. Single
// source of truth shared by Home, Workload and Tasks so counts match.
export function getNoDeadlineHighValue(
  tasks: Task[],
  recurringStems: Set<string>,
  stemFn: (s: string) => string,
): Task[] {
  return tasks.filter(t =>
    !t.is_rest
    && !t.deadline
    && t.status !== 'done'
    && (t.priority === 'must' || recurringStems.has(stemFn(t.title)))
  );
}

// What's "wrong" with a task in a backlog/needs-attention list. Used to
// render explanatory chips so the user understands why each task surfaces.
export type TaskWarning = 'missed' | 'blocked' | 'unscheduled' | 'no_deadline';
export function getTaskWarnings(t: Task, today: string): TaskWarning[] {
  const out: TaskWarning[] = [];
  if (t.status === 'blocked') out.push('blocked');
  else if (t.scheduled_date && t.scheduled_date < today && t.status !== 'done' && !t.is_rest) out.push('missed');
  if (!t.scheduled_date && t.status !== 'done') out.push('unscheduled');
  if (!t.deadline && t.status !== 'done') out.push('no_deadline');
  return out;
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
// Energy multiplier is now configurable per-user. `pct` is the percentage
// (e.g. 10 → ±10%). High adds, Low subtracts, Med = 1.0.
export type EnergyLevel = 'Low' | 'Med' | 'High';

// Resolve the user's typical daily energy from their profile pattern.
// Used as the fallback when no daily_capacity row exists for a given date,
// so changes saved in Settings/Onboarding flow into capacity math + display.
//
// When `mode === 'period'`, the per-period values (morning/afternoon/evening)
// are honored. Pass `opts.hour` (0-23) to pick the period for a specific
// moment (e.g. "now" on the Home screen). Without a hint, we pick the most
// common period value so a day-level summary still reflects the user's
// settings (falling back to `whole` when periods are empty).
export type PeriodKey = 'morning' | 'afternoon' | 'evening';

export function periodForHour(hour: number): PeriodKey {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export function resolveProfileEnergy(
  pattern:
    | {
        mode?: 'whole' | 'period';
        whole?: string | null;
        morning?: string | null;
        afternoon?: string | null;
        evening?: string | null;
      }
    | null
    | undefined,
  opts: { hour?: number; period?: PeriodKey } = {},
): string {
  if (!pattern) return 'Med';
  const whole = (pattern.whole as string) ?? 'Med';
  if (pattern.mode !== 'period') return whole;

  const get = (k: PeriodKey) => (pattern[k] as string | null | undefined) ?? whole;

  // Specific period requested → use it directly.
  const period = opts.period ?? (opts.hour != null ? periodForHour(opts.hour) : null);
  if (period) return get(period);

  // No hint → pick the most common across periods so a day-level value
  // still reflects per-period settings. Ties prefer the period that's
  // explicitly set (not falling back to `whole`).
  const vals: Array<{ v: string; explicit: boolean }> = (['morning', 'afternoon', 'evening'] as PeriodKey[])
    .map(k => ({ v: get(k), explicit: (pattern[k] as string | null | undefined) != null }));
  const counts = new Map<string, { n: number; explicit: number }>();
  vals.forEach(({ v, explicit }) => {
    const c = counts.get(v) ?? { n: 0, explicit: 0 };
    c.n += 1; if (explicit) c.explicit += 1;
    counts.set(v, c);
  });
  let best = whole;
  let bestScore = -1;
  let bestExplicit = -1;
  counts.forEach((c, v) => {
    if (c.n > bestScore || (c.n === bestScore && c.explicit > bestExplicit)) {
      best = v; bestScore = c.n; bestExplicit = c.explicit;
    }
  });
  return best;
}

export function energyMultiplier(level: string | null | undefined, pct = 10): number {
  if (level === 'High') return 1 + pct / 100;
  if (level === 'Low') return 1 - pct / 100;
  return 1;
}

// Backwards-compatible default multipliers (pct = 10).
export const ENERGY_MULTIPLIER = { Low: 0.9, Med: 1, High: 1.1 } as const;

export function effectiveCapacityMinutes(
  dailyOverride: { available_hours: number; energy_level: string } | null,
  profileDefaultMinutes: number,
  opts: { affects?: boolean; pct?: number } = {},
): number {
  const baseMin = dailyOverride
    ? Number(dailyOverride.available_hours) * 60
    : profileDefaultMinutes;
  const affects = opts.affects ?? true;
  if (!affects) return Math.round(baseMin);
  const mult = energyMultiplier(dailyOverride?.energy_level ?? 'Med', opts.pct ?? 10);
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
export function timeStringToMin(s: string | null): number | null {
  if (!s) return null;
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
}

// HH:MM (zero-padded). Wraps modulo 24h.
export function minToTimeString(min: number): string {
  const m = ((Math.round(min) % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Find tasks/blocks that overlap a proposed [startMin,endMin) on a given date.
// Used by Capture and the Reschedule dialog so the user can see — but still
// override — overlaps with other scheduled work or rest time.
export type ScheduleConflict = {
  title: string;
  startMin: number;
  endMin: number;
  kind: CalEventKind;
};

export function findScheduleConflicts(opts: {
  date: string;
  startMin: number;
  endMin: number;
  tasks: Task[];
  blocks?: DefaultBlock[];
  excludeTaskId?: string | null;
}): ScheduleConflict[] {
  const { date, startMin, endMin, tasks, blocks, excludeTaskId } = opts;
  if (endMin <= startMin) return [];
  const out: ScheduleConflict[] = [];
  tasks.forEach(t => {
    if (t.scheduled_date !== date) return;
    if (excludeTaskId && t.id === excludeTaskId) return;
    if (t.status === 'done') return;
    // Fall back to the same defaults getScheduledEvents uses for visual
    // placement so untimed scheduled actions still participate in conflict
    // detection (Issue C). Missing start_time → 09:00; missing end_time →
    // start + duration_minutes (or +30m if duration is also missing).
    const sExplicit = timeStringToMin(t.start_time);
    const s = sExplicit ?? (9 * 60);
    const dur = t.duration_minutes && t.duration_minutes > 0 ? t.duration_minutes : 30;
    const e = timeStringToMin(t.end_time) ?? (s + dur);
    if (e <= s) return;
    if (startMin < e && endMin > s) {
      out.push({ title: t.title, startMin: s, endMin: e, kind: t.is_rest ? 'rest' : 'task' });
    }
  });
  expandTimeBlocks(blocks ?? [], date).forEach(b => {
    if (startMin < b.endMin && endMin > b.startMin) {
      out.push({ title: b.title, startMin: b.startMin, endMin: b.endMin, kind: b.kind });
    }
  });
  return out;
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

// ---------- Default time blocks (sleep/meal/recovery/custom) ----------
// `days` is an optional 0-indexed Monday-start weekday filter. Absent or
// empty means "every day" (backwards compatible).
export type DefaultBlock = {
  label: string;
  start: string;
  end: string;
  kind: CalEventKind;
  days?: number[];
};

// Returns the 0=Mon..6=Sun index for an ISO YYYY-MM-DD date string.
export function monStartDayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const js = new Date(y, (m || 1) - 1, d || 1).getDay();
  return (js + 6) % 7;
}

export function expandTimeBlocks(blocks: DefaultBlock[], date: string): CalEvent[] {
  const dow = monStartDayOfWeek(date);
  const out: CalEvent[] = [];
  blocks.forEach((b, i) => {
    if (b.days && b.days.length > 0 && !b.days.includes(dow)) return;
    const startMin = timeStringToMin(b.start) ?? 0;
    const endMin = timeStringToMin(b.end) ?? startMin + 30;
    out.push({
      id: `block-${date}-${i}`,
      title: b.label,
      kind: b.kind,
      domain: 'rest',
      startMin,
      endMin: endMin <= startMin ? 24 * 60 : endMin,
      date,
      fixed: true,
    });
  });
  return out;
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
  const patch: Partial<Task> = {
    scheduled_date: newDate,
    reschedule_count: (task.reschedule_count || 0) + 1,
    status: 'rescheduled',
    last_mood: opts.mood ?? null,
    replanning_reason: opts.reason ?? null,
    // progress, subtasks, next_action, notes intentionally untouched
  };
  // Only overwrite status with 'rescheduled' when the task hadn't been
  // started yet. If the user is already in_progress / started / nearly_done
  // / blocked / done, preserve their real progress state.
  if (task.status !== 'not_started') {
    delete patch.status;
  }
  return patch;
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
