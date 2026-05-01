import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTask, useTaskMutations } from '@/hooks/useTasks';
import AppShell from '@/components/AppShell';
import {
  DOMAIN_LABEL, STATUS_LABEL, Status, Subtask,
  formatDeadline, fmtMin, todayISO, toISODate,
} from '@/lib/pace';
import { progressForStatus, buildReschedulePatch } from '@/lib/scheduling';
import { toast } from 'sonner';
import { ArrowLeft, Plus, X, Timer, Trash2 } from 'lucide-react';

const STATUSES: Status[] = ['not_started','started','in_progress','blocked','nearly_done','done'];

export default function TaskDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const { data: task } = useTask(id);
  const { update: updateMut, remove: removeMut } = useTaskMutations();
  const [subInput, setSubInput] = useState('');

  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);

  if (!task) {
    return <AppShell><div className="text-sm text-muted-foreground">Loading…</div></AppShell>;
  }

  const subtasks: Subtask[] = Array.isArray(task.subtasks) ? task.subtasks : [];
  const subDoneCount = subtasks.filter(s => s.done).length;
  const computedProgress = subtasks.length
    ? Math.round((subDoneCount / subtasks.length) * 100)
    : task.progress;

  async function update(patch: any) {
    try {
      await updateMut.mutateAsync({ id: task!.id, patch });
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not update.');
    }
  }

  async function setStatus(s: Status) {
    const target = progressForStatus(s, task.progress || 0);
    // Don't drop existing progress when moving forward; honor it when status implies more.
    const nextProgress = s === 'done' ? 100 : Math.max(task.progress || 0, target);
    await update({ status: s, progress: nextProgress });
    toast.success(`Marked ${STATUS_LABEL[s].toLowerCase()}.`);
  }

  async function toggleSub(sid: string) {
    const next = subtasks.map(s => s.id === sid ? { ...s, done: !s.done } : s);
    const progress = next.length ? Math.round((next.filter(s => s.done).length / next.length) * 100) : task.progress;
    let nextStatus: Status = task.status;
    if (progress === 100) nextStatus = 'done';
    else if (progress >= 75 && nextStatus === 'in_progress') nextStatus = 'nearly_done';
    else if (progress > 0 && nextStatus === 'not_started') nextStatus = 'in_progress';
    await update({ subtasks: next, progress, status: nextStatus });
  }

  async function addSub() {
    const t = subInput.trim(); if (!t) return;
    const next = [...subtasks, { id: crypto.randomUUID(), title: t, done: false }];
    setSubInput('');
    await update({ subtasks: next });
  }

  async function removeSub(sid: string) {
    const next = subtasks.filter(s => s.id !== sid);
    await update({ subtasks: next });
  }

  async function reschedule() {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    await update({
      scheduled_date: toISODate(tomorrow),
      reschedule_count: (task.reschedule_count || 0) + 1,
      status: 'rescheduled',
    });
    toast.success('Moved to tomorrow. Progress preserved.');
  }

  async function pauseTask() {
    await update({ status: 'blocked' });
  }

  async function reduceScope() {
    await update({ duration_minutes: Math.max(10, Math.round((task.duration_minutes || 30) / 2)) });
    toast.success('Scope reduced. Smaller is still real.');
  }

  async function remove() {
    await removeMut.mutateAsync(task!.id);
    toast.success('Removed.');
    nav('/');
  }

  return (
    <AppShell>
      <button onClick={() => nav(-1)} className="pace-btn-ghost pace-btn-sm -ml-3">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="pace-tag flex items-center">
          <span className={`priority-dot ${task.priority}`} />
          {task.domain ? DOMAIN_LABEL[task.domain] : 'Uncategorized'} · {formatDeadline(task.deadline)}
        </span>
        <span className={`status-chip status-${task.status}`}>{STATUS_LABEL[task.status as Status]}</span>
      </div>

      <h1 className="pace-screen-title mt-2">{task.title}</h1>
      {task.next_action && (
        <div className="pace-meta mt-1">→ {task.next_action}</div>
      )}

      {/* Status flow */}
      <div className="mt-5 pace-card">
        <div className="pace-eyebrow mb-2">Progress</div>
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setStatus(s)}
              className={task.status === s ? 'pace-chip-filled' : 'pace-chip'}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <div className="pace-progress"><i style={{ width: `${computedProgress}%` }} /></div>
          <div className="pace-meta mt-1">{computedProgress}%</div>
        </div>
      </div>

      {/* Subtasks */}
      <div className="mt-4 pace-card">
        <div className="pace-eyebrow mb-2">Next steps</div>
        <ul className="space-y-1.5">
          {subtasks.map(s => (
            <li key={s.id} className="flex items-center justify-between rounded-xl bg-muted px-3 py-2">
              <button onClick={() => toggleSub(s.id)} className="flex items-center gap-2 text-left flex-1">
                <span className={`w-4 h-4 rounded-full border-[1.5px] inline-flex items-center justify-center shrink-0 ${
                  s.done ? 'bg-primary border-primary' : 'border-muted-foreground/40'
                }`}>
                  {s.done && <span className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />}
                </span>
                <span className={`text-[14px] ${s.done ? 'line-through text-muted-foreground' : ''}`}>{s.title}</span>
              </button>
              <button onClick={() => removeSub(s.id)} aria-label="Remove">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </li>
          ))}
          {subtasks.length === 0 && (
            <li className="text-[13px] text-muted-foreground">No subtasks yet. Break it down — even one small step counts.</li>
          )}
        </ul>
        <div className="mt-3 flex gap-2">
          <input className="pace-field" value={subInput}
            onChange={e => setSubInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } }}
            placeholder="Add a small next step" />
          <button onClick={addSub} className="pace-btn px-4"><Plus className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Estimates summary */}
      <div className="mt-4 pace-card">
        <div className="pace-eyebrow mb-2">Estimates</div>
        <div className="flex flex-wrap gap-1.5 text-[13px]">
          {task.duration_minutes && <span className="pace-chip">{fmtMin(task.duration_minutes)}</span>}
          {task.effort_level && <span className="pace-chip">Effort · {task.effort_level}</span>}
          {task.energy && <span className="pace-chip">Energy · {task.energy}</span>}
          {task.involves_others && <span className="pace-chip">Involves others</span>}
          {task.others_rely && <span className="pace-chip">Others rely</span>}
          {task.reschedule_count > 0 && <span className="pace-chip">Rescheduled {task.reschedule_count}×</span>}
        </div>
        {task.notes && (
          <div className="mt-3 text-[14px] text-muted-foreground whitespace-pre-wrap">{task.notes}</div>
        )}
      </div>

      {(task.reschedule_count ?? 0) >= 2 && (
        <div className="mt-4 pace-alert">
          <div className="pace-eyebrow mb-1"><span className="priority-dot should" />This has moved a few times</div>
          Is it still important, too large, or waiting on something? A tiny version often unsticks it.
        </div>
      )}

      {/* Actions */}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button onClick={() => nav('/focus', { state: { taskId: task.id } })} className="pace-btn-primary col-span-2">
          <Timer className="w-4 h-4" /> Focus on this
        </button>
        <button onClick={pauseTask} className="pace-btn">Pause</button>
        <button onClick={reduceScope} className="pace-btn">Reduce scope</button>
        <button onClick={reschedule} className="pace-btn col-span-2">Reschedule to tomorrow</button>
        <button onClick={remove} className="pace-btn-ghost col-span-2 text-[hsl(var(--attention))]">
          <Trash2 className="w-4 h-4" /> Remove
        </button>
      </div>
    </AppShell>
  );
}
