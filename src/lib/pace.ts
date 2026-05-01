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
  too_tired: 'Too tired',
  underestimated: 'Underestimated it',
  waiting_others: 'Waiting on others',
  higher_priority: 'Higher priority came up',
  needed_more_time: 'Needed more time',
  circumstances_changed: 'Circumstances changed',
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
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (sameDay) return `Today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  if (d < now) return 'Needs attention';
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
