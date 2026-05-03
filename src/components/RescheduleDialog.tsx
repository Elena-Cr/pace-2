import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import ReplanReasonChips from '@/components/ReplanReasonChips';
import { useTasks, useTaskMutations } from '@/hooks/useTasks';
import { useUserProfile } from '@/hooks/useUserProfile';
import { buildReschedulePatch, workloadByDate } from '@/lib/scheduling';
import { Mood, ReplanReason, fmtMin, toISODate, todayISO } from '@/lib/pace';
import { toast } from 'sonner';
import TimeRangePicker, { timeStringToMin } from '@/components/TimeRangePicker';
import { Clock } from 'lucide-react';

type Props = {
  taskId: string | null;
  open: boolean;
  onClose: () => void;
  /** Optional mood to attach to the reschedule patch. */
  mood?: Mood | null;
};

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function RescheduleDialog({ taskId, open, onClose, mood }: Props) {
  const { data: tasks = [] } = useTasks();
  const { profile } = useUserProfile();
  const { update } = useTaskMutations();
  const task = useMemo(() => tasks.find(t => t.id === taskId) ?? null, [tasks, taskId]);

  const tomorrowISO = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); return toISODate(d);
  }, []);
  const [selected, setSelected] = useState<string>(tomorrowISO);
  const [reason, setReason] = useState<ReplanReason | undefined>(undefined);
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');

  // Reset selection whenever a new task opens.
  useEffect(() => {
    if (open) {
      setSelected(tomorrowISO);
      setReason(undefined);
      setStartTime(task?.start_time ? task.start_time.slice(0, 5) : '');
      setEndTime(task?.end_time ? task.end_time.slice(0, 5) : '');
    }
  }, [open, tomorrowISO, task?.start_time, task?.end_time]);

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
    try {
      await update.mutateAsync({
        id: task.id,
        patch: buildReschedulePatch(task, selected, {
          reason: reason ?? undefined,
          mood: mood ?? undefined,
        }),
      });
      toast.success('Task moved. Progress preserved.');
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not move.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle className="pace-title text-left">When works better?</DialogTitle>
          <DialogDescription className="text-[13px] text-muted-foreground text-left">
            Pick any day in the next two weeks. We'll keep your progress and notes.
          </DialogDescription>
        </DialogHeader>

        {task && (
          <div className="mt-1 text-[13px] text-muted-foreground">
            Moving <span className="font-medium text-foreground">{task.title}</span>
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
          <div className="pace-eyebrow mb-1.5">Reason (optional)</div>
          <ReplanReasonChips selected={reason} onSelect={setReason} />
        </div>

        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="pace-btn pace-btn-sm flex-1">Cancel</button>
          <button onClick={confirm} className="pace-btn-primary pace-btn-sm flex-1">
            Move to selected date
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
