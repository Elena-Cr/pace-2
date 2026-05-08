// @deprecated — The /plan screen has been retired. Its features were migrated:
//   • Proactive overload prompt → Home.tsx and Calendar.tsx (day view)
//   • Backlog-to-today scheduling shortcut → Home.tsx (Backlog section)
//   • Energy-by-time-of-day editor → Settings.tsx (already present as
//     energy_pattern.mode === 'period')
//   • Per-day recovery_notes / capacity slider → DayEnergyPicker on Home/Calendar
// The route has been removed from App.tsx. This file is retained for reference
// and will be deleted in a follow-up cleanup once nothing else depends on it.
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
  getRestBlocksForDate,
  getScheduledEvents,
  expandTimeBlocks,
  getTaskRestConflicts,
  calculateDailyWorkloadWithBuffer,
  bufferMinutes,
  effectiveCapacityMinutes,
  buildReschedulePatch,
} from '@/lib/scheduling';
import { toast } from 'sonner';
import { Calendar as CalIcon, Users, AlertTriangle } from 'lucide-react';

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
  // Optional per-period overrides; null = inherit the daily energyLevel.
  const [morningEnergy, setMorningEnergy] = useState<string | null>(null);
  const [afternoonEnergy, setAfternoonEnergy] = useState<string | null>(null);
  const [eveningEnergy, setEveningEnergy] = useState<string | null>(null);
  const [showPeriodEnergy, setShowPeriodEnergy] = useState(false);
  const hasCapacityRow = !!capacityRow;

  // Scroll restoration: save Y on navigation away, restore on mount.
  useEffect(() => {
    const saved = sessionStorage.getItem('plan:scrollY');
    if (saved) {
      const y = Number(saved);
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
    const onScroll = () => sessionStorage.setItem('plan:scrollY', String(window.scrollY));
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);

  // Seed slider with capacity row when present, otherwise from the user profile default.
  // Energy and per-period overrides default to the user's typical pattern when
  // there's no row yet for today.
  useEffect(() => {
    if (capacityRow) {
      setCapacityMin(Math.round(Number(capacityRow.available_hours) * 60));
      setEnergyLevel(capacityRow.energy_level);
      setRecoveryNotes(capacityRow.recovery_notes ?? '');
      setMorningEnergy(capacityRow.morning_energy ?? null);
      setAfternoonEnergy(capacityRow.afternoon_energy ?? null);
      setEveningEnergy(capacityRow.evening_energy ?? null);
      if (capacityRow.morning_energy || capacityRow.afternoon_energy || capacityRow.evening_energy) {
        setShowPeriodEnergy(true);
      }
    } else if (userProfile) {
      setCapacityMin(userProfile.daily_capacity_minutes);
      const pat = userProfile.energy_pattern;
      if (pat) {
        setEnergyLevel(pat.whole ?? 'Med');
        if (pat.mode === 'period') {
          setMorningEnergy(pat.morning ?? null);
          setAfternoonEnergy(pat.afternoon ?? null);
          setEveningEnergy(pat.evening ?? null);
          setShowPeriodEnergy(true);
        }
      }
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


  async function saveCapacity(partial: Partial<{
    available_hours: number;
    energy_level: string;
    recovery_notes: string | null;
    morning_energy: string | null;
    afternoon_energy: string | null;
    evening_energy: string | null;
  }>) {
    if (!user || capacityMin == null) return;
    await upsertCapacity.mutateAsync({
      date: today,
      available_hours: capacityMin / 60,
      energy_level: energyLevel,
      recovery_notes: recoveryNotes || null,
      morning_energy: morningEnergy,
      afternoon_energy: afternoonEnergy,
      evening_energy: eveningEnergy,
      ...partial,
    });
  }

  const plannedMinutes = calculateDailyWorkloadWithBuffer(tasks);
  const taskMinutesOnly = tasks.reduce((s, t) => s + (t.duration_minutes || 0), 0);
  const bufferTotal = plannedMinutes - taskMinutesOnly;
  const profileCapMin = userProfile?.daily_capacity_minutes ?? 330;
  const capacityReady = capacityMin != null;
  const capacityMinutes = effectiveCapacityMinutes(
    capacityReady ? { available_hours: (capacityMin as number) / 60, energy_level: energyLevel } : null,
    profileCapMin,
    { affects: userProfile?.energy_affects_capacity ?? true, pct: userProfile?.energy_capacity_pct ?? 10 },
  );
  const pct = Math.min(150, Math.round((plannedMinutes / Math.max(1, capacityMinutes)) * 100));
  const over = capacityReady && plannedMinutes > capacityMinutes;
  const heavyTask = tasks.find(t => t.effort_level === 'Heavy' || (t.duration_minutes ?? 0) >= 90);
  const preferredCount = userProfile?.preferred_tasks_per_day ?? null;
  const showPaceHint = preferredCount != null && tasks.length > preferredCount;

  // Conflict detection for today (tasks vs protected blocks).
  const planConflictTaskIds = useMemo(() => {
    const taskEvents = getScheduledEvents(tasks).filter(e => e.date === today);
    const blocks = (userProfile?.default_time_blocks ?? []).map(b => ({
      label: b.label, start: b.start, end: b.end, kind: b.kind as any, days: b.days,
    }));
    const blockEvents = expandTimeBlocks(blocks, today);
    const ids = getTaskRestConflicts([...taskEvents, ...blockEvents]);
    return new Set(Array.from(ids).map(id => id.replace(/^task-/, '')));
  }, [tasks, userProfile, today]);

  // Energy hint per task: if any period override matches the user's
  // typical pattern's "high" slot, surface a soft hint at the task's
  // scheduled time. Purely informational — no scheduling change.
  const energyHintByTaskId = useMemo(() => {
    const map = new Map<string, string>();
    const events = getScheduledEvents(tasks).filter(e => e.date === today && e.taskId);
    events.forEach(e => {
      const t = tasks.find(x => x.id === e.taskId);
      if (!t) return;
      const h = Math.floor(e.startMin / 60);
      const period = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
      const periodEnergy = period === 'morning' ? morningEnergy
        : period === 'afternoon' ? afternoonEnergy
        : eveningEnergy;
      // Hint only when this period is High and the task is heavier than light.
      if (periodEnergy === 'High' && (t.effort_level === 'Heavy' || (t.duration_minutes ?? 0) >= 60)) {
        map.set(t.id, `High energy ${period} — good fit for this`);
      }
    });
    return map;
  }, [tasks, today, morningEnergy, afternoonEnergy, eveningEnergy]);


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
      <div className="pace-eyebrow mt-1">{new Date().toLocaleDateString([], { weekday: 'long' })}{capacityReady ? ` · capacity ${fmtMin(capacityMinutes)}` : ''}</div>

      <div className="mt-5 pace-card">
        <div className="pace-eyebrow">Capacity for today</div>
        <div className="mt-3">
          {capacityReady ? (
            <>
              <label className="pace-field-label">Hours available · {((capacityMin as number) / 60).toFixed(1)}h</label>
              <input type="range" min={60} max={720} step={30} value={capacityMin as number}
                onChange={e => setCapacityMin(Number(e.target.value))}
                onMouseUp={() => saveCapacity({ available_hours: (capacityMin as number) / 60 })}
                onTouchEnd={() => saveCapacity({ available_hours: (capacityMin as number) / 60 })}
                className="w-full accent-primary" />
            </>
          ) : (
            <>
              <div className="pace-field-label">Hours available</div>
              <div className="h-2 rounded-full bg-muted animate-pulse" />
            </>
          )}
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

        {/* Optional per-period overrides on top of the daily energy. */}
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowPeriodEnergy(s => !s)}
            aria-expanded={showPeriodEnergy}
            className="text-[12px] font-medium text-primary inline-flex items-center gap-1">
            {showPeriodEnergy ? '− Hide' : '+ Show'} energy by time of day
          </button>
          {showPeriodEnergy && (
            <div className="mt-2 space-y-2">
              {([
                ['Morning', morningEnergy, setMorningEnergy, 'morning_energy'],
                ['Afternoon', afternoonEnergy, setAfternoonEnergy, 'afternoon_energy'],
                ['Evening', eveningEnergy, setEveningEnergy, 'evening_energy'],
              ] as const).map(([label, value, setter, key]) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="text-[12px] text-muted-foreground w-20 shrink-0">{label}</span>
                  <div className="flex gap-1 flex-1">
                    {ENERGIES.map(e => (
                      <button
                        key={e}
                        onClick={() => {
                          const next = value === e ? null : e;
                          setter(next);
                          saveCapacity({ [key]: next } as any);
                        }}
                        className={`flex-1 px-2 py-1 rounded-full text-[12px] font-medium ${value === e ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="pace-meta">Optional. Leave empty to use the daily level.</p>
            </div>
          )}
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
        <span>{capacityReady ? `${fmtMin(capacityMinutes)} available` : '— available'}</span>
      </div>

      {showPaceHint && (
        <div className="pace-card-soft mt-3 animate-fade-in text-[13px] text-muted-foreground">
          Today has {tasks.length} actions; your usual rhythm is {preferredCount}. Want to move some to backlog?
        </div>
      )}

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

      <div className="pace-eyebrow mt-6 mb-2">Actions today</div>
      <div className="space-y-2">
        {tasks.length === 0 && <div className="text-sm text-muted-foreground">Nothing scheduled. Capture something or rest — both count.</div>}
        {tasks.map(t => {
          const conflict = planConflictTaskIds.has(t.id);
          const energyHint = energyHintByTaskId.get(t.id);
          return (
            <button key={t.id} onClick={() => nav(`/task/${t.id}`)} className="pace-card w-full text-left flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="pace-eyebrow flex items-center"><span className={`priority-dot ${t.priority}`} />{t.title}</div>
                <div className="text-[12px] mt-0.5">{t.duration_minutes ? fmtMin(t.duration_minutes) : '—'}{t.effort_level ? ` · ${t.effort_level}` : ''}</div>
                <div className="mt-1 flex flex-wrap gap-1.5 items-center text-[11px] text-muted-foreground">
                  {(t.involves_others || t.others_rely) && (
                    <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" />{t.others_rely ? 'Others rely' : 'Involves others'}</span>
                  )}
                  {(t.reschedule_count ?? 0) >= 2 && (
                    <span>· Rescheduled {t.reschedule_count}×</span>
                  )}
                  {conflict && (
                    <span className="inline-flex items-center gap-1 text-[hsl(var(--attention))]">
                      · <AlertTriangle className="w-3 h-3" /> overlaps rest
                    </span>
                  )}
                  {energyHint && (
                    <span className="text-[hsl(var(--success))]">· {energyHint}</span>
                  )}
                </div>
              </div>
              {t.duration_minutes && <span className="pace-chip">+{bufferMinutes(t)}m buffer</span>}
            </button>
          );
        })}
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
                {(t.reschedule_count ?? 0) >= 2 && ` · Rescheduled ${t.reschedule_count}×`}
              </div>
              {(t.involves_others || t.others_rely) && (
                <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Users className="w-3 h-3" />{t.others_rely ? 'Others rely' : 'Involves others'}
                </div>
              )}
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
