import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import AppShell from '@/components/AppShell';
import { DOMAIN_LABEL, Domain, fmtMin, todayISO, toISODate } from '@/lib/pace';

const DOMAINS: Domain[] = ['academic', 'work', 'social', 'personal'];

const DOMAIN_HUE: Record<Domain, string> = {
  academic: 'hsl(var(--secondary))',
  work: 'hsl(var(--primary))',
  social: 'hsl(var(--warning))',
  personal: 'hsl(var(--success))',
};

function startOfWeek(d = new Date()) {
  const day = d.getDay(); // 0 Sun
  const diff = (day + 6) % 7; // Mon-start
  const x = new Date(d); x.setDate(d.getDate() - diff); x.setHours(0,0,0,0);
  return x;
}

export default function Workload() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [tasks, setTasks] = useState<any[]>([]);
  const [reflection, setReflection] = useState<number | null>(null);

  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);

  useEffect(() => {
    if (!user) return;
    const start = toISODate(startOfWeek());
    const end = new Date(); end.setDate(end.getDate() + 14);
    supabase.from('tasks').select('*')
      .gte('scheduled_date', start)
      .lte('scheduled_date', toISODate(end))
      .then(({ data }) => setTasks(data ?? []));
  }, [user]);

  const week = useMemo(() => {
    const start = startOfWeek();
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const iso = toISODate(d);
      const dayTasks = tasks.filter(t => t.scheduled_date === iso && !t.is_rest);
      const totals: Record<Domain, number> = { academic: 0, work: 0, social: 0, personal: 0 };
      let rest = 0;
      let total = 0;
      dayTasks.forEach(t => {
        const m = t.duration_minutes || 30;
        total += m;
        if (t.is_rest) rest += m;
        else if (t.domain) totals[t.domain as Domain] += m;
      });
      return { date: d, iso, totals, rest, total, count: dayTasks.length };
    });
  }, [tasks]);

  const maxMin = Math.max(60, ...week.map(d => d.total));
  const totalsByDomain = DOMAINS.reduce((acc, d) => {
    acc[d] = week.reduce((s, w) => s + w.totals[d], 0);
    return acc;
  }, {} as Record<Domain, number>);
  const grandTotal = Object.values(totalsByDomain).reduce((a, b) => a + b, 0);

  // Non-deadline high-value
  const noDeadline = tasks.filter(t => !t.deadline && t.priority === 'must' && t.status !== 'done');

  return (
    <AppShell>
      <h1 className="pace-screen-title">Weekly workload</h1>
      <div className="pace-eyebrow mt-1">Across academic, work, social, and personal</div>

      {/* Stacked bars */}
      <div className="mt-5 pace-card">
        <div className="pace-eyebrow mb-3">By day</div>
        <div className="flex items-end gap-2 h-44">
          {week.map(w => {
            const isToday = w.iso === todayISO();
            return (
              <div key={w.iso} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                <div className="w-full flex-1 flex items-end">
                  <div className="w-full rounded-t-lg overflow-hidden flex flex-col-reverse" style={{ height: '100%' }}>
                    {DOMAINS.map(d => {
                      const h = (w.totals[d] / maxMin) * 100;
                      if (h <= 0) return null;
                      return <div key={d} style={{ height: `${h}%`, background: DOMAIN_HUE[d], minHeight: 2 }} />;
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
              <span className="w-3 h-3 rounded-sm" style={{ background: DOMAIN_HUE[d] }} />
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
                    <div style={{ width: `${pct}%`, background: DOMAIN_HUE[d] }} className="h-full rounded-full" />
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
