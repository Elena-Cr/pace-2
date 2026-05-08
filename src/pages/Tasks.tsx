import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppShell from '@/components/AppShell';
import TaskCard from '@/components/TaskCard';
import { useAuth } from '@/hooks/useAuth';
import { useTasks } from '@/hooks/useTasks';
import { useTaskSuggestions, stem } from '@/hooks/useTaskSuggestions';
import { todayISO, DOMAIN_LABEL, type Domain } from '@/lib/pace';
import {
  getBacklog,
  getMissed,
  getNoDeadlineHighValue,
  getTaskWarnings,
  type Task,
  type TaskWarning,
} from '@/lib/scheduling';
import { ListTodo, AlertTriangle, Inbox, CheckCircle2, CalendarClock, Timer, CalendarX, Flag, CalendarPlus } from 'lucide-react';
import RescheduleDialog from '@/components/RescheduleDialog';

type GroupKey = 'action' | 'all' | 'backlog' | 'missed' | 'no_deadline' | 'scheduled' | 'done';
type DomainFilter = 'all' | Domain | 'none';

const GROUPS: { k: GroupKey; label: string; icon: any }[] = [
  { k: 'action', label: 'Needs action', icon: AlertTriangle },
  { k: 'all', label: 'All', icon: ListTodo },
  { k: 'backlog', label: 'Later', icon: Inbox },
  { k: 'missed', label: 'Missed', icon: AlertTriangle },
  { k: 'no_deadline', label: 'No deadline', icon: Flag },
  { k: 'scheduled', label: 'Scheduled', icon: CalendarClock },
  { k: 'done', label: 'Completed', icon: CheckCircle2 },
];

const DOMAIN_FILTERS: { k: DomainFilter; label: string }[] = [
  { k: 'all', label: 'All categories' },
  { k: 'academic', label: DOMAIN_LABEL.academic },
  { k: 'work', label: DOMAIN_LABEL.work },
  { k: 'social', label: DOMAIN_LABEL.social },
  { k: 'personal', label: DOMAIN_LABEL.personal },
  { k: 'none', label: 'Uncategorized' },
];

const WARNING_LABEL: Record<TaskWarning, string> = {
  missed: 'Missed — past scheduled day',
  blocked: 'Blocked',
  unscheduled: 'Not scheduled yet',
  no_deadline: 'No deadline set',
};

function isGroupKey(s: string | null): s is GroupKey {
  return !!s && ['action','all','backlog','missed','no_deadline','scheduled','done'].includes(s);
}

