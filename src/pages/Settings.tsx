import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile, TimeBlock } from '@/hooks/useUserProfile';
import AppShell from '@/components/AppShell';
import { fmtMin } from '@/lib/pace';
import { toast } from 'sonner';
import { ArrowLeft, LogOut, Plus, X } from 'lucide-react';

export default function Settings() {
  const { user, profile: authProfile, signOut } = useAuth();
  const { profile, loading, update, reload } = useUserProfile();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [capacityMin, setCapacityMin] = useState(330);
  const [tasksPerDay, setTasksPerDay] = useState(4);
  const [blocks, setBlocks] = useState<TimeBlock[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!user) nav('/auth', { replace: true }); }, [user, nav]);

  useEffect(() => {
    if (authProfile) setName(authProfile.display_name ?? '');
  }, [authProfile]);

  useEffect(() => {
    if (profile) {
      setCapacityMin(profile.daily_capacity_minutes);
      setTasksPerDay(profile.preferred_tasks_per_day);
      setBlocks(profile.default_time_blocks ?? []);
    }
  }, [profile]);

  if (loading || !profile) return null;

  function setBlock(i: number, patch: Partial<TimeBlock>) {
    setBlocks(b => b.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function addBlock() {
    setBlocks(b => [...b, { label: 'New block', start: '09:00', end: '09:30', kind: 'recovery' }]);
  }
  function removeBlock(i: number) {
    setBlocks(b => b.filter((_, idx) => idx !== i));
  }

  async function save() {
    if (!user) return;
    setBusy(true);
    if (name.trim() && name !== authProfile?.display_name) {
      await supabase.from('profiles').update({ display_name: name.trim() }).eq('id', user.id);
    }
    const res = await update({
      daily_capacity_minutes: capacityMin,
      preferred_tasks_per_day: tasksPerDay,
      default_time_blocks: blocks,
    });
    setBusy(false);
    if (res?.error) { toast.error(res.error.message); return; }
    toast.success('Settings saved.');
    reload();
  }

  async function handleSignOut() {
    await signOut();
    nav('/auth', { replace: true });
  }

  return (
    <AppShell>
      <button onClick={() => nav(-1)} className="pace-btn-ghost pace-btn-sm -ml-2 mb-2">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <h1 className="pace-screen-title">Settings</h1>
      <p className="pace-meta mt-1">Tune Pace to your real rhythm.</p>

      <div className="mt-6 space-y-5">
        <section className="pace-card">
          <div className="pace-eyebrow">Profile</div>
          <div className="mt-3">
            <label className="pace-field-label">Display name</label>
            <input className="pace-field" value={name} onChange={e => setName(e.target.value)} />
          </div>
        </section>

        <section className="pace-card">
          <div className="pace-eyebrow">Daily capacity</div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-[24px] font-semibold tabular-nums">{fmtMin(capacityMin)}</span>
            <span className="pace-meta">per day</span>
          </div>
          <input
            type="range" min={60} max={720} step={30}
            value={capacityMin}
            onChange={e => setCapacityMin(Number(e.target.value))}
            className="w-full accent-primary mt-2"
          />
        </section>

        <section className="pace-card">
          <div className="pace-eyebrow">Preferred intentions per day</div>
          <div className="mt-3 flex gap-2 flex-wrap">
            {[2, 3, 4, 5, 6, 8].map(n => (
              <button key={n} onClick={() => setTasksPerDay(n)}
                className={tasksPerDay === n ? 'pace-chip-filled' : 'pace-chip'}>
                {n}
              </button>
            ))}
          </div>
        </section>

        <section className="pace-card">
          <div className="flex items-center justify-between">
            <div className="pace-eyebrow">Protected time blocks</div>
            <button onClick={addBlock} className="pace-btn-ghost pace-btn-sm"><Plus className="w-3.5 h-3.5" /> Add</button>
          </div>
          <div className="mt-3 space-y-2">
            {blocks.map((b, i) => (
              <div key={i} className="rounded-xl bg-muted p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    className="pace-field flex-1"
                    value={b.label}
                    onChange={e => setBlock(i, { label: e.target.value })}
                    placeholder="Label"
                  />
                  <button onClick={() => removeBlock(i)} aria-label="Remove" className="p-2 rounded-lg hover:bg-background">
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="pace-field-label">Start</label>
                    <input type="time" className="pace-field" value={b.start} onChange={e => setBlock(i, { start: e.target.value })} />
                  </div>
                  <div>
                    <label className="pace-field-label">End</label>
                    <input type="time" className="pace-field" value={b.end} onChange={e => setBlock(i, { end: e.target.value })} />
                  </div>
                  <div>
                    <label className="pace-field-label">Kind</label>
                    <select className="pace-field" value={b.kind} onChange={e => setBlock(i, { kind: e.target.value as TimeBlock['kind'] })}>
                      <option value="sleep">Sleep</option>
                      <option value="meal">Meal</option>
                      <option value="recovery">Recovery</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
            {blocks.length === 0 && (
              <div className="text-sm text-muted-foreground">No protected time yet. Add sleep, meals, or recovery blocks.</div>
            )}
          </div>
        </section>

        <button onClick={save} disabled={busy} className="pace-btn-primary w-full">
          {busy ? 'Saving…' : 'Save settings'}
        </button>

        <button onClick={handleSignOut} className="pace-btn w-full">
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </div>
    </AppShell>
  );
}
