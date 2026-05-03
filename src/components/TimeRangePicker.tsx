import { AlertTriangle } from 'lucide-react';
import { findScheduleConflicts, minToTimeString, timeStringToMin, type Task } from '@/lib/scheduling';
import { fmtMin } from '@/lib/pace';
import type { TimeBlock } from '@/hooks/useUserProfile';

type Props = {
  startTime: string;            // 'HH:MM' or ''
  endTime: string;              // 'HH:MM' or ''
  onChange: (start: string, end: string) => void;
  date: string | null;          // YYYY-MM-DD; conflicts only checked when set
  tasks: Task[];
  blocks?: TimeBlock[];
  excludeTaskId?: string | null;
  required?: boolean;
};

export default function TimeRangePicker({
  startTime, endTime, onChange, date, tasks, blocks, excludeTaskId, required,
}: Props) {
  const conflicts = (() => {
    if (!date) return [];
    const s = timeStringToMin(startTime || null);
    const e = timeStringToMin(endTime || null);
    if (s == null || e == null || e <= s) return [];
    const tbs = (blocks ?? []).map(b => ({
      label: b.label, start: b.start, end: b.end, kind: b.kind as any, days: b.days,
    }));
    return findScheduleConflicts({
      date, startMin: s, endMin: e, tasks, blocks: tbs, excludeTaskId,
    });
  })();

  const invalidOrder = !!startTime && !!endTime && timeStringToMin(endTime)! <= timeStringToMin(startTime)!;

  return (
    <div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="pace-meta block mb-1">Start{required ? '' : ' (optional)'}</label>
          <input
            type="time"
            className="pace-field"
            value={startTime}
            onChange={e => onChange(e.target.value, endTime)}
          />
        </div>
        <div className="flex-1">
          <label className="pace-meta block mb-1">End{required ? '' : ' (optional)'}</label>
          <input
            type="time"
            className="pace-field"
            value={endTime}
            onChange={e => onChange(startTime, e.target.value)}
          />
        </div>
      </div>

      {invalidOrder && (
        <div className="mt-2 text-[12px] text-destructive">End time must be after start time.</div>
      )}

      {conflicts.length > 0 && (
        <div className="mt-2 rounded-xl border border-destructive/40 bg-destructive/10 p-2.5">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-destructive">
            <AlertTriangle className="w-3.5 h-3.5" />
            Overlaps {conflicts.length === 1 ? '1 thing' : `${conflicts.length} things`} on this day
          </div>
          <ul className="mt-1 space-y-0.5 text-[12px] text-foreground/80">
            {conflicts.map((c, i) => (
              <li key={i}>
                · <span className="font-medium">{c.title}</span>{' '}
                <span className="text-muted-foreground">
                  ({minToTimeString(c.startMin)}–{minToTimeString(c.endMin)}, {c.kind})
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-1 text-[11px] text-muted-foreground">You can still pick this time.</div>
        </div>
      )}
    </div>
  );
}

export { minToTimeString, timeStringToMin };
export const durationMinutesFromRange = (start: string, end: string): number | null => {
  const s = timeStringToMin(start || null);
  const e = timeStringToMin(end || null);
  if (s == null || e == null || e <= s) return null;
  return e - s;
};
