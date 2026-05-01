import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile, TimeBlock } from '@/hooks/useUserProfile';
import { fmtMin } from '@/lib/pace';
import { toast } from 'sonner';
import { ArrowRight, ArrowLeft } from 'lucide-react';

const DEFAULT_BLOCKS: TimeBlock[] = [
  { label: 'Sleep', start: '23:30', end: '07:30', kind: 'sleep' },
  { label: 'Lunch', start: '12:30', end: '13:00', kind: 'meal' },
  { label: 'Recovery walk', start: '17:00', end: '17:30', kind: 'recovery' },
];

export default function Onboarding() {
  const { user, profile: authProfile } = useAuth();
  const { profile, loading, update } = useUserProfile();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(authProfile?.display_name ?? '');
  const [capacityMin, setCapacityMin] = useState(profile?.daily_capacity_minutes ?? 330);
  const [tasksPerDay, setTasksPerDay] = useState(profile?.preferred_tasks_per_day ?? 4);
  const [blocks, setBlocks] = useState<TimeBlock[]>(profile?.default_time_blocks ?? DEFAULT_BLOCKS);
  const [busy, setBusy] = useState(false);

  if (!user) { nav('/auth', { replace: true }); return null; }
  if (loading) return null;
  if (profile?.onboarding_completed) { nav('/', { replace: true }); return null; }

  function setBlock(i: number, patch: Partial<TimeBlock>) {
    setBlocks(b => b.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }

  async function finish() {
    if (!user) return;
    setBusy(true);
    if (name.trim() && name !== authProfile?.display_name) {
      await supabase.from('profiles').update({ display_name: name.trim() }).eq('id', user.id);
    }
    await update({
      daily_capacity_minutes: capacityMin,
      preferred_tasks_per_day: tasksPerDay,
      default_time_blocks: blocks,
      onboarding_completed: true,
    });
    setBusy(false);
    toast.success('Welcome aboard.');
    nav('/', { replace: true });
  }

  const steps = [
    {
      eyebrow: '01 · Hello',
      title: 'What should we call you?',
      sub: 'You can change this later in Settings.',
      body: (
        <input className="pace-field" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
      ),
      canNext: name.trim().length > 0,
    },
    {
      eyebrow: '02 · Capacity',
      title: 'How much real focus time do you have on a typical day?',
      sub: 'Be honest — this is your sustainable pace, not a stretch goal.',
      body: (
        <div className="space-y-3">
          <div className="text-center">
            <div className="text-[28px] font-semibold tabular-nums">{fmtMin(capacityMin)}</div>
            <div className="pace-meta">per day</div>
          </div>
          <input
            type="range" min={60} max={600} step={30}
            value={capacityMin}
            onChange={e => setCapacityMin(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[12px] text-muted-foreground">
            <span>1h</span><span>5h</span><span>10h</span>
          </div>
        </div>
      ),
      canNext: true,
    },
    {
      eyebrow: '03 · Pace',
      title: 'How many intentions feel right per day?',
      sub: 'Most people thrive with 3–5. You can always add more.',
      body: (
        <div className="flex gap-2 justify-center">
          {[2, 3, 4, 5, 6, 8].map(n => (
            <button key={n} onClick={() => setTasksPerDay(n)}
              className={tasksPerDay === n ? 'pace-chip-filled' : 'pace-chip'}>
              {n}
            </button>
          ))}
        </div>
      ),
      canNext: true,
    },
    {
      eyebrow: '04 · Protected time',
      title: 'When do you sleep, eat, and recover?',
      sub: 'These blocks stay protected on your calendar.',
      body: (
        <div className="space-y-2">
          {blocks.map((b, i) => (
            <div key={i} className="pace-card !p-3">
              <div className="pace-eyebrow">{b.label}</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="pace-field-label">Start</label>
                  <input type="time" className="pace-field" value={b.start} onChange={e => setBlock(i, { start: e.target.value })} />
                </div>
                <div>
                  <label className="pace-field-label">End</label>
                  <input type="time" className="pace-field" value={b.end} onChange={e => setBlock(i, { end: e.target.value })} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ),
      canNext: true,
    },
  ];

  const cur = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-md px-5 pt-10 pb-10" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2.5rem)' }}>
        <div className="flex gap-1 mb-6">
          {steps.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition ${i <= step ? 'bg-primary' : 'bg-muted'}`} />
          ))}
        </div>

        <div className="pace-eyebrow">{cur.eyebrow}</div>
        <h1 className="pace-screen-title mt-1">{cur.title}</h1>
        <p className="pace-meta mt-1">{cur.sub}</p>

        <div className="mt-6 animate-fade-in">{cur.body}</div>

        <div className="mt-8 flex gap-2">
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)} className="pace-btn flex-1">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          )}
          {!isLast && (
            <button onClick={() => setStep(s => s + 1)} disabled={!cur.canNext} className="pace-btn-primary flex-1">
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          )}
          {isLast && (
            <button onClick={finish} disabled={busy || !cur.canNext} className="pace-btn-primary flex-1">
              {busy ? 'Saving…' : 'Start using Pace'}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
