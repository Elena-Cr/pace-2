import { STATUS_LABEL, DOMAIN_LABEL, DOMAIN_COLOR_VAR, fmtMin, formatDeadline, type Domain } from "@/lib/pace";
import type { Task } from "@/lib/scheduling";
import { Check, Users, AlertTriangle, Clock, CalendarDays } from "lucide-react";

function fmtTime(t?: string | null) {
  if (!t) return "";
  return t.slice(0, 5);
}

function fmtTimeRange(s?: string | null, e?: string | null) {
  if (!s && !e) return "";
  if (s && e) return `${fmtTime(s)} – ${fmtTime(e)}`;
  return fmtTime(s || e);
}

function fmtDate(d?: string | null) {
  if (!d) return "";
  return new Date(d + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric" });
}

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
  const accent = task.domain ? DOMAIN_COLOR_VAR[task.domain as Domain] : "hsl(var(--border))";
  const done = task.status === "done";
  const timeStr = fmtTimeRange(task.start_time, task.end_time);
  const dateStr = !omitDate ? fmtDate(task.scheduled_date) : "";
  const whenLabel = [dateStr, timeStr].filter(Boolean).join(" · ");

  return (
    <button
      onClick={() => onOpen?.(task)}
      className={`w-full text-left pace-card !p-3 flex items-start gap-1 hover:shadow-sm transition animate-fade-in ${done ? "opacity-60" : ""}`}
    >
      <span aria-hidden="true" className="w-1 self-stretch rounded-full shrink-0" style={{ background: accent }} />
      {onToggleComplete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleComplete(task);
          }}
          aria-label={done ? "Mark as not done" : "Mark complete"}
          className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition ${
            done
              ? "bg-[hsl(var(--success))] border-[hsl(var(--success))] text-white"
              : "border-border hover:border-primary"
          }`}
        >
          {done && <Check className="w-3 h-3" strokeWidth={3} />}
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <div className={`text-[15px] font-medium leading-snug truncate ${done ? "line-through" : ""}`}>
            {task.title}
          </div>
          {whenLabel && <span className="ml-auto text-[11px] text-muted-foreground shrink-0">{whenLabel}</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
          {!whenLabel && !omitDate && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="w-3 h-3" /> Not scheduled
            </span>
          )}
          {task.domain && (
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
              {DOMAIN_LABEL[task.domain as Domain]}
            </span>
          )}
          {task.duration_minutes != null && task.duration_minutes > 0 && (
            <span className="inline-flex items-center gap-1">
              · <Clock className="w-3 h-3" /> {fmtMin(task.duration_minutes)}
            </span>
          )}
          {task.deadline && (
            <span className="inline-flex items-center gap-1">
              · <AlertTriangle className="w-3 h-3" /> {formatDeadline(task.deadline)}
            </span>
          )}
          {task.involves_others && (
            <span className="inline-flex items-center gap-1">
              · <Users className="w-3 h-3" /> Involves others
            </span>
          )}
          <span className={`status-chip status-${task.status} ml-auto`}>{STATUS_LABEL[task.status]}</span>
        </div>
      </div>
    </button>
  );
}
