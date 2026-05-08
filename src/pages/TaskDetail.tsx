import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTask, useTaskMutations, useTasks } from '@/hooks/useTasks';
import { useUserProfile } from '@/hooks/useUserProfile';
import AppShell from '@/components/AppShell';
import RescheduleDialog from '@/components/RescheduleDialog';
import TaskMeta from '@/components/TaskMeta';
import { durationMinutesFromRange, minToTimeString, timeStringToMin } from '@/components/TimeRangePicker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DOMAIN_LABEL, STATUS_LABEL, PRIORITY_LABEL, Status, Priority, Domain, Subtask,
  formatDeadline, fmtMin, toISODate,
} from '@/lib/pace';
import { progressForStatusExplicit, buildReschedulePatch } from '@/lib/scheduling';
import { toast } from 'sonner';
import { ArrowLeft, Plus, X, Timer, Trash2, Pencil, Users, CalendarIcon, ChevronDown } from 'lucide-react';

// Pre-generated 15-minute interval times (00:00 → 23:45)
const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4); const m = (i % 4) * 15;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
});

function SectionToggle({
  open, onToggle, title, hasValue, children,
}: { open: boolean; onToggle: () => void; title: string; hasValue: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className={cn('text-[14px] font-medium', hasValue ? 'text-primary' : 'text-foreground')}>
          {title}
        </span>
        <ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="px-4 pb-4 space-y-4 animate-fade-in">{children}</div>}
    </div>
  );
}

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
  const { data: allTasks = [] } = useTasks();
  const { profile: userProfile } = useUserProfile();
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
  const [eEffort, setEEffort] = useState<string | null>(null);
  const [eWhen, setEWhen] = useState<'today' | 'tomorrow' | 'backlog' | 'pick'>('backlog');
  const [ePickedDate, setEPickedDate] = useState<Date | undefined>(undefined);
  const [eDatePopoverOpen, setEDatePopoverOpen] = useState(false);
  const [eStartTime, setEStartTime] = useState<string>('');
  const [eEndTime, setEEndTime] = useState<string>('');
  const [eEstHours, setEEstHours] = useState<number | ''>('');
  const [eEstMinutes, setEEstMinutes] = useState<number | ''>('');
  const [eEstimate, setEEstimate] = useState<number | ''>('');
  const [ePendingEstimate, setEPendingEstimate] = useState<{ h: number | ''; m: number | '' } | null>(null);
  const [eNextAction, setENextAction] = useState('');
  const [eNotes, setENotes] = useState('');
  const [eOthers, setEOthers] = useState(false);
  const [eSubtasks, setESubtasks] = useState<Subtask[]>([]);
  const [eSubInput, setESubInput] = useState('');
  const [eLocation, setELocation] = useState('');
  const [eOpenA, setEOpenA] = useState(false);
  const [eOpenB, setEOpenB] = useState(false);
  const [eOpenC, setEOpenC] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);

  // Derived scheduled ISO based on the picker.
  const eScheduledISO = useMemo<string | null>(() => {
    if (eWhen === 'today') return toISODate(new Date());
    if (eWhen === 'tomorrow') { const d = new Date(); d.setDate(d.getDate() + 1); return toISODate(d); }
    if (eWhen === 'pick' && ePickedDate) return toISODate(ePickedDate);
    return null;
  }, [eWhen, ePickedDate]);

  const eHasTimeRange = !!eStartTime && !!eEndTime
    && (timeStringToMin(eEndTime)! > timeStringToMin(eStartTime)!);

  // When start time + estimate are known, derive end time automatically.
  useEffect(() => {
    if (!eStartTime || !eEstimate || Number(eEstimate) <= 0) return;
    const startMin = timeStringToMin(eStartTime)!;
    setEEndTime(minToTimeString(startMin + Number(eEstimate)));
  }, [eStartTime, eEstimate]);

  // Sync hours/minutes -> total estimate
  useEffect(() => {
    const h = typeof eEstHours === 'number' ? eEstHours : 0;
    const m = typeof eEstMinutes === 'number' ? eEstMinutes : 0;
    const total = h * 60 + m;
    setEEstimate(total > 0 ? total : '');
  }, [eEstHours, eEstMinutes]);

  function checkEditEstimateOnBlur() {
    if (!eHasTimeRange) return;
    const rangeDur = durationMinutesFromRange(eStartTime, eEndTime);
    const h = typeof eEstHours === 'number' ? eEstHours : 0;
    const m = typeof eEstMinutes === 'number' ? eEstMinutes : 0;
    const typed = h * 60 + m;
    if (rangeDur == null || typed === rangeDur || typed <= 0) return;
    setEPendingEstimate({ h: eEstHours, m: eEstMinutes });
  }

  const ePendingNewEnd = useMemo(() => {
    if (!ePendingEstimate || !eHasTimeRange) return null;
    const h = typeof ePendingEstimate.h === 'number' ? ePendingEstimate.h : 0;
    const m = typeof ePendingEstimate.m === 'number' ? ePendingEstimate.m : 0;
    const total = h * 60 + m;
    if (total <= 0) return null;
    const startMin = timeStringToMin(eStartTime)!;
    return minToTimeString(startMin + total);
  }, [ePendingEstimate, eHasTimeRange, eStartTime]);

  function confirmEditEstimateChange() {
    if (!ePendingEstimate) return;
    if (ePendingNewEnd) setEEndTime(ePendingNewEnd);
    setEPendingEstimate(null);
  }
  function cancelEditEstimateChange() {
    const dur = durationMinutesFromRange(eStartTime, eEndTime);
    if (dur != null) {
      setEEstHours(Math.floor(dur / 60) || (dur < 60 ? 0 : ''));
      setEEstMinutes(dur % 60 || (dur >= 60 && dur % 60 === 0 ? 0 : (dur < 60 ? dur : '')));
    }
    setEPendingEstimate(null);
  }

  function addEditSub() {
    const t = eSubInput.trim(); if (!t) return;
    setESubtasks(s => [...s, { id: crypto.randomUUID(), title: t, done: false }]);
    setESubInput('');
  }

  function openEdit() {
    if (!task) return;
    setETitle(task.title);
    setEDomain(task.domain);
    setEPriority(task.priority);
    setEDeadline(toDatetimeLocal(task.deadline));
    setEEffort(task.effort_level);
    setEOthers(!!(task.involves_others || task.others_rely));
    setENextAction(task.next_action ?? '');
    setENotes(task.notes ?? '');
    setESubtasks(Array.isArray(task.subtasks) ? task.subtasks : []);

    // When picker
    if (task.scheduled_date) {
      const todayISO = toISODate(new Date());
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowISO = toISODate(tomorrow);
      if (task.scheduled_date === todayISO) { setEWhen('today'); setEPickedDate(undefined); }
      else if (task.scheduled_date === tomorrowISO) { setEWhen('tomorrow'); setEPickedDate(undefined); }
      else {
        setEWhen('pick');
        // Parse YYYY-MM-DD as local date.
        const [y, m, d] = task.scheduled_date.split('-').map(Number);
        setEPickedDate(new Date(y, m - 1, d));
      }
    } else {
      setEWhen('backlog');
      setEPickedDate(undefined);
    }

    // Time range — strip seconds if present
    const trim = (t: string | null) => (t ? t.slice(0, 5) : '');
    setEStartTime(trim(task.start_time));
    setEEndTime(trim(task.end_time));

    // Estimate
    const dur = task.duration_minutes ?? 0;
    if (dur > 0) {
      setEEstHours(Math.floor(dur / 60) || (dur < 60 ? 0 : ''));
      setEEstMinutes(dur % 60 || (dur >= 60 && dur % 60 === 0 ? 0 : (dur < 60 ? dur : '')));
    } else {
      setEEstHours(''); setEEstMinutes('');
    }

    setELocation('');
    // Open sections that already contain user data so the editor reflects state.
    const hasA = !!task.effort_level || (task.duration_minutes ?? 0) > 0 || !!(task.involves_others || task.others_rely) || task.priority !== 'should';
    const hasB = !!task.scheduled_date || !!task.deadline;
    const hasC = (Array.isArray(task.subtasks) && task.subtasks.length > 0) || !!task.notes;
    setEOpenA(hasA); setEOpenB(hasB); setEOpenC(hasC);

    setEditMode(true);
  }

  async function saveEdit() {
    if (!task) return;
    if (!eTitle.trim()) { toast.error('Add a title to save.'); return; }
    if (!eEstimate || Number(eEstimate) <= 0) { toast.error('Add a time estimate.'); return; }
    if (eScheduledISO && !eHasTimeRange) {
      toast.error('Pick a start and end time for this day.');
      return;
    }
    setSavingEdit(true);
    try {
      const start_time = eHasTimeRange && eScheduledISO ? `${eStartTime}:00` : null;
      const end_time = eHasTimeRange && eScheduledISO ? `${eEndTime}:00` : null;
      await updateMut.mutateAsync({
        id: task.id,
        patch: {
          title: eTitle.trim(),
          domain: eDomain,
          priority: ePriority,
          deadline: eDeadline ? new Date(eDeadline).toISOString() : null,
          duration_minutes: eEstimate ? Number(eEstimate) : null,
          effort_level: eEffort,
          scheduled_date: eScheduledISO,
          start_time,
          end_time,
          next_action: eNextAction.trim() || null,
          notes: eNotes.trim() || null,
          subtasks: eSubtasks,
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
      const messages = [
        'Done. That was real work.',
        'Completed. Momentum is building.',
        'One less thing. Nice pacing.',
      ];
      toast.success(messages[Math.floor(Math.random() * messages.length)]);
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
        <h1 className="pace-screen-title mt-2">Edit action</h1>

        <div className="mt-5 space-y-4">
          {/* ALWAYS VISIBLE: Title */}
          <div>
            <label className="pace-field-label">What needs doing?</label>
            <input className="pace-field" value={eTitle} onChange={e => setETitle(e.target.value)} placeholder="e.g. Stats problem set 4" />
          </div>

          {/* ALWAYS VISIBLE: Category */}
          <div>
            <label className="pace-field-label">Category</label>
            <div className="flex flex-wrap gap-1.5">
              {DOMAINS.map(d => (
                <button key={d} onClick={() => setEDomain(d)}
                  className={eDomain === d ? 'pace-chip-filled' : 'pace-chip'}>{DOMAIN_LABEL[d]}</button>
              ))}
              <button onClick={() => setEDomain(null)}
                className={`pace-chip-dashed ${eDomain === null ? 'opacity-100' : 'opacity-70'}`}>Decide later</button>
            </div>
          </div>

          {/* SECTION A: Priority & Effort */}
          <SectionToggle
            open={eOpenA} onToggle={() => setEOpenA(o => !o)}
            title="Priority & Effort"
            hasValue={!!eEffort || !!eEstimate || eOthers || ePriority !== 'should'}
          >
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
              <label className="pace-field-label">Time estimate</label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type="number" min={0} step={1}
                    className="pace-field pr-8"
                    placeholder="Hours"
                    value={eEstHours}
                    onBlur={checkEditEstimateOnBlur}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === '') return setEEstHours('');
                      const n = Math.max(0, Math.floor(Number(v)));
                      setEEstHours(Number.isNaN(n) ? '' : n);
                    }}
                  />
                  {eEstHours !== '' && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">h</span>
                  )}
                </div>
                <div className="flex-1 relative">
                  <input
                    type="number" min={0} max={59} step={1}
                    className="pace-field pr-8"
                    placeholder="Minutes"
                    value={eEstMinutes}
                    onBlur={checkEditEstimateOnBlur}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === '') return setEEstMinutes('');
                      let n = Math.max(0, Math.floor(Number(v)));
                      if (Number.isNaN(n)) return setEEstMinutes('');
                      if (n > 59) n = 59;
                      setEEstMinutes(n);
                    }}
                  />
                  {eEstMinutes !== '' && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">m</span>
                  )}
                </div>
              </div>
            </div>

            <div>
              <div className="pace-field-label">Effort level (optional)</div>
              <p className="pace-meta mt-1">How much mental or physical effort this requires.</p>
              <div className="flex gap-1.5 mt-1.5">
                {EFFORTS.map(e => (
                  <button key={e} onClick={() => setEEffort(e === eEffort ? null : e)}
                    className={eEffort === e ? 'pace-chip-filled' : 'pace-chip'}>{e}</button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setEOthers(v => !v)}
              className={cn(
                'w-full justify-center inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-medium border',
                eOthers
                  ? 'bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.35)]'
                  : 'bg-muted text-muted-foreground border-border'
              )}
              aria-pressed={eOthers}
            >
              <Users className="w-3.5 h-3.5" />
              Involves others? {eOthers ? 'Yes' : 'No'}
            </button>
          </SectionToggle>

          {/* SECTION B: Scheduling & Deadline */}
          <SectionToggle
            open={eOpenB} onToggle={() => setEOpenB(o => !o)}
            title="Scheduling & Deadline"
            hasValue={!!eScheduledISO || !!eDeadline}
          >
            <div>
              <label className="pace-field-label">What date would you like to schedule this for?</label>
              <p className="pace-meta mt-0.5 mb-1.5">This is when you plan to work on it.</p>
              <div className="flex gap-1.5 flex-wrap">
                {([
                  { k: 'today', label: 'Today' },
                  { k: 'tomorrow', label: 'Tomorrow' },
                  { k: 'backlog', label: 'Backlog' },
                ] as const).map(opt => (
                  <button key={opt.k} type="button" onClick={() => setEWhen(opt.k)}
                    className={eWhen === opt.k ? 'pace-chip-filled' : 'pace-chip'}>
                    {opt.label}
                  </button>
                ))}
                <Popover open={eDatePopoverOpen} onOpenChange={setEDatePopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        eWhen === 'pick' && ePickedDate ? 'pace-chip-filled' : 'pace-chip',
                        'inline-flex items-center gap-1.5'
                      )}
                    >
                      <CalendarIcon className="w-3.5 h-3.5" />
                      {eWhen === 'pick' && ePickedDate ? format(ePickedDate, 'MMM d') : 'Pick a date'}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={ePickedDate}
                      onSelect={(d) => {
                        if (d) {
                          setEPickedDate(d);
                          setEWhen('pick');
                          setEDatePopoverOpen(false);
                        }
                      }}
                      initialFocus
                      className={cn('p-3 pointer-events-auto')}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {eScheduledISO && (
                <div className="mt-3">
                  <label className="pace-field-label">Start time</label>
                  <select
                    className="pace-field"
                    value={eStartTime}
                    onChange={e => setEStartTime(e.target.value)}
                  >
                    <option value="">Select a time…</option>
                    {TIME_OPTIONS.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {eHasTimeRange && (
                    <p className="pace-meta mt-1">Ends at {eEndTime}.</p>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="pace-field-label">Does this have a deadline? (optional)</label>
              <p className="pace-meta mt-0.5 mb-1.5">This is the latest date it must be done by.</p>
              <input type="datetime-local" className="pace-field" value={eDeadline} onChange={e => setEDeadline(e.target.value)} />
            </div>
          </SectionToggle>

          {/* SECTION C: Notes & Next Steps */}
          <SectionToggle
            open={eOpenC} onToggle={() => setEOpenC(o => !o)}
            title="Notes & Next Steps"
            hasValue={eSubtasks.length > 0 || !!eNotes.trim() || !!eLocation.trim()}
          >
            <div>
              <label className="pace-field-label">Smallest next action (optional)</label>
              <input className="pace-field" value={eNextAction} onChange={e => setENextAction(e.target.value)} placeholder="e.g. open the assignment page" />
            </div>

            <div>
              <label className="pace-field-label">Next steps (optional)</label>
              <div className="flex gap-2">
                <input className="pace-field" value={eSubInput}
                  onChange={e => setESubInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEditSub(); } }}
                  placeholder="Break it into small pieces" />
                <button type="button" onClick={addEditSub} className="pace-btn px-4"><Plus className="w-4 h-4" /></button>
              </div>
              {eSubtasks.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {eSubtasks.map(s => (
                    <li key={s.id} className="flex items-center justify-between rounded-xl bg-muted px-3 py-2 text-[14px]">
                      <span>· {s.title}</span>
                      <button onClick={() => setESubtasks(x => x.filter(y => y.id !== s.id))} aria-label="Remove">
                        <X className="w-4 h-4 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <label className="pace-field-label">Notes (optional)</label>
              <textarea className="pace-field min-h-[88px] py-3" value={eNotes} onChange={e => setENotes(e.target.value)} placeholder="Anything that helps future-you" />
            </div>

            <div>
              <label className="pace-field-label">Location (optional)</label>
              <input className="pace-field" value={eLocation} onChange={e => setELocation(e.target.value)} placeholder="e.g. Library, home office" />
            </div>
          </SectionToggle>

          <div className="flex gap-2 pt-2">
            <button onClick={() => setEditMode(false)} className="pace-btn flex-1">Cancel</button>
            <button onClick={saveEdit} disabled={savingEdit} className="pace-btn-primary flex-1">
              {savingEdit ? 'Saving…' : 'Save changes'}
            </button>
          </div>
          {/* keep refs alive for unused imports */}
          <span className="hidden">{allTasks.length}{userProfile ? '' : ''}</span>
        </div>

        <AlertDialog open={!!ePendingEstimate} onOpenChange={(o) => { if (!o) cancelEditEstimateChange(); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will also move the end time to <span className="font-medium text-foreground">{ePendingNewEnd ?? '—'}</span>.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={cancelEditEstimateChange}>No</AlertDialogCancel>
              <AlertDialogAction onClick={confirmEditEstimateChange}>Yes, move end time</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AppShell>
    );
  }

  // ---------- View mode ----------
  return (
    <AppShell>
      <button onClick={() => nav(-1)} className="pace-btn-ghost pace-btn-sm -ml-3">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="mt-3 flex items-start justify-between gap-2">
        <TaskMeta task={task} />
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`status-chip status-${task.status}`}>{STATUS_LABEL[task.status as Status]}</span>
          <button onClick={openEdit} className="pace-btn-ghost pace-btn-sm" aria-label="Edit action">
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

      {/* First-step prompt for heavier tasks with no next action defined. */}
      {!task.next_action && !editingNext && (task.effort_level === 'Heavy' || (task.duration_minutes ?? 0) >= 90) && (
        <div className="mt-4 pace-card-soft">
          <div className="pace-eyebrow mb-1"><span className="priority-dot should" />A bigger one</div>
          <div className="text-[14px]">This is a bigger one. What's the smallest thing you could do first?</div>
          <div className="mt-2 flex gap-2">
            <input
              className="pace-field"
              placeholder="e.g. Open the doc and read the brief"
              value={nextDraft}
              onChange={e => setNextDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); const v = nextDraft.trim(); if (v) { update({ next_action: v }); setNextDraft(''); } }
              }}
            />
            <button
              onClick={() => { const v = nextDraft.trim(); if (v) { update({ next_action: v }); setNextDraft(''); } }}
              className="pace-btn pace-btn-sm"
            >Save</button>
          </div>
        </div>
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
              <button onClick={() => toggleSub(s.id)} className="flex items-center gap-2 text-left flex-1 min-w-0">
                <span className={`w-4 h-4 rounded-full border-[1.5px] inline-flex items-center justify-center shrink-0 ${
                  s.done ? 'bg-primary border-primary' : 'border-muted-foreground/40'
                }`}>
                  {s.done && <span className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />}
                </span>
                <span className={`text-[14px] truncate ${s.done ? 'line-through text-muted-foreground' : ''}`}>{s.title}</span>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                {!s.done && (
                  <button
                    onClick={() => nav('/focus', { state: { taskId: task.id, subtaskId: s.id } })}
                    className="pace-btn-ghost pace-btn-sm"
                    aria-label={`Focus on ${s.title}`}
                  >
                    <Timer className="w-3.5 h-3.5" /> Focus
                  </button>
                )}
                <button onClick={() => removeSub(s.id)} aria-label="Remove">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
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

      {/* Notes */}
      <div className="mt-4 pace-card">
        <div className="pace-eyebrow mb-2">Notes</div>
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
