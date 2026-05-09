import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import ReplanReasonChips from '@/components/ReplanReasonChips';
import { useTasks, useTaskMutations } from '@/hooks/useTasks';
import { useUserProfile } from '@/hooks/useUserProfile';
import { buildReschedulePatch, buildMoveToLaterPatch, workloadByDate, findScheduleConflicts, timeStringToMin } from '@/lib/scheduling';
import { Mood, ReplanReason, fmtMin, toISODate, todayISO } from '@/lib/pace';
import { toast } from 'sonner';
import { AlertTriangle, Clock } from 'lucide-react';

type Props = {
  taskId: string | null;
  open: boolean;
  onClose: () => void;
  /** Optional mood to attach to the reschedule patch. */
  mood?: Mood | null;
  /**
   * 'reschedule' (default) bumps reschedule_count and sets status to
   * 'rescheduled'. 'schedule' is for tasks that have never been scheduled —
   * it just sets the date/time without counting as a reschedule.
   */
  mode?: 'reschedule' | 'schedule';
};

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function RescheduleDialog({ taskId, open, onClose, mood, mode = 'reschedule' }: Props) {
  // If this is a brand-new schedule on a task that's never been planned, fall
  // back to 'schedule' semantics regardless of the prop so the counter never
  // bumps for first-time scheduling. This keeps callers simple.
  const isSchedule = (mode === 'schedule');
  const { data: tasks = [] } = useTasks();
  const { update } = useTaskMutations();
  const { profile: userProfile } = useUserProfile();
  const task = useMemo(() => tasks.find(t => t.id === taskId) ?? null, [tasks, taskId]);

  const tomorrowISO = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); return toISODate(d);
  }, []);
  const [selected, setSelected] = useState<string>(tomorrowISO);
  const [reason, setReason] = useState<ReplanReason | undefined>(undefined);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState('');
  const [startTime, setStartTime] = useState<string>('');
  // Editable time estimate (P20). Stored as separate H/M strings so the
  // user can clear either without losing the other.
  const [estHours, setEstHours] = useState<string>('');
  const [estMinutes, setEstMinutes] = useState<string>('');

  // Reset selection whenever a new task opens.
  useEffect(() => {
    if (open) {
      setSelected(task?.scheduled_date ?? tomorrowISO);
      setReason(undefined);
      setCustomMode(false);
      setCustomText('');
      setStartTime(task?.start_time ? task.start_time.slice(0, 5) : '');
      const dur = task?.duration_minutes ?? 0;
      setEstHours(dur > 0 ? String(Math.floor(dur / 60)) : '');
      setEstMinutes(dur > 0 ? String(dur % 60) : '');
    }
  }, [open, tomorrowISO, task?.start_time, task?.scheduled_date, task?.duration_minutes]);

  // Next 14 days starting tomorrow, with planned workload per day.
  const loads = useMemo(() => workloadByDate(tasks.filter(t => !t.is_rest)), [tasks]);
  const days = useMemo(() => {
    const out: { iso: string; date: Date; minutes: number }[] = [];
    const base = new Date();
    for (let i = 1; i <= 14; i++) {
      const d = new Date(base); d.setDate(base.getDate() + i);
      const iso = toISODate(d);
      out.push({ iso, date: d, minutes: loads[iso] ?? 0 });
    }
    return out;
  }, [loads]);

  async function confirm() {
    if (!task) return;
    if (selected < todayISO()) { toast.error('Pick today or a later date.'); return; }
    if (!startTime) { toast.error('Add a start time to schedule this task.'); return; }
    try {
      // Only bump reschedule_count + flip status when the *date* actually
      // changes. Time-only or estimate-only edits within the same day are
      // treated as a metadata update so the counter doesn't inflate.
      const dateChanged = selected !== (task.scheduled_date ?? null);
      let patch: any;
      if (isSchedule || !dateChanged) {
        patch = { scheduled_date: selected };
      } else {
        patch = buildReschedulePatch(task, selected, {
          reason: reason ?? undefined,
          mood: mood ?? undefined,
        });
      }
      const h = Math.max(0, Math.floor(Number(estHours) || 0));
      const m = Math.max(0, Math.floor(Number(estMinutes) || 0));
      const totalMin = h * 60 + m;
      patch.start_time = startTime ? `${startTime}:00` : null;
      // End time is derived from start + estimate so the calendar can still
      // place the action; users no longer pick it explicitly.
      if (startTime && totalMin > 0) {
        const [sh, sm] = startTime.split(':').map(Number);
        const endMin = sh * 60 + sm + totalMin;
        const eh = Math.floor(endMin / 60) % 24;
        const em = endMin % 60;
        patch.end_time = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}:00`;
      } else {
        patch.end_time = null;
      }
      if (totalMin > 0) patch.duration_minutes = totalMin;
      if (!isSchedule && dateChanged && customMode && customText.trim()) {
        const stamp = new Date().toLocaleDateString();
        const existing = (task as any).notes ?? '';
        patch.notes = existing
          ? `${existing}\n\n[${stamp}] Reschedule reason: ${customText.trim()}`
          : `[${stamp}] Reschedule reason: ${customText.trim()}`;
      }
      await update.mutateAsync({ id: task.id, patch });
      toast.success(
        isSchedule ? 'Task scheduled.' :
        dateChanged ? 'Task moved. Progress preserved.' :
        'Updated.'
      );
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not move.');
    }
  }

  async function moveToLater() {
    if (!task) return;
    try {
      const patch: any = buildMoveToLaterPatch(task);
      // Preserve the (possibly edited) time estimate the user typed in the dialog.
      const h = Math.max(0, Math.floor(Number(estHours) || 0));
      const m = Math.max(0, Math.floor(Number(estMinutes) || 0));
      const totalMin = h * 60 + m;
      if (totalMin > 0) patch.duration_minutes = totalMin;
      await update.mutateAsync({ id: task.id, patch });
      toast.success('Moved to Later. Time estimate kept.');
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not move.');
    }
  }

  const title = isSchedule ? 'When would you like to do this?' : 'When works better?';
  const description = isSchedule
    ? "Pick a day in the next two weeks and add a start time."
    : "Pick any day in the next two weeks. We'll keep your progress and notes.";
  const ctaLabel = isSchedule ? 'Schedule task' : 'Move to selected date';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md rounded-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pace-title text-left">{title}</DialogTitle>
          <DialogDescription className="text-[13px] text-muted-foreground text-left">
            {description}
          </DialogDescription>
        </DialogHeader>

        {task && (
          <div className="mt-1 text-[13px] text-muted-foreground">
            {isSchedule ? 'Scheduling' : 'Moving'}{' '}
            <span className="font-medium text-foreground">{task.title}</span>
          </div>
        )}

        <div className="mt-3">
          <label className="pace-field-label">Pick a date</label>
          <input
            type="date"
            className="pace-field"
            value={selected}
            min={todayISO()}
            onChange={(e) => setSelected(e.target.value)}
          />
        </div>

        <div className="mt-3">
          <div className="pace-eyebrow mb-2">Or jump to a day</div>
          <div className="grid grid-cols-4 gap-1.5">
            {days.slice(0, 8).map(d => {
              const active = d.iso === selected;
              return (
                <button
                  key={d.iso}
                  onClick={() => setSelected(d.iso)}
                  className={`rounded-2xl px-2 py-2 text-center border transition ${
                    active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card border-border/60 hover:bg-muted'
                  }`}
                >
                  <div className="text-[10px] uppercase tracking-wider opacity-80">{DAY_SHORT[d.date.getDay()]}</div>
                  <div className="text-[15px] font-semibold leading-tight">{d.date.getDate()}</div>
                  <div className={`text-[10px] mt-0.5 ${active ? 'opacity-90' : 'text-muted-foreground'}`}>
                    {d.minutes ? fmtMin(d.minutes) : 'free'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3">
          <div className="pace-eyebrow inline-flex items-center gap-1.5 mb-1.5">
            <Clock className="w-3 h-3" /> Pick a start time <span className="text-[hsl(var(--attention))]">*</span>
          </div>
          <input
            type="time"
            className="pace-field"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>

        <div className="mt-3">
          <label className="pace-field-label">Time estimate</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              inputMode="numeric"
              className="pace-field"
              value={estHours}
              onChange={(e) => setEstHours(e.target.value)}
              placeholder="0"
              aria-label="Hours"
            />
            <span className="text-[13px] text-muted-foreground">H</span>
            <input
              type="number"
              min={0}
              max={59}
              inputMode="numeric"
              className="pace-field"
              value={estMinutes}
              onChange={(e) => setEstMinutes(e.target.value)}
              placeholder="0"
              aria-label="Minutes"
            />
            <span className="text-[13px] text-muted-foreground">M</span>
          </div>
        </div>

        {!isSchedule && (
          <div className="mt-3">
            <div className="pace-title text-left text-[15px]">Rescheduled. What got in the way?</div>
            <div className="text-[12px] text-muted-foreground mb-2">Rescheduling is part of good planning.</div>
            <ReplanReasonChips
              selected={reason}
              onSelect={(r) => { setCustomMode(false); setReason(r); }}
              customSelected={customMode}
              customText={customText}
              onSelectCustom={() => { setCustomMode(true); setReason(undefined); }}
              onCustomTextChange={setCustomText}
            />
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="pace-btn pace-btn-sm flex-1">Cancel</button>
          <button onClick={confirm} className="pace-btn-primary pace-btn-sm flex-1">
            {ctaLabel}
          </button>
        </div>

        {!isSchedule && (
          <button
            onClick={moveToLater}
            className="mt-2 pace-btn pace-btn-sm w-full text-[13px]"
          >
            Move to Later
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