export default function Tasks() {
  const nav = useNavigate();
  const { user } = useAuth();
  const { data: tasks = [], isLoading } = useTasks();
  const { templates } = useTaskSuggestions(user?.id);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialGroup: GroupKey = isGroupKey(searchParams.get('group')) ? (searchParams.get('group') as GroupKey) : 'action';
  const [group, setGroup] = useState<GroupKey>(initialGroup);
  const [domain, setDomain] = useState<DomainFilter>('all');
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const today = todayISO();

  // Sync group ↔ URL so deep-links from Home (e.g. ?group=no_deadline) work.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (group === 'action') next.delete('group');
    else next.set('group', group);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  const recurringStems = useMemo(
    () => new Set(templates.map(t => stem(t.exampleTitle)).filter(Boolean)),
    [templates],
  );

  const counts = useMemo(() => {
    const backlog = getBacklog(tasks).filter(t => !t.is_rest);
    const missed = getMissed(tasks, today);
    const noDeadline = getNoDeadlineHighValue(tasks, recurringStems, stem);
    // "Needs action" = anything with at least one warning (missed, blocked,
    // unscheduled, or important-without-a-deadline). Dedupe by id.
    const noDeadlineIds = new Set(noDeadline.map(t => t.id));
    const merged = new Map<string, Task>();
    [...backlog, ...missed].forEach(t => merged.set(t.id, t));
    noDeadline.forEach(t => merged.set(t.id, t));
    const action = Array.from(merged.values());
    const scheduled = tasks.filter(t => t.scheduled_date && t.scheduled_date >= today && t.status !== 'done' && !t.is_rest);
    const done = tasks.filter(t => t.status === 'done');
    const all = tasks.filter(t => !t.is_rest);
    return { action, all, backlog, missed, no_deadline: noDeadline, scheduled, done, _noDeadlineIds: noDeadlineIds };
  }, [tasks, today, recurringStems]);

  const filtered = useMemo(() => {
    let list: Task[] = (counts as any)[group] ?? [];
    if (domain !== 'all') {
      list = list.filter(t => domain === 'none' ? !t.domain : t.domain === domain);
    }
    return [...list].sort((a, b) => {
      const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      const as = a.scheduled_date ?? '9999-99-99';
      const bs = b.scheduled_date ?? '9999-99-99';
      if (as !== bs) return as.localeCompare(bs);
      return ad - bd;
    });
  }, [counts, group, domain]);

  function warningsFor(t: Task): TaskWarning[] {
    const base = getTaskWarnings(t, today);
    // Only surface "no deadline" when the task is in our high-value set —
    // not every task without a deadline is a problem.
    return base.filter(w => w !== 'no_deadline' || counts._noDeadlineIds.has(t.id));
  }

  return (
    <AppShell>
      <header className="flex items-start justify-between gap-3 mb-5">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Actions</h1>
          <p className="text-muted-foreground text-[15px]">
            Your full list — including unscheduled and missed work.
          </p>
        </div>
        <button
          onClick={() => nav('/focus')}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium shadow-[0_4px_14px_hsl(var(--primary)/0.3)] transition active:scale-95"
        >
          <Timer className="w-4 h-4" />
          Start Focus
        </button>
      </header>

      <section aria-label="Task group" className="mb-3">
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {GROUPS.map(({ k, label, icon: Icon }) => {
            const n = (counts as any)[k]?.length ?? 0;
            const active = group === k;
            return (
              <button
                key={k}
                onClick={() => setGroup(k)}
                className={active ? 'pace-chip-selected' : 'pace-chip'}
                aria-pressed={active}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
                <span className="ml-1 opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-label="Category filter" className="mb-5">
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {DOMAIN_FILTERS.map(({ k, label }) => {
            const active = domain === k;
            return (
              <button
                key={k}
                onClick={() => setDomain(k)}
                className={active ? 'pace-chip-selected' : 'pace-chip'}
                aria-pressed={active}
              >
                {label}
              </button>
            );
          })}
        </div>
      </section>

      {group === 'no_deadline' && (
        <p className="text-[13px] text-muted-foreground mb-3">
          Important actions (high priority or recurring) that don't have a deadline yet.
        </p>
      )}

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="pace-card text-center py-10 text-muted-foreground">
          {group === 'action'
            ? 'Nothing needs your attention. Nice work.'
            : 'No actions here yet.'}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map(t => {
            const warnings = warningsFor(t);
            const canSchedule = !t.scheduled_date && t.status !== 'done' && !t.is_rest;
            return (
              <li key={t.id} className="space-y-1.5">
                <TaskCard task={t} onOpen={() => nav(`/task/${t.id}`)} />
                <div className="flex flex-wrap items-center gap-1.5 px-1">
                  {warnings.map(w => (
                    <span
                      key={w}
                      className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--attention)/0.15)] text-[hsl(var(--attention))] px-2 py-0.5 text-[11px] font-medium"
                    >
                      {w === 'unscheduled' ? <CalendarX className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                      {WARNING_LABEL[w]}
                    </span>
                  ))}
                  {canSchedule && (
                    <button
                      onClick={() => setScheduleId(t.id)}
                      className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-2.5 py-0.5 text-[11px] font-medium"
                    >
                      <CalendarPlus className="w-3 h-3" />
                      Schedule
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <RescheduleDialog
        taskId={scheduleId}
        open={!!scheduleId}
        onClose={() => setScheduleId(null)}
        mode="schedule"
      />
    </AppShell>
  );
}
