import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTasks, useTaskMutations } from '@/hooks/useTasks';
import AppShell from '@/components/AppShell';
import RescheduleDialog from '@/components/RescheduleDialog';
import { Mood, MOOD_LABEL, ReplanReason, todayISO } from '@/lib/pace';
import { getMissed } from '@/lib/scheduling';
import ReplanReasonChips from '@/components/ReplanReasonChips';
import { toast } from 'sonner';

const MOODS: Mood[] = ['fine','tired','overwhelmed','frustrated','unsure'];

export default function Replan() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as any;
  const preselectId: string | undefined = loc.state?.taskId;
  const { data: tasks = [] } = useTasks();
  const { update, remove } = useTaskMutations();
  const [moodByTask, setMoodByTask] = useState<Record<string, Mood>>({});
  const [moodOpen, setMoodOpen] = useState<Record<string, boolean>>({});
  const [reasonByTask, setReasonByTask] = useState<Record<string, ReplanReason>>({});
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const openedFromState = useRef(false);

  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);

  const carry = useMemo(() => {
    return getMissed(tasks, todayISO())
      .slice()
      .sort((a, b) => (b.reschedule_count ?? 0) - (a.reschedule_count ?? 0));
  }, [tasks]);

  useEffect(() => {
    if (preselectId && !openedFromState.current) {
      openedFromState.current = true;
      setRescheduleId(preselectId);
    }
  }, [preselectId]);

  async function action(
    id: string,
    kind: 'start' | 'reschedule' | 'remove' | 'reduce' | 'block' | 'tomorrow_morning' | 'rest_first',
  ) {
    const t = carry.find(x => x.id === id); if (!t) return;
    const reason = reasonByTask[id];
    const mood = moodByTask[id] ?? null;
    if (kind === 'start') { nav('/focus', { state: { taskId: id, minutes: 10 } }); return; }
    if (kind === 'remove') {
      await remove.mutateAsync(id);
      toast.success('Removed. That counts as a decision.');
      return;
    }
    if (kind === 'block') {
      await update.mutateAsync({ id, patch: { status: 'blocked', last_mood: mood, replanning_reason: reason } as any });
      toast.success('Marked blocked. We\'ll surface it when something unblocks.');
      return;
    }
    if (kind === 'reschedule') {
      setRescheduleId(id);
      return;
    }
    if (kind === 'reduce') {
      await update.mutateAsync({ id, patch: {
        duration_minutes: 10,
        scheduled_date: todayISO(),
        next_action: t.next_action || 'Just open it for 10 minutes',
        last_mood: mood,
        replanning_reason: reason,
      } as any });
      toast.success('Made it tiny. Ten minutes is a real start.');
      return;
    }
    if (kind === 'tomorrow_morning') {
      const d = new Date(); d.setDate(d.getDate() + 1);
      const iso = d.toISOString().slice(0, 10);
      await update.mutateAsync({ id, patch: {
        scheduled_date: iso,
        start_time: '09:00',
        last_mood: mood,
        replanning_reason: reason,
      } as any });
      toast.success('Moved to tomorrow morning.');
      return;
    }
    if (kind === 'rest_first') {
      await update.mutateAsync({ id, patch: {
        scheduled_date: todayISO(),
        last_mood: mood,
        replanning_reason: reason,
      } as any });
      toast('Rest first. Decide after.');
      return;
    }
  }

  return (
    <AppShell>
      <h1 className="pace-screen-title">Replanning</h1>
      <div className="pace-eyebrow mt-1">From earlier · {carry.length} {carry.length === 1 ? 'task' : 'tasks'} to look at</div>

      <div className="mt-5 space-y-3">
        {carry.length === 0 && (
          <div className="pace-card-soft text-sm text-muted-foreground">
            Nothing to replan. That's worth noticing too.
          </div>
        )}

        {carry.map(t => {
          const reason = reasonByTask[t.id];
          const mood = moodByTask[t.id] ?? null;
          const open = !!moodOpen[t.id];
          return (
            <div key={t.id} className="space-y-2.5">
              <div className="pace-card">
                <div className="flex items-center justify-between gap-2">
                  <div className="pace-eyebrow flex items-center"><span className={`priority-dot ${t.priority}`} />{t.title}</div>
                </div>
                <div className="text-[13px] text-muted-foreground mt-1">Needs attention. What would help?</div>

                {/* Per-task mood check-in */}
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setMoodOpen(s => ({ ...s, [t.id]: !s[t.id] }))}
                    className="text-[12px] text-primary font-medium"
                  >
                    {open ? 'Hide' : 'How are you feeling about this one?'}
                    {!open && mood && <span className="text-muted-foreground font-normal"> · {MOOD_LABEL[mood]}</span>}
                  </button>
                  {open && (
                    <div className="mt-2 flex gap-1.5 flex-wrap">
                      {MOODS.map(m => (
                        <button key={m} onClick={() => setMoodByTask(s => ({ ...s, [t.id]: m }))}
                          className={mood === m ? 'pace-chip-filled' : 'pace-chip'}>{MOOD_LABEL[m]}</button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-3">
                  <div className="pace-eyebrow mb-1.5">Reason (optional)</div>
                  <ReplanReasonChips
                    selected={reason}
                    onSelect={(r) => setReasonByTask(s => ({ ...s, [t.id]: r }))}
                  />
                </div>

                {/* Mood-adapted coping suggestions */}
                {mood === 'overwhelmed' && (
                  <div className="mt-3 pace-alert">
                    <div className="text-[13px] mb-2">A smaller scope often helps.</div>
                    <div className="flex gap-1.5 flex-wrap">
                      <button onClick={() => action(t.id, 'reduce')} className="pace-btn-primary pace-btn-sm">Try just 10 minutes</button>
                      <button onClick={() => action(t.id, 'rest_first')} className="pace-btn pace-btn-sm">Rest first, then decide</button>
                    </div>
                  </div>
                )}
                {mood === 'tired' && (
                  <div className="mt-3 pace-alert">
                    <div className="text-[13px] mb-2">Lower the bar — fresher energy tomorrow.</div>
                    <div className="flex gap-1.5 flex-wrap">
                      <button onClick={() => action(t.id, 'reduce')} className="pace-btn-primary pace-btn-sm">Reduce to 10m</button>
                      <button onClick={() => action(t.id, 'tomorrow_morning')} className="pace-btn pace-btn-sm">Move to tomorrow morning</button>
                    </div>
                  </div>
                )}
                {mood === 'frustrated' && (
                  <div className="mt-3 pace-alert">
                    <div className="text-[13px] mb-2">When you're stuck, smaller steps or a second pair of eyes can unblock things.</div>
                    <div className="flex gap-1.5 flex-wrap">
                      <button onClick={() => nav(`/task/${t.id}`)} className="pace-btn-primary pace-btn-sm">Break into smaller steps</button>
                      <button onClick={() => action(t.id, 'block')} className="pace-btn pace-btn-sm">Talk to someone who might unblock this</button>
                    </div>
                  </div>
                )}

                <div className="mt-3 flex gap-1.5 flex-wrap">
                  <button onClick={() => action(t.id, 'start')} className="pace-btn-primary pace-btn-sm">Start now (15m)</button>
                  <button onClick={() => action(t.id, 'reduce')} className="pace-btn pace-btn-sm">Reduce to 10m</button>
                  <button onClick={() => action(t.id, 'reschedule')} className="pace-btn pace-btn-sm">Reschedule</button>
                  <button onClick={() => action(t.id, 'block')} className="pace-btn pace-btn-sm">Blocked</button>
                  <button onClick={() => action(t.id, 'remove')} className="pace-btn-ghost pace-btn-sm">Remove</button>
                </div>

                {/* First-step prompt for tasks that have moved without a next action. */}
                {!t.next_action && (t.reschedule_count ?? 0) >= 1 && (
                  <div className="mt-3 pace-card-soft">
                    <div className="text-[13px]">What's the smallest thing you could do first?</div>
                    <FirstStepInput
                      onSave={async (v) => {
                        await update.mutateAsync({ id: t.id, patch: { next_action: v } as any });
                        toast.success('Saved a first step.');
                      }}
                    />
                  </div>
                )}
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

      <RescheduleDialog
        taskId={rescheduleId}
        open={!!rescheduleId}
        onClose={() => setRescheduleId(null)}
        mood={rescheduleId ? (moodByTask[rescheduleId] ?? null) : null}
      />
    </AppShell>
  );
}

function FirstStepInput({ onSave }: { onSave: (v: string) => void | Promise<void> }) {
  const [v, setV] = useState('');
  return (
    <div className="mt-2 flex gap-2">
      <input
        className="pace-field"
        placeholder="e.g. Open the doc"
        value={v}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); const t = v.trim(); if (t) { onSave(t); setV(''); } }
        }}
      />
      <button onClick={() => { const t = v.trim(); if (t) { onSave(t); setV(''); } }} className="pace-btn pace-btn-sm">Save</button>
    </div>
  );
}
