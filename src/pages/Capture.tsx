import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import AppShell from '@/components/AppShell';
import { Domain, Priority, PRIORITY_LABEL, fmtMin, DOMAIN_LABEL, toISODate } from '@/lib/pace';
import { toast } from 'sonner';
import { X, Plus, Sparkles, Repeat } from 'lucide-react';
import { useTaskSuggestions, Suggestion } from '@/hooks/useTaskSuggestions';

const DOMAINS: { k: Domain; label: string }[] = [
  { k: 'academic', label: 'Academic' },
  { k: 'work', label: 'Work' },
  { k: 'social', label: 'Social' },
  { k: 'personal', label: 'Personal' },
];

const ENERGIES = ['Low', 'Med', 'High'];
const EFFORTS = ['Light', 'Moderate', 'Heavy'];

export default function Capture() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [domain, setDomain] = useState<Domain | null>(null);
  const [priority, setPriority] = useState<Priority>('should');
  const [deadline, setDeadline] = useState('');
  const [estimate, setEstimate] = useState<number | ''>('');
  const [energy, setEnergy] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  // difficulty removed — using effort_level only
  const [nextAction, setNextAction] = useState('');
  const [notes, setNotes] = useState('');
  const [involvesOthers, setInvolvesOthers] = useState(false);
  const [othersRely, setOthersRely] = useState(false);
  const [subtasks, setSubtasks] = useState<{ id: string; title: string; done: boolean }[]>([]);
  const [subInput, setSubInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [appliedFor, setAppliedFor] = useState<string | null>(null); // title we last applied a suggestion for
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const { templates, suggestFor } = useTaskSuggestions(user?.id);

  // Debounced live suggestion
  const [debouncedTitle, setDebouncedTitle] = useState(title);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedTitle(title), 250);
    return () => clearTimeout(id);
  }, [title]);

  const suggestion = useMemo(() => suggestFor(debouncedTitle), [debouncedTitle, suggestFor]);
  const showSuggestion = suggestion && appliedFor !== debouncedTitle && !dismissed.has(debouncedTitle);

  function applySuggestion(s: Suggestion, presetTitle?: string) {
    if (presetTitle) setTitle(presetTitle);
    if (!domain && s.domain) setDomain(s.domain);
    if (priority === 'should' && s.priority) setPriority(s.priority);
    if (estimate === '' && s.duration_minutes) setEstimate(s.duration_minutes);
    if (!energy && s.energy) setEnergy(s.energy);
    if (!effort && s.effort_level) setEffort(s.effort_level);
    if (!nextAction && s.next_action) setNextAction(s.next_action);
    if (!involvesOthers && s.involves_others) setInvolvesOthers(true);
    if (!othersRely && s.others_rely) setOthersRely(true);
    setShowAdvanced(true);
    setAppliedFor(presetTitle ?? debouncedTitle);
    toast.success('Pre-filled from your past intentions.');
  }

  function dismissSuggestion() {
    setDismissed(prev => new Set(prev).add(debouncedTitle));
  }

  const heavy = (estimate || 0) >= 90 || effort === 'Heavy';

  function addSub() {
    const t = subInput.trim(); if (!t) return;
    setSubtasks(s => [...s, { id: crypto.randomUUID(), title: t, done: false }]);
    setSubInput('');
  }

  async function save() {
    if (!user) return;
    if (!title.trim()) { toast.error('Just a title is enough to start.'); return; }
    setBusy(true);
    const { toISODate } = await import('@/lib/pace');
    const { error } = await supabase.from('tasks').insert({
      user_id: user.id,
      title: title.trim(),
      domain,
      priority,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      duration_minutes: estimate ? Number(estimate) : null,
      energy,
      effort_level: effort,
      next_action: nextAction || null,
      notes: notes || null,
      involves_others: involvesOthers,
      others_rely: othersRely,
      subtasks: subtasks as any,
      scheduled_date: toISODate(new Date()),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Captured.');
    nav('/');
  }

  return (
    <AppShell>
      <div className="pace-eyebrow">New intention</div>
      <h1 className="pace-screen-title mt-1">Capture</h1>
      <p className="pace-meta mt-1">Just a title is enough — you can estimate later.</p>

      <div className="mt-6 space-y-4">
        {/* Recurring templates from past tasks */}
        {templates.length > 0 && title.length === 0 && (
          <div>
            <div className="pace-eyebrow inline-flex items-center gap-1.5 mb-2">
              <Repeat className="w-3 h-3" /> Recurring intentions
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

        <div>
          <label className="pace-field-label">What needs doing?</label>
          <input className="pace-field" autoFocus value={title} onChange={e => { setTitle(e.target.value); setAppliedFor(null); }} placeholder="e.g. Stats problem set 4" />
        </div>

        {/* Live suggestion based on title */}
        {showSuggestion && suggestion && (
          <div className="pace-card-soft border border-primary/20 animate-fade-in">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="pace-eyebrow inline-flex items-center gap-1.5 text-primary">
                  <Sparkles className="w-3 h-3" />
                  {suggestion.source === 'repeating' ? 'Looks familiar' : 'Similar to past intentions'}
                </div>
                <div className="text-[13px] text-muted-foreground mt-1">
                  Based on {suggestion.matches} past {suggestion.matches === 1 ? 'intention' : 'intentions'} like
                  {' '}<span className="text-foreground font-medium">"{suggestion.exampleTitle}"</span>
                </div>
              </div>
              <button onClick={dismissSuggestion} className="p-1 -m-1 rounded-full hover:bg-muted shrink-0" aria-label="Dismiss">
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
            <div className="mt-2 flex gap-1 flex-wrap text-[12px]">
              {suggestion.domain && <span className="pace-chip">Domain · {DOMAIN_LABEL[suggestion.domain]}</span>}
              {suggestion.priority && <span className="pace-chip">Priority · {PRIORITY_LABEL[suggestion.priority]}</span>}
              {suggestion.duration_minutes != null && <span className="pace-chip">~ {fmtMin(suggestion.duration_minutes)}</span>}
              {suggestion.energy && <span className="pace-chip">Energy · {suggestion.energy}</span>}
              {suggestion.effort_level && <span className="pace-chip">Effort · {suggestion.effort_level}</span>}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => applySuggestion(suggestion)} className="pace-btn-primary pace-btn-sm">Use these</button>
              <button onClick={dismissSuggestion} className="pace-btn-ghost pace-btn-sm">Not this time</button>
            </div>
          </div>
        )}

        <div>
          <label className="pace-field-label">Domain</label>
          <div className="flex flex-wrap gap-1.5">
            {DOMAINS.map(d => (
              <button key={d.k} onClick={() => setDomain(d.k)}
                className={domain === d.k ? 'pace-chip-filled' : 'pace-chip'}>{d.label}</button>
            ))}
            <button onClick={() => setDomain(null)} className={`pace-chip-dashed ${domain === null ? 'opacity-100' : 'opacity-70'}`}>Decide later</button>
          </div>
        </div>

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
          <label className="pace-field-label">Deadline (optional)</label>
          <input type="datetime-local" className="pace-field" value={deadline} onChange={e => setDeadline(e.target.value)} />
        </div>

        <button type="button" onClick={() => setShowAdvanced(s => !s)} className="pace-btn-ghost w-full">
          {showAdvanced ? 'Hide details' : 'Add estimates & details'}
        </button>

        {showAdvanced && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <label className="pace-field-label">Estimates</label>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" min={5} step={5} className="pace-field" placeholder="Time · minutes"
                  value={estimate} onChange={e => setEstimate(e.target.value ? Number(e.target.value) : '')} />
                <select className="pace-field" value={energy ?? ''} onChange={e => setEnergy(e.target.value || null)}>
                  <option value="">Energy · any</option>
                  {ENERGIES.map(x => <option key={x} value={x}>Energy · {x}</option>)}
                </select>
              </div>
              <div className="mt-3">
                <div className="pace-field-label">Effort level</div>
                <div className="flex gap-1.5">
                  {EFFORTS.map(e => (
                    <button key={e} onClick={() => setEffort(e === effort ? null : e)}
                      className={effort === e ? 'pace-chip-filled' : 'pace-chip'}>{e}</button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="pace-field-label">Smallest next action</label>
              <input className="pace-field" value={nextAction} onChange={e => setNextAction(e.target.value)} placeholder="e.g. open the assignment page" />
            </div>

            <div>
              <label className="pace-field-label">Next steps (subtasks)</label>
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

            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setInvolvesOthers(v => !v)}
                className={involvesOthers ? 'pace-chip-filled' : 'pace-chip'}>
                Involves others
              </button>
              <button type="button" onClick={() => setOthersRely(v => !v)}
                className={othersRely ? 'pace-chip-filled' : 'pace-chip'}>
                Others rely on this
              </button>
            </div>

            <div>
              <label className="pace-field-label">Notes (optional)</label>
              <textarea className="pace-field min-h-[88px] py-3" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything that helps future-you" />
            </div>
          </div>
        )}

        {heavy && (
          <div className="pace-alert animate-fade-in">
            <div className="pace-eyebrow mb-1"><span className="priority-dot should" />A heavier one</div>
            Want to break it into smaller pieces, schedule a short rest first, or move it to a fresher morning? You can do all of this later from the task page too.
          </div>
        )}

        <button onClick={save} disabled={busy} className="pace-btn-primary w-full">
          {busy ? 'Saving…' : 'Save intention'}
        </button>
        <button onClick={() => nav(-1)} className="pace-btn w-full">Cancel</button>
      </div>
    </AppShell>
  );
}
