import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useTasks, useTaskMutations } from '@/hooks/useTasks';
import { useDailyCapacity } from '@/hooks/useDailyCapacity';
import AppShell from '@/components/AppShell';
import TaskCard from '@/components/TaskCard';
import RescheduleDialog from '@/components/RescheduleDialog';
import RestBlockDialog, { RestBlockInitial } from '@/components/RestBlockDialog';
import DayEnergyPicker from '@/components/DayEnergyPicker';
import CapacityInfoButton from '@/components/CapacityInfoButton';
import { greeting, todayISO, toISODate, Status, STATUS_LABEL, Domain, DOMAIN_LABEL, DOMAIN_COLOR_VAR, fmtMin, formatDeadline } from '@/lib/pace';
import {
  getTodayTasks,
  getTomorrowTasks,
  getMissed,
  getDoneOnDate,
  getRestBlocksForDate,
  getScheduledEvents,
  expandTimeBlocks,
  getTaskRestConflicts,
  effectiveCapacityMinutes,
  capacityState,
  getNoDeadlineHighValue,
  resolveProfileEnergy,
} from '@/lib/scheduling';
import { useTaskSuggestions, stem } from '@/hooks/useTaskSuggestions';
import { toast } from 'sonner';
import { Calendar as CalIcon, Timer, Plus, ArrowRight, Sparkles, Moon, Sun, Coffee, Settings as SettingsIcon, Users, AlertTriangle } from 'lucide-react';

const FILTERS: { k: 'all' | Status; label: string }[] = [
  { k: 'all', label: 'All' },
  { k: 'in_progress', label: STATUS_LABEL.in_progress },
  { k: 'blocked', label: STATUS_LABEL.blocked },
  { k: 'nearly_done', label: STATUS_LABEL.nearly_done },
];

