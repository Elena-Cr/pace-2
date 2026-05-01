import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Users, AlertTriangle, Timer, X, MoveRight } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile, TimeBlock } from '@/hooks/useUserProfile';
import { useTasks, useTaskMutations } from '@/hooks/useTasks';
import { useDailyCapacityRange } from '@/hooks/useDailyCapacity';
import { Domain, DOMAIN_LABEL, Status, STATUS_LABEL, fmtMin, REPLAN_REASON_LABEL, ReplanReason, toISODate } from '@/lib/pace';
import type { Task } from '@/lib/scheduling';
import { getScheduledEvents, effectiveCapacityMinutes, capacityState } from '@/lib/scheduling';
import { toast } from 'sonner';

function timeStrToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

type CalKind = 'task' | 'rest' | 'meal' | 'sleep' | 'recovery' | 'focus';

type CalEvent = {
  id: string;
  title: string;
  domain: Domain | 'rest';
  kind: CalKind;
  status?: Status;
  next_action?: string | null;
  duration_minutes?: number | null;
  effort_level?: string | null;
  energy?: string | null;
  notes?: string | null;
  others_rely?: boolean;
  // time
  day: number;        // 0..6 (week index)
  startMin: number;   // minutes from 00:00
  endMin: number;
  // backing
  taskId?: string;
  fixed?: boolean;    // sleep/meal/recovery aren't tasks
};

const HOUR_PX = 56;
const START_HOUR = 6;
const END_HOUR = 24; // exclusive
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function startOfWeek(d: Date) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - dow);
  return x;
}
function fmtTime(min: number) {
  const h = Math.floor(min / 60); const m = min % 60;
  const am = h < 12; const hh = ((h + 11) % 12) + 1;
  return `${hh}${m ? ':' + String(m).padStart(2, '0') : ''}${am ? 'a' : 'p'}`;
}
function fmtRange(s: number, e: number) { return `${fmtTime(s)} – ${fmtTime(e)}`; }

// Sample non-task blocks repeated each weekday
const FIXED_BLOCKS: Array<Omit<CalEvent, 'id' | 'day'>> = [
  { title: 'Sleep', domain: 'rest', kind: 'sleep', startMin: 0, endMin: 7 * 60 + 30, fixed: true },
  { title: 'Breakfast', domain: 'rest', kind: 'meal', startMin: 8 * 60, endMin: 8 * 60 + 30, fixed: true },
  { title: 'Lunch', domain: 'rest', kind: 'meal', startMin: 12 * 60 + 30, endMin: 13 * 60, fixed: true },
  { title: 'Recovery walk', domain: 'rest', kind: 'recovery', startMin: 17 * 60, endMin: 17 * 60 + 30, fixed: true },
  { title: 'Dinner', domain: 'rest', kind: 'meal', startMin: 19 * 60, endMin: 19 * 60 + 30, fixed: true },
  { title: 'Sleep', domain: 'rest', kind: 'sleep', startMin: 23 * 60 + 30, endMin: 24 * 60, fixed: true },
];

function domainClass(domain: Domain | 'rest') {
  // soft tinted background + colored left bar
  switch (domain) {
    case 'academic': return { bg: 'bg-[hsl(var(--domain-academic)/0.14)]', bar: 'bg-[hsl(var(--domain-academic))]', text: 'text-[hsl(var(--domain-academic))]' };
    case 'work':     return { bg: 'bg-[hsl(var(--domain-work)/0.16)]',     bar: 'bg-[hsl(var(--domain-work))]',     text: 'text-[hsl(var(--domain-work))]' };
    case 'social':   return { bg: 'bg-[hsl(var(--domain-social)/0.18)]',   bar: 'bg-[hsl(var(--domain-social))]',   text: 'text-[hsl(206_7%_20%)]' };
    case 'personal': return { bg: 'bg-[hsl(var(--domain-personal)/0.14)]', bar: 'bg-[hsl(var(--domain-personal))]', text: 'text-[hsl(var(--domain-personal))]' };
    case 'rest':     return { bg: 'bg-[hsl(var(--domain-rest)/0.55)]',     bar: 'bg-[hsl(var(--domain-rest))]',     text: 'text-[hsl(var(--rest-foreground))]' };
  }
}

