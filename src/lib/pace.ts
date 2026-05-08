export type Priority = 'must' | 'should' | 'could';
export type Domain = 'academic' | 'work' | 'social' | 'personal';
export type Status =
  | 'not_started'
  | 'started'
  | 'in_progress'
  | 'blocked'
  | 'nearly_done'
  | 'done'
  | 'rescheduled';

export type ReplanReason =
  | 'too_tired'
  | 'underestimated'
  | 'waiting_others'
  | 'higher_priority'
  | 'needed_more_time'
  | 'circumstances_changed';

export type Mood = 'fine' | 'tired' | 'overwhelmed' | 'frustrated' | 'unsure';

export type Subtask = { id: string; title: string; done: boolean };

export const PRIORITY_LABEL: Record<Priority, string> = {
  must: 'High',
  should: 'Medium',
  could: 'Low',
};

export const DOMAIN_LABEL: Record<Domain, string> = {
  academic: 'Academic',
  work: 'Work',
  social: 'Social',
  personal: 'Personal',
};

// Single source of truth for domain colours. Resolves the same CSS variable
// across every view (Home, Plan, Calendar, Workload). Use this constant
// instead of inlining `hsl(var(--domain-...))` or inventing local palettes.
export const DOMAIN_COLOR_VAR: Record<Domain | 'rest', string> = {
  academic: 'hsl(var(--domain-academic))',
  work: 'hsl(var(--domain-work))',
  social: 'hsl(var(--domain-social))',
  personal: 'hsl(var(--domain-personal))',
  rest: 'hsl(var(--domain-rest))',
};

// NOTE: any new value added to Status must be paired with a matching
// `.status-<value>` rule in src/index.css (used by the `status-chip` component).
export const STATUS_LABEL: Record<Status, string> = {
  not_started: 'Not started',
  started: 'Started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  nearly_done: 'Nearly done',
  done: 'Completed',
  rescheduled: 'Rescheduled',
};

export const REPLAN_REASON_LABEL: Record<ReplanReason, string> = {
  too_tired: 'Low energy today',
  underestimated: 'Took longer than expected',
  waiting_others: 'Waiting on someone else',
  higher_priority: 'Something more urgent came up',
  needed_more_time: 'Need a longer slot',
  circumstances_changed: 'Plans changed',
};

export const MOOD_LABEL: Record<Mood, string> = {
  fine: 'Fine',
  tired: 'Tired',
  overwhelmed: 'Overwhelmed',
  frustrated: 'Frustrated',
  unsure: 'Unsure',
};

export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function formatDeadline(iso: string | null): string {
  if (!iso) return 'No deadline';
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const startOfDeadline = new Date(d); startOfDeadline.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((startOfDeadline.getTime() - startOfToday.getTime()) / 86400000);
  if (dayDiff < 0) return 'Deadline passed';
  if (dayDiff === 0) return 'Due today';
  if (dayDiff === 1) return 'Due tomorrow';
  if (dayDiff <= 7) return `Due in ${dayDiff} days`;
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

// Local-date ISO (YYYY-MM-DD) — never use toISOString().slice(0,10),
// which returns the UTC date and can be off-by-one in non-UTC timezones.
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function todayISO() {
  return toISODate(new Date());
}

// Format a scheduled date (+ optional start/end time) as a friendly label
// like "Today 9:00 – 10:30", "Tomorrow", or "Mon, May 5 · 14:00". Returns
// an empty string when the task isn't scheduled.
function fmtClock(t: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hh = Number(h), mm = Number(m || 0);
  if (Number.isNaN(hh)) return '';
  const am = hh < 12; const h12 = ((hh + 11) % 12) + 1;
  return `${h12}${mm ? ':' + String(mm).padStart(2, '0') : ''}${am ? 'a' : 'p'}`;
}

export function formatScheduledWhen(
  scheduledDate: string | null,
  startTime: string | null,
  endTime: string | null,
): string {
  if (!scheduledDate) return '';
  const [y, m, d] = scheduledDate.split('-').map(Number);
  if (!y) return '';
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  let label: string;
  if (dt.getTime() === now.getTime()) label = 'Today';
  else if (dt.getTime() === tomorrow.getTime()) label = 'Tomorrow';
  else label = dt.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const s = fmtClock(startTime);
  const e = fmtClock(endTime);
  if (s && e) return `${label}, ${s} – ${e}`;
  if (s) return `${label}, ${s}`;
  return label;
}

export function fmtMin(min: number) {
  if (!min) return '—';
  const h = Math.floor(min / 60); const m = min % 60;
  return `${h ? `${h}h ` : ''}${m ? `${m}m` : (h ? '' : '0m')}`.trim();
}

export function nextStatus(s: Status): Status {
  const order: Status[] = ['not_started','started','in_progress','nearly_done','done'];
  const i = order.indexOf(s);
  if (i === -1 || i === order.length - 1) return 'done';
  return order[i + 1];
}
