import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import AppShell from '@/components/AppShell';
import { todayISO, fmtMin } from '@/lib/pace';
import { toast } from 'sonner';

const PROTECTED = [
  { label: 'Sleep', when: '11:30pm – 7:30am' },
  { label: 'Lunch', when: '12:30 – 1:00' },
  { label: 'Recovery walk', when: '5:00 – 5:30' },
];

const ENERGIES = ['Low', 'Med', 'High'];

export default function Plan() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [tasks, setTasks] = useState<any[]>([]);
  const [capacityHours, setCapacityHours] = useState(5.5);
  const [energyLevel, setEnergyLevel] = useState('Med');
  const [recoveryNotes, setRecoveryNotes] = useState('');

  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);

  useEffect(() => {
    if (!user) return;
    supabase.from('tasks').select('*').neq('status', 'done').eq('is_rest', false)
      .order('deadline', { ascending: true, nullsFirst: false })
      .then(({ data }) => setTasks(data ?? []));
    supabase.from('daily_capacity').select('*').eq('date', todayISO()).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setCapacityHours(Number(data.available_hours));
          setEnergyLevel(data.energy_level);
          setRecoveryNotes(data.recovery_notes ?? '');
        }
      });
  }, [user]);

  async function saveCapacity(partial: Partial<{ available_hours: number; energy_level: string; recovery_notes: string }>) {
    if (!user) return;
    const payload = {
      user_id: user.id,
      date: todayISO(),
      available_hours: capacityHours,
      energy_level: energyLevel,
      recovery_notes: recoveryNotes || null,
      ...partial,
    };
    await supabase.from('daily_capacity').upsert(payload, { onConflict: 'user_id,date' });
  }

  const plannedMinutes = tasks.reduce((s, t) => s + (t.duration_minutes || 0), 0);
  const energyMultiplier = energyLevel === 'Low' ? 0.75 : energyLevel === 'High' ? 1.1 : 1;
  const capacityMinutes = Math.round(capacityHours * 60 * energyMultiplier);
  const pct = Math.min(150, Math.round((plannedMinutes / Math.max(1, capacityMinutes)) * 100));
  const over = plannedMinutes > capacityMinutes;
  const heavyTask = tasks.find(t => t.effort_level === 'Heavy' || (t.duration_minutes ?? 0) >= 90);

  async function move(taskId: string) {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const t = tasks.find(x => x.id === taskId);
    const { error } = await supabase.from('tasks').update({
      scheduled_date: tomorrow.toISOString().slice(0, 10),
      reschedule_count: (t?.reschedule_count || 0) + 1,
      status: 'rescheduled',
    }).eq('id', taskId);
    if (error) { toast.error(error.message); return; }
    setTasks(t => t.filter(x => x.id !== taskId));
    toast.success('Moved to tomorrow. Your rest is untouched.');
  }

  return (
    <AppShell>
      <h1 className="pace-screen-title">Today's plan</h1>
      <div className="pace-eyebrow mt-1">{new Date().toLocaleDateString([], { weekday: 'long' })} · capacity {fmtMin(capacityMinutes)}</div>

      <div className="mt-5 pace-card">
        <div className="pace-eyebrow">Capacity for today</div>
        <div className="mt-3">
          <label className="pace-field-label">Hours available · {capacityHours}h</label>
          <input type="range" min={1} max={12} step={0.5} value={capacityHours}
            onChange={e => setCapacityHours(Number(e.target.value))}
            onMouseUp={() => saveCapacity({ available_hours: capacityHours })}
            onTouchEnd={() => saveCapacity({ available_hours: capacityHours })}
            className="w-full accent-primary" />
        </div>
        <div className="mt-3">
          <label className="pace-field-label">Energy</label>
          <div className="flex gap-1.5">
            {ENERGIES.map(e => (
              <button key={e} onClick={() => { setEnergyLevel(e); saveCapacity({ energy_level: e }); }}
                className={energyLevel === e ? 'pace-chip-filled' : 'pace-chip'}>{e}</button>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <label className="pace-field-label">Recovery needs (optional)</label>
          <input className="pace-field" value={recoveryNotes}
            onChange={e => setRecoveryNotes(e.target.value)}
            onBlur={() => saveCapacity({ recovery_notes: recoveryNotes })}
            placeholder="e.g. early night, extra walk" />
        </div>
      </div>

      <div className="pace-eyebrow mt-5 mb-1.5">Planned vs available</div>
      <div className={`pace-capacity ${over ? 'over' : ''}`}><i style={{ width: `${pct}%` }} /></div>
      <div className="mt-1.5 flex justify-between text-[12px] text-muted-foreground">
        <span>{fmtMin(plannedMinutes)} planned</span>
        <span>{fmtMin(capacityMinutes)} available</span>
      </div>

      {over && (
        <div className="pace-alert mt-3 animate-fade-in">
          <div className="pace-eyebrow mb-1">
            <span className="priority-dot should" />Your plan may need adjustment today
          </div>
          You're {fmtMin(plannedMinutes - capacityMinutes)} over capacity. Want to move one task, shorten one, or split it across two days? Your rest stays protected either way.
          <div className="mt-2 flex gap-1.5 flex-wrap">
            {heavyTask && (
              <button onClick={() => move(heavyTask.id)} className="pace-btn-primary pace-btn-sm">Move "{heavyTask.title.slice(0, 22)}"</button>
            )}
            <button onClick={() => nav('/replan')} className="pace-btn pace-btn-sm">Replan together</button>
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
          <button key={t.id} onClick={() => nav(`/task/${t.id}`)} className="pace-card w-full text-left flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="pace-eyebrow flex items-center"><span className={`priority-dot ${t.priority}`} />{t.title}</div>
              <div className="text-[12px] mt-0.5">{t.duration_minutes ? fmtMin(t.duration_minutes) : '—'}{t.effort_level ? ` · ${t.effort_level}` : ''}</div>
            </div>
            {t.duration_minutes && <span className="pace-chip">+{Math.ceil(t.duration_minutes * 0.15)}m buffer</span>}
          </button>
        ))}
      </div>
    </AppShell>
  );
}
