import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile } from '@/hooks/useUserProfile';
import AppShell from '@/components/AppShell';
import TaskCard from '@/components/TaskCard';
import { greeting, todayISO, toISODate, Status, STATUS_LABEL, Domain, DOMAIN_LABEL, fmtMin, formatDeadline } from '@/lib/pace';
import { toast } from 'sonner';
import { Calendar as CalIcon, Timer, Plus, ArrowRight, Sparkles, Moon, Sun, Coffee, Settings as SettingsIcon } from 'lucide-react';

const FILTERS: { k: 'all' | Status; label: string }[] = [
  { k: 'all', label: 'All' },
  { k: 'in_progress', label: STATUS_LABEL.in_progress },
  { k: 'blocked', label: STATUS_LABEL.blocked },
  { k: 'nearly_done', label: STATUS_LABEL.nearly_done },
];

const DOMAIN_BAR: Record<Domain | 'rest', string> = {
  academic: 'bg-[hsl(var(--domain-academic))]',
  work: 'bg-[hsl(var(--domain-work))]',
  social: 'bg-[hsl(var(--domain-social))]',
  personal: 'bg-[hsl(var(--domain-personal))]',
  rest: 'bg-[hsl(var(--domain-rest))]',
};

export default function Home() {
  const { user, profile, loading } = useAuth();
  const { profile: userProfile, loading: upLoading } = useUserProfile();
  const nav = useNavigate();
  const [tasks, setTasks] = useState<any[]>([]);
  const [missed, setMissed] = useState<any[]>([]);
  const [doneToday, setDoneToday] = useState<any[]>([]);
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [capacity, setCapacity] = useState<{ available_hours: number; energy_level: string } | null>(null);
  const [focusToday, setFocusToday] = useState<{ count: number; minutes: number }>({ count: 0, minutes: 0 });
  const [tomorrowCount, setTomorrowCount] = useState(0);

  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);
  useEffect(() => {
    if (!upLoading && user && userProfile && !userProfile.onboarding_completed) {
      nav('/onboarding', { replace: true });
    }
  }, [upLoading, user, userProfile, nav]);
  useEffect(() => { if (user) load(); }, [user]);

  async function load() {
    const today = todayISO();
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = toISODate(tomorrow);

    const { data, error } = await supabase
      .from('tasks').select('*')
      .order('priority', { ascending: true })
      .order('deadline', { ascending: true, nullsFirst: false })
      .limit(100);
    if (error) { toast.error(error.message); return; }
    const all = data ?? [];

    const open = all.filter(t => t.status !== 'done');
    setTasks(open.filter(t => !t.scheduled_date || t.scheduled_date >= today));
    setMissed(open.filter(t => t.scheduled_date && t.scheduled_date < today && !t.is_rest));
    setDoneToday(all.filter(t => t.status === 'done' && (t.updated_at ?? '').slice(0, 10) === today));
    setTomorrowCount(open.filter(t => t.scheduled_date === tomorrowStr && !t.is_rest).length);

    const { data: cap } = await supabase.from('daily_capacity').select('available_hours, energy_level').eq('date', today).maybeSingle();
    setCapacity(cap as any);

    const since = new Date(); since.setHours(0, 0, 0, 0);
    const { data: sessions } = await supabase.from('focus_sessions').select('planned_minutes, ended_at')
      .gte('started_at', since.toISOString());
    const list = sessions ?? [];
    setFocusToday({ count: list.length, minutes: list.reduce((s, x: any) => s + (x.planned_minutes || 0), 0) });
  }

  async function nudge(id: string, kind: 'start' | 'reschedule' | 'block') {
    if (kind === 'start') { nav('/focus', { state: { taskId: id, minutes: 15 } }); return; }
    const t = missed.find(x => x.id === id); if (!t) return;
    if (kind === 'reschedule') {
      await supabase.from('tasks').update({
        scheduled_date: todayISO(),
        reschedule_count: (t.reschedule_count || 0) + 1,
        status: 'rescheduled',
      }).eq('id', id);
      toast.success('Carried to today.');
    } else {
      await supabase.from('tasks').update({ status: 'blocked' }).eq('id', id);
      toast.success('Marked as blocked. Not your fault.');
    }
    load();
  }

  const today = new Date();
  const dateStr = today.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const todayStr = todayISO();

  const todayTasks = useMemo(() => tasks.filter(t => t.scheduled_date === todayStr && !t.is_rest), [tasks, todayStr]);
  const restBlocks = useMemo(() => tasks.filter(t => t.is_rest && (!t.scheduled_date || t.scheduled_date === todayStr)), [tasks, todayStr]);
  const real = todayTasks;
  const filtered = filter === 'all' ? real : real.filter(t => t.status === filter);

  // Capacity math
  const capH = capacity ? Number(capacity.available_hours) : 5.5;
  const energy = capacity?.energy_level ?? 'Med';
  const mult = energy === 'Low' ? 0.75 : energy === 'High' ? 1.1 : 1;
  const capMin = Math.round(capH * 60 * mult);
  const plannedMin = real.reduce((s, t) => s + (t.duration_minutes || 0), 0);
  const ratio = plannedMin / Math.max(1, capMin);
  const capState: 'balanced' | 'close' | 'over' = ratio > 1 ? 'over' : ratio > 0.85 ? 'close' : 'balanced';
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

  // Next up: prefer in_progress, else nearest
  const nextUp = useMemo(() => {
    const inProg = real.find(t => t.status === 'in_progress');
    if (inProg) return inProg;
    return [...real].sort((a, b) => {
      const ap = a.priority === 'must' ? 0 : a.priority === 'should' ? 1 : 2;
      const bp = b.priority === 'must' ? 0 : b.priority === 'should' ? 1 : 2;
      return ap - bp;
    })[0];
  }, [real]);

  const completionPct = real.length === 0 ? 0 : Math.round((doneToday.length / (real.length + doneToday.length)) * 100);

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
      <div className="pace-eyebrow">{dateStr}</div>
      <h1 className="pace-screen-title mt-1">{greeting()}, {profile?.display_name ?? 'friend'}</h1>
      <p className="pace-meta mt-1">
        {real.length === 0
          ? 'A clear day. Add an intention when you are ready.'
          : `${real.length} ${real.length === 1 ? 'thing' : 'things'} planned · ${fmtMin(plannedMin) || '—'} of work`}
      </p>

      {/* Capacity dashboard card */}
      <div className="pace-card mt-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="pace-eyebrow">Today's capacity</div>
            <div className="pace-title mt-0.5">{fmtMin(plannedMin) || '0m'} <span className="text-muted-foreground text-[14px] font-normal">of {fmtMin(capMin)}</span></div>
          </div>
          <span className={`rounded-full px-3 py-1 text-[11px] font-medium ${capChipClass}`}>{capLabel}</span>
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
          <span>Energy · {energy}</span>
          <button onClick={() => nav('/workload')} className="text-[12px] font-medium text-primary inline-flex items-center gap-1">
            Workload <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Quick stats */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button onClick={() => nav('/calendar')} className="pace-card !p-3 text-left">
          <div className="pace-eyebrow">Done</div>
          <div className="text-[20px] font-semibold mt-0.5">{doneToday.length}</div>
          <div className="pace-meta">{completionPct}% of today</div>
        </button>
        <button onClick={() => nav('/focus')} className="pace-card !p-3 text-left">
          <div className="pace-eyebrow">Focus</div>
          <div className="text-[20px] font-semibold mt-0.5">{focusToday.count}</div>
          <div className="pace-meta">{fmtMin(focusToday.minutes) || '0m'}</div>
        </button>
        <button onClick={() => nav('/calendar')} className="pace-card !p-3 text-left">
          <div className="pace-eyebrow">Tomorrow</div>
          <div className="text-[20px] font-semibold mt-0.5">{tomorrowCount}</div>
          <div className="pace-meta">{tomorrowCount === 1 ? 'item' : 'items'}</div>
        </button>
      </div>

      {/* Up next */}
      {nextUp && (
        <div className="pace-card mt-3">
          <div className="flex items-center justify-between">
            <div className="pace-eyebrow inline-flex items-center gap-1.5"><Sparkles className="w-3 h-3" /> Up next</div>
            <span className="pace-meta">{formatDeadline(nextUp.deadline)}</span>
          </div>
          <div className="mt-1.5 flex items-start gap-2">
            <span className={`w-1 self-stretch rounded-full ${DOMAIN_BAR[(nextUp.domain || 'personal') as Domain]}`} />
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-medium leading-snug truncate">{nextUp.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                {nextUp.domain && <span>{DOMAIN_LABEL[nextUp.domain as Domain]}</span>}
                {nextUp.duration_minutes != null && <span>· {fmtMin(nextUp.duration_minutes)}</span>}
                {nextUp.next_action && <span>· {nextUp.next_action}</span>}
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

      {/* Domain breakdown */}
      {real.length > 0 && (
        <div className="mt-3 flex gap-1.5 flex-wrap">
          {(Object.keys(domainCounts) as Array<Domain>).map(d => (
            <span key={d} className="pace-chip">
              <span className={`w-1.5 h-1.5 rounded-full ${DOMAIN_BAR[d]}`} />
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

      {/* Quick actions */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={() => nav('/capture')} className="pace-btn-primary"><Plus className="w-4 h-4" /> New intention</button>
        <button onClick={() => nav('/calendar')} className="pace-btn"><CalIcon className="w-4 h-4" /> Calendar</button>
      </div>

      {/* Needs attention */}
      {missed.length > 0 && (
        <div className="mt-6 space-y-2.5">
          <div className="pace-eyebrow"><span className="priority-dot must" />Needs attention</div>
          {missed.slice(0, 3).map(t => (
            <div key={t.id} className="pace-alert animate-fade-in">
              <div className="text-[14px] font-medium">{t.title}</div>
              <div className="text-[13px] mt-1">This task needs attention. What would help now?</div>
              <div className="mt-2 flex gap-1.5 flex-wrap">
                <button onClick={() => nudge(t.id, 'start')} className="pace-btn-primary pace-btn-sm">Start now</button>
                <button onClick={() => nudge(t.id, 'reschedule')} className="pace-btn pace-btn-sm">Reschedule</button>
                <button onClick={() => nudge(t.id, 'block')} className="pace-btn pace-btn-sm">Mark blocked</button>
                <button onClick={() => nav(`/task/${t.id}`)} className="pace-btn-ghost pace-btn-sm">Open</button>
              </div>
            </div>
          ))}
          {missed.length > 3 && (
            <button onClick={() => nav('/replan')} className="pace-btn-ghost w-full">See {missed.length - 3} more in Replan</button>
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
            className={filter === f.k ? 'pace-chip-filled shrink-0' : 'pace-chip shrink-0'}>{f.label}</button>
        ))}
      </div>

      <div className="mt-3 space-y-2.5">
        {filtered.length === 0 && restBlocks.length === 0 && (
          <div className="pace-card-soft text-sm text-muted-foreground">
            Nothing on today's list. Tap <span className="font-semibold text-foreground">New intention</span> above to add something — title is the only thing required.
          </div>
        )}

        {filtered.map((t) => (
          <TaskCard key={t.id} task={t} onOpen={(task) => nav(`/task/${task.id}`)} />
        ))}

        {filter === 'all' && restBlocks.map(t => (
          <div key={t.id} className="pace-rest">
            <span>◯ {t.title}</span>
            <span>{t.next_action ?? ''}</span>
          </div>
        ))}

        {doneToday.length > 0 && (
          <div className="pace-card-soft mt-4 text-[12px] text-muted-foreground">
            ✓ {doneToday.length} {doneToday.length === 1 ? 'thing done' : 'things done'} today. Nice pacing.
          </div>
        )}
      </div>
    </AppShell>
  );
}
