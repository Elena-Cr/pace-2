import { STATUS_LABEL, DOMAIN_COLOR_VAR, type Domain } from '@/lib/pace';
import type { Task } from '@/lib/scheduling';
import TaskMeta from './TaskMeta';
import { ArrowRight, Check } from 'lucide-react';

export default function TaskCard({
  task,
  onOpen,
  omitDate = false,
  onToggleComplete,
}: {
  task: Task;
  onOpen?: (t: Task) => void;
  omitDate?: boolean;
  onToggleComplete?: (t: Task) => void;
}) {
  const accent = task.domain
    ? DOMAIN_COLOR_VAR[task.domain as Domain]
    : 'hsl(var(--border))';
  const done = task.status === 'done';
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
        <div className="flex items-center gap-2 min-w-0">
          {onToggleComplete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleComplete(task); }}
              aria-label={done ? 'Mark as not done' : 'Mark complete'}
              className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition ${
                done
                  ? 'bg-[hsl(var(--success))] border-[hsl(var(--success))] text-white'
                  : 'border-border hover:border-primary'
              }`}
            >
              {done && <Check className="w-3 h-3" strokeWidth={3} />}
            </button>
          )}
          <div className={`pace-task-title truncate ${done ? 'line-through text-muted-foreground' : ''}`}>{task.title}</div>
        </div>
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
