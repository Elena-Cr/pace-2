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
  getTaskWarnings,
  type Task,
  type TaskWarning,
} from '@/lib/scheduling';
import { ListTodo, AlertTriangle, Inbox, CheckCircle2, CalendarClock, CalendarX, CalendarPlus, CalendarSync } from 'lucide-react';
import RescheduleDialog from '@/components/RescheduleDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTaskMutations } from '@/hooks/useTasks';
import { toast } from 'sonner';

type GroupKey = 'action' | 'all' | 'backlog' | 'missed' | 'scheduled' | 'done';
type DomainFilter = 'all' | Domain | 'none';

const GROUPS: { k: GroupKey; label: string; icon: any }[] = [
  { k: 'action', label: 'Needs action', icon: AlertTriangle },
  { k: 'all', label: 'All', icon: ListTodo },
  { k: 'backlog', label: 'Later', icon: Inbox },
  { k: 'missed', label: 'Missed', icon: AlertTriangle },
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
};

function isGroupKey(s: string | null): s is GroupKey {
  return !!s && ['action','all','backlog','missed','scheduled','done'].includes(s);
}

export default function Tasks() {
  const nav = useNavigate();
  const { user } = useAuth();
  const { data: tasks = [], isLoading } = useTasks();
  const { update } = useTaskMutations();
  const { templates } = useTaskSuggestions(user?.id);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialGroup: GroupKey = isGroupKey(searchParams.get('group')) ? (searchParams.get('group') as GroupKey) : 'action';
  const [group, setGroup] = useState<GroupKey>(initialGroup);
  const [domain, setDomain] = useState<DomainFilter>('all');
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const today = todayISO();

  async function toggleComplete(t: { id: string; status: string }) {
    const next = t.status === 'done' ? 'not_started' : 'done';
    try {
      await update.mutateAsync({ id: t.id, patch: {
        status: next as any,
        progress: next === 'done' ? 100 : 0,
        completed_at: next === 'done' ? new Date().toISOString() : null,
      } as any });
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not update.');
    }
  }

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

  // recurringStems no longer needed without the no-deadline group, but
  // we keep the templates dependency stable.
  void useMemo(() => new Set(templates.map(t => stem(t.exampleTitle)).filter(Boolean)), [templates]);

  const counts = useMemo(() => {
    const backlog = getBacklog(tasks).filter(t => !t.is_rest);
    const missed = getMissed(tasks, today);
    const merged = new Map<string, Task>();
    [...backlog, ...missed].forEach(t => merged.set(t.id, t));
    const action = Array.from(merged.values());
    const scheduled = tasks.filter(t => t.scheduled_date && t.scheduled_date >= today && t.status !== 'done' && !t.is_rest);
    const done = tasks.filter(t => t.status === 'done');
    const all = tasks.filter(t => !t.is_rest);
    return { action, all, backlog, missed, scheduled, done };
  }, [tasks, today]);

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
    return getTaskWarnings(t, today);
  }

  return (
    <AppShell>
      <header className="mb-5 space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Actions</h1>
        <p className="text-muted-foreground text-[15px] w-full">
          Your full list — including unscheduled and missed work.
        </p>
      </header>

      <section aria-label="Filters" className="mb-5 flex items-center gap-2">
        <Select value={group} onValueChange={(v) => setGroup(v as GroupKey)}>
          <SelectTrigger className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUPS.map(({ k, label }) => {
              const n = (counts as any)[k]?.length ?? 0;
              return (
                <SelectItem key={k} value={k}>
                  {label} ({n})
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <Select value={domain} onValueChange={(v) => setDomain(v as DomainFilter)}>
          <SelectTrigger className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DOMAIN_FILTERS.map(({ k, label }) => (
              <SelectItem key={k} value={k}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

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
            const canReschedule = !!t.scheduled_date && t.scheduled_date < today && t.status !== 'done' && !t.is_rest;
            return (
              <li key={t.id} className="space-y-1.5">
                <TaskCard task={t} onOpen={() => nav(`/task/${t.id}`)} onToggleComplete={toggleComplete} />
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
                  {(canSchedule || canReschedule) && (
                    <button
                      onClick={() => setScheduleId(t.id)}
                      className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-2.5 py-0.5 text-[11px] font-medium"
                    >
                      {canReschedule ? <CalendarSync className="w-3 h-3" /> : <CalendarPlus className="w-3 h-3" />}
                      {canReschedule ? 'Reschedule' : 'Schedule'}
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
