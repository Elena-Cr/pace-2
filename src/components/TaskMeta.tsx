import { Users, Clock, CalendarDays, Flag, Activity, Repeat, AlertTriangle, MapPin } from 'lucide-react';
import {
  DOMAIN_LABEL, PRIORITY_LABEL, fmtMin, formatDeadline, formatScheduledWhen,
  type Domain, type Priority,
} from '@/lib/pace';

// Shared shape of the task fields we render. Both real Task rows and the
// CalEvent objects satisfy this, so the same component can be used
// everywhere a task is summarised (TaskCard, Calendar dialog, TaskDetail).
export type TaskMetaInfo = {
  domain?: Domain | null;
  priority?: Priority;
  scheduled_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  deadline?: string | null;
  duration_minutes?: number | null;
  effort_level?: string | null;
  involves_others?: boolean;
  others_rely?: boolean;
  reschedule_count?: number;
  location?: string | null;
};

// Small chip used by TaskMeta. Kept inline so usage stays one import.
function Chip({ icon: Icon, label, value, tone, compact }: { icon: any; label: string; value: string; tone?: 'attention'; compact?: boolean }) {
  const toneClass = tone === 'attention'
    ? 'bg-[hsl(var(--attention)/0.15)] text-[hsl(var(--attention))]'
    : 'bg-muted text-foreground';
  const sizeClass = compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[12px]';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full ${sizeClass} ${toneClass}`}>
      <Icon className="w-3 h-3 shrink-0" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

export default function TaskMeta({ task, compact = false, omitDate = false }: { task: TaskMetaInfo; compact?: boolean; omitDate?: boolean }) {
  const whenLabel = formatScheduledWhen(task.scheduled_date ?? null, task.start_time ?? null, task.end_time ?? null, { omitDate });
  const showDeadline = !!task.deadline;
  const showOthers = !!task.involves_others;

  return (
    <div className={`flex flex-wrap gap-1.5 ${compact ? 'text-[11px]' : ''}`}>
      {whenLabel && <Chip icon={CalendarDays} label="Scheduled" value={whenLabel} compact={compact} />}
      {!whenLabel && showDeadline && (
        <Chip icon={CalendarDays} label="Scheduled" value="Not scheduled yet" compact={compact} />
      )}
      {!whenLabel && !showDeadline && (
        <Chip icon={CalendarDays} label="Scheduled" value="Not scheduled" tone="attention" compact={compact} />
      )}
      {task.priority && <Chip icon={Flag} label="Priority" value={PRIORITY_LABEL[task.priority]} compact={compact} />}
      {task.domain && <Chip icon={Activity} label="Category" value={DOMAIN_LABEL[task.domain]} compact={compact} />}
      {task.duration_minutes != null && task.duration_minutes > 0 && (
        <Chip icon={Clock} label="Estimate" value={fmtMin(task.duration_minutes)} compact={compact} />
      )}
      {task.effort_level && <Chip icon={Activity} label="Effort" value={task.effort_level} compact={compact} />}
      {showDeadline && <Chip icon={AlertTriangle} label="Deadline" value={formatDeadline(task.deadline ?? null)} compact={compact} />}
      {showOthers && (
        <Chip icon={Users} label="People" value="Involves others" compact={compact} />
      )}
      {task.location && <Chip icon={MapPin} label="Location" value={task.location} compact={compact} />}
      {(task.reschedule_count ?? 0) > 0 && (
        <Chip icon={Repeat} label="Rescheduled" value={`${task.reschedule_count}×`} compact={compact} />
      )}
    </div>
  );
}
