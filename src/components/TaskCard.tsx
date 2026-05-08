import { STATUS_LABEL, DOMAIN_COLOR_VAR, type Domain } from '@/lib/pace';
import type { Task } from '@/lib/scheduling';
import TaskMeta from './TaskMeta';
import { ArrowRight } from 'lucide-react';

export default function TaskCard({ task, onOpen, omitDate = false }: { task: Task; onOpen?: (t: Task) => void; omitDate?: boolean }) {
  const accent = task.domain
    ? DOMAIN_COLOR_VAR[task.domain as Domain]
    : 'hsl(var(--border))';
  return (
    <button
      onClick={() => onOpen?.(task)}
      className="pace-card w-full text-left animate-fade-in space-y-2.5 relative overflow-hidden pl-4"
    >
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-[inherit]"
        style={{ background: accent }}
      />
      <div className="flex items-center justify-between gap-2">
        <div className="pace-task-title">{task.title}</div>
        <span className={`status-chip status-${task.status} shrink-0`}>{STATUS_LABEL[task.status]}</span>
      </div>
      <TaskMeta task={task} omitDate={omitDate} />
      {task.progress > 0 && task.status !== 'done' && (
        <div className="pace-progress"><i style={{ width: `${task.progress}%` }} /></div>
      )}
      {task.next_action && (
        <div className="pt-2.5 border-t border-border/50 text-[14px] text-muted-foreground flex items-center gap-2">
          <ArrowRight className="w-3.5 h-3.5 shrink-0" />{task.next_action}
        </div>
      )}
    </button>
  );
}
