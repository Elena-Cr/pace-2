import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile, TimeBlock, EnergyPattern, EnergyLevel, DEFAULT_ENERGY_PATTERN } from '@/hooks/useUserProfile';
import { fmtMin } from '@/lib/pace';
import { toast } from 'sonner';
import { ArrowRight, ArrowLeft, Plus, Trash2 } from 'lucide-react';

const ENERGY_LEVELS: EnergyLevel[] = ['Low', 'Med', 'High'];

const DEFAULT_BLOCKS: TimeBlock[] = [
  { label: 'Sleep', start: '23:30', end: '07:30', kind: 'sleep' },
  { label: 'Lunch', start: '12:30', end: '13:00', kind: 'meal' },
  { label: 'Recovery walk', start: '17:00', end: '17:30', kind: 'recovery' },
];

export default function Onboarding() {
  const { user, loading: authLoading, profile: authProfile } = useAuth();
  const { profile, loading, update } = useUserProfile();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [capacityMin, setCapacityMin] = useState(profile?.daily_capacity_minutes ?? 330);
  const [tasksPerDay, setTasksPerDay] = useState(profile?.preferred_tasks_per_day ?? 4);
  const [blocks, setBlocks] = useState<TimeBlock[]>(profile?.default_time_blocks ?? DEFAULT_BLOCKS);
  const [energyPattern, setEnergyPattern] = useState<EnergyPattern>(profile?.energy_pattern ?? DEFAULT_ENERGY_PATTERN);
  const [busy, setBusy] = useState(false);

  // Pre-fill the name from the signup profile once it loads. We don't want
  // to overwrite anything the user has typed, and we also skip the default
  // 'Friend' fallback inserted by the handle_new_user trigger.
  useEffect(() => {
    if (nameTouched) return;
    const dn = authProfile?.display_name;
    if (dn && dn !== 'Friend' && dn !== name) setName(dn);
  }, [authProfile?.display_name, nameTouched, name]);

  // Side-effect navigation runs in an effect, not the render body, so we never
  // briefly render Onboarding for an already-onboarded user (or vice versa).
  useEffect(() => {
    if (authLoading || loading) return;
    if (!user) { nav('/auth', { replace: true }); return; }
    if (profile?.onboarding_completed) { nav('/', { replace: true }); return; }
  }, [authLoading, loading, user, profile, nav]);

  // Render nothing until auth + profile have resolved (prevents flicker).
  if (authLoading || loading || !user || profile?.onboarding_completed) return null;

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
      energy_pattern: energyPattern,
      onboarding_completed: true,
    });
    setBusy(false);
    toast.success('Welcome aboard.');
    nav('/', { replace: true });
  }

  function patchPattern(p: Partial<EnergyPattern>) {
    setEnergyPattern(prev => ({ ...prev, ...p }));
  }

  const steps = [
    {
      eyebrow: '01 · Hello',
      title: 'What should we call you?',
      sub: 'You can change this later in Settings.',
      body: (
        <input
          className="pace-field"
          autoFocus
          value={name}
          onChange={e => { setNameTouched(true); setName(e.target.value); }}
          placeholder="Your name"
        />
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
            type="range" min={60} max={720} step={30}
            value={capacityMin}
            onChange={e => setCapacityMin(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[12px] text-muted-foreground">
            <span>1h</span><span>6h</span><span>12h</span>
          </div>
        </div>
      ),
      canNext: true,
    },
    {
      eyebrow: '03 · Energy (optional)',
      title: 'When do you usually have the most energy?',
      sub: 'You can skip this and set it later in Settings.',
      body: (
        <div className="space-y-3">
          <div className="flex gap-1.5 justify-center">
            <button onClick={() => patchPattern({ mode: 'whole' })}
              className={energyPattern.mode === 'whole' ? 'pace-chip-filled' : 'pace-chip'}>Whole day</button>
            <button onClick={() => patchPattern({ mode: 'period' })}
              className={energyPattern.mode === 'period' ? 'pace-chip-filled' : 'pace-chip'}>By time of day</button>
          </div>
          {energyPattern.mode === 'whole' ? (
            <div className="flex gap-1.5 justify-center">
              {ENERGY_LEVELS.map(e => (
                <button key={e} onClick={() => patchPattern({ whole: e })}
                  className={energyPattern.whole === e ? 'pace-chip-filled' : 'pace-chip'}>{e}</button>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {([['Morning', 'morning'], ['Afternoon', 'afternoon'], ['Evening', 'evening']] as const).map(([label, key]) => {
                const value = energyPattern[key];
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-[12px] text-muted-foreground w-20 shrink-0">{label}</span>
                    <div className="flex gap-1 flex-1">
                      {ENERGY_LEVELS.map(e => (
                        <button key={e}
                          onClick={() => patchPattern({ [key]: value === e ? null : e } as Partial<EnergyPattern>)}
                          className={`flex-1 px-2 py-1 rounded-full text-[12px] font-medium ${value === e ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ),
      canNext: true,
    },
    {
      eyebrow: '05 · Protected time',
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
        {step === 0 && (
          <div className="text-center mb-8 animate-fade-in">
            <div className="text-[40px] font-bold tracking-tight text-primary leading-none">Pace</div>
            <p className="mt-2 text-[14px] text-muted-foreground">A calm planner built for students.</p>
          </div>
        )}

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
