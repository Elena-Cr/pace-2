import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTask, useTaskMutations } from '@/hooks/useTasks';
import AppShell from '@/components/AppShell';
import RescheduleDialog from '@/components/RescheduleDialog';
import {
  DOMAIN_LABEL, STATUS_LABEL, PRIORITY_LABEL, Status, Priority, Domain, Subtask,
  formatDeadline, fmtMin, toISODate,
} from '@/lib/pace';
import { progressForStatusExplicit, buildReschedulePatch } from '@/lib/scheduling';
import { toast } from 'sonner';
import { ArrowLeft, Plus, X, Timer, Trash2, Pencil, Users } from 'lucide-react';

const STATUSES: Status[] = ['not_started','started','in_progress','blocked','nearly_done','done'];
const DOMAINS: Domain[] = ['academic', 'work', 'social', 'personal'];
const EFFORTS = ['Light', 'Moderate', 'Heavy'];

// Convert an ISO timestamp into the value format expected by datetime-local
// (YYYY-MM-DDTHH:MM) in the user's local time.
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TaskDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const { data: task } = useTask(id);
  const { update: updateMut, remove: removeMut } = useTaskMutations();
  const [subInput, setSubInput] = useState('');
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [editingNext, setEditingNext] = useState(false);
  const [nextDraft, setNextDraft] = useState('');
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // Edit-form draft state. Populated from `task` whenever edit mode opens.
  const [eTitle, setETitle] = useState('');
  const [eDomain, setEDomain] = useState<Domain | null>(null);
  const [ePriority, setEPriority] = useState<Priority>('should');
  const [eDeadline, setEDeadline] = useState('');
  const [eDuration, setEDuration] = useState<number | ''>('');
  const [eEffort, setEEffort] = useState<string | null>(null);
  const [eScheduledDate, setEScheduledDate] = useState<string>('');
  const [eOthers, setEOthers] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);

  function openEdit() {
    if (!task) return;
    setETitle(task.title);
    setEDomain(task.domain);
    setEPriority(task.priority);
    setEDeadline(toDatetimeLocal(task.deadline));
    setEDuration(task.duration_minutes ?? '');
    setEEnergy(task.energy);
    setEEffort(task.effort_level);
    setEScheduledDate(task.scheduled_date ?? '');
    setEOthers(!!(task.involves_others || task.others_rely));
    setEditMode(true);
  }

  async function saveEdit() {
    if (!task) return;
    if (!eTitle.trim()) { toast.error('Add a title to save.'); return; }
    setSavingEdit(true);
    try {
      await updateMut.mutateAsync({
        id: task.id,
        patch: {
          title: eTitle.trim(),
          domain: eDomain,
          priority: ePriority,
          deadline: eDeadline ? new Date(eDeadline).toISOString() : null,
          duration_minutes: eDuration === '' ? null : Number(eDuration),
          energy: eEnergy,
          effort_level: eEffort,
          scheduled_date: eScheduledDate || null,
          involves_others: eOthers,
          others_rely: eOthers,
        } as any,
      });
      toast.success('Saved.');
      setEditMode(false);
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not save.');
    } finally {
      setSavingEdit(false);
    }
  }

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
    // Explicit user selection: honour the canonical target so progress
    // can decrease when moving backwards (e.g. Done → Nearly done).
    const finalProgress = progressForStatusExplicit(s, task.progress || 0);
    await update({ status: s, progress: finalProgress });
    if (s === 'done') {
      toast.success('Completed. That counts.');
    } else {
      toast.success(`Marked ${STATUS_LABEL[s].toLowerCase()}.`);
    }
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

  async function pauseTask() {
    await update({ status: 'blocked' });
  }

  async function remove() {
    await removeMut.mutateAsync(task!.id);
    toast.success('Removed.');
    nav('/');
  }

  // ---------- Edit mode layout ----------
  if (editMode) {
    return (
      <AppShell>
        <button onClick={() => setEditMode(false)} className="pace-btn-ghost pace-btn-sm -ml-3">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="pace-screen-title mt-2">Edit task</h1>

        <div className="mt-5 space-y-4">
          <div>
            <label className="pace-field-label">Title</label>
            <input className="pace-field" value={eTitle} onChange={e => setETitle(e.target.value)} />
          </div>

          <div>
            <label className="pace-field-label">Domain</label>
            <div className="flex flex-wrap gap-1.5">
              {DOMAINS.map(d => (
                <button key={d} onClick={() => setEDomain(d)}
                  className={eDomain === d ? 'pace-chip-filled' : 'pace-chip'}>{DOMAIN_LABEL[d]}</button>
              ))}
              <button onClick={() => setEDomain(null)}
                className={`pace-chip-dashed ${eDomain === null ? 'opacity-100' : 'opacity-70'}`}>Decide later</button>
            </div>
          </div>

          <div>
            <label className="pace-field-label">Priority</label>
            <div className="flex gap-1.5">
              {(['must','should','could'] as Priority[]).map(p => (
                <button key={p} onClick={() => setEPriority(p)}
                  className={ePriority === p ? 'pace-chip-filled' : 'pace-chip'}>
                  <span className={`priority-dot ${p}`} />{PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="pace-field-label">Scheduled date</label>
            <input
              type="date"
              className="pace-field"
              value={eScheduledDate}
              onChange={e => setEScheduledDate(e.target.value)}
            />
            {eScheduledDate && (
              <button onClick={() => setEScheduledDate('')} className="pace-btn-ghost pace-btn-sm mt-1">
                Move to backlog
              </button>
            )}
          </div>

          <div>
            <label className="pace-field-label">Deadline (optional)</label>
            <input
              type="datetime-local"
              className="pace-field"
              value={eDeadline}
              onChange={e => setEDeadline(e.target.value)}
            />
          </div>

          <div>
            <label className="pace-field-label">Estimates</label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number" min={5} step={5}
                className="pace-field"
                placeholder="Time · minutes"
                value={eDuration}
                onChange={e => setEDuration(e.target.value ? Number(e.target.value) : '')}
              />
              <select
                className="pace-field"
                value={eEnergy ?? ''}
                onChange={e => setEEnergy(e.target.value || null)}
              >
                <option value="">Energy · any</option>
                {ENERGIES.map(x => <option key={x} value={x}>Energy · {x}</option>)}
              </select>
            </div>
            <div className="mt-3">
              <div className="pace-field-label">Effort level</div>
              <div className="flex gap-1.5">
                {EFFORTS.map(e => (
                  <button key={e} onClick={() => setEEffort(e === eEffort ? null : e)}
                    className={eEffort === e ? 'pace-chip-filled' : 'pace-chip'}>{e}</button>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setEOthers(v => !v)}
            className={`${eOthers ? 'pace-chip-filled' : 'pace-chip'} w-full justify-center`}
          >
            <Users className="w-3.5 h-3.5" /> Involves or relies on others
          </button>

          <div className="flex gap-2 pt-2">
            <button onClick={() => setEditMode(false)} className="pace-btn flex-1">Cancel</button>
            <button onClick={saveEdit} disabled={savingEdit} className="pace-btn-primary flex-1">
              {savingEdit ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  // ---------- View mode ----------
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
        <div className="flex items-center gap-1.5">
          <span className={`status-chip status-${task.status}`}>{STATUS_LABEL[task.status as Status]}</span>
          <button onClick={openEdit} className="pace-btn-ghost pace-btn-sm" aria-label="Edit task">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        </div>
      </div>

      <h1 className="pace-screen-title mt-2">{task.title}</h1>
      {editingNext ? (
        <div className="mt-2 flex gap-2">
          <input
            autoFocus
            className="pace-field"
            value={nextDraft}
            onChange={e => setNextDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); update({ next_action: nextDraft.trim() || null }); setEditingNext(false); }
              if (e.key === 'Escape') setEditingNext(false);
            }}
            placeholder="Smallest next action"
          />
          <button
            onClick={() => { update({ next_action: nextDraft.trim() || null }); setEditingNext(false); }}
            className="pace-btn pace-btn-sm"
          >Save</button>
        </div>
      ) : (
        <button
          onClick={() => { setNextDraft(task.next_action ?? ''); setEditingNext(true); }}
          className="pace-meta mt-1 text-left hover:text-foreground transition"
        >
          {task.next_action ? `→ ${task.next_action}` : '→ Add a smallest next action'}
        </button>
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
          {(task.involves_others || task.others_rely) && (
            <span className="pace-chip"><Users className="w-3 h-3" /> Others involved</span>
          )}
          {task.reschedule_count > 0 && <span className="pace-chip">Rescheduled {task.reschedule_count}×</span>}
        </div>
        <div className="mt-3">
          {editingNotes ? (
            <div className="space-y-2">
              <textarea
                autoFocus
                className="pace-field min-h-[88px] py-3"
                value={notesDraft}
                onChange={e => setNotesDraft(e.target.value)}
                placeholder="Anything that helps future-you"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { update({ notes: notesDraft.trim() || null }); setEditingNotes(false); }}
                  className="pace-btn-primary pace-btn-sm"
                >Save</button>
                <button
                  onClick={() => setEditingNotes(false)}
                  className="pace-btn-ghost pace-btn-sm"
                >Cancel</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => { setNotesDraft(task.notes ?? ''); setEditingNotes(true); }}
              className="text-left text-[14px] text-muted-foreground whitespace-pre-wrap w-full hover:text-foreground transition"
            >
              {task.notes || 'Add notes'}
            </button>
          )}
        </div>
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
        <button onClick={() => setRescheduleOpen(true)} className="pace-btn">Reschedule</button>
        <button onClick={remove} className="pace-btn-ghost col-span-2 text-[hsl(var(--attention))]">
          <Trash2 className="w-4 h-4" /> Remove
        </button>
      </div>

      <RescheduleDialog
        taskId={task.id}
        open={rescheduleOpen}
        onClose={() => setRescheduleOpen(false)}
      />
    </AppShell>
  );
}
