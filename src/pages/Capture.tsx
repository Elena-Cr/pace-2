import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTaskMutations, useTasks } from '@/hooks/useTasks';
import { useUserProfile } from '@/hooks/useUserProfile';
import AppShell from '@/components/AppShell';
import { Domain, Priority, PRIORITY_LABEL, fmtMin, DOMAIN_LABEL, toISODate } from '@/lib/pace';
import { toast } from 'sonner';
import { X, Plus, Sparkles, Repeat, Users, CalendarIcon, ChevronDown } from 'lucide-react';
import { useTaskSuggestions, Suggestion, stem } from '@/hooks/useTaskSuggestions';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { durationMinutesFromRange, minToTimeString, timeStringToMin } from '@/components/TimeRangePicker';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const DOMAINS: { k: Domain; label: string }[] = [
  { k: 'academic', label: 'Academic' },
  { k: 'work', label: 'Work' },
  { k: 'social', label: 'Social' },
  { k: 'personal', label: 'Personal' },
];

const EFFORTS = ['Light', 'Moderate', 'Heavy'];

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

export default function Capture() {
  const nav = useNavigate();
  const { user } = useAuth();
  const { insert } = useTaskMutations();
  const { data: tasks = [] } = useTasks();
  const { profile: userProfile } = useUserProfile();
  const [title, setTitle] = useState('');
  const [domain, setDomain] = useState<Domain | null>(null);
  const [categoryChosen, setCategoryChosen] = useState(false);
  const [priority, setPriority] = useState<Priority>('should');
  const [deadline, setDeadline] = useState('');
  const [when, setWhen] = useState<'today' | 'tomorrow' | 'backlog' | 'pick'>('backlog');
  const [pickedDate, setPickedDate] = useState<Date | undefined>(undefined);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [estimate, setEstimate] = useState<number | ''>('');
  const [estHours, setEstHours] = useState<number | ''>('');
  const [estMinutes, setEstMinutes] = useState<number | ''>('');
  const [pendingEstimate, setPendingEstimate] = useState<{ h: number | ''; m: number | '' } | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [nextAction, setNextAction] = useState('');
  const [notes, setNotes] = useState('');
  const [location, setLocation] = useState('');
  const [othersInvolved, setOthersInvolved] = useState(false);
  const [countsTowardCapacity, setCountsTowardCapacity] = useState(true);
  const [subtasks, setSubtasks] = useState<{ id: string; title: string; done: boolean }[]>([]);
  const [subInput, setSubInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [appliedFor, setAppliedFor] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Section open/closed state — all collapsed by default
  const [openA, setOpenA] = useState(false);
  const [openB, setOpenB] = useState(false);
  const [openC, setOpenC] = useState(false);

  const { templates, suggestFor } = useTaskSuggestions(user?.id);

  const [debouncedTitle, setDebouncedTitle] = useState(title);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedTitle(title), 250);
    return () => clearTimeout(id);
  }, [title]);

  const suggestion = useMemo(() => suggestFor(debouncedTitle), [debouncedTitle, suggestFor]);
  const debouncedStem = useMemo(() => stem(debouncedTitle), [debouncedTitle]);
  const showSuggestion = !!(suggestion && appliedFor !== debouncedStem && !dismissed.has(debouncedStem));

  const scheduledISO = useMemo<string | null>(() => {
    if (when === 'today') return toISODate(new Date());
    if (when === 'tomorrow') { const d = new Date(); d.setDate(d.getDate() + 1); return toISODate(d); }
    if (when === 'pick' && pickedDate) return toISODate(pickedDate);
    return null;
  }, [when, pickedDate]);

  const hasTimeRange = !!startTime && !!endTime
    && (timeStringToMin(endTime)! > timeStringToMin(startTime)!);

  // Sync hours/minutes -> total estimate
  useEffect(() => {
    const h = typeof estHours === 'number' ? estHours : 0;
    const m = typeof estMinutes === 'number' ? estMinutes : 0;
    const total = h * 60 + m;
    setEstimate(total > 0 ? total : '');
  }, [estHours, estMinutes]);

  // When start time + estimate are known, derive end time automatically.
  useEffect(() => {
    if (!startTime || !estimate || Number(estimate) <= 0) return;
    const startMin = timeStringToMin(startTime)!;
    setEndTime(minToTimeString(startMin + Number(estimate)));
  }, [startTime, estimate]);

  function checkEstimateOnBlur() {
    if (!hasTimeRange) return;
    const rangeDur = durationMinutesFromRange(startTime, endTime);
    const h = typeof estHours === 'number' ? estHours : 0;
    const m = typeof estMinutes === 'number' ? estMinutes : 0;
    const typed = h * 60 + m;
    if (rangeDur == null || typed === rangeDur || typed <= 0) return;
    setPendingEstimate({ h: estHours, m: estMinutes });
  }

  const pendingNewEnd = useMemo(() => {
    if (!pendingEstimate || !startTime) return null;
    const h = typeof pendingEstimate.h === 'number' ? pendingEstimate.h : 0;
    const m = typeof pendingEstimate.m === 'number' ? pendingEstimate.m : 0;
    const total = h * 60 + m;
    if (total <= 0) return null;
    const startMin = timeStringToMin(startTime)!;
    return minToTimeString(startMin + total);
  }, [pendingEstimate, startTime]);

  function confirmEstimateChange() {
    if (!pendingEstimate) return;
    if (pendingNewEnd) setEndTime(pendingNewEnd);
    setPendingEstimate(null);
  }
  function cancelEstimateChange() {
    const dur = durationMinutesFromRange(startTime, endTime);
    if (dur != null) {
      setEstHours(Math.floor(dur / 60) || (dur < 60 ? 0 : ''));
      setEstMinutes(dur % 60 || (dur >= 60 && dur % 60 === 0 ? 0 : (dur < 60 ? dur : '')));
    }
    setPendingEstimate(null);
  }

  function applySuggestion(s: Suggestion, presetTitle?: string) {
    if (presetTitle) setTitle(presetTitle);
    if (!domain && s.domain) setDomain(s.domain);
    if (priority === 'should' && s.priority) setPriority(s.priority);
    if (estimate === '' && s.duration_minutes) {
      setEstHours(Math.floor(s.duration_minutes / 60) || '');
      setEstMinutes(s.duration_minutes % 60 || '');
    }
    if (!effort && s.effort_level) setEffort(s.effort_level);
    if (!nextAction && s.next_action) setNextAction(s.next_action);
    if (!othersInvolved && (s.involves_others || s.others_rely)) setOthersInvolved(true);
    setOpenA(true);
    setAppliedFor(stem(presetTitle ?? debouncedTitle));
    toast.success('Pre-filled from your past actions.');
  }

  function dismissSuggestion() {
    setDismissed(prev => new Set(prev).add(debouncedStem));
  }

  const heavy = (estimate || 0) >= 90 || effort === 'Heavy';

  function addSub() {
    const t = subInput.trim(); if (!t) return;
    setSubtasks(s => [...s, { id: crypto.randomUUID(), title: t, done: false }]);
    setSubInput('');
  }

  // Section "has value" indicators
  const sectionAHasValue = !!effort || !!estimate || othersInvolved || priority !== 'should';
  const sectionBHasValue = !!scheduledISO || !!deadline;
  const sectionCHasValue = subtasks.length > 0 || !!notes.trim() || !!location.trim();

  async function save() {
    if (!user) return;
    if (!title.trim()) { toast.error('Add a title to start.'); return; }
    if (!categoryChosen) { toast.error('Pick a category.'); return; }
    const isLater = when === 'backlog' && !scheduledISO;
    if (!isLater && (!estimate || Number(estimate) <= 0)) { toast.error('Add a time estimate.'); return; }
    if (scheduledISO && !hasTimeRange) {
      toast.error('Pick a start time for this day.');
      return;
    }
    setBusy(true);
    try {
      const start_time = hasTimeRange && scheduledISO ? `${startTime}:00` : null;
      const end_time = hasTimeRange && scheduledISO ? `${endTime}:00` : null;
      await insert.mutateAsync({
        title: title.trim(),
        domain,
        priority,
        deadline: deadline ? new Date(deadline + 'T23:59:59').toISOString() : null,
        duration_minutes: estimate ? Number(estimate) : null,
        effort_level: effort,
        next_action: nextAction || null,
        notes: notes || null,
        involves_others: othersInvolved,
        subtasks,
        scheduled_date: scheduledISO,
        start_time,
        end_time,
        location: location.trim() || null,
        counts_toward_capacity: countsTowardCapacity,
      } as any);
      toast.success('Captured.');
      nav('/');
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="pace-eyebrow">New action</div>

      <div className="mt-6 space-y-4">
        {/* Recurring templates from past tasks */}
        {templates.length > 0 && title.length === 0 && (
          <div>
            <div className="pace-eyebrow inline-flex items-center gap-1.5 mb-2">
              <Repeat className="w-3 h-3" /> Recurring actions
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {templates.map((t, i) => (
                <button key={i} onClick={() => applySuggestion(t, t.exampleTitle)} className="pace-chip">
                  {t.exampleTitle}
                  <span className="ml-1 text-[10px] text-muted-foreground">×{t.matches}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ALWAYS-VISIBLE: Title */}
        <div>
          <label className="pace-field-label">What needs doing?</label>
          <input className="pace-field" autoFocus value={title} onChange={e => { setTitle(e.target.value); setAppliedFor(null); }} placeholder="e.g. Stats problem set 4" />
        </div>

        {showSuggestion && suggestion && (
          <div className="pace-card-soft border border-primary/20 animate-fade-in">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="pace-eyebrow inline-flex items-center gap-1.5 text-primary">
                  <Sparkles className="w-3 h-3" />
                  {suggestion.source === 'repeating' ? 'Looks familiar' : 'Similar to past actions'}
                </div>
                <div className="text-[13px] text-muted-foreground mt-1">
                  Based on {suggestion.matches} past {suggestion.matches === 1 ? 'action' : 'actions'} like
                  {' '}<span className="text-foreground font-medium">"{suggestion.exampleTitle}"</span>
                </div>
              </div>
              <button onClick={dismissSuggestion} className="p-1 -m-1 rounded-full hover:bg-muted shrink-0" aria-label="Dismiss">
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
            <div className="mt-2 flex gap-1 flex-wrap text-[12px]">
              {suggestion.domain && <span className="pace-chip">Category · {DOMAIN_LABEL[suggestion.domain]}</span>}
              {suggestion.priority && <span className="pace-chip">Priority · {PRIORITY_LABEL[suggestion.priority]}</span>}
              {suggestion.duration_minutes != null && <span className="pace-chip">~ {fmtMin(suggestion.duration_minutes)}</span>}
              {suggestion.effort_level && <span className="pace-chip">Effort · {suggestion.effort_level}</span>}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => applySuggestion(suggestion)} className="pace-btn-primary pace-btn-sm">Use these</button>
              <button onClick={dismissSuggestion} className="pace-btn-ghost pace-btn-sm">Not this time</button>
            </div>
          </div>
        )}

        {/* ALWAYS-VISIBLE: Category */}
        <div>
          <label className="pace-field-label">Category</label>
          <div className="flex flex-wrap gap-1.5">
            {DOMAINS.map(d => (
              <button key={d.k} onClick={() => setDomain(d.k)}
                className={domain === d.k ? 'pace-chip-filled' : 'pace-chip'}>{d.label}</button>
            ))}
            <button onClick={() => setDomain(null)} className={`pace-chip-dashed ${domain === null ? 'opacity-100' : 'opacity-70'}`}>Decide later</button>
          </div>
        </div>

        {/* SECTION A: Priority & Effort */}
        <SectionToggle open={openA} onToggle={() => setOpenA(o => !o)} title="Priority & Effort" hasValue={sectionAHasValue}>
          <div>
            <label className="pace-field-label">Priority</label>
            <div className="flex gap-1.5">
              {(['must','should','could'] as Priority[]).map(p => (
                <button key={p} onClick={() => setPriority(p)}
                  className={priority === p ? 'pace-chip-filled' : 'pace-chip'}>
                  <span className={`priority-dot ${p}`} />{PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="pace-field-label">Effort level (optional)</div>
            <p className="pace-meta mt-1">How much mental or physical effort this requires.</p>
            <div className="flex gap-1.5 mt-1.5">
              {EFFORTS.map(e => (
                <button key={e} onClick={() => setEffort(e === effort ? null : e)}
                  className={effort === e ? 'pace-chip-filled' : 'pace-chip'}>{e}</button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2">
            <label htmlFor="capture-others" className="text-[13px] font-medium inline-flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Involves others
            </label>
            <Switch id="capture-others" checked={othersInvolved} onCheckedChange={setOthersInvolved} />
          </div>
        </SectionToggle>

        {/* SECTION B: Scheduling & Deadline */}
        <SectionToggle open={openB} onToggle={() => setOpenB(o => !o)} title="Scheduling & Deadline" hasValue={sectionBHasValue}>
          <div>
            <label className="pace-field-label">What date would you like to schedule this for?</label>
            <p className="pace-meta mt-0.5 mb-1.5">This is when you plan to work on it.</p>
            <div className="flex gap-1.5 flex-wrap">
              {([
                { k: 'today', label: 'Today' },
                { k: 'tomorrow', label: 'Tomorrow' },
                { k: 'backlog', label: 'Later' },
              ] as const).map(opt => (
                <button key={opt.k} type="button" onClick={() => setWhen(opt.k)}
                  className={when === opt.k ? 'pace-chip-filled' : 'pace-chip'}>
                  {opt.label}
                </button>
              ))}
              <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      when === 'pick' && pickedDate ? 'pace-chip-filled' : 'pace-chip',
                      'inline-flex items-center gap-1.5'
                    )}
                  >
                    <CalendarIcon className="w-3.5 h-3.5" />
                    {when === 'pick' && pickedDate ? format(pickedDate, 'MMM d') : 'Pick a date'}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={pickedDate}
                    onSelect={(d) => {
                      if (d) {
                        setPickedDate(d);
                        setWhen('pick');
                        setDatePopoverOpen(false);
                      }
                    }}
                    initialFocus
                    className={cn('p-3 pointer-events-auto')}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {scheduledISO && (
              <div className="mt-3">
                <label className="pace-field-label">Start time</label>
                <select
                  className="pace-field"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                >
                  <option value="">Select a time…</option>
                  {TIME_OPTIONS.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                {hasTimeRange && (
                  <p className="pace-meta mt-1">Ends at {endTime}.</p>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="pace-field-label">Time estimate</label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="number" min={0} step={1}
                  className="pace-field pr-8"
                  placeholder="Hours"
                  value={estHours}
                  onBlur={checkEstimateOnBlur}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === '') return setEstHours('');
                    const n = Math.max(0, Math.floor(Number(v)));
                    setEstHours(Number.isNaN(n) ? '' : n);
                  }}
                />
                {estHours !== '' && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">h</span>
                )}
              </div>
              <div className="flex-1 relative">
                <input
                  type="number" min={0} max={59} step={1}
                  className="pace-field pr-8"
                  placeholder="Minutes"
                  value={estMinutes}
                  onBlur={checkEstimateOnBlur}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === '') return setEstMinutes('');
                    let n = Math.max(0, Math.floor(Number(v)));
                    if (Number.isNaN(n)) return setEstMinutes('');
                    if (n > 59) n = 59;
                    setEstMinutes(n);
                  }}
                />
                {estMinutes !== '' && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">m</span>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="pace-field-label">Does this have a deadline? (optional)</label>
            <p className="pace-meta mt-0.5 mb-1.5">This is the latest date it must be done by.</p>
            <input type="date" className="pace-field" value={deadline} onChange={e => setDeadline(e.target.value)} />
          </div>
        </SectionToggle>

        {/* SECTION C: Notes & Next Steps */}
        <SectionToggle open={openC} onToggle={() => setOpenC(o => !o)} title="Notes & Next Steps" hasValue={sectionCHasValue}>
          <div>
            <label className="pace-field-label">Next steps (optional)</label>
            <div className="flex gap-2">
              <input className="pace-field" value={subInput}
                onChange={e => setSubInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } }}
                placeholder="Break it into small pieces" />
              <button type="button" onClick={addSub} className="pace-btn px-4"><Plus className="w-4 h-4" /></button>
            </div>
            {subtasks.length > 0 && (
              <ul className="mt-2 space-y-1">
                {subtasks.map(s => (
                  <li key={s.id} className="flex items-center justify-between rounded-xl bg-muted px-3 py-2 text-[14px]">
                    <span>· {s.title}</span>
                    <button onClick={() => setSubtasks(x => x.filter(y => y.id !== s.id))} aria-label="Remove">
                      <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label className="pace-field-label">Notes (optional)</label>
            <textarea className="pace-field min-h-[88px] py-3" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything that helps future-you" />
          </div>

          <div>
            <label className="pace-field-label">Location (optional)</label>
            <input className="pace-field" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Library, home office" />
          </div>
        </SectionToggle>

        {heavy && (
          <div className="pace-alert animate-fade-in">
            <div className="pace-eyebrow mb-1"><span className="priority-dot should" />A heavier one</div>
            Want to break it into smaller pieces, schedule a short rest first, or move it to a fresher morning? You can do all of this later from the action page too.
          </div>
        )}

        <button onClick={save} disabled={busy} className="pace-btn-primary w-full">
          {busy ? 'Saving…' : 'Save action'}
        </button>
        <button onClick={() => nav(-1)} className="pace-btn w-full">Cancel</button>
      </div>

      <AlertDialog open={!!pendingEstimate} onOpenChange={(o) => { if (!o) cancelEstimateChange(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will also move the end time to <span className="font-medium text-foreground">{pendingNewEnd ?? '—'}</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelEstimateChange}>No</AlertDialogCancel>
            <AlertDialogAction onClick={confirmEstimateChange}>Yes, move end time</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Note: `tasks` and `userProfile` references kept for potential conflict checks; underused now. */}
      <span className="hidden">{tasks.length}{userProfile ? '' : ''}</span>
    </AppShell>
  );
}
