import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useTasks } from '@/hooks/useTasks';
import { useTaskSuggestions, stem } from '@/hooks/useTaskSuggestions';
import AppShell from '@/components/AppShell';
import { DOMAIN_LABEL, DOMAIN_COLOR_VAR, Domain, fmtMin, todayISO, toISODate } from '@/lib/pace';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
  const [reflection, setReflection] = useState<number | null>(null);
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

  // Non-deadline high-value: priority "must" OR a stem that matches a
  // recurring template from the user's history.
  const recurringStems = useMemo(
    () => new Set(templates.map(t => stem(t.exampleTitle)).filter(Boolean)),
    [templates],
  );
  const noDeadline = tasks.filter(t =>
    !t.deadline
    && t.status !== 'done'
    && (t.priority === 'must' || recurringStems.has(stem(t.title)))
  );

  return (
    <AppShell>
      <h1 className="pace-screen-title">Weekly workload</h1>
      <div className="pace-eyebrow mt-1">Across academic, work, social, and personal</div>

      {/* Stacked bars */}
      <div className="mt-5 pace-card">
        <div className="flex items-center justify-between mb-3">
          <div className="pace-eyebrow">By day</div>
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
        <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
          {DOMAINS.map(d => (
            <span key={d} className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="w-3 h-3 rounded-sm" style={{ background: DOMAIN_COLOR_VAR[d] }} />
              {DOMAIN_LABEL[d]} · {fmtMin(totalsByDomain[d])}
            </span>
          ))}
        </div>
      </div>

      {/* Distribution */}
      <div className="mt-4 pace-card">
        <div className="pace-eyebrow mb-2">Distribution this week</div>
        {grandTotal === 0 ? (
          <div className="text-[14px] text-muted-foreground">Nothing scheduled yet. Capture a task or set a capacity in Plan.</div>
        ) : (
          <div className="space-y-2">
            {DOMAINS.map(d => {
              const pct = Math.round((totalsByDomain[d] / grandTotal) * 100);
              return (
                <div key={d}>
                  <div className="flex justify-between text-[13px]">
                    <span>{DOMAIN_LABEL[d]}</span>
                    <span className="text-muted-foreground">{pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden mt-1">
                    <div style={{ width: `${pct}%`, background: DOMAIN_COLOR_VAR[d] }} className="h-full rounded-full" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {noDeadline.length > 0 && (
        <div className="mt-4 pace-card">
          <div className="pace-eyebrow mb-2"><span className="priority-dot must" />Important without a deadline</div>
          <div className="space-y-2">
            {noDeadline.map(t => (
              <button key={t.id} onClick={() => nav(`/task/${t.id}`)} className="w-full text-left rounded-xl bg-muted px-3 py-2 text-[14px]">
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recovery reflection */}
      <div className="mt-4 pace-card">
        <div className="pace-eyebrow mb-2">Recovery reflection</div>
        <div className="text-[14px]">Did this plan leave enough time for rest and recovery?</div>
        <div className="mt-2 flex gap-1.5">
          {[1,2,3,4,5].map(n => (
            <button key={n} onClick={() => setReflection(n)}
              className={reflection === n ? 'pace-chip-filled' : 'pace-chip'}>
              {n}
            </button>
          ))}
        </div>
        {reflection !== null && (
          <div className="mt-2 text-[13px] text-muted-foreground">
            {reflection <= 2
              ? 'Noted. Try protecting one extra rest block next week.'
              : reflection >= 4
              ? 'Lovely. Worth keeping that pacing.'
              : 'Noted. We can adjust the next plan together.'}
          </div>
        )}
      </div>
    </AppShell>
  );
}
