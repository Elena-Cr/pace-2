import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import AppShell from '@/components/AppShell';
import { Domain, Priority, PRIORITY_LABEL } from '@/lib/pace';
import { toast } from 'sonner';
import { X, Plus } from 'lucide-react';

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
  const [difficulty, setDifficulty] = useState<number | null>(null);
  const [nextAction, setNextAction] = useState('');
  const [notes, setNotes] = useState('');
  const [involvesOthers, setInvolvesOthers] = useState(false);
  const [othersRely, setOthersRely] = useState(false);
  const [subtasks, setSubtasks] = useState<{ id: string; title: string; done: boolean }[]>([]);
  const [subInput, setSubInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const heavy = (difficulty ?? 0) >= 4 || (estimate || 0) >= 90 || effort === 'Heavy';

  function addSub() {
    const t = subInput.trim(); if (!t) return;
    setSubtasks(s => [...s, { id: crypto.randomUUID(), title: t, done: false }]);
    setSubInput('');
  }

  async function save() {
    if (!user) return;
    if (!title.trim()) { toast.error('Just a title is enough to start.'); return; }
    setBusy(true);
    const buffer = difficulty && difficulty >= 4 ? 0.2 : 0.1;
    const suggested = estimate ? Math.round(estimate * (1 + buffer)) : null;
    const { error } = await supabase.from('tasks').insert({
      user_id: user.id,
      title: title.trim(),
      domain,
      priority,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      estimated_minutes: suggested,
      energy,
      effort_level: effort,
      difficulty,
      next_action: nextAction || null,
      notes: notes || null,
      involves_others: involvesOthers,
      others_rely: othersRely,
      subtasks: subtasks as any,
      scheduled_for: new Date().toISOString().slice(0, 10),
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
        <div>
          <label className="pace-field-label">What needs doing?</label>
          <input className="pace-field" autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Stats problem set 4" />
        </div>

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
              <div className="mt-3">
                <div className="pace-field-label">Difficulty {difficulty ? `· ${difficulty}/5` : ''}</div>
                <div className="flex gap-1.5">
                  {[1,2,3,4,5].map(n => (
                    <button key={n} onClick={() => setDifficulty(n === difficulty ? null : n)}
                      className={difficulty === n ? 'pace-chip-filled' : 'pace-chip'}>{n}</button>
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
