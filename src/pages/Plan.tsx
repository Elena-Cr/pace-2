import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import AppShell from '@/components/AppShell';
import { todayISO } from '@/lib/pace';
import { toast } from 'sonner';

const PROTECTED = [
  { label: 'Sleep', when: '11:30pm – 7:30am' },
  { label: 'Lunch', when: '12:30 – 1:00' },
  { label: 'Recovery walk', when: '5:00 – 5:30' },
];

export default function Plan() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [tasks, setTasks] = useState<any[]>([]);
  const [capacityHours, setCapacityHours] = useState(5.5);

  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);

  useEffect(() => {
    if (!user) return;
    supabase.from('tasks').select('*').neq('status', 'done').eq('is_rest', false)
      .order('deadline', { ascending: true, nullsFirst: false })
      .then(({ data }) => setTasks(data ?? []));
  }, [user]);

  const plannedMinutes = tasks.reduce((s, t) => s + (t.estimated_minutes || 0), 0);
  const capacityMinutes = Math.round(capacityHours * 60);
  const pct = Math.min(150, Math.round((plannedMinutes / capacityMinutes) * 100));
  const over = plannedMinutes > capacityMinutes;

  function fmt(min: number) {
    const h = Math.floor(min / 60); const m = min % 60;
    return `${h ? `${h}h ` : ''}${m}m`;
  }

  async function move(taskId: string) {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const { error } = await supabase.from('tasks').update({
      scheduled_for: tomorrow.toISOString().slice(0, 10),
      reschedule_count: tasks.find(t => t.id === taskId)?.reschedule_count + 1 || 1,
    }).eq('id', taskId);
    if (error) { toast.error(error.message); return; }
    setTasks(t => t.filter(x => x.id !== taskId));
    toast.success('Moved to tomorrow. Your rest is untouched.');
  }

  return (
    <AppShell>
      <h1 className="pace-title">Today's plan</h1>
      <div className="pace-eyebrow mt-1">{new Date().toLocaleDateString([], { weekday: 'long' })} · capacity {fmt(capacityMinutes)}</div>

      <div className="mt-5 pace-card">
        <div className="pace-eyebrow">Capacity inputs</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <label className="pace-field-label">Hours available</label>
            <input type="range" min={1} max={12} step={0.5} value={capacityHours}
              onChange={e => setCapacityHours(Number(e.target.value))} className="w-full accent-foreground" />
            <div className="font-mono text-[11px] mt-1">{capacityHours}h</div>
          </div>
          <div>
            <label className="pace-field-label">Energy</label>
            <div className="flex gap-1.5">
              {['Low','Med','High'].map(e => <span key={e} className={e === 'Med' ? 'pace-chip-filled' : 'pace-chip'}>{e}</span>)}
            </div>
          </div>
        </div>
      </div>

      <div className="pace-eyebrow mt-5 mb-1.5">Planned vs available</div>
      <div className={`pace-capacity ${over ? 'over' : ''}`}><i style={{ width: `${pct}%` }} /></div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{fmt(plannedMinutes)} planned</span>
        <span>{fmt(capacityMinutes)} available</span>
      </div>

      {over && (
        <div className="pace-alert mt-3 animate-fade-in">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            <span className="priority-dot must" />Looks like a lot for today
          </div>
          You're {fmt(plannedMinutes - capacityMinutes)} over capacity. Want to move one task, shorten one, or split it across two days?
          <div className="mt-2 flex gap-1.5 flex-wrap">
            <button onClick={() => tasks[0] && move(tasks[0].id)} className="pace-btn-primary pace-btn-sm">Move heaviest</button>
            <button className="pace-btn pace-btn-sm">Reduce scope</button>
            <button className="pace-btn pace-btn-sm">Split</button>
          </div>
        </div>
      )}

      <div className="pace-eyebrow mt-6 mb-2">Protected blocks</div>
      <div className="space-y-1.5">
        {PROTECTED.map(p => (
          <div key={p.label} className="pace-rest"><span>◯ {p.label}</span><span>{p.when}</span></div>
        ))}
      </div>

      <div className="pace-eyebrow mt-6 mb-2">Tasks today</div>
      <div className="space-y-2">
        {tasks.length === 0 && <div className="text-sm text-muted-foreground">Nothing scheduled. Capture something or rest — both count.</div>}
        {tasks.map(t => (
          <div key={t.id} className="pace-card flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="pace-eyebrow flex items-center"><span className={`priority-dot ${t.priority}`} />{t.title}</div>
              <div className="text-[12px] mt-0.5">{t.estimated_minutes ? fmt(t.estimated_minutes) : '—'}</div>
            </div>
            {t.estimated_minutes && <span className="pace-chip">+{Math.ceil(t.estimated_minutes * 0.15)}m buffer</span>}
          </div>
        ))}
      </div>
    </AppShell>
  );
}
