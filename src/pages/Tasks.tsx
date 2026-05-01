import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '@/components/AppShell';
import TaskCard from '@/components/TaskCard';
import { useTasks } from '@/hooks/useTasks';
import { todayISO, DOMAIN_LABEL, type Domain } from '@/lib/pace';
import { getBacklog, getMissed, type Task } from '@/lib/scheduling';
import { ListTodo, AlertTriangle, Inbox, CheckCircle2, CalendarClock } from 'lucide-react';

type GroupKey = 'action' | 'all' | 'backlog' | 'missed' | 'scheduled' | 'done';
type DomainFilter = 'all' | Domain | 'none';

const GROUPS: { k: GroupKey; label: string; icon: any }[] = [
  { k: 'action', label: 'Needs action', icon: AlertTriangle },
  { k: 'all', label: 'All', icon: ListTodo },
  { k: 'backlog', label: 'Backlog', icon: Inbox },
  { k: 'missed', label: 'Missed', icon: AlertTriangle },
  { k: 'scheduled', label: 'Scheduled', icon: CalendarClock },
  { k: 'done', label: 'Completed', icon: CheckCircle2 },
];

const DOMAIN_FILTERS: { k: DomainFilter; label: string }[] = [
  { k: 'all', label: 'All types' },
  { k: 'academic', label: DOMAIN_LABEL.academic },
  { k: 'work', label: DOMAIN_LABEL.work },
  { k: 'social', label: DOMAIN_LABEL.social },
  { k: 'personal', label: DOMAIN_LABEL.personal },
  { k: 'none', label: 'Uncategorized' },
];

export default function Tasks() {
  const nav = useNavigate();
  const { data: tasks = [], isLoading } = useTasks();
  const [group, setGroup] = useState<GroupKey>('action');
  const [domain, setDomain] = useState<DomainFilter>('all');
  const today = todayISO();

  const counts = useMemo(() => {
    const backlog = getBacklog(tasks).filter(t => !t.is_rest);
    const missed = getMissed(tasks, today);
    const action = [...backlog, ...missed];
    const scheduled = tasks.filter(t => t.scheduled_date && t.scheduled_date >= today && t.status !== 'done' && !t.is_rest);
    const done = tasks.filter(t => t.status === 'done');
    const all = tasks.filter(t => !t.is_rest);
    return { action, all, backlog, missed, scheduled, done };
  }, [tasks, today]);

  const filtered = useMemo(() => {
    let list: Task[] = counts[group] ?? [];
    if (domain !== 'all') {
      list = list.filter(t => domain === 'none' ? !t.domain : t.domain === domain);
    }
    // Sort: missed/overdue first by deadline, then by scheduled date, then deadline.
    return [...list].sort((a, b) => {
      const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      const as = a.scheduled_date ?? '9999-99-99';
      const bs = b.scheduled_date ?? '9999-99-99';
      if (as !== bs) return as.localeCompare(bs);
      return ad - bd;
    });
  }, [counts, group, domain]);

  return (
    <AppShell>
      <header className="space-y-1 mb-5">
        <h1 className="text-3xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-muted-foreground text-[15px]">
          Your full backlog — including unscheduled and missed work.
        </p>
      </header>

      <section aria-label="Task group" className="mb-3">
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {GROUPS.map(({ k, label, icon: Icon }) => {
            const n = counts[k]?.length ?? 0;
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

      <section aria-label="Type filter" className="mb-5">
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

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="pace-card text-center py-10 text-muted-foreground">
          {group === 'action'
            ? 'Nothing needs your attention. Nice work.'
            : 'No tasks here yet.'}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map(t => (
            <li key={t.id}>
              <TaskCard task={t} onOpen={() => nav(`/task/${t.id}`)} />
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
