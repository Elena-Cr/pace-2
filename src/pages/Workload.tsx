import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useTasks } from '@/hooks/useTasks';
import { useTaskSuggestions, stem } from '@/hooks/useTaskSuggestions';
import AppShell from '@/components/AppShell';
import { DOMAIN_LABEL, DOMAIN_COLOR_VAR, Domain, fmtMin, todayISO, toISODate } from '@/lib/pace';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { workloadByDate } from '@/lib/scheduling';

const DOMAINS: Domain[] = ['academic', 'work', 'social', 'personal'];

function startOfWeek(d = new Date()) {
  const day = d.getDay(); // 0 Sun
  const diff = (day + 6) % 7; // Mon-start
  const x = new Date(d); x.setDate(d.getDate() - diff); x.setHours(0,0,0,0);
  return x;
}

export default function Workload() {
  const { user, loading } = useAuth();
  const { profile: userProfile } = useUserProfile();
  const nav = useNavigate();
  const { data: allTasks = [] } = useTasks();
  const { templates } = useTaskSuggestions(user?.id);
  
  const [weekOffset, setWeekOffset] = useState(0);

  const dailyCapMin = userProfile?.daily_capacity_minutes ?? 330;

  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);

  const weekStart = useMemo(() => {
    const s = startOfWeek();
    s.setDate(s.getDate() + weekOffset * 7);
    return s;
  }, [weekOffset]);

  // Limit to the visible week window.
  const tasks = useMemo(() => {
    const start = toISODate(weekStart);
    const end = new Date(weekStart); end.setDate(weekStart.getDate() + 6);
    const endIso = toISODate(end);
    return allTasks.filter(t => t.scheduled_date && t.scheduled_date >= start && t.scheduled_date <= endIso);
  }, [allTasks, weekStart]);

  const week = useMemo(() => {
    // Total minutes per day comes from the shared helper so every view agrees.
    const totalsByDate = workloadByDate(tasks.filter(t => !t.is_rest));
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
      const iso = toISODate(d);
      const dayTasks = tasks.filter(t => t.scheduled_date === iso && !t.is_rest);
      const totals: Record<Domain, number> = { academic: 0, work: 0, social: 0, personal: 0 };
      dayTasks.forEach(t => {
        const m = t.duration_minutes || 30;
        if (t.domain) totals[t.domain as Domain] += m;
      });
      return { date: d, iso, totals, rest: 0, total: totalsByDate[iso] || 0, count: dayTasks.length };
    });
  }, [tasks, weekStart]);

  const weekEnd = useMemo(() => {
    const e = new Date(weekStart); e.setDate(weekStart.getDate() + 6); return e;
  }, [weekStart]);
  const weekRangeLabel = weekOffset === 0
    ? 'This week'
    : weekOffset === 1
    ? 'Next week'
    : weekOffset === -1
    ? 'Last week'
    : `${weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;

  // Scale: at least capacity + 2h headroom, but grow if any day exceeds that
  // so the tallest bar always fills the chart and shorter days stay proportional.
  const weekMax = Math.max(0, ...week.map(d => d.total));
  const maxMin = Math.max(60, dailyCapMin + 120, weekMax);
  const totalsByDomain = DOMAINS.reduce((acc, d) => {
    acc[d] = week.reduce((s, w) => s + w.totals[d], 0);
    return acc;
  }, {} as Record<Domain, number>);
  const grandTotal = Object.values(totalsByDomain).reduce((a, b) => a + b, 0);


  return (
    <AppShell>
      <h1 className="pace-screen-title">Weekly workload</h1>
      <div className="pace-eyebrow mt-1">Across academic, work, social, and personal</div>

      {/* Stacked bars */}
      <div className="mt-5 pace-card !py-3">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setWeekOffset(o => o - 1)}
              aria-label="Previous week"
              className="rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-muted">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="pace-eyebrow w-20 text-center flex items-center justify-center whitespace-normal break-words leading-tight">{weekRangeLabel}</div>
            <button
              onClick={() => setWeekOffset(o => o + 1)}
              aria-label="Next week"
              className="rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-muted">
              <ChevronRight className="w-4 h-4" />
            </button>
            {weekOffset !== 0 && (
              <button onClick={() => setWeekOffset(0)} className="ml-1 text-[11px] font-medium text-primary">Today</button>
            )}
          </div>
          <div className="pace-meta">capacity {fmtMin(dailyCapMin)}/day</div>
        </div>
        <div className="relative flex items-end gap-2 h-44">
          {/* Capacity reference line */}
          <div
            className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-primary/50"
            style={{ bottom: `${(dailyCapMin / maxMin) * 100}%` }}
          >
            <span className="absolute -top-4 right-0 text-[10px] text-primary/80 font-medium">
              capacity
            </span>
          </div>
          {week.map(w => {
            const isToday = w.iso === todayISO();
            return (
              <div key={w.iso} className="flex-1 flex flex-col items-center gap-1.5 min-w-0 h-full">
                <div className="w-full flex-1 flex items-end">
                  <div className="w-full rounded-t-lg overflow-hidden flex flex-col-reverse" style={{ height: `${(w.total / maxMin) * 100}%`, minHeight: w.total > 0 ? 4 : 0 }}>
                    {DOMAINS.map(d => {
                      if (w.totals[d] <= 0) return null;
                      const h = (w.totals[d] / Math.max(1, w.total)) * 100;
                      return <div key={d} style={{ height: `${h}%`, background: DOMAIN_COLOR_VAR[d], minHeight: 2 }} />;
                    })}
                    {w.total === 0 && <div className="h-1 rounded-t-lg bg-muted" />}
                  </div>
                </div>
                <div className={`text-[11px] font-medium ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                  {w.date.toLocaleDateString([], { weekday: 'narrow' })}
                </div>
                <div className="text-[10px] text-muted-foreground">{w.total ? fmtMin(w.total) : '—'}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex-wrap text-xs font-thin font-sans text-justify my-[5px] flex items-start justify-start gap-[5px] rounded-none">
          {DOMAINS.map(d => (
            <span key={d} className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="w-3 h-3 rounded-sm" style={{ background: DOMAIN_COLOR_VAR[d] }} />
              {DOMAIN_LABEL[d]} · {fmtMin(totalsByDomain[d])}
            </span>
          ))}
        </div>
      </div>

      {/* Domain distribution — horizontal stacked bar with inline % */}
      {grandTotal > 0 && (
        <div className="mt-4">
          <div className="flex h-10 w-full rounded-xl overflow-hidden border border-border/40">
            {DOMAINS.map(d => {
              const pct = (totalsByDomain[d] / grandTotal) * 100;
              if (pct <= 0) return null;
              const rounded = Math.round(pct);
              return (
                <div
                  key={d}
                  className="flex items-center justify-center text-[12px] font-semibold text-white/95"
                  style={{ width: `${pct}%`, background: DOMAIN_COLOR_VAR[d] }}
                  title={`${DOMAIN_LABEL[d]} · ${rounded}%`}
                >
                  {pct >= 8 ? `${rounded}%` : ''}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            {DOMAINS.map(d => (
              <span key={d} className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm" style={{ background: DOMAIN_COLOR_VAR[d] }} />
                {DOMAIN_LABEL[d]}
              </span>
            ))}
          </div>
        </div>
      )}


      {/* Insights — collapsible */}
      <Insights
        weekTotalMin={grandTotal}
        weekCapMin={dailyCapMin * 7}
        tasks={tasks}
      />

    </AppShell>
  );
}

function Insights({ weekTotalMin, weekCapMin, tasks }: { weekTotalMin: number; weekCapMin: number; tasks: any[] }) {
  const [open, setOpen] = useState(false);
  const pct = weekCapMin > 0 ? Math.min(999, Math.round((weekTotalMin / weekCapMin) * 100)) : 0;
  const overBy = Math.max(0, weekTotalMin - weekCapMin);
  const underBy = Math.max(0, weekCapMin - weekTotalMin);

  const counts = useMemo(() => {
    const c = { not_started: 0, in_progress: 0, done: 0 };
    tasks.forEach(t => {
      if (t.is_rest) return;
      if (t.status === 'done') c.done += 1;
      else if (t.status === 'in_progress' || t.status === 'started' || t.status === 'nearly_done') c.in_progress += 1;
      else c.not_started += 1;
    });
    return c;
  }, [tasks]);
  const total = counts.not_started + counts.in_progress + counts.done;

  const STATUS = [
    { k: 'not_started' as const, label: 'Not started', color: 'hsl(var(--muted-foreground))' },
    { k: 'in_progress' as const, label: 'In progress', color: 'hsl(var(--primary))' },
    { k: 'done' as const,        label: 'Completed',   color: 'hsl(var(--success))' },
  ];

  return (
    <div className="mt-4 pace-card">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between"
        aria-expanded={open}
      >
        <div className="pace-eyebrow">Insights</div>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-5 animate-fade-in">
          {/* Workload vs capacity */}
          <div>
            <div className="text-[13px] font-semibold mb-1">Workload vs. capacity</div>
            <div className="text-[12px] text-muted-foreground mb-2">
              {fmtMin(weekTotalMin)} planned of {fmtMin(weekCapMin)} weekly capacity · {pct}%
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, pct)}%`,
                  background: pct > 100 ? 'hsl(var(--attention))' : 'hsl(var(--primary))',
                }}
              />
            </div>
            <div className="mt-2 text-[12px] text-muted-foreground">
              {overBy > 0
                ? `Over capacity by ${fmtMin(overBy)} this week.`
                : `Room for ${fmtMin(underBy)} more this week.`}
            </div>
          </div>

          {/* Status distribution */}
          <div>
            <div className="text-[13px] font-semibold mb-2">Status distribution</div>
            {total === 0 ? (
              <div className="text-[13px] text-muted-foreground">No actions scheduled this week yet.</div>
            ) : (
              <>
                <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                  {STATUS.map(s => {
                    const w = (counts[s.k] / total) * 100;
                    if (w === 0) return null;
                    return <div key={s.k} style={{ width: `${w}%`, background: s.color }} />;
                  })}
                </div>
                <div className="mt-2 space-y-1">
                  {STATUS.map(s => (
                    <div key={s.k} className="flex items-center justify-between text-[12px]">
                      <span className="inline-flex items-center gap-1.5 text-foreground">
                        <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                        {s.label}
                      </span>
                      <span className="text-muted-foreground">{counts[s.k]} · {Math.round((counts[s.k] / total) * 100)}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
