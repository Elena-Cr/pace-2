import { Priority, Domain, Status, DOMAIN_LABEL, STATUS_LABEL, formatDeadline } from '@/lib/pace';
import { ArrowRight } from 'lucide-react';

type Task = {
  id: string; title: string; domain: Domain | null; priority: Priority;
  status: Status; deadline: string | null; next_action: string | null;
  progress: number; reschedule_count: number; involves_others: boolean;
};

export default function TaskCard({ task, onOpen }: { task: Task; onOpen?: (t: Task) => void }) {
  return (
    <button onClick={() => onOpen?.(task)} className="pace-card w-full text-left animate-fade-in">
      <div className="flex items-center justify-between gap-2">
        <span className="pace-eyebrow flex items-center">
          <span className={`priority-dot ${task.priority}`} />
          {task.domain ? DOMAIN_LABEL[task.domain] : 'Uncategorized'} · {formatDeadline(task.deadline)}
        </span>
        <span className="pace-chip-dashed">{STATUS_LABEL[task.status]}</span>
      </div>
      <div className="mt-1 font-display text-[14px] font-semibold leading-snug">{task.title}</div>
      {task.progress > 0 && (
        <div className="pace-progress mt-2"><i style={{ width: `${task.progress}%` }} /></div>
      )}
      {task.next_action && (
        <div className="mt-2 pt-2 border-t border-dashed border-foreground/25 text-[12px] flex items-center gap-1.5">
          <ArrowRight className="w-3 h-3" />{task.next_action}
        </div>
      )}
      {(task.reschedule_count > 0 || task.involves_others) && (
        <div className="mt-2 flex gap-1.5 flex-wrap">
          {task.reschedule_count > 0 && <span className="pace-chip">rescheduled {task.reschedule_count}×</span>}
          {task.involves_others && <span className="pace-chip">involves others</span>}
        </div>
      )}
    </button>
  );
}