export default function Home() {
  const { user, profile, loading } = useAuth();
  const { profile: userProfile, loading: upLoading } = useUserProfile();
  const nav = useNavigate();
  const { data: tasks = [] } = useTasks();
  const { update } = useTaskMutations();
  // Persist the active task filter in the URL so back-navigation from
  // TaskDetail restores the same view. Only non-default filters are stored.
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFilter = (() => {
    const f = searchParams.get('filter');
    return (f === 'in_progress' || f === 'blocked' || f === 'nearly_done') ? (f as Status) : 'all';
  })();
  const [filter, setFilter] = useState<'all' | Status>(initialFilter);
  // Inline-expand state for stat cards (D.2 / D.3).
  const [showDone, setShowDone] = useState(false);
  const [showTomorrow, setShowTomorrow] = useState(false);
  const todayStr = todayISO();
  const { data: capacity = null } = useDailyCapacity(todayStr);
  const [focusToday, setFocusToday] = useState<{ count: number; minutes: number }>({ count: 0, minutes: 0 });
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [restEdit, setRestEdit] = useState<RestBlockInitial | null>(null);

  // Sync filter ↔ URL.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (filter === 'all') next.delete('filter');
    else next.set('filter', filter);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);
  useEffect(() => {
    if (!upLoading && user && userProfile && !userProfile.onboarding_completed) {
      nav('/onboarding', { replace: true });
    }
  }, [upLoading, user, userProfile, nav]);

  // Focus session aggregates stay direct: focus_sessions hook is out of scope for this phase.
  useEffect(() => {
    if (!user) return;
    const since = new Date(); since.setHours(0, 0, 0, 0);
    supabase.from('focus_sessions').select('planned_minutes, ended_at')
      .gte('started_at', since.toISOString())
      .then(({ data }) => {
        const list = data ?? [];
        setFocusToday({ count: list.length, minutes: list.reduce((s, x: any) => s + (x.planned_minutes || 0), 0) });
      });
  }, [user, tasks]);

  const tomorrowStr = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return toISODate(d);
  }, []);
  const missed = useMemo(() => getMissed(tasks, todayStr), [tasks, todayStr]);
  const doneToday = useMemo(() => getDoneOnDate(tasks, todayStr), [tasks, todayStr]);
  const tomorrowTasks = useMemo(() => getTomorrowTasks(tasks, tomorrowStr), [tasks, tomorrowStr]);
  const tomorrowCount = tomorrowTasks.length;

  async function nudge(id: string, kind: 'reschedule' | 'block' | 'later') {
    if (kind === 'reschedule') { setRescheduleId(id); return; }
    const t = missed.find(x => x.id === id); if (!t) return;
    if (kind === 'later') {
      await update.mutateAsync({ id, patch: {
        scheduled_date: null,
        start_time: null,
        end_time: null,
        status: 'not_started',
      } as any });
      toast.success('Moved to Later.');
    } else {
      await update.mutateAsync({ id, patch: { status: 'blocked' } as any });
      toast.success('Marked as blocked. Not your fault.');
    }
  }

  function daysOverdue(scheduledDate: string | null): number {
    if (!scheduledDate) return 0;
    const today = new Date(todayStr + 'T00:00:00');
    const sched = new Date(scheduledDate + 'T00:00:00');
    const diff = Math.floor((today.getTime() - sched.getTime()) / 86400000);
    return Math.max(0, diff);
  }

  const today = new Date();
  const dateStr = today.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

  const todayTasks = useMemo(() => getTodayTasks(tasks, todayStr), [tasks, todayStr]);
  const restBlocks = useMemo(() => getRestBlocksForDate(tasks, todayStr), [tasks, todayStr]);

  // Unified rest agenda for today: one-time rest tasks + recurring fixed
  // blocks from the user's profile (sleep/meal/recovery/custom). Sorted by
  // start time so the user sees when each protected block falls.
  const todayRestItems = useMemo(() => {
    const toMin = (s?: string | null) => {
      if (!s) return null;
      const [h, m] = s.split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    const fmtT = (min: number) => {
      const h = Math.floor(min / 60), m = min % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };
    const fmtRange = (s: number | null, e: number | null) =>
      s == null || e == null ? '' : `${fmtT(s)} – ${fmtT(e)}`;

    const items: Array<{ key: string; title: string; range: string; startMin: number; note?: string | null }> = [];

    // One-time rest tasks
    restBlocks.forEach((t: any) => {
      const s = toMin(t.start_time);
      const e = toMin(t.end_time);
      items.push({
        key: `rest-${t.id}`,
        title: t.title,
        range: fmtRange(s, e),
        startMin: s ?? Number.POSITIVE_INFINITY,
        note: t.next_action,
      });
    });

    // Recurring fixed blocks from profile
    const blocks = (userProfile?.default_time_blocks ?? []).map((b: any) => ({
      label: b.label, start: b.start, end: b.end, kind: b.kind, days: b.days,
    }));
    expandTimeBlocks(blocks, todayStr).forEach((ev, i) => {
      items.push({
        key: `fix-${i}-${ev.startMin}`,
        title: ev.title,
        range: fmtRange(ev.startMin, ev.endMin),
        startMin: ev.startMin,
      });
    });

    return items.sort((a, b) => a.startMin - b.startMin);
  }, [restBlocks, userProfile, todayStr]);

  const real = todayTasks;
  const filtered = filter === 'all' ? real : real.filter(t => t.status === filter);

  // Conflict detection: build today's full event picture (tasks + protected
  // time blocks from the user profile) and ask the shared helper which task
  // event ids overlap rest. Use the *unfiltered* event set so a hidden filter
  // never makes a real conflict invisible.
  const conflictTaskIds = useMemo(() => {
    const taskEvents = getScheduledEvents(tasks).filter(e => e.date === todayStr);
    const blocks = (userProfile?.default_time_blocks ?? []).map(b => ({
      label: b.label, start: b.start, end: b.end, kind: b.kind as any, days: b.days,
    }));
    const blockEvents = expandTimeBlocks(blocks, todayStr);
    const all = [...taskEvents, ...blockEvents];
    const ids = getTaskRestConflicts(all);
    // Map conflicting event ids back to task ids via the typed taskId field
    // on the event, so we don't depend on the "task-" id prefix format.
    const byId = new Map(all.map(e => [e.id, e] as const));
    const out = new Set<string>();
    ids.forEach(id => {
      const ev = byId.get(id);
      if (ev?.taskId) out.add(ev.taskId);
    });
    return out;
  }, [tasks, userProfile, todayStr]);

  // Important without a deadline (recurring or must-priority).
  const { templates } = useTaskSuggestions(user?.id);
  const recurringStems = useMemo(
    () => new Set(templates.map(t => stem(t.exampleTitle)).filter(Boolean)),
    [templates],
  );
  const noDeadlineHighValue = useMemo(
    () => getNoDeadlineHighValue(tasks, recurringStems, stem),
    [tasks, recurringStems],
  );

  // Capacity math — daily override (daily_capacity row) takes precedence,
  // otherwise fall back to the user's profile default capacity + typical
  // energy pattern so changes in Settings/Onboarding immediately reflect here.
  // For "today" we resolve the period-mode pattern using the current hour so
  // morning/afternoon/evening selections are honored.
  const profileCapMin = userProfile?.daily_capacity_minutes ?? 330;
  const nowHour = new Date().getHours();
  const profileEnergy = resolveProfileEnergy(userProfile?.energy_pattern, { hour: nowHour });
  // Per-period overrides on the daily_capacity row (set in Plan) take
  // precedence over the daily energy_level for the current period.
  const periodKey = nowHour < 12 ? 'morning_energy' : nowHour < 17 ? 'afternoon_energy' : 'evening_energy';
  const periodOverride = (capacity as any)?.[periodKey] as string | null | undefined;
  const effectiveOverride = capacity
    ? { available_hours: Number(capacity.available_hours), energy_level: periodOverride ?? capacity.energy_level ?? profileEnergy }
    : { available_hours: profileCapMin / 60, energy_level: profileEnergy };
  const capMin = effectiveCapacityMinutes(
    effectiveOverride,
    profileCapMin,
    { affects: userProfile?.energy_affects_capacity ?? true, pct: userProfile?.energy_capacity_pct ?? 10 },
  );
  const plannedMin = real.reduce((s, t) => s + (t.duration_minutes || 0), 0)
    + doneToday.reduce((s, t) => s + (t.duration_minutes || 0), 0);
  const capState = capacityState(plannedMin, capMin);
  const ratio = plannedMin / Math.max(1, capMin);
  const energy = periodOverride ?? capacity?.energy_level ?? profileEnergy;
  const capLabel = capState === 'over' ? 'Over capacity' : capState === 'close' ? 'Close to capacity' : 'Balanced';
  const capChipClass = capState === 'over'
    ? 'bg-[hsl(var(--attention)/0.18)] text-[hsl(var(--attention))]'
    : capState === 'close'
    ? 'bg-[hsl(var(--warning)/0.22)] text-[hsl(206_7%_20%)]'
    : 'bg-[hsl(var(--success)/0.18)] text-[hsl(var(--success))]';

  // Domain breakdown
  const domainCounts = useMemo(() => {
    const m: Record<string, number> = {};
    real.forEach(t => { const d = t.domain || 'personal'; m[d] = (m[d] || 0) + 1; });
    return m;
  }, [real]);

  // Heaviest action today (by duration, falling back to Heavy effort or first).
  // Used by the proactive overload prompt to suggest something to move.
  const heaviestToday = useMemo(() => {
    if (!real.length) return null;
    const sorted = [...real].sort((a, b) =>
      (b.duration_minutes ?? 0) - (a.duration_minutes ?? 0));
    return sorted.find(t => (t.duration_minutes ?? 0) > 0)
      ?? sorted.find(t => t.effort_level === 'Heavy')
      ?? sorted[0];
  }, [real]);

  // Backlog (unscheduled actions) for the inline "schedule from backlog" shortcut
  // migrated from the deprecated /plan screen.
  const backlog = useMemo(
    () => tasks.filter(t => !t.scheduled_date && t.status !== 'done').slice(0, 5),
    [tasks],
  );

  async function scheduleFromBacklog(taskId: string, when: 'today' | 'tomorrow') {
    const date = new Date();
    if (when === 'tomorrow') date.setDate(date.getDate() + 1);
    const iso = toISODate(date);
    try {
      await update.mutateAsync({ id: taskId, patch: { scheduled_date: iso } as any });
      toast.success(when === 'today' ? 'Added to today.' : 'Scheduled for tomorrow.');
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not schedule.');
    }
  }

  // Next up: prefer in_progress, else nearest
  const nextUp = useMemo(() => {
    const inProg = real.find(t => t.status === 'in_progress');
    if (inProg) return inProg;
    return [...real].sort((a, b) => {
      const ap = a.priority === 'must' ? 0 : a.priority === 'should' ? 1 : 2;
      const bp = b.priority === 'must' ? 0 : b.priority === 'should' ? 1 : 2;
      if (ap !== bp) return ap - bp;
      // Within a priority, prefer the soonest deadline. Tasks without a
      // deadline sort after tasks that have one.
      const ad = a.deadline ? Date.parse(a.deadline) : Number.POSITIVE_INFINITY;
      const bd = b.deadline ? Date.parse(b.deadline) : Number.POSITIVE_INFINITY;
      return ad - bd;
    })[0];
  }, [real]);

  const totalToday = real.length + doneToday.length;
  const completionPct = totalToday === 0 ? 0 : Math.round((doneToday.length / totalToday) * 100);

  // Up next rest block (smart hint)
  const restHint = useMemo(() => {
    if (!restBlocks.length) return null;
    const titles = restBlocks.map((r: any) => r.title.toLowerCase());
    if (titles.some((t: string) => t.includes('sleep'))) return { icon: Moon, label: 'Sleep is protected tonight' };
    if (titles.some((t: string) => t.includes('walk') || t.includes('recovery'))) return { icon: Sun, label: 'Recovery time is set aside' };
    return { icon: Coffee, label: `${restBlocks.length} rest ${restBlocks.length === 1 ? 'block' : 'blocks'} planned` };
  }, [restBlocks]);

  return (
    <AppShell>
      {/* Greeting */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="pace-eyebrow">{dateStr}</div>
          <h1 className="pace-screen-title mt-1">{greeting()}, {profile?.display_name ?? 'friend'}</h1>
        </div>
        <button onClick={() => nav('/settings')} aria-label="Settings"
          className="shrink-0 rounded-full p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition">
          <SettingsIcon className="w-5 h-5" />
        </button>
      </div>
      <p className="pace-meta mt-1">
        {real.length === 0
          ? 'A clear day. Add an action when you are ready.'
          : `${real.length} ${real.length === 1 ? 'thing' : 'things'} planned · ${fmtMin(plannedMin) || '—'} of work`}
      </p>

      {/* Capacity dashboard card */}
      <div className="pace-card mt-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="pace-eyebrow">Today's capacity</div>
            <div className="pace-title mt-0.5">{fmtMin(plannedMin) || '0m'} <span className="text-muted-foreground text-[14px] font-normal">of {fmtMin(capMin)}</span></div>
          </div>
          <div className="flex items-center gap-1">
            {capState !== 'over' && (
              <span className={`rounded-full px-3 py-1 text-[11px] font-medium ${capChipClass}`}>{capLabel}</span>
            )}
            <CapacityInfoButton />
          </div>
        </div>
        <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              capState === 'over' ? 'bg-[hsl(var(--attention))]' : capState === 'close' ? 'bg-[hsl(var(--warning))]' : 'bg-[hsl(var(--success))]'
            }`}
            style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
          />
        </div>
        <div className="mt-2 pace-meta flex items-center justify-between">
          <DayEnergyPicker
            date={todayStr}
            current={energy}
            availableHours={capMin / 60}
            size="sm"
          />
          <button onClick={() => nav('/workload')} className="text-[12px] font-medium text-primary inline-flex items-center gap-1">
            Workload <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Proactive overload prompt — replaces the passive "Over capacity" chip
          when today is over. Migrated from the deprecated /plan screen. */}
      {capState === 'over' && (
        <div className="pace-alert mt-3 animate-fade-in">
          <div className="pace-eyebrow mb-1">
            <span className="priority-dot should" />Your plan may need adjustment
          </div>
          <div className="text-[13px]">
            You are {fmtMin(plannedMin - capMin)} over capacity. Want to move an
            action, shorten one, or split it across two days?
          </div>
          {heaviestToday && (
            <div className="mt-2 flex gap-1.5 flex-wrap">
              <button
                onClick={() => setRescheduleId(heaviestToday.id)}
                className="pace-btn-primary pace-btn-sm">
                Move "{heaviestToday.title.slice(0, 28)}"
              </button>
            </div>
          )}
        </div>
      )}

      {/* Quick stats — Done & Tomorrow expand inline; Focus jumps to /focus. */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button
          onClick={() => { setShowDone(s => !s); if (!showDone) setShowTomorrow(false); }}
          aria-expanded={showDone}
          className={`pace-card !p-3 text-left transition ${showDone ? 'ring-1 ring-primary/40' : ''}`}>
          <div className="pace-eyebrow">Done</div>
          <div className="text-[20px] font-semibold mt-0.5">{doneToday.length}</div>
          <div className="pace-meta">{completionPct}% of today</div>
        </button>
        <button onClick={() => nav('/focus')} className="pace-card !p-3 text-left">
          <div className="pace-eyebrow">Focus</div>
          <div className="text-[20px] font-semibold mt-0.5">{focusToday.count}</div>
          <div className="pace-meta">{fmtMin(focusToday.minutes) || '0m'}</div>
        </button>
        <button
          onClick={() => { setShowTomorrow(s => !s); if (!showTomorrow) setShowDone(false); }}
          aria-expanded={showTomorrow}
          className={`pace-card !p-3 text-left transition ${showTomorrow ? 'ring-1 ring-primary/40' : ''}`}>
          <div className="pace-eyebrow">Tomorrow</div>
          <div className="text-[20px] font-semibold mt-0.5">{tomorrowCount}</div>
          <div className="pace-meta">{tomorrowCount === 1 ? 'item' : 'items'}</div>
        </button>
      </div>

      {/* Inline expansion: today's completed tasks. */}
      {showDone && (
        <div className="mt-3 pace-card animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="pace-eyebrow">Done today</div>
            <button onClick={() => setShowDone(false)} className="text-[12px] text-muted-foreground">Hide</button>
          </div>
          {doneToday.length === 0 ? (
            <div className="mt-2 text-[13px] text-muted-foreground">Nothing finished yet today.</div>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {doneToday.map(t => {
                const dom = (t.domain || 'personal') as Domain;
                const completedAt = t.completed_at
                  ? new Date(t.completed_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                  : null;
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => nav(`/task/${t.id}`)}
                      className="w-full text-left flex items-center gap-2 px-1 py-1 rounded-lg hover:bg-muted/40">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: DOMAIN_COLOR_VAR[dom] }} />
                      <span className="text-[14px] line-through text-muted-foreground truncate">{t.title}</span>
                      {completedAt && <span className="ml-auto text-[11px] text-muted-foreground shrink-0">{completedAt}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Inline expansion: tomorrow's planned tasks, sorted by priority. */}
      {showTomorrow && (
        <div className="mt-3 pace-card animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="pace-eyebrow">Tomorrow</div>
            <button onClick={() => setShowTomorrow(false)} className="text-[12px] text-muted-foreground">Hide</button>
          </div>
          {tomorrowTasks.length === 0 ? (
            <div className="mt-2 text-[13px] text-muted-foreground">Nothing planned for tomorrow yet.</div>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {[...tomorrowTasks]
                .sort((a, b) => {
                  const ap = a.priority === 'must' ? 0 : a.priority === 'should' ? 1 : 2;
                  const bp = b.priority === 'must' ? 0 : b.priority === 'should' ? 1 : 2;
                  return ap - bp;
                })
                .map(t => {
                  const dom = (t.domain || 'personal') as Domain;
                  return (
                    <li key={t.id}>
                      <button
                        onClick={() => nav(`/task/${t.id}`)}
                        className="w-full text-left flex items-center gap-2 px-1 py-1 rounded-lg hover:bg-muted/40">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: DOMAIN_COLOR_VAR[dom] }} />
                        <span className="text-[14px] truncate">{t.title}</span>
                        {t.duration_minutes != null && (
                          <span className="ml-auto text-[11px] text-muted-foreground shrink-0">{fmtMin(t.duration_minutes)}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
            </ul>
          )}
          <button
            onClick={() => nav(`/calendar?view=day&date=${tomorrowStr}`)}
            className="mt-3 text-[12px] font-medium text-primary inline-flex items-center gap-1">
            View in calendar <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Up next */}
      {nextUp && (
        <div className="pace-card mt-3">
          <div className="flex items-center justify-between">
            <div className="pace-eyebrow inline-flex items-center gap-1.5"><Sparkles className="w-3 h-3" /> Up next</div>
            <span className="pace-meta">{formatDeadline(nextUp.deadline)}</span>
          </div>
          <div className="mt-1.5 flex items-start gap-2">
            <span className="w-1 self-stretch rounded-full" style={{ background: DOMAIN_COLOR_VAR[(nextUp.domain || 'personal') as Domain] }} />
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-medium leading-snug truncate">{nextUp.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                {nextUp.domain && <span>{DOMAIN_LABEL[nextUp.domain as Domain]}</span>}
                {nextUp.duration_minutes != null && <span>· {fmtMin(nextUp.duration_minutes)}</span>}
                {nextUp.next_action && <span>· {nextUp.next_action}</span>}
                {(nextUp.involves_others || nextUp.others_rely) && (
                  <span className="inline-flex items-center gap-1">
                    · <Users className="w-3 h-3" /> {nextUp.others_rely ? 'Others rely' : 'Involves others'}
                  </span>
                )}
                {conflictTaskIds.has(nextUp.id) && (
                  <span className="inline-flex items-center gap-1 text-[hsl(var(--attention))]">
                    · <AlertTriangle className="w-3 h-3" /> overlaps rest
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => nav('/focus', { state: { taskId: nextUp.id, minutes: 25 } })} className="pace-btn-primary pace-btn-sm">
              <Timer className="w-3.5 h-3.5" /> Start focus
            </button>
            <button onClick={() => nav(`/task/${nextUp.id}`)} className="pace-btn pace-btn-sm">Open</button>
          </div>
        </div>
      )}

      {/* Important without a deadline */}
      {noDeadlineHighValue.length > 0 && (
        <button
          onClick={() => nav('/tasks?group=no_deadline')}
          className="pace-card-soft mt-3 w-full text-left flex items-center justify-between gap-2"
        >
          <span className="text-[13px]">
            <span className="pace-eyebrow inline-flex items-center gap-1.5 mr-2"><span className="priority-dot must" />Important without a deadline</span>
            {noDeadlineHighValue.length} {noDeadlineHighValue.length === 1 ? 'action' : 'actions'} worth a slot this week.
          </span>
          <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>
      )}

      {/* Domain breakdown */}
      {real.length > 0 && (
        <div className="mt-3 flex gap-1.5 flex-wrap">
          {(Object.keys(domainCounts) as Array<Domain>).map(d => (
            <span key={d} className="pace-chip">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: DOMAIN_COLOR_VAR[d] }} />
              {DOMAIN_LABEL[d] ?? d} · {domainCounts[d]}
            </span>
          ))}
          {restHint && (
            <span className="pace-chip">
              <restHint.icon className="w-3 h-3" /> {restHint.label}
            </span>
          )}
        </div>
      )}

      {/* Quick actions — taller tiles with subtitles so they read as
          distinct primary actions rather than identical text buttons. */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => nav('/capture')}
          className="rounded-2xl px-4 py-3.5 bg-primary text-primary-foreground shadow-sm hover:shadow transition flex items-center gap-3 text-left">
          <span className="w-9 h-9 rounded-xl bg-primary-foreground/20 flex items-center justify-center shrink-0">
            <Plus className="w-4 h-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold leading-tight">New action</span>
            <span className="block text-[11px] opacity-80 leading-tight mt-0.5">Quick capture</span>
          </span>
        </button>
        <button
          onClick={() => setRestEdit({ date: todayStr, startTime: '12:00', endTime: '12:30', label: 'Rest' })}
          className="rounded-2xl px-4 py-3.5 bg-secondary text-secondary-foreground shadow-sm hover:shadow transition flex items-center gap-3 text-left">
          <span className="w-9 h-9 rounded-xl bg-foreground/10 flex items-center justify-center shrink-0">
            <Moon className="w-4 h-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold leading-tight">Add rest block</span>
            <span className="block text-[11px] opacity-70 leading-tight mt-0.5">Just for today</span>
          </span>
        </button>
        <button
          onClick={() => nav('/calendar')}
          className="col-span-2 rounded-2xl px-4 py-3 bg-muted text-foreground shadow-sm hover:shadow transition flex items-center gap-3 text-left">
          <span className="w-9 h-9 rounded-xl bg-foreground/10 flex items-center justify-center shrink-0">
            <CalIcon className="w-4 h-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold leading-tight">Calendar</span>
            <span className="block text-[11px] opacity-70 leading-tight mt-0.5">Week & month</span>
          </span>
        </button>
      </div>

      {/* Needs attention */}
      {missed.length > 0 && (
        <div className="mt-6 space-y-2.5">
          <div>
            <div className="text-[16px] font-semibold">That's OK -  let's figure out the next step.</div>
            <div className="text-[13px] text-muted-foreground mt-0.5">Pick what feels right for now.</div>
          </div>
          {missed.slice(0, 3).map(t => {
            const overdue = daysOverdue(t.scheduled_date ?? null);
            const moved = t.reschedule_count ?? 0;
            const heavyMoved = moved >= 2;
            return (
              <div key={t.id} className="pace-alert animate-fade-in">
                <div className="text-[14px] font-medium">{t.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
                  {overdue > 0 && <span>{overdue} {overdue === 1 ? 'day' : 'days'} overdue</span>}
                  {moved > 0 && <span>· Rescheduled {moved}×</span>}
                </div>
                {t.others_rely && (
                  <div className="mt-1 text-[12px] inline-flex items-center gap-1 text-[hsl(var(--attention))]">
                    <Users className="w-3 h-3" /> Others are depending on this.
                  </div>
                )}
                {heavyMoved && (
                  <div className="mt-1.5 text-[13px]">
                    This has moved a few times. A tiny version often unsticks it.
                  </div>
                )}
                {!heavyMoved && (
                  <div className="text-[13px] mt-1">Pick what feels right for now.</div>
                )}
                <div className="mt-2 flex gap-1.5 flex-wrap">
                  <button onClick={() => nudge(t.id, 'reschedule')} className="pace-btn-primary pace-btn-sm">Reschedule</button>
                  <button onClick={() => nudge(t.id, 'block')} className="pace-btn pace-btn-sm">Mark as blocked</button>
                  <button onClick={() => nudge(t.id, 'later')} className="pace-btn pace-btn-sm">Move to Later</button>
                </div>
              </div>
            );
          })}
          {missed.length > 3 && (
            <div className="text-[12px] text-muted-foreground text-center">+{missed.length - 3} more need attention</div>
          )}
        </div>
      )}

      {/* Today list */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-[18px] font-semibold">Today</h2>
        <span className="pace-meta">{filtered.length} shown</span>
      </div>

      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {FILTERS.map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)}
            className={filter === f.k ? 'pace-chip-selected shrink-0' : 'pace-chip shrink-0'}>{f.label}</button>
        ))}
      </div>

      <div className="mt-3 space-y-2.5">
        {filtered.length === 0 && todayRestItems.length === 0 && (
          <div className="pace-card-soft text-sm text-muted-foreground">
            Nothing on today's list. Tap <span className="font-semibold text-foreground">New action</span> above to add something — title is the only thing required.
          </div>
        )}

        {filtered.map((t) => (
          <div key={t.id} className="space-y-1">
            {conflictTaskIds.has(t.id) && (
              <div className="flex items-center gap-1.5 text-[12px] text-[hsl(var(--attention))] px-1">
                <AlertTriangle className="w-3 h-3" /> overlaps rest
              </div>
            )}
            <TaskCard task={t} onOpen={(task) => nav(`/task/${task.id}`)} />
          </div>
        ))}

        {/* Rest blocks stay visible no matter which status filter is active.
            Includes both one-time rest tasks and recurring protected time
            blocks from the user's profile, sorted by start time. */}
        {todayRestItems.map(r => (
          <div key={r.key} className="pace-rest">
            <span className="inline-flex items-center gap-2 min-w-0">
              <span className="shrink-0">◯</span>
              <span className="truncate">{r.title}</span>
            </span>
            <span className="text-[12px] text-muted-foreground whitespace-nowrap">
              {r.range || r.note || ''}
            </span>
          </div>
        ))}

        {doneToday.length > 0 && (
          <div className="pace-card-soft mt-4 text-[12px] text-muted-foreground">
            ✓ {doneToday.length} {doneToday.length === 1 ? 'thing done' : 'things done'} today. Nice pacing.
          </div>
        )}
      </div>

      {/* Backlog — schedule-from-backlog shortcut migrated from /plan. */}
      {backlog.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] font-semibold">Later</h2>
            <span className="pace-meta">{backlog.length} unscheduled</span>
          </div>
          <div className="mt-2 space-y-2">
            {backlog.map(t => (
              <div key={t.id} className="pace-card">
                <button onClick={() => nav(`/task/${t.id}`)} className="w-full text-left">
                  <div className="text-[14px] font-medium leading-snug truncate">{t.title}</div>
                  <div className="text-[12px] mt-0.5 text-muted-foreground">
                    {t.duration_minutes ? fmtMin(t.duration_minutes) : 'No estimate'}
                    {t.effort_level ? ` · ${t.effort_level}` : ''}
                    {t.deadline ? ` · ${formatDeadline(t.deadline)}` : ''}
                  </div>
                </button>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => scheduleFromBacklog(t.id, 'today')} className="pace-btn-primary pace-btn-sm">
                    <CalIcon className="w-3.5 h-3.5" /> Today
                  </button>
                  <button onClick={() => scheduleFromBacklog(t.id, 'tomorrow')} className="pace-btn pace-btn-sm">
                    Tomorrow
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <RescheduleDialog
        taskId={rescheduleId}
        open={!!rescheduleId}
        onClose={() => setRescheduleId(null)}
      />
      <RestBlockDialog
        open={!!restEdit}
        initial={restEdit}
        onClose={() => setRestEdit(null)}
      />
    </AppShell>
  );
}
