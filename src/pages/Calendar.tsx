import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Users, AlertTriangle, Timer, MoveRight, Moon, Pencil, Trash2 } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile, TimeBlock } from '@/hooks/useUserProfile';
import { useTasks, useTaskMutations } from '@/hooks/useTasks';
import { useDailyCapacityRange } from '@/hooks/useDailyCapacity';
import { Domain, DOMAIN_LABEL, DOMAIN_COLOR_VAR, Status, STATUS_LABEL, fmtMin, ReplanReason, toISODate } from '@/lib/pace';
import type { Task } from '@/lib/scheduling';
import { getScheduledEvents, effectiveCapacityMinutes, capacityState, buildReschedulePatch, layoutEventsForDay, bufferMinutes, resolveProfileEnergy } from '@/lib/scheduling';
import { toast } from 'sonner';
import ReplanReasonChips from '@/components/ReplanReasonChips';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import DayEnergyPicker from '@/components/DayEnergyPicker';
import CapacityInfoButton from '@/components/CapacityInfoButton';
import RescheduleDialog from '@/components/RescheduleDialog';
import RestBlockDialog, { RestBlockInitial } from '@/components/RestBlockDialog';
import TaskMeta from '@/components/TaskMeta';

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
  priority?: 'must' | 'should' | 'could';
  next_action?: string | null;
  duration_minutes?: number | null;
  effort_level?: string | null;
  notes?: string | null;
  involves_others?: boolean;
  others_rely?: boolean;
  reschedule_count?: number;
  scheduled_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  deadline?: string | null;
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

// Domain styles use the same CSS variables exposed by DOMAIN_COLOR_VAR
// in lib/pace.ts, so Calendar stays visually in sync with Home/Plan/Workload.
function domainClass(domain: Domain | 'rest') {
  switch (domain) {
    case 'academic': return { bg: 'bg-[hsl(var(--domain-academic)/0.14)]', bar: 'bg-[hsl(var(--domain-academic))]', text: 'text-[hsl(var(--domain-academic))]' };
    case 'work':     return { bg: 'bg-[hsl(var(--domain-work)/0.16)]',     bar: 'bg-[hsl(var(--domain-work))]',     text: 'text-[hsl(var(--domain-work))]' };
    case 'social':   return { bg: 'bg-[hsl(var(--domain-social)/0.18)]',   bar: 'bg-[hsl(var(--domain-social))]',   text: 'text-[hsl(206_7%_20%)]' };
    case 'personal': return { bg: 'bg-[hsl(var(--domain-personal)/0.14)]', bar: 'bg-[hsl(var(--domain-personal))]', text: 'text-[hsl(var(--domain-personal))]' };
    case 'rest':     return { bg: 'bg-[hsl(var(--domain-rest)/0.55)]',     bar: 'bg-[hsl(var(--domain-rest))]',     text: 'text-[hsl(var(--rest-foreground))]' };
  }
}

const ALL_DOMAINS: Array<Domain | 'rest'> = ['academic', 'work', 'social', 'personal', 'rest'];

