import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useTasks, useTaskMutations } from '@/hooks/useTasks';
import { useDailyCapacity, useUpsertCapacity } from '@/hooks/useDailyCapacity';
import AppShell from '@/components/AppShell';
import { todayISO, fmtMin, toISODate, formatDeadline } from '@/lib/pace';
import {
  getTodayTasks,
  getBacklog,
  calculateDailyWorkload,
  effectiveCapacityMinutes,
  buildReschedulePatch,
} from '@/lib/scheduling';
import { toast } from 'sonner';
import { Calendar as CalIcon } from 'lucide-react';

function fmtBlockTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const am = h < 12; const hh = ((h + 11) % 12) + 1;
  return `${hh}${m ? ':' + String(m).padStart(2, '0') : ''}${am ? 'a' : 'p'}`;
}

const ENERGIES = ['Low', 'Med', 'High'];

export default function Plan() {
  const { user, loading } = useAuth();
  const { profile: userProfile } = useUserProfile();
  const nav = useNavigate();
  const { data: allTasks = [] } = useTasks();
  const { update } = useTaskMutations();
  const today = todayISO();
  const { data: capacityRow } = useDailyCapacity(today);
  const upsertCapacity = useUpsertCapacity();

  const tasks = useMemo(() => getTodayTasks(allTasks, today), [allTasks, today]);
  const backlog = useMemo(() => getBacklog(allTasks), [allTasks]);

  // Slider value in minutes; null while we don't yet know the user's default.
  const [capacityMin, setCapacityMin] = useState<number | null>(null);
  const [energyLevel, setEnergyLevel] = useState('Med');
  const [recoveryNotes, setRecoveryNotes] = useState('');
  const hasCapacityRow = !!capacityRow;

  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);

  // Seed slider with capacity row when present, otherwise from the user profile default.
  useEffect(() => {
    if (capacityRow) {
      setCapacityMin(Math.round(Number(capacityRow.available_hours) * 60));
      setEnergyLevel(capacityRow.energy_level);
      setRecoveryNotes(capacityRow.recovery_notes ?? '');
    } else if (userProfile) {
      setCapacityMin(userProfile.daily_capacity_minutes);
    }
  }, [capacityRow, userProfile]);

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


  async function saveCapacity(partial: Partial<{ available_hours: number; energy_level: string; recovery_notes: string }>) {
    if (!user) return;
    await upsertCapacity.mutateAsync({
      date: today,
      available_hours: capacityHours,
      energy_level: energyLevel,
      recovery_notes: recoveryNotes || null,
      ...partial,
    });
  }

  const plannedMinutes = calculateDailyWorkload(tasks);
  const profileCapMin = userProfile?.daily_capacity_minutes ?? 330;
  const capacityMinutes = effectiveCapacityMinutes(
    { available_hours: capacityHours, energy_level: energyLevel },
    profileCapMin,
  );
  const pct = Math.min(150, Math.round((plannedMinutes / Math.max(1, capacityMinutes)) * 100));
  const over = plannedMinutes > capacityMinutes;
  const heavyTask = tasks.find(t => t.effort_level === 'Heavy' || (t.duration_minutes ?? 0) >= 90);

  async function move(taskId: string) {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const t = tasks.find(x => x.id === taskId);
    if (!t) return;
    try {
      await update.mutateAsync({ id: taskId, patch: buildReschedulePatch(t, toISODate(tomorrow)) });
      toast.success('Moved to tomorrow. Your rest is untouched.');
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not move.');
    }
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
        {(userProfile?.default_time_blocks ?? []).length === 0 && (
          <div className="text-sm text-muted-foreground">No protected time set. Add some in Settings.</div>
        )}
        {(userProfile?.default_time_blocks ?? []).map((p, i) => (
          <div key={`${p.label}-${i}`} className="pace-rest">
            <span>◯ {p.label}</span>
            <span>{fmtBlockTime(p.start)} – {fmtBlockTime(p.end)}</span>
          </div>
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

      {/* Backlog */}
      <div className="mt-6 flex items-center justify-between">
        <div className="pace-eyebrow">Backlog</div>
        <span className="pace-meta">{backlog.length} unscheduled</span>
      </div>
      <div className="mt-2 space-y-2">
        {backlog.length === 0 && (
          <div className="text-sm text-muted-foreground">Nothing waiting. Everything captured has a day.</div>
        )}
        {backlog.map(t => (
          <div key={t.id} className="pace-card">
            <button onClick={() => nav(`/task/${t.id}`)} className="w-full text-left">
              <div className="pace-eyebrow flex items-center"><span className={`priority-dot ${t.priority}`} />{t.title}</div>
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
    </AppShell>
  );
}
