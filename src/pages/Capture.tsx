import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import AppShell from '@/components/AppShell';
import { Domain, Priority } from '@/lib/pace';
import { toast } from 'sonner';

const DOMAINS: { k: Domain; label: string }[] = [
  { k: 'academic', label: 'Academic' },
  { k: 'work', label: 'Work' },
  { k: 'social', label: 'Social' },
  { k: 'personal', label: 'Personal' },
];

const ENERGIES = ['Low', 'Med', 'High'];

export default function Capture() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [domain, setDomain] = useState<Domain | null>(null);
  const [priority, setPriority] = useState<Priority>('should');
  const [deadline, setDeadline] = useState('');
  const [estimate, setEstimate] = useState<number | ''>('');
  const [energy, setEnergy] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<number | null>(null);
  const [nextAction, setNextAction] = useState('');
  const [busy, setBusy] = useState(false);

  const heavy = (difficulty ?? 0) >= 4 || (estimate || 0) >= 90;

  async function save() {
    if (!user) return;
    if (!title.trim()) { toast.error('Give it a title — even a rough one.'); return; }
    setBusy(true);
    const { error } = await supabase.from('tasks').insert({
      user_id: user.id,
      title: title.trim(),
      domain,
      priority,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      estimated_minutes: estimate || null,
      energy,
      difficulty,
      next_action: nextAction || null,
      scheduled_for: new Date().toISOString().slice(0, 10),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Captured.');
    nav('/');
  }

  return (
    <AppShell>
      <div className="pace-eyebrow">New responsibility</div>
      <h1 className="pace-title mt-1">Capture</h1>

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
            <button onClick={() => setDomain(null)} className={`pace-chip-dashed ${domain === null ? 'opacity-100' : 'opacity-70'}`}>Categorize later</button>
          </div>
        </div>

        <div>
          <label className="pace-field-label">Priority</label>
          <div className="flex gap-1.5">
            {(['must','should','could'] as Priority[]).map(p => (
              <button key={p} onClick={() => setPriority(p)}
                className={priority === p ? 'pace-chip-filled' : 'pace-chip'}>
                <span className={`priority-dot ${p}`} />{p}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="pace-field-label">Deadline (optional)</label>
          <input type="datetime-local" className="pace-field" value={deadline} onChange={e => setDeadline(e.target.value)} />
        </div>

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
          <div className="mt-2">
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
          <label className="pace-field-label">Smallest next action (optional)</label>
          <input className="pace-field" value={nextAction} onChange={e => setNextAction(e.target.value)} placeholder="e.g. open the assignment page" />
        </div>

        {heavy && (
          <div className="pace-alert animate-fade-in">
            <div className="pace-eyebrow mb-1">
              <span className="priority-dot should" />Coping suggestions
            </div>
            This looks like a heavy one. Want to break it down, schedule a short rest first, or move it to a fresher morning? You can do that later from the task too.
          </div>
        )}

        <button onClick={save} disabled={busy} className="pace-btn-primary w-full">
          {busy ? 'Saving…' : 'Save responsibility'}
        </button>
        <button onClick={() => nav(-1)} className="pace-btn w-full">Cancel</button>
      </div>
    </AppShell>
  );
}