// Collapsible "Needs attention" panel for the day-view agenda. Each item
// expands inline to surface neutral-toned recovery actions.
function NeedsAttention({
  items,
  onReschedule,
  onReduce,
  onBlock,
  onStart,
}: {
  items: CalEvent[];
  onReschedule: (ev: CalEvent) => void;
  onReduce: (ev: CalEvent) => void;
  onBlock: (ev: CalEvent) => void;
  onStart: (ev: CalEvent) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="rounded-2xl border border-[hsl(var(--attention)/0.35)] bg-[hsl(var(--attention)/0.06)] p-3">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-2 text-left">
        <AlertTriangle className="w-4 h-4 text-[hsl(var(--attention))]" />
        <span className="text-[13px] font-semibold text-[hsl(var(--attention))]">
          That's OK -  let's figure out the next step. · {items.length}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {collapsed ? 'Show' : 'Hide'}
        </span>
      </button>
      {!collapsed && (
        <ul className="mt-2 space-y-1.5">
          {items.map(ev => {
            const isOpen = openId === ev.id;
            const h = Math.floor(ev.startMin / 60);
            const timeLabel = `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`;
            return (
              <li key={ev.id} className="rounded-xl bg-card border border-border/50">
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : ev.id)}
                  className="w-full text-left px-3 py-2 flex items-center gap-2">
                  <span className="text-[13px] font-medium truncate">{ev.title}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground shrink-0">
                    Scheduled {timeLabel}
                  </span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 -mt-1">
                    <p className="text-[12px] text-muted-foreground mb-2">
                      The scheduled window has passed. Pick a gentle next step.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <button onClick={() => onStart(ev)} className="pace-btn-primary pace-btn-sm">
                        <Timer className="w-3.5 h-3.5" /> Start now
                      </button>
                      <button onClick={() => onReschedule(ev)} className="pace-btn pace-btn-sm">
                        <MoveRight className="w-3.5 h-3.5" /> Reschedule
                      </button>
                      <button onClick={() => onReduce(ev)} className="pace-btn pace-btn-sm">
                        Reduce to 10 min
                      </button>
                      <button onClick={() => onBlock(ev)} className="pace-btn pace-btn-sm">
                        Mark blocked
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}


export default function CalendarView() {
  const { user, loading } = useAuth();
  const { profile: userProfile } = useUserProfile();
  const { data: allTasks = [] } = useTasks();
  const { update, insert, remove } = useTaskMutations();
  const nav = useNavigate();
  // URL-backed view + date so back-navigation from TaskDetail restores the
  // exact calendar state the user left. `view` is one of day|week|month;
  // `date` is the focused date in YYYY-MM-DD (centerDate for week view,
  // selected day for day view, anchor month for month view).
  const [searchParams, setSearchParams] = useSearchParams();
  const parsedDate = (() => {
    const raw = searchParams.get('date');
    if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [y, m, dd] = raw.split('-').map(Number);
      const d = new Date(y, m - 1, dd); d.setHours(0, 0, 0, 0);
      if (!isNaN(d.getTime())) return d;
    }
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  })();
  const parsedView = (() => {
    const v = searchParams.get('view');
    return v === 'day' || v === 'week' || v === 'month' ? v : 'week';
  })();
  const [view, setView] = useState<'day' | 'week' | 'month'>(parsedView);
  // weekStart drives the 7-day window used by Day view's day picker.
  const [weekStart, setWeekStart] = useState(() => startOfWeek(parsedDate));
  // centerDate drives the 3-day sliding Week view (centerDate-1, centerDate, centerDate+1).
  const [centerDate, setCenterDate] = useState(() => parsedDate);
  const [dayIdx, setDayIdx] = useState(() => (parsedDate.getDay() + 6) % 7);
  const [monthAnchor, setMonthAnchor] = useState(() => { const d = new Date(parsedDate); d.setDate(1); d.setHours(0,0,0,0); return d; });
  const [filter, setFilter] = useState<Set<Domain | 'rest'>>(new Set(ALL_DOMAINS));
  const [showCompleted, setShowCompleted] = useState(false);
  const [open, setOpen] = useState<CalEvent | null>(null);
  const [replanFor, setReplanFor] = useState<{ taskId: string; title: string } | null>(null);
  const [replanCustomMode, setReplanCustomMode] = useState(false);
  const [replanCustomText, setReplanCustomText] = useState('');
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  // Empty-slot tap surfaces a tiny choice between "New action" and "Add rest block".
  const [slotChoice, setSlotChoice] = useState<{ dayIdx: number; hour: number } | null>(null);
  // Mount state for the one-time rest block create/edit dialog.
  const [restEdit, setRestEdit] = useState<RestBlockInitial | null>(null);
  const [drag, setDrag] = useState<{ id: string } | null>(null);
  // Tracks the event id currently being dropped so we can hide it from the
  // source slot immediately, before the mutation round-trip completes.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Build the per-day fixed blocks from the user's preferences (sleep/meal/
  // recovery/custom). Each block can be filtered to specific weekdays via
  // its optional `days` field (0=Mon..6=Sun) — e.g. a later sleep on
  // weekends. If `days` is absent or empty, the block applies every day.
  // If a sleep block crosses midnight (e.g. 23:30 → 07:30), split it
  // visually into "evening" + "morning" segments so it renders correctly
  // on a 0–24h grid.
  const fixedBlocksFor = useMemo(() => {
    const tb: TimeBlock[] | null = userProfile?.default_time_blocks ?? null;
    return (date: Date): Array<Omit<CalEvent, 'id' | 'day'>> => {
      // Mon=0..Sun=6
      const dow = (date.getDay() + 6) % 7;
      const source: Array<TimeBlock | { label: string; start: string; end: string; kind: CalKind; days?: number[] }> =
        tb && tb.length ? tb : (FIXED_BLOCKS.map(b => ({ label: b.title, start: '', end: '', kind: b.kind, days: undefined })) as any);
      // If we fell back to FIXED_BLOCKS, return them unchanged (no day filter).
      if (!tb || !tb.length) return FIXED_BLOCKS;
      const out: Array<Omit<CalEvent, 'id' | 'day'>> = [];
      tb.forEach(b => {
        if (b.days && b.days.length > 0 && !b.days.includes(dow)) return;
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
    };
  }, [userProfile]);


  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);

  // Sync URL ↔ state. Use replace so we don't pollute the history stack as
  // the user pages through days. Returning to /calendar from TaskDetail will
  // restore the same view + focused date.
  useEffect(() => {
    const focus =
      view === 'day' ? (() => { const d = new Date(weekStart); d.setDate(d.getDate() + dayIdx); return d; })() :
      view === 'week' ? centerDate :
      monthAnchor;
    const next = new URLSearchParams(searchParams);
    next.set('view', view);
    next.set('date', toISODate(focus));
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // We intentionally read the latest searchParams via setSearchParams' input,
    // and depend only on the underlying state values to drive updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, centerDate, dayIdx, weekStart, monthAnchor]);

  // In week (3-day sliding) view: [centerDate-1, centerDate, centerDate+1].
  // In day view: full 7-day Mon-start window driven by weekStart, used by the
  // day picker so the user can jump within the current week.
  const days = useMemo(() => {
    if (view === 'week') {
      const start = new Date(centerDate); start.setDate(start.getDate() - 1);
      return Array.from({ length: 3 }, (_, i) => {
        const d = new Date(start); d.setDate(d.getDate() + i); return d;
      });
    }
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart); d.setDate(d.getDate() + i); return d;
    });
  }, [view, centerDate, weekStart]);

  const weekRange = useMemo(() => {
    const start = toISODate(days[0]);
    const last = days[days.length - 1];
    const end = new Date(last); end.setDate(end.getDate() + 1);
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
      fixedBlocksFor(d).forEach((b, bi) => list.push({ ...b, id: `fix-${di}-${bi}`, day: di }));
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
        priority: t.priority,
        next_action: t.next_action,
        duration_minutes: t.duration_minutes,
        effort_level: t.effort_level,
        notes: t.notes,
        involves_others: t.involves_others,
        others_rely: t.others_rely,
        reschedule_count: t.reschedule_count,
        scheduled_date: t.scheduled_date,
        start_time: t.start_time,
        end_time: t.end_time,
        deadline: t.deadline,
        day: di,
        startMin: ev.startMin,
        endMin: ev.endMin,
      });
    });
    return list;
  }, [tasks, days, fixedBlocksFor]);

  // Compute per-day workload + conflicts
  const daySummary = days.map((d, di) => {
    const date = toISODate(d);
    const cap = capacities[date];
    const profileCapMin = userProfile?.daily_capacity_minutes ?? 330;
    const profileEnergy = resolveProfileEnergy(userProfile?.energy_pattern);
    const effectiveOverride = cap
      ? { available_hours: Number(cap.available_hours), energy_level: cap.energy_level ?? profileEnergy }
      : { available_hours: profileCapMin / 60, energy_level: profileEnergy };
    const capMin = effectiveCapacityMinutes(
      effectiveOverride,
      profileCapMin,
      { affects: userProfile?.energy_affects_capacity ?? true, pct: userProfile?.energy_capacity_pct ?? 10 },
    );
    const availH = capMin / 60;
    const energy = cap?.energy_level ?? profileEnergy;
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
    if (draggingId && e.id === draggingId) return false;
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
    if (view === 'week') {
      const d = new Date(centerDate); d.setDate(d.getDate() + delta); setCenterDate(d);
    } else {
      const d = new Date(weekStart); d.setDate(d.getDate() + delta * 7); setWeekStart(d);
    }
  }
  function resetCenter() {
    const d = new Date(); d.setHours(0,0,0,0);
    if (view === 'week') setCenterDate(d);
    else setWeekStart(startOfWeek(d));
  }

  // Drag & drop reschedule
  async function handleDrop(targetDay: number) {
    if (!drag) return;
    const ev = events.find(e => e.id === drag.id);
    setDrag(null);
    if (!ev || !ev.taskId || ev.day === targetDay) return;
    const newDate = toISODate(days[targetDay]);
    const t = tasks.find(x => x.id === ev.taskId);
    if (!t) return;
    setDraggingId(ev.id);
    try {
      await update.mutateAsync({ id: ev.taskId, patch: buildReschedulePatch(t, newDate) });
      setReplanFor({ taskId: ev.taskId, title: ev.title });
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not move.');
    } finally {
      setDraggingId(null);
    }
  }

  async function setReplanReason(reason: ReplanReason | null) {
    if (!replanFor) return;
    if (reason) await update.mutateAsync({ id: replanFor.taskId, patch: { replanning_reason: reason } as any });
    toast.success('Task moved. Progress preserved.');
    setReplanFor(null);
    setReplanCustomMode(false);
    setReplanCustomText('');
  }

  async function saveCustomReplanReason() {
    if (!replanFor) return;
    const text = replanCustomText.trim();
    if (text) {
      // No `replanning_reason_text` column exists; append the custom reason
      // to the task's notes as a dated entry.
      const t = allTasks.find(x => x.id === replanFor.taskId);
      const existing = (t as any)?.notes ?? '';
      const stamp = new Date().toLocaleDateString();
      const appended = existing
        ? `${existing}\n\n[${stamp}] Reschedule reason: ${text}`
        : `[${stamp}] Reschedule reason: ${text}`;
      await update.mutateAsync({ id: replanFor.taskId, patch: { notes: appended } as any });
    }
    toast.success('Task moved. Progress preserved.');
    setReplanFor(null);
    setReplanCustomMode(false);
    setReplanCustomText('');
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
          <button onClick={() => shiftWeek(-1)} className="p-2 rounded-full hover:bg-muted" aria-label={view === 'week' ? 'Previous day' : 'Previous week'}><ChevronLeft className="w-5 h-5" /></button>
          <button onClick={resetCenter} className="pace-chip">
            {view === 'week'
              ? `${days[0].toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} – ${days[days.length - 1].toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`
              : `${days[0].toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${days[days.length - 1].toLocaleDateString([], { month: 'short', day: 'numeric' })}`}
          </button>
          <button onClick={() => shiftWeek(1)} className="p-2 rounded-full hover:bg-muted" aria-label={view === 'week' ? 'Next day' : 'Next week'}><ChevronRight className="w-5 h-5" /></button>
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

      {/* Category colour legend — only for day/week views, only categories
          present in the currently visible events. Horizontally scrollable. */}
      {(view === 'day' || view === 'week') && (() => {
        const scope = view === 'day'
          ? visibleEvents.filter(e => e.day === dayIdx)
          : visibleEvents;
        const present = new Set<Domain>();
        scope.forEach(e => {
          if (e.kind === 'task' && e.domain && e.domain !== 'rest') {
            present.add(e.domain as Domain);
          }
        });
        if (present.size === 0) return null;
        const ordered: Domain[] = (['academic', 'work', 'social', 'personal'] as Domain[])
          .filter(d => present.has(d));
        return (
          <div className="mt-2 -mx-1 px-1 overflow-x-auto">
            <div className="flex gap-3 min-w-min text-[11px] text-muted-foreground">
              {ordered.map(d => (
                <span key={d} className="inline-flex items-center gap-1.5 shrink-0">
                  <span
                    aria-hidden="true"
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{ background: DOMAIN_COLOR_VAR[d] }}
                  />
                  {DOMAIN_LABEL[d]}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Day picker for day view — fixed 7 across, no horizontal scroll.
          Each chip has a stable height: an always-present 6px indicator row
          below the date number, so adding/removing a status dot never
          changes the chip's overall size. */}
      {view === 'day' && (
        <div className="mt-3 flex gap-1">
          {days.map((d, i) => {
            const active = i === dayIdx;
            const summary = daySummary[i];
            const dotClass =
              summary.state === 'over' ? 'bg-[hsl(var(--attention))]' :
              summary.state === 'close' ? 'bg-[hsl(var(--warning))]' :
              'bg-transparent';
            return (
              <button key={i} onClick={() => setDayIdx(i)}
                className={`flex-1 min-w-0 px-1 py-2 rounded-2xl text-center ${active ? 'bg-muted-foreground/15 border border-muted-foreground/40' : 'bg-card border border-border/60'}`}>
                <div className="text-[9px] font-semibold uppercase tracking-wider opacity-80 truncate">{DAYS[i]}</div>
                <div className="text-[14px] font-semibold leading-tight">{d.getDate()}</div>
                <div className="h-1.5 mt-0.5 flex items-center justify-center" aria-hidden="true">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass}`} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* === DAY VIEW: agenda layout ===
          Rest blocks, focus blocks, and tasks all appear inline in chronological
          order. A "Needs attention" section at the top surfaces tasks scheduled
          today whose end time has already passed without completion, with
          per-item Reschedule / Reduce / Block / Start now actions. */}
      {view === 'day' && (() => {
        const dayEvs = visibleEvents.filter(e => e.day === dayIdx);
        // Chronological agenda. Untimed events fall after timed ones because
        // getScheduledEvents always assigns a synthetic startMin, but if any
        // event happens to lack one we sort it last.
        const agenda = [...dayEvs].sort((a, b) => {
          const aHas = Number.isFinite(a.startMin) ? 0 : 1;
          const bHas = Number.isFinite(b.startMin) ? 0 : 1;
          if (aHas !== bHas) return aHas - bHas;
          return a.startMin - b.startMin;
        });
        const summary = daySummary[dayIdx];
        const stateLabel = summary.state === 'over' ? 'Needs adjustment' : summary.state === 'close' ? 'Close to capacity' : 'Balanced';
        const stateClass = summary.state === 'over' ? 'bg-[hsl(var(--attention)/0.18)] text-[hsl(var(--attention))]' :
                           summary.state === 'close' ? 'bg-[hsl(var(--warning)/0.22)] text-[hsl(206_7%_20%)]' :
                           'bg-[hsl(var(--success)/0.18)] text-[hsl(var(--success))]';
        const taskItems = agenda.filter(e => e.kind === 'task' || e.kind === 'focus');
        const dateObj = days[dayIdx];
        const isTodayView = dateObj.toDateString() === new Date().toDateString();
        const taskById = new Map(tasks.map(t => [t.id, t] as const));

        // Needs attention: tasks scheduled today whose end time is in the past
        // and whose status is not done. Only meaningful for the "today" column.
        const attentionItems = isTodayView
          ? taskItems.filter(e => e.taskId && e.status !== 'done' && e.endMin <= nowMin)
          : [];
        const attentionIds = new Set(attentionItems.map(e => e.id));
        const restAgenda = agenda.filter(e => !attentionIds.has(e.id));

        return (
          <div className="mt-4 space-y-4">
            {/* Day summary card */}
            <div className="pace-card">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="pace-eyebrow">{DAYS[dayIdx]}</div>
                  <div className="pace-title mt-0.5">{dateObj.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div>
                </div>
                <div className="flex items-center gap-2">
                  <DayEnergyPicker
                    date={summary.date}
                    current={summary.energy}
                    availableHours={summary.availH}
                    size="md"
                  />
                  <div className={`rounded-full px-3 py-1 text-[11px] font-medium ${stateClass}`}>{stateLabel}</div>
                  <CapacityInfoButton />
                </div>
              </div>
              <div className="mt-2 pace-meta">{fmtMin(summary.planned)} planned of {fmtMin(summary.capMin)} capacity · {taskItems.length} {taskItems.length === 1 ? 'item' : 'items'}</div>
            </div>

            {/* Proactive overload prompt — actionable replacement for the
                passive "Needs adjustment" ribbon. Shown when the day is over
                capacity. Migrated from the deprecated /plan screen. */}
            {summary.state === 'over' && (() => {
              const heaviest = [...taskItems]
                .filter(e => e.taskId)
                .sort((a, b) => (b.duration_minutes ?? 0) - (a.duration_minutes ?? 0))[0];
              const overBy = Math.max(0, summary.planned - summary.capMin);
              return (
                <div className="pace-alert animate-fade-in">
                  <div className="pace-eyebrow mb-1">
                    <span className="priority-dot should" />Your plan may need adjustment
                  </div>
                  <div className="text-[13px]">
                    You are {fmtMin(overBy)} over capacity. Want to move an
                    action, shorten one, or split it across two days?
                  </div>
                  {heaviest?.taskId && (
                    <div className="mt-2 flex gap-1.5 flex-wrap">
                      <button
                        onClick={() => setRescheduleId(heaviest.taskId!)}
                        className="pace-btn-primary pace-btn-sm">
                        Move "{heaviest.title.slice(0, 28)}"
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Needs attention — collapsible, compact, action-led. */}
            {attentionItems.length > 0 && (
              <NeedsAttention
                items={attentionItems}
                onReschedule={(ev) => { setOpen(null); if (ev.taskId) setRescheduleId(ev.taskId); }}
                onReduce={async (ev) => {
                  if (!ev.taskId) return;
                  try {
                    await update.mutateAsync({ id: ev.taskId, patch: { duration_minutes: 10 } as any });
                    toast.success('Reduced to 10 minutes.');
                  } catch (err: any) { toast.error(err?.message ?? 'Could not update.'); }
                }}
                onBlock={async (ev) => {
                  if (!ev.taskId) return;
                  try {
                    await update.mutateAsync({ id: ev.taskId, patch: { status: 'blocked' } as any });
                    toast.success('Marked as blocked.');
                  } catch (err: any) { toast.error(err?.message ?? 'Could not update.'); }
                }}
                onStart={(ev) => nav('/focus', { state: { taskId: ev.taskId } })}
              />
            )}

            {/* Agenda */}
            <div>
              <div className="pace-eyebrow mb-2">Agenda</div>
              {restAgenda.length === 0 ? (
                <div className="pace-card text-center text-[14px] text-muted-foreground">
                  Nothing planned yet. Add an action below to get started.
                </div>
              ) : (
                <ul className="space-y-2">
                  {restAgenda.map(ev => {
                    const dc = domainClass(ev.domain);
                    const conflict = summary.conflictIds.has(ev.id);
                    const done = ev.status === 'done';
                    const isRest = ev.kind !== 'task' && ev.kind !== 'focus';

                    if (isRest) {
                      // Inline rest block, full agenda width, distinct neutral
                      // styling so it reads as protected time.
                      return (
                        <li key={ev.id}>
                          <button onClick={() => setOpen(ev)}
                            className={`w-full text-left rounded-2xl ${dc.bg} border border-border/30 px-3 py-2.5 flex items-center gap-2`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${dc.bar}`} />
                            <span className="text-[13px] font-medium">{ev.title}</span>
                            <span className="text-[11px] text-muted-foreground uppercase tracking-wider ml-1">Rest</span>
                            <span className="ml-auto text-[12px] text-muted-foreground">{fmtRange(ev.startMin, ev.endMin)}</span>
                          </button>
                        </li>
                      );
                    }

                    const t = ev.taskId ? taskById.get(ev.taskId) : undefined;
                    const buf = t ? bufferMinutes(t) : 0;
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
                            <div className="flex items-baseline gap-2">
                              <div className={`text-[15px] font-medium leading-snug truncate ${done ? 'line-through' : ''}`}>{ev.title}</div>
                              <span className="ml-auto text-[11px] text-muted-foreground shrink-0">{fmtRange(ev.startMin, ev.endMin)}</span>
                            </div>
                            {buf > 0 && (
                              <div className="mt-0.5 text-[11px] text-muted-foreground">+{fmtMin(buf)} buffer</div>
                            )}
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                              <span className={`inline-flex items-center gap-1 ${dc.text}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${dc.bar}`} />
                                {ev.domain === 'rest' ? 'Rest' : DOMAIN_LABEL[ev.domain as Domain]}
                              </span>
                              {ev.duration_minutes != null && <span>· {fmtMin(ev.duration_minutes)}</span>}
                              {ev.effort_level && <span>· {ev.effort_level} effort</span>}
                              {ev.others_rely && <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> shared</span>}
                              {(ev.reschedule_count ?? 0) >= 2 && <span className="pace-chip !py-0.5 !px-1.5 !text-[11px]">Rescheduled {ev.reschedule_count}×</span>}
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
          </div>
        );
      })()}

      {/* === WEEK VIEW (time grid) === */}
      {view === 'week' && (
      <>
      {/* Day headers + summaries — separate block above the time grid */}
      <div className="mt-4 pace-card !p-3">
        <div className="flex" style={{ paddingLeft: 36 }}>
          {visibleDays.map(di => {
            const d = days[di];
            const s = daySummary[di];
            const isToday = d.toDateString() === new Date().toDateString();
            const stateLabel = s.state === 'over' ? 'Needs adjustment' : s.state === 'close' ? 'Close to capacity' : 'Balanced';
            const stateClass = s.state === 'over' ? 'bg-[hsl(var(--attention)/0.18)] text-[hsl(var(--attention))]' :
                               s.state === 'close' ? 'bg-[hsl(var(--warning)/0.22)] text-[hsl(206_7%_20%)]' :
                               'bg-[hsl(var(--success)/0.18)] text-[hsl(var(--success))]';
            const weekdayShort = d.toLocaleDateString([], { weekday: 'short' });
            const goToDay = () => {
              setWeekStart(startOfWeek(d));
              setDayIdx((d.getDay() + 6) % 7);
              setView('day');
            };
            return (
              <div key={di} className="flex-1 min-w-0 px-1">
                <div className={`text-center ${isToday ? 'text-primary font-semibold' : 'text-foreground'}`}>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{weekdayShort}</div>
                  <div className="text-[15px] font-semibold">{d.getDate()}</div>
                </div>
                <button
                  type="button"
                  onClick={goToDay}
                  className={`mt-1 w-full rounded-lg px-1.5 py-1 text-[10px] text-center ${stateClass} ${s.state !== 'balanced' ? 'hover:opacity-90 cursor-pointer' : 'cursor-default'}`}
                  aria-label={s.state !== 'balanced' ? `${stateLabel} — open day view to see details` : stateLabel}>
                  {stateLabel}
                </button>
                <div className="text-[10px] text-muted-foreground text-center mt-0.5">
                  {fmtMin(s.planned)} / {fmtMin(s.capMin)}
                </div>
                <div className="mt-1 flex justify-center">
                  <DayEnergyPicker
                    date={s.date}
                    current={s.energy}
                    availableHours={s.availH}
                    size="sm"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 pace-card !p-3 overflow-hidden">

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
              // Lay out overlapping events into side-by-side columns so two
              // tasks in the same hour don't stack on top of each other.
              const laidOut = layoutEventsForDay(dayEvs);
              return (
                <div key={di}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(di)}
                  // Single click handler computes the hour from the y-offset.
                  // Replaces 18 separate <button> hour cells per day so keyboard
                  // users don't get a tab stop at every empty slot.
                  onClick={(e) => {
                    if (e.target !== e.currentTarget) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const y = e.clientY - rect.top;
                    const hour = START_HOUR + Math.floor(y / HOUR_PX);
                    if (hour >= START_HOUR && hour < END_HOUR) setSlotChoice({ dayIdx: di, hour });
                  }}
                  className="flex-1 min-w-0 relative border-l border-border/40 cursor-pointer">
                  {/* Hour grid lines (visual only — not focusable). */}
                  {HOURS.map((h, i) => (
                    <div key={h}
                      aria-hidden="true"
                      className="absolute left-0 right-0 border-t border-border/30 pointer-events-none"
                      style={{ top: i * HOUR_PX, height: HOUR_PX }} />
                  ))}

                  {/* Overbooking ribbon — actionable: tapping the day jumps
                      to day view where the full overload prompt lives. */}
                  {summary.state === 'over' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setWeekStart(startOfWeek(days[di]));
                        setDayIdx((days[di].getDay() + 6) % 7);
                        setView('day');
                      }}
                      className="absolute top-0 left-1 right-1 z-20 rounded-md bg-[hsl(var(--attention)/0.18)] text-[hsl(var(--attention))] text-[10px] px-1.5 py-0.5 flex items-center gap-1 hover:bg-[hsl(var(--attention)/0.28)]"
                      aria-label="Plan may need adjustment — open day view to move an action">
                      <AlertTriangle className="w-2.5 h-2.5" /> Move an action?
                    </button>
                  )}

                  {/* Events */}
                  {laidOut.map(ev => {
                    const top = ((ev.startMin - START_HOUR * 60) / 60) * HOUR_PX;
                    const height = Math.max(22, ((ev.endMin - ev.startMin) / 60) * HOUR_PX - 2);
                    const dc = domainClass(ev.domain);
                    const conflict = summary.conflictIds.has(ev.id);
                    const isFixed = !!ev.fixed;
                    const widthPct = 100 / ev.columnCount;
                    const leftPct = ev.column * widthPct;
                    return (
                      <button
                        key={ev.id}
                        draggable={!isFixed}
                        onDragStart={() => setDrag({ id: ev.id })}
                        onClick={(e) => { e.stopPropagation(); setOpen(ev); }}
                        className={`absolute rounded-lg ${dc.bg} text-left p-1.5 overflow-hidden border border-border/30`}
                        style={{ top, height, left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`, zIndex: 5 }}>
                        <div className="flex gap-1 items-start">
                          <span className={`w-1 self-stretch rounded-full ${dc.bar} shrink-0`} />
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-semibold leading-tight truncate">{ev.title}</div>
                            <div className="text-[9px] text-muted-foreground truncate">{fmtRange(ev.startMin, ev.endMin)}</div>
                            <div className="flex gap-1 mt-0.5 flex-wrap items-center">
                              {ev.others_rely && <Users className="w-2.5 h-2.5 text-muted-foreground" aria-label="Others rely on this" />}
                              {(ev.reschedule_count ?? 0) >= 2 && (
                                <span className="text-[9px] text-muted-foreground" aria-label={`Rescheduled ${ev.reschedule_count} times`}>↻{ev.reschedule_count}</span>
                              )}
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
      </>
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
        const DOMAIN_ORDER: Domain[] = ['academic', 'work', 'social', 'personal'];
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
                // Per-domain presence: at most one dot per domain, fixed order.
                const domainsPresent = new Set<Domain | 'rest'>();
                items.forEach(t => {
                  const dom = (t.is_rest ? 'rest' : (t.domain || 'personal')) as Domain | 'rest';
                  domainsPresent.add(dom);
                });
                return (
                  <button key={i}
                    onClick={() => { setDayIdx((d.getDay() + 6) % 7); setWeekStart(startOfWeek(d)); setView('day'); }}
                    className={`aspect-square min-h-[54px] rounded-xl border text-left p-1 flex flex-col gap-0.5 transition hover:bg-muted/40
                      ${inMonth ? 'bg-card border-border/50' : 'bg-muted/30 border-transparent text-muted-foreground'}
                      ${isToday ? '!bg-muted-foreground/15 !border-muted-foreground/50 border-2' : ''}`}>
                    <div className={`text-[11px] ${isToday ? 'font-bold' : 'font-semibold'}`}>{d.getDate()}</div>
                    {/* Fixed 4-slot domain dot row — Academic, Work, Social, Personal.
                        Empty slots are rendered as transparent placeholders so the
                        cell layout stays stable regardless of domain mix. */}
                    <div className="flex gap-1 mt-auto" aria-hidden="true">
                      {DOMAIN_ORDER.map(dom => {
                        const present = domainsPresent.has(dom);
                        const dc = domainClass(dom);
                        return (
                          <span
                            key={dom}
                            className={`w-1.5 h-1.5 rounded-full ${present ? dc.bar : 'bg-transparent'}`}
                          />
                        );
                      })}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}
      {/* Add action / Add rest block */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={() => nav('/capture')} className="pace-btn-primary">
          <Plus className="w-4 h-4" /> Add action
        </button>
        <button
          onClick={() => {
            const focus =
              view === 'day' ? days[dayIdx] :
              view === 'week' ? centerDate :
              new Date();
            setRestEdit({ date: toISODate(focus), startTime: '12:00', endTime: '12:30', label: 'Rest' });
          }}
          className="pace-btn">
          <Moon className="w-4 h-4" /> Add rest block
        </button>
      </div>

      {/* Detail dialog — shadcn Dialog gives us focus trap + Escape for free. */}
      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent className="max-w-md rounded-3xl">
          {open && (
            <>
              <DialogHeader>
                <div className="pace-tag flex items-center">
                  <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${domainClass(open.domain).bar}`} />
                  {open.domain === 'rest' ? 'Rest / Recovery' : DOMAIN_LABEL[open.domain]} · {fmtRange(open.startMin, open.endMin)}
                </div>
                <DialogTitle className="pace-title mt-1 text-left">{open.title}</DialogTitle>
                <DialogDescription className="sr-only">Event details</DialogDescription>
              </DialogHeader>

              {open.status && (
                <div className="mt-1"><span className={`status-chip status-${open.status}`}>{STATUS_LABEL[open.status]}</span></div>
              )}

              {open.taskId ? (
                <div className="mt-3">
                  <TaskMeta
                    task={{
                      domain: open.domain === 'rest' ? null : open.domain,
                      priority: open.priority,
                      scheduled_date: open.scheduled_date,
                      start_time: open.start_time,
                      end_time: open.end_time,
                      deadline: open.deadline,
                      duration_minutes: open.duration_minutes ?? null,
                      effort_level: open.effort_level ?? null,
                      involves_others: open.involves_others,
                      others_rely: open.others_rely,
                      reschedule_count: open.reschedule_count,
                    }}
                  />
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
                  {open.duration_minutes != null && <div className="bg-muted rounded-xl px-3 py-2"><div className="pace-eyebrow">Estimate</div>{fmtMin(open.duration_minutes)}</div>}
                  {open.effort_level && <div className="bg-muted rounded-xl px-3 py-2"><div className="pace-eyebrow">Effort</div>{open.effort_level}</div>}
                </div>
              )}

              {open.next_action && (
                <div className="mt-3 text-[14px] text-muted-foreground"><span className="font-medium text-foreground">Next:</span> {open.next_action}</div>
              )}
              {open.notes && <div className="mt-2 text-[14px] text-muted-foreground">{open.notes}</div>}

              {/* One-time rest block: edit / remove. */}
              {open.taskId && open.kind === 'rest' && !open.fixed && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      const init: RestBlockInitial = {
                        id: open.taskId,
                        date: open.scheduled_date ?? toISODate(days[open.day]),
                        startTime: open.start_time ?? undefined,
                        endTime: open.end_time ?? undefined,
                        label: open.title,
                      };
                      setOpen(null);
                      setRestEdit(init);
                    }}
                    className="pace-btn pace-btn-sm">
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button
                    onClick={async () => {
                      const id = open.taskId;
                      setOpen(null);
                      if (!id) return;
                      try {
                        await remove.mutateAsync(id);
                        toast.success('Rest block removed.');
                      } catch (err: any) {
                        toast.error(err?.message ?? 'Could not remove.');
                      }
                    }}
                    className="pace-btn pace-btn-sm">
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                </div>
              )}

              {/* Regular task actions. */}
              {open.taskId && open.kind !== 'rest' && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={() => { const id = open.taskId; setOpen(null); nav(`/task/${id}`); }} className="pace-btn pace-btn-sm"><Pencil className="w-3.5 h-3.5" /> Edit details</button>
                  <button onClick={() => { const id = open.taskId; setOpen(null); if (id) setRescheduleId(id); }} className="pace-btn pace-btn-sm"><MoveRight className="w-3.5 h-3.5" /> Reschedule</button>
                  <button onClick={() => { setOpen(null); nav('/focus'); }} className="pace-btn-primary pace-btn-sm"><Timer className="w-3.5 h-3.5" /> Start focus</button>
                </div>
              )}

              {/* Recurring rest block (from Settings): read-only + shortcut. */}
              {open.fixed && (
                <div className="mt-4 space-y-2">
                  <div className="text-[12px] text-muted-foreground">This is a protected block to support your recovery.</div>
                  <button
                    onClick={() => {
                      const init: RestBlockInitial = {
                        date: toISODate(new Date()),
                        startTime: undefined,
                        endTime: undefined,
                        label: open.title,
                      };
                      // Pre-fill the start/end with the recurring block's times.
                      const sH = Math.floor(open.startMin / 60);
                      const sM = open.startMin % 60;
                      const eH = Math.floor(open.endMin / 60);
                      const eM = open.endMin % 60;
                      init.startTime = `${String(sH).padStart(2, '0')}:${String(sM).padStart(2, '0')}`;
                      init.endTime = `${String(eH).padStart(2, '0')}:${String(eM).padStart(2, '0')}`;
                      setOpen(null);
                      setRestEdit(init);
                    }}
                    className="pace-btn pace-btn-sm">
                    <Plus className="w-3.5 h-3.5" /> Add a similar block today
                  </button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Replan reason dialog */}
      <Dialog open={!!replanFor} onOpenChange={(o) => { if (!o) setReplanReason(null); }}>
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="pace-title text-left">Rescheduled. What got in the way?</DialogTitle>
            <DialogDescription className="text-[13px] text-muted-foreground text-left">
              Rescheduling is part of good planning.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-1">
            <ReplanReasonChips
              onSelect={(r) => { setReplanCustomMode(false); setReplanReason(r); }}
              customSelected={replanCustomMode}
              customText={replanCustomText}
              onSelectCustom={() => setReplanCustomMode(true)}
              onCustomTextChange={setReplanCustomText}
            />
          </div>
          {replanCustomMode ? (
            <button onClick={saveCustomReplanReason} className="pace-btn-primary pace-btn-sm mt-3 w-full">Save reason</button>
          ) : (
            <button onClick={() => setReplanReason(null)} className="pace-btn-ghost pace-btn-sm mt-3 w-full">Skip</button>
          )}
        </DialogContent>
      </Dialog>

      <RescheduleDialog
        taskId={rescheduleId}
        open={!!rescheduleId}
        onClose={() => setRescheduleId(null)}
      />

      {/* Slot-choice: tap an empty calendar cell → pick task or rest. */}
      <Dialog open={!!slotChoice} onOpenChange={(o) => { if (!o) setSlotChoice(null); }}>
        <DialogContent className="max-w-xs rounded-3xl">
          <DialogHeader>
            <DialogTitle className="pace-title text-left">Add to this slot</DialogTitle>
            <DialogDescription className="text-[13px] text-muted-foreground text-left">
              {slotChoice && `${days[slotChoice.dayIdx].toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtTime(slotChoice.hour * 60)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 grid gap-2">
            <button
              onClick={() => {
                if (!slotChoice) return;
                const { dayIdx: di, hour } = slotChoice;
                setSlotChoice(null);
                createAt(di, hour);
              }}
              className="pace-btn-primary">
              <Plus className="w-4 h-4" /> New action
            </button>
            <button
              onClick={() => {
                if (!slotChoice) return;
                const { dayIdx: di, hour } = slotChoice;
                const date = toISODate(days[di]);
                const startTime = `${String(hour).padStart(2, '0')}:00`;
                const endTime = `${String(Math.min(hour + 1, 23)).padStart(2, '0')}:00`;
                setSlotChoice(null);
                setRestEdit({ date, startTime, endTime, label: 'Rest' });
              }}
              className="pace-btn">
              <Moon className="w-4 h-4" /> Add rest block
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <RestBlockDialog
        open={!!restEdit}
        initial={restEdit}
        onClose={() => setRestEdit(null)}
      />
    </AppShell>
  );

  async function toggleDone(ev: CalEvent) {
    if (!ev.taskId) return;
    const newStatus: Status = ev.status === 'done' ? 'in_progress' : 'done';
    try {
      await update.mutateAsync({ id: ev.taskId, patch: { status: newStatus } as any });
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not update.');
    }
  }

  async function createAt(dayI: number, hour: number) {
    if (!user) return;
    const title = window.prompt('New action');
    if (!title?.trim()) return;
    const date = toISODate(days[dayI]);
    const startTime = `${String(hour).padStart(2, '0')}:00:00`;
    const endTime = `${String(hour + 1).padStart(2, '0')}:00:00`;
    try {
      await insert.mutateAsync({
        title: title.trim(),
        domain: 'personal', priority: 'should', status: 'not_started',
        scheduled_date: date,
        duration_minutes: 60,
        start_time: startTime,
        end_time: endTime,
      } as any);
      toast.success('Added to your plan.');
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not add.');
    }
  }
}
