import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTaskMutations } from '@/hooks/useTasks';
import { toast } from 'sonner';
import { Moon } from 'lucide-react';

// One-time rest block — a tasks row with is_rest=true scoped to a single
// scheduled_date + time range. Distinct from the recurring blocks defined
// in user_profiles.default_time_blocks (managed in Settings).
export type RestBlockInitial = {
  id?: string;          // present → edit existing
  date: string;         // YYYY-MM-DD
  startTime?: string;   // HH:MM
  endTime?: string;     // HH:MM
  label?: string;
};

function toHHMM(t?: string | null) {
  if (!t) return '';
  return t.length >= 5 ? t.slice(0, 5) : t;
}

export default function RestBlockDialog({
  open,
  initial,
  onClose,
}: {
  open: boolean;
  initial: RestBlockInitial | null;
  onClose: () => void;
}) {
  const { insert, update, remove } = useTaskMutations();
  const [date, setDate] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (!open || !initial) return;
    setDate(initial.date);
    setStart(toHHMM(initial.startTime) || '12:00');
    setEnd(toHHMM(initial.endTime) || '12:30');
    setLabel(initial.label ?? 'Rest');
  }, [open, initial]);

  const isEdit = !!initial?.id;

  async function save() {
    if (!date || !start || !end) {
      toast.error('Pick a date and time range.');
      return;
    }
    if (end <= start) {
      toast.error('End time must be after start time.');
      return;
    }
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const duration = (eh * 60 + em) - (sh * 60 + sm);
    const patch: any = {
      title: label.trim() || 'Rest',
      is_rest: true,
      scheduled_date: date,
      start_time: `${start}:00`,
      end_time: `${end}:00`,
      duration_minutes: duration,
      domain: null,
      priority: 'should',
      status: 'not_started',
    };
    try {
      if (isEdit && initial?.id) {
        await update.mutateAsync({ id: initial.id, patch });
        toast.success('Rest block updated.');
      } else {
        await insert.mutateAsync(patch);
        toast.success('Rest block added.');
      }
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not save.');
    }
  }

  async function handleRemove() {
    if (!initial?.id) return;
    try {
      await remove.mutateAsync(initial.id);
      toast.success('Rest block removed.');
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not remove.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle className="pace-title text-left inline-flex items-center gap-2">
            <Moon className="w-4 h-4" />
            {isEdit ? 'Edit rest block' : 'Add rest block'}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-muted-foreground text-left">
            One-time protected time, just for this day.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 space-y-3">
          <label className="block">
            <span className="pace-eyebrow">Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="pace-eyebrow">Start</span>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)}
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="pace-eyebrow">End</span>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)}
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />
            </label>
          </div>
          <label className="block">
            <span className="pace-eyebrow">Label</span>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="Rest"
              className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={save} className="pace-btn-primary pace-btn-sm">
            {isEdit ? 'Save changes' : 'Add rest block'}
          </button>
          {isEdit && (
            <button onClick={handleRemove} className="pace-btn pace-btn-sm">Remove</button>
          )}
          <button onClick={onClose} className="pace-btn-ghost pace-btn-sm ml-auto">Cancel</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
