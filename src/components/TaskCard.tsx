import { Priority, Domain, Status, DOMAIN_LABEL, STATUS_LABEL, formatDeadline } from '@/lib/pace';
import { ArrowRight } from 'lucide-react';

type Task = {
  id: string; title: string; domain: Domain | null; priority: Priority;
  status: Status; deadline: string | null; next_action: string | null;
  progress: number; reschedule_count: number; involves_others: boolean;
};

export default function TaskCard({ task, onOpen }: { task: Task; onOpen?: (t: Task) => void }) {
  return (
    <button onClick={() => onOpen?.(task)} className="pace-card w-full text-left animate-fade-in space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="pace-tag flex items-center">
          <span className={`priority-dot ${task.priority}`} />
          {task.domain ? DOMAIN_LABEL[task.domain] : 'Uncategorized'} · {formatDeadline(task.deadline)}
        </span>
        <span className={`status-chip status-${task.status}`}>{STATUS_LABEL[task.status]}</span>
      </div>
      <div className="pace-task-title">{task.title}</div>
      {task.progress > 0 && (
        <div className="pace-progress"><i style={{ width: `${task.progress}%` }} /></div>
      )}
      {task.next_action && (
        <div className="pt-2.5 border-t border-border/50 text-[14px] text-muted-foreground flex items-center gap-2">
          <ArrowRight className="w-3.5 h-3.5 shrink-0" />{task.next_action}
        </div>
      )}
      {(task.reschedule_count > 0 || task.involves_others) && (
        <div className="flex gap-1.5 flex-wrap">
          {task.reschedule_count > 0 && <span className="pace-chip">Rescheduled {task.reschedule_count}×</span>}
          {task.involves_others && <span className="pace-chip">Involves others</span>}
        </div>
      )}
    </button>
  );
}