const ALL_DOMAINS: Array<Domain | 'rest'> = ['academic', 'work', 'social', 'personal', 'rest'];

export default function CalendarView() {
  const { user, loading } = useAuth();
  const { profile: userProfile } = useUserProfile();
  const { data: allTasks = [] } = useTasks();
  const { update, insert } = useTaskMutations();
  const nav = useNavigate();
  const [view, setView] = useState<'day' | 'week' | 'month'>('week');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [dayIdx, setDayIdx] = useState(() => (new Date().getDay() + 6) % 7);
  const [monthAnchor, setMonthAnchor] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });
  const [filter, setFilter] = useState<Set<Domain | 'rest'>>(new Set(ALL_DOMAINS));
  const [showCompleted, setShowCompleted] = useState(false);
  const [open, setOpen] = useState<CalEvent | null>(null);
  const [replanFor, setReplanFor] = useState<{ taskId: string; title: string } | null>(null);
  const [drag, setDrag] = useState<{ id: string } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Build the per-day fixed blocks from the user's preferences (sleep/meal/recovery).
  // If a sleep block crosses midnight (e.g. 23:30 → 07:30), split it visually
  // into "evening" + "morning" segments so it renders correctly on a 0–24h grid.
  const fixedBlocks: Array<Omit<CalEvent, 'id' | 'day'>> = useMemo(() => {
    const tb: TimeBlock[] = userProfile?.default_time_blocks ?? [];
    if (!tb.length) return FIXED_BLOCKS; // sane defaults until profile loads
    const out: Array<Omit<CalEvent, 'id' | 'day'>> = [];
    tb.forEach(b => {
      const s = timeStrToMin(b.start);
      const e = timeStrToMin(b.end);
      const base = { title: b.label, domain: 'rest' as const, kind: b.kind as CalKind, fixed: true };
      if (e > s) {
        out.push({ ...base, startMin: s, endMin: e });
      } else {
        // wraps midnight
        out.push({ ...base, startMin: s, endMin: 24 * 60 });
        if (e > 0) out.push({ ...base, startMin: 0, endMin: e });
      }
    });
    return out;
  }, [userProfile]);


  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + i); return d;
  }), [weekStart]);

  const weekRange = useMemo(() => {
    const start = toISODate(days[0]);
    const end = new Date(days[6]); end.setDate(end.getDate() + 1);
    return { start, endExclusive: toISODate(end) };
  }, [days]);

  const tasks = useMemo<Task[]>(
    () => allTasks.filter(t => t.scheduled_date && t.scheduled_date >= weekRange.start && t.scheduled_date < weekRange.endExclusive),
    [allTasks, weekRange],
  );

  const { data: capacities = {} } = useDailyCapacityRange(weekRange.start, weekRange.endExclusive);

  // Month grid range (Mon-start, 6 rows = 42 days)
  const monthGrid = useMemo(() => {
    const first = new Date(monthAnchor);
    const gridStart = startOfWeek(first);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart); d.setDate(d.getDate() + i); return d;
    });
  }, [monthAnchor]);

  const monthTasks = useMemo<Task[]>(() => {
    if (view !== 'month') return [];
    const start = toISODate(monthGrid[0]);
    const end = new Date(monthGrid[41]); end.setDate(end.getDate() + 1);
    const endIso = toISODate(end);
    return allTasks.filter(t => t.scheduled_date && t.scheduled_date >= start && t.scheduled_date < endIso);
  }, [allTasks, monthGrid, view]);

  // Build events: tasks scheduled this week + fixed rest/meal/sleep blocks per day.
  // Task placement (incl. start_time / end_time) comes from the shared helper so
  // Calendar agrees with Home, Plan, and Workload.
  const events: CalEvent[] = useMemo(() => {
    const list: CalEvent[] = [];
    days.forEach((d, di) => {
      fixedBlocks.forEach((b, bi) => list.push({ ...b, id: `fix-${di}-${bi}`, day: di }));
    });
    const taskById = new Map(tasks.map(t => [t.id, t] as const));
    const dayByDate = new Map(days.map((d, i) => [toISODate(d), i] as const));
    getScheduledEvents(tasks).forEach(ev => {
      const di = ev.taskId ? dayByDate.get(ev.date) : undefined;
      if (di === undefined || di < 0) return;
      const t = ev.taskId ? taskById.get(ev.taskId) : undefined;
      if (!t) return;
      list.push({
        id: ev.id,
        taskId: t.id,
        title: ev.title,
        domain: ev.domain,
        kind: ev.kind,
        status: ev.status,
        next_action: t.next_action,
        duration_minutes: t.duration_minutes,
        effort_level: t.effort_level,
        energy: t.energy,
        notes: t.notes,
        others_rely: t.others_rely,
        day: di,
        startMin: ev.startMin,
        endMin: ev.endMin,
      });
    });
    return list;
  }, [tasks, days, fixedBlocks]);

  // Compute per-day workload + conflicts
  const daySummary = days.map((d, di) => {
    const date = toISODate(d);
    const cap = capacities[date];
    const profileCapMin = userProfile?.daily_capacity_minutes ?? 330;
    const capMin = effectiveCapacityMinutes(
      cap ? { available_hours: Number(cap.available_hours), energy_level: cap.energy_level ?? 'Med' } : null,
      profileCapMin,
    );
    const availH = capMin / 60;
    const energy = cap?.energy_level ?? 'Med';
    const taskEvents = events.filter(e => e.day === di && e.kind === 'task');
    const planned = taskEvents.reduce((s, e) => s + (e.endMin - e.startMin), 0);
    const restEvents = events.filter(e => e.day === di && e.kind !== 'task');
    // conflicts: any task overlapping a fixed (rest/meal/sleep) block
    const conflictIds = new Set<string>();
    taskEvents.forEach(t => {
      restEvents.forEach(r => {
        if (t.startMin < r.endMin && t.endMin > r.startMin) conflictIds.add(t.id);
      });
    });
    const state = capacityState(planned, capMin);
    return { date, availH, energy, capMin, planned, conflictIds, state };
  });

  const visibleEvents = events.filter(e => {
    if (!filter.has(e.domain)) return false;
    if (!showCompleted && e.status === 'done') return false;
    return true;
  });

  function toggleFilter(d: Domain | 'rest') {
    const next = new Set(filter);
    next.has(d) ? next.delete(d) : next.add(d);
    setFilter(next);
  }

  function shiftWeek(delta: number) {
    const d = new Date(weekStart); d.setDate(d.getDate() + delta * 7); setWeekStart(d);
  }

  // Drag & drop reschedule
  async function handleDrop(targetDay: number) {
    if (!drag) return;
    const ev = events.find(e => e.id === drag.id);
    setDrag(null);
    if (!ev || !ev.taskId || ev.day === targetDay) return;
    const newDate = toISODate(days[targetDay]);
    const t = tasks.find(x => x.id === ev.taskId);
    try {
      await update.mutateAsync({ id: ev.taskId, patch: {
        scheduled_date: newDate,
        reschedule_count: (t?.reschedule_count || 0) + 1,
      } as any });
      setReplanFor({ taskId: ev.taskId, title: ev.title });
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not move.');
    }
  }

  async function setReplanReason(reason: ReplanReason | null) {
    if (!replanFor) return;
    if (reason) await update.mutateAsync({ id: replanFor.taskId, patch: { replanning_reason: reason } as any });
    toast.success('Task moved. Progress preserved.');
    setReplanFor(null);
  }

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayDayIdx = days.findIndex(d => d.toDateString() === new Date().toDateString());

  const visibleDays = view === 'week' ? days.map((_, i) => i) : [dayIdx];
  const totalGridHeight = (END_HOUR - START_HOUR) * HOUR_PX;

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="pace-screen-title">Calendar</h1>
        <div className="flex items-center bg-muted rounded-full p-1 text-[12px] font-medium">
          <button onClick={() => setView('day')} className={`px-3 py-1 rounded-full ${view === 'day' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>Day</button>
          <button onClick={() => setView('week')} className={`px-3 py-1 rounded-full ${view === 'week' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>Week</button>
          <button onClick={() => setView('month')} className={`px-3 py-1 rounded-full ${view === 'month' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>Month</button>
        </div>
      </div>

      {/* Date nav */}
      {view !== 'month' ? (
        <div className="mt-3 flex items-center justify-between">
          <button onClick={() => shiftWeek(-1)} className="p-2 rounded-full hover:bg-muted" aria-label="Previous week"><ChevronLeft className="w-5 h-5" /></button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))} className="pace-chip">
            {days[0].toLocaleDateString([], { month: 'short', day: 'numeric' })} – {days[6].toLocaleDateString([], { month: 'short', day: 'numeric' })}
          </button>
          <button onClick={() => shiftWeek(1)} className="p-2 rounded-full hover:bg-muted" aria-label="Next week"><ChevronRight className="w-5 h-5" /></button>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between">
          <button onClick={() => { const d = new Date(monthAnchor); d.setMonth(d.getMonth() - 1); setMonthAnchor(d); }} className="p-2 rounded-full hover:bg-muted" aria-label="Previous month"><ChevronLeft className="w-5 h-5" /></button>
          <button onClick={() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); setMonthAnchor(d); }} className="pace-chip">
            {monthAnchor.toLocaleDateString([], { month: 'long', year: 'numeric' })}
          </button>
          <button onClick={() => { const d = new Date(monthAnchor); d.setMonth(d.getMonth() + 1); setMonthAnchor(d); }} className="p-2 rounded-full hover:bg-muted" aria-label="Next month"><ChevronRight className="w-5 h-5" /></button>
        </div>
      )}

      {/* Filters */}
      <div className="mt-3 flex gap-1.5 flex-wrap">
        {ALL_DOMAINS.map(d => {
          const on = filter.has(d);
          const dc = domainClass(d);
          const label = d === 'rest' ? 'Rest' : DOMAIN_LABEL[d];
          return (
            <button key={d} onClick={() => toggleFilter(d)}
              className={`pace-chip ${on ? '' : 'opacity-40'}`}>
              <span className={`inline-block w-2 h-2 rounded-full ${dc.bar}`} />
              {label}
            </button>
          );
        })}
        <button onClick={() => setShowCompleted(s => !s)} className={`pace-chip ${showCompleted ? '' : 'opacity-60'}`}>
          {showCompleted ? 'Hide completed' : 'Show completed'}
        </button>
      </div>

      {/* Day picker for day view */}
      {view === 'day' && (
        <div className="mt-3 flex gap-1 overflow-x-auto -mx-1 px-1">
          {days.map((d, i) => {
            const active = i === dayIdx;
            const summary = daySummary[i];
            return (
              <button key={i} onClick={() => setDayIdx(i)}
                className={`shrink-0 px-3 py-2 rounded-2xl text-center min-w-[56px] ${active ? 'bg-primary text-primary-foreground' : 'bg-card border border-border/60'}`}>
                <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{DAYS[i]}</div>
                <div className="text-[15px] font-semibold">{d.getDate()}</div>
                {summary.state !== 'balanced' && (
                  <div className={`mt-0.5 inline-block w-1.5 h-1.5 rounded-full ${summary.state === 'over' ? 'bg-[hsl(var(--attention))]' : 'bg-[hsl(var(--warning))]'}`} />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* === DAY VIEW: to-do list style === */}
      {view === 'day' && (() => {
        const dayEvs = visibleEvents.filter(e => e.day === dayIdx).sort((a, b) => a.startMin - b.startMin);
        const summary = daySummary[dayIdx];
        const stateLabel = summary.state === 'over' ? 'Needs adjustment' : summary.state === 'close' ? 'Close to capacity' : 'Balanced';
        const stateClass = summary.state === 'over' ? 'bg-[hsl(var(--attention)/0.18)] text-[hsl(var(--attention))]' :
                           summary.state === 'close' ? 'bg-[hsl(var(--warning)/0.22)] text-[hsl(206_7%_20%)]' :
                           'bg-[hsl(var(--success)/0.18)] text-[hsl(var(--success))]';
        const taskItems = dayEvs.filter(e => e.kind === 'task' || e.kind === 'focus');
        const restItems = dayEvs.filter(e => e.kind !== 'task' && e.kind !== 'focus');
        const dateObj = days[dayIdx];

        return (
          <div className="mt-4 space-y-4">
            {/* Day summary card */}
            <div className="pace-card">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="pace-eyebrow">{DAYS[dayIdx]}</div>
                  <div className="pace-title mt-0.5">{dateObj.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div>
                </div>
                <div className={`rounded-full px-3 py-1 text-[11px] font-medium ${stateClass}`}>{stateLabel}</div>
              </div>
              <div className="mt-2 pace-meta">{fmtMin(summary.planned)} planned of {fmtMin(summary.capMin)} capacity · {taskItems.length} {taskItems.length === 1 ? 'item' : 'items'}</div>
            </div>

            {/* To-do list */}
            <div>
              <div className="pace-eyebrow mb-2">Your day</div>
              {taskItems.length === 0 ? (
                <div className="pace-card text-center text-[14px] text-muted-foreground">
                  Nothing planned yet. Add an intention below to get started.
                </div>
              ) : (
                <ul className="space-y-2">
                  {taskItems.map(ev => {
                    const dc = domainClass(ev.domain);
                    const conflict = summary.conflictIds.has(ev.id);
                    const done = ev.status === 'done';
                    return (
                      <li key={ev.id}>
                        <button onClick={() => setOpen(ev)}
                          className={`w-full text-left pace-card !p-3 flex items-start gap-3 hover:shadow-sm transition ${done ? 'opacity-60' : ''}`}>
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleDone(ev); }}
                            className={`mt-0.5 w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${done ? 'bg-[hsl(var(--success))] border-[hsl(var(--success))]' : 'border-border'}`}
                            aria-label={done ? 'Mark as not done' : 'Mark complete'}>
                            {done && <span className="text-white text-[10px]">✓</span>}
                          </button>
                          <span className={`w-1 self-stretch rounded-full ${dc.bar} shrink-0`} />
                          <div className="min-w-0 flex-1">
                            <div className={`text-[15px] font-medium leading-snug ${done ? 'line-through' : ''}`}>{ev.title}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                              <span className={`inline-flex items-center gap-1 ${dc.text}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${dc.bar}`} />
                                {ev.domain === 'rest' ? 'Rest' : DOMAIN_LABEL[ev.domain as Domain]}
                              </span>
                              {ev.duration_minutes != null && <span>· {fmtMin(ev.duration_minutes)}</span>}
                              {ev.energy && <span>· {ev.energy} energy</span>}
                              {ev.others_rely && <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> shared</span>}
                              {conflict && <span className="inline-flex items-center gap-1 text-[hsl(var(--attention))]"><AlertTriangle className="w-3 h-3" /> overlaps rest</span>}
                            </div>
                            {ev.next_action && (
                              <div className="mt-1.5 text-[13px] text-muted-foreground">
                                <span className="font-medium text-foreground">Next:</span> {ev.next_action}
                              </div>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Rest & care */}
            {restItems.length > 0 && (
              <div>
                <div className="pace-eyebrow mb-2">Rest & care</div>
                <ul className="space-y-1.5">
                  {restItems.map(ev => {
                    const dc = domainClass(ev.domain);
                    return (
                      <li key={ev.id}>
                        <button onClick={() => setOpen(ev)} className={`w-full text-left rounded-2xl ${dc.bg} border border-border/30 px-3 py-2 flex items-center gap-2`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${dc.bar}`} />
                          <span className="text-[14px] font-medium">{ev.title}</span>
                          <span className="ml-auto text-[12px] text-muted-foreground">{fmtRange(ev.startMin, ev.endMin)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        );
      })()}

      {/* === WEEK VIEW (time grid) === */}
      {view === 'week' && (
      <div className="mt-4 pace-card !p-3 overflow-hidden">
        {/* Day headers + summaries */}
        <div className="flex" style={{ paddingLeft: 36 }}>
          {visibleDays.map(di => {
            const d = days[di];
            const s = daySummary[di];
            const isToday = d.toDateString() === new Date().toDateString();
            const stateLabel = s.state === 'over' ? 'Needs adjustment' : s.state === 'close' ? 'Close to capacity' : 'Balanced';
            const stateClass = s.state === 'over' ? 'bg-[hsl(var(--attention)/0.18)] text-[hsl(var(--attention))]' :
                               s.state === 'close' ? 'bg-[hsl(var(--warning)/0.22)] text-[hsl(206_7%_20%)]' :
                               'bg-[hsl(var(--success)/0.18)] text-[hsl(var(--success))]';
            return (
              <div key={di} className="flex-1 min-w-0 px-1">
                <div className={`text-center ${isToday ? 'text-primary font-semibold' : 'text-foreground'}`}>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{DAYS[di]}</div>
                  <div className="text-[15px] font-semibold">{d.getDate()}</div>
                </div>
                <div className={`mt-1 rounded-lg px-1.5 py-1 text-[10px] text-center ${stateClass}`}>
                  {stateLabel}
                </div>
                <div className="text-[10px] text-muted-foreground text-center mt-0.5">
                  {fmtMin(s.planned)} / {fmtMin(s.capMin)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Time grid */}
        <div ref={gridRef} className="relative mt-2 flex" style={{ height: totalGridHeight }}>
          {/* Hour labels */}
          <div className="w-9 shrink-0 relative">
            {HOURS.map((h, i) => (
              <div key={h} className="absolute left-0 right-0 text-[10px] text-muted-foreground -translate-y-1.5"
                   style={{ top: i * HOUR_PX }}>
                {((h + 11) % 12 + 1)}{h < 12 ? 'a' : 'p'}
              </div>
            ))}
          </div>

          {/* Day columns */}
          <div className="flex-1 flex relative">
            {visibleDays.map(di => {
              const dayEvs = visibleEvents.filter(e => e.day === di);
              const summary = daySummary[di];
              return (
                <div key={di}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(di)}
                  className="flex-1 min-w-0 relative border-l border-border/40">
                  {/* Hour lines + click-to-add */}
                  {HOURS.map((h, i) => (
                    <button key={h}
                      onClick={() => createAt(di, h)}
                      className="absolute left-0 right-0 border-t border-border/30 hover:bg-muted/40 transition"
                      style={{ top: i * HOUR_PX, height: HOUR_PX }}
                      aria-label={`Add at ${h}:00`} />
                  ))}

                  {/* Overbooking ribbon */}
                  {summary.state === 'over' && (
                    <div className="absolute top-0 left-1 right-1 z-20 rounded-md bg-[hsl(var(--attention)/0.18)] text-[hsl(var(--attention))] text-[10px] px-1.5 py-0.5 flex items-center gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" /> Plan may need adjustment
                    </div>
                  )}

                  {/* Events */}
                  {dayEvs.map(ev => {
                    const top = ((ev.startMin - START_HOUR * 60) / 60) * HOUR_PX;
                    const height = Math.max(22, ((ev.endMin - ev.startMin) / 60) * HOUR_PX - 2);
                    const dc = domainClass(ev.domain);
                    const conflict = summary.conflictIds.has(ev.id);
                    const isFixed = !!ev.fixed;
                    return (
                      <button
                        key={ev.id}
                        draggable={!isFixed}
                        onDragStart={() => setDrag({ id: ev.id })}
                        onClick={() => setOpen(ev)}
                        className={`absolute left-0.5 right-0.5 rounded-lg ${dc.bg} text-left p-1.5 overflow-hidden border border-border/30`}
                        style={{ top, height, zIndex: 5 }}>
                        <div className="flex gap-1 items-start">
                          <span className={`w-0.5 self-stretch rounded-full ${dc.bar} shrink-0`} />
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-semibold leading-tight truncate">{ev.title}</div>
                            <div className="text-[9px] text-muted-foreground truncate">{fmtRange(ev.startMin, ev.endMin)}</div>
                            <div className="flex gap-1 mt-0.5 flex-wrap">
                              {ev.others_rely && <Users className="w-2.5 h-2.5 text-muted-foreground" />}
                              {conflict && <AlertTriangle className="w-2.5 h-2.5 text-[hsl(var(--attention))]" aria-label="Conflict with rest" />}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {/* Current time line */}
                  {di === todayDayIdx && nowMin >= START_HOUR * 60 && nowMin <= END_HOUR * 60 && (
                    <div className="absolute left-0 right-0 z-10 pointer-events-none"
                         style={{ top: ((nowMin - START_HOUR * 60) / 60) * HOUR_PX }}>
                      <div className="h-px bg-[hsl(var(--attention))]" />
                      <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-[hsl(var(--attention))]" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      )}

      {/* === MONTH VIEW === */}
      {view === 'month' && (() => {
        const monthIdx = monthAnchor.getMonth();
        const todayStr = new Date().toDateString();
        // group monthTasks by date
        const byDate: Record<string, any[]> = {};
        monthTasks.forEach(t => {
          if (!t.scheduled_date) return;
          if (!showCompleted && t.status === 'done') return;
          const dom = (t.is_rest ? 'rest' : (t.domain || 'personal')) as Domain | 'rest';
          if (!filter.has(dom)) return;
          (byDate[t.scheduled_date] ||= []).push(t);
        });
        return (
          <div className="mt-4 pace-card !p-2">
            <div className="grid grid-cols-7 gap-1 mb-1">
              {DAYS.map(d => <div key={d} className="text-[10px] text-center text-muted-foreground uppercase tracking-wider font-medium py-1">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthGrid.map((d, i) => {
                const inMonth = d.getMonth() === monthIdx;
                const isToday = d.toDateString() === todayStr;
                const dateStr = toISODate(d);
                const items = byDate[dateStr] || [];
                return (
                  <button key={i}
                    onClick={() => { setDayIdx((d.getDay() + 6) % 7); setWeekStart(startOfWeek(d)); setView('day'); }}
                    className={`aspect-square min-h-[54px] rounded-xl border text-left p-1 flex flex-col gap-0.5 transition hover:bg-muted/40
                      ${inMonth ? 'bg-card border-border/50' : 'bg-muted/30 border-transparent text-muted-foreground'}
                      ${isToday ? '!border-primary border-2' : ''}`}>
                    <div className={`text-[11px] font-semibold ${isToday ? 'text-primary' : ''}`}>{d.getDate()}</div>
                    <div className="flex flex-wrap gap-0.5 mt-auto">
                      {items.slice(0, 4).map((t, ti) => {
                        const dom = (t.is_rest ? 'rest' : (t.domain || 'personal')) as Domain | 'rest';
                        const dc = domainClass(dom);
                        return <span key={ti} className={`w-1.5 h-1.5 rounded-full ${dc.bar}`} />;
                      })}
                      {items.length > 4 && <span className="text-[9px] text-muted-foreground leading-none">+{items.length - 4}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}
      {/* Add intention */}
      <button onClick={() => nav('/capture')} className="pace-btn-primary mt-4 w-full">
        <Plus className="w-4 h-4" /> Add intention
      </button>

      {/* Detail modal */}
      {open && (
        <div className="fixed inset-0 z-40 bg-foreground/30 flex items-end sm:items-center justify-center p-3" onClick={() => setOpen(null)}>
          <div className="bg-card rounded-3xl p-5 w-full max-w-md animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="pace-tag flex items-center">
                  <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${domainClass(open.domain).bar}`} />
                  {open.domain === 'rest' ? 'Rest / Recovery' : DOMAIN_LABEL[open.domain]} · {fmtRange(open.startMin, open.endMin)}
                </div>
                <div className="pace-title mt-1">{open.title}</div>
              </div>
              <button onClick={() => setOpen(null)} className="p-1.5 rounded-full hover:bg-muted"><X className="w-4 h-4" /></button>
            </div>

            {open.status && (
              <div className="mt-3"><span className={`status-chip status-${open.status}`}>{STATUS_LABEL[open.status]}</span></div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
              {open.duration_minutes != null && <div className="bg-muted rounded-xl px-3 py-2"><div className="pace-eyebrow">Estimate</div>{fmtMin(open.duration_minutes)}</div>}
              {open.effort_level && <div className="bg-muted rounded-xl px-3 py-2"><div className="pace-eyebrow">Effort</div>{open.effort_level}</div>}
              {open.energy && <div className="bg-muted rounded-xl px-3 py-2"><div className="pace-eyebrow">Energy</div>{open.energy}</div>}
            </div>

            {open.next_action && (
              <div className="mt-3 text-[14px] text-muted-foreground"><span className="font-medium text-foreground">Next:</span> {open.next_action}</div>
            )}
            {open.notes && <div className="mt-2 text-[14px] text-muted-foreground">{open.notes}</div>}

            {open.taskId && (
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => { setOpen(null); nav(`/task/${open.taskId}`); }} className="pace-btn pace-btn-sm">Edit</button>
                <button onClick={() => { setOpen(null); nav('/replan'); }} className="pace-btn pace-btn-sm"><MoveRight className="w-3.5 h-3.5" /> Reschedule</button>
                <button onClick={() => { setOpen(null); nav('/focus'); }} className="pace-btn-primary pace-btn-sm"><Timer className="w-3.5 h-3.5" /> Start focus</button>
              </div>
            )}
            {open.fixed && (
              <div className="mt-4 text-[12px] text-muted-foreground">This is a protected block to support your recovery.</div>
            )}
          </div>
        </div>
      )}

      {/* Replan reason prompt */}
      {replanFor && (
        <div className="fixed inset-0 z-50 bg-foreground/30 flex items-end sm:items-center justify-center p-3" onClick={() => setReplanReason(null)}>
          <div className="bg-card rounded-3xl p-5 w-full max-w-md animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="pace-title">Task moved. What changed?</div>
            <div className="text-[13px] text-muted-foreground mt-1">Optional — helps you spot patterns.</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => setReplanReason(null)} className="pace-chip">Better time</button>
              {(Object.keys(REPLAN_REASON_LABEL) as ReplanReason[]).map(r => (
                <button key={r} onClick={() => setReplanReason(r)} className="pace-chip">{REPLAN_REASON_LABEL[r]}</button>
              ))}
            </div>
            <button onClick={() => setReplanReason(null)} className="pace-btn-ghost pace-btn-sm mt-3 w-full">Skip</button>
          </div>
        </div>
      )}
    </AppShell>
  );

  async function toggleDone(ev: CalEvent) {
    if (!ev.taskId) return;
    const newStatus: Status = ev.status === 'done' ? 'in_progress' : 'done';
    const { error } = await supabase.from('tasks').update({ status: newStatus }).eq('id', ev.taskId);
    if (error) { toast.error(error.message); return; }
    setTasks(arr => arr.map(x => x.id === ev.taskId ? { ...x, status: newStatus } : x));
  }

  async function createAt(dayI: number, hour: number) {
    if (!user) return;
    const title = window.prompt('New intention');
    if (!title?.trim()) return;
    const date = toISODate(days[dayI]);
    const { data, error } = await supabase.from('tasks').insert({
      user_id: user.id, title: title.trim(),
      domain: 'personal', priority: 'should', status: 'not_started',
      scheduled_date: date, duration_minutes: 60,
    }).select().single();
    if (error) { toast.error(error.message); return; }
    setTasks(arr => [...arr, rowToTask(data)]);
    toast.success('Added to your plan.');
  }
}
