import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import AppShell from '@/components/AppShell';
import { Mood, MOOD_LABEL, ReplanReason, REPLAN_REASON_LABEL, todayISO, toISODate } from '@/lib/pace';
import type { Task } from '@/lib/scheduling';
import { toast } from 'sonner';

const MOODS: Mood[] = ['fine','tired','overwhelmed','frustrated','unsure'];

export default function Replan() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [carry, setCarry] = useState<Task[]>([]);
  const [mood, setMood] = useState<Mood | null>(null);
  const [reasonByTask, setReasonByTask] = useState<Record<string, ReplanReason>>({});

  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);

  useEffect(() => {
    if (!user) return;
    supabase.from('tasks').select('*')
      .neq('status', 'done')
      .lt('scheduled_date', todayISO())
      .order('reschedule_count', { ascending: false })
      .then(({ data }) => setCarry(data ?? []));
  }, [user]);

  async function action(id: string, kind: 'start' | 'reschedule' | 'remove' | 'tiny' | 'block') {
    const t = carry.find(x => x.id === id); if (!t) return;
    const reason = reasonByTask[id];
    if (kind === 'start') { nav('/focus', { state: { taskId: id, minutes: 15 } }); return; }
    if (kind === 'remove') {
      await supabase.from('tasks').delete().eq('id', id);
      setCarry(c => c.filter(x => x.id !== id));
      toast.success('Removed. That counts as a decision.');
      return;
    }
    if (kind === 'block') {
      await supabase.from('tasks').update({ status: 'blocked', last_mood: mood, replanning_reason: reason }).eq('id', id);
      setCarry(c => c.filter(x => x.id !== id));
      toast.success('Marked blocked. We\'ll surface it when something unblocks.');
      return;
    }
    if (kind === 'reschedule') {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      await supabase.from('tasks').update({
        scheduled_date: toISODate(tomorrow),
        reschedule_count: (t.reschedule_count || 0) + 1,
        status: 'rescheduled',
        last_mood: mood,
        replanning_reason: reason,
      }).eq('id', id);
      setCarry(c => c.filter(x => x.id !== id));
      toast.success('Carried to tomorrow. Progress preserved.');
      return;
    }
    if (kind === 'tiny') {
      await supabase.from('tasks').update({
        duration_minutes: 10,
        scheduled_date: todayISO(),
        next_action: t.next_action || 'Just open it for 10 minutes',
        last_mood: mood,
        replanning_reason: reason,
      }).eq('id', id);
      setCarry(c => c.filter(x => x.id !== id));
      toast.success('Made it tiny. Ten minutes is a real start.');
    }
  }

  return (
    <AppShell>
      <h1 className="pace-screen-title">Replanning</h1>
      <div className="pace-eyebrow mt-1">From earlier · {carry.length} {carry.length === 1 ? 'task' : 'tasks'} to look at</div>

      {/* Mood check-in */}
      <div className="mt-5 pace-card">
        <div className="pace-section">How are you feeling?</div>
        <div className="text-[13px] text-muted-foreground mt-1">No wrong answer — it just helps shape what we suggest.</div>
        <div className="mt-3 flex gap-1.5 flex-wrap">
          {MOODS.map(m => (
            <button key={m} onClick={() => setMood(m)}
              className={mood === m ? 'pace-chip-filled' : 'pace-chip'}>{MOOD_LABEL[m]}</button>
          ))}
        </div>
        {mood && (mood === 'overwhelmed' || mood === 'tired') && (
          <div className="mt-3 pace-alert">
            That's real. Try one of these: break a task into a 10-minute first step, take a short rest, or move the heaviest thing to a fresher time.
          </div>
        )}
      </div>

      <div className="mt-5 space-y-3">
        {carry.length === 0 && (
          <div className="pace-card-soft text-sm text-muted-foreground">
            Nothing to replan. That's worth noticing too.
          </div>
        )}

        {carry.map(t => {
          const reason = reasonByTask[t.id];
          return (
            <div key={t.id} className="space-y-2.5">
              <div className="pace-card">
                <div className="flex items-center justify-between gap-2">
                  <div className="pace-eyebrow flex items-center"><span className={`priority-dot ${t.priority}`} />{t.title}</div>
                </div>
                <div className="text-[13px] text-muted-foreground mt-1">Needs attention. What would help?</div>

                <div className="mt-3">
                  <div className="pace-eyebrow mb-1.5">Reason (optional)</div>
                  <div className="flex gap-1.5 flex-wrap">
                    {(Object.keys(REPLAN_REASON_LABEL) as ReplanReason[]).map(r => (
                      <button key={r}
                        onClick={() => setReasonByTask(s => ({ ...s, [t.id]: r }))}
                        className={reason === r ? 'pace-chip-filled' : 'pace-chip'}>
                        {REPLAN_REASON_LABEL[r]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-3 flex gap-1.5 flex-wrap">
                  <button onClick={() => action(t.id, 'start')} className="pace-btn-primary pace-btn-sm">Start now (15m)</button>
                  <button onClick={() => action(t.id, 'tiny')} className="pace-btn pace-btn-sm">Reduce to 10m</button>
                  <button onClick={() => action(t.id, 'reschedule')} className="pace-btn pace-btn-sm">Reschedule</button>
                  <button onClick={() => action(t.id, 'block')} className="pace-btn pace-btn-sm">Blocked</button>
                  <button onClick={() => action(t.id, 'remove')} className="pace-btn-ghost pace-btn-sm">Remove</button>
                </div>
              </div>

              {(t.reschedule_count ?? 0) >= 2 && (
                <div className="pace-alert">
                  <div className="pace-eyebrow mb-1">
                    <span className="priority-dot should" />This has moved a few times
                  </div>
                  No judgment. Is it still important, too large, or waiting on something? Maybe try a tiny version.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
