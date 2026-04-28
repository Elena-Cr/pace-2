export type Priority = 'must' | 'should' | 'could';
export type Domain = 'academic' | 'work' | 'social' | 'personal';
export type Status = 'not_started' | 'in_progress' | 'done' | 'rescheduled';

export const DOMAIN_LABEL: Record<Domain, string> = {
  academic: 'Academic',
  work: 'Work',
  social: 'Social',
  personal: 'Personal',
};

export const STATUS_LABEL: Record<Status, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
  rescheduled: 'Rescheduled',
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
  if (d < now) return 'Overdue';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
