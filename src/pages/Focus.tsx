import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTasks, useTaskMutations } from '@/hooks/useTasks';
import AppShell from '@/components/AppShell';
import { type Task, buildReschedulePatch, progressForStatus } from '@/lib/scheduling';
import { todayISO } from '@/lib/pace';
import { toast } from 'sonner';
import { ArrowRight } from 'lucide-react';

export default function Focus() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as any;
  const initialMinutes: number = loc.state?.minutes ?? 25;
  const taskIdHint: string | undefined = loc.state?.taskId;

  const { data: allTasks = [] } = useTasks();
  const { update } = useTaskMutations();
  const [planned, setPlanned] = useState(initialMinutes);
  const [secondsLeft, setSecondsLeft] = useState(initialMinutes * 60);
  const [running, setRunning] = useState(false);
  const [dnd, setDnd] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [overrunPrompt, setOverrunPrompt] = useState(false);
  const [completionCheck, setCompletionCheck] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  // True while a 5-minute recovery break countdown is running.
  // The visual ring + timer are reused; we just don't show focus controls.
  const [breakMode, setBreakMode] = useState(false);
  const tick = useRef<number | null>(null);
  const wasRunning = useRef(false);

  // Pick the focus task: explicit hint, else first open non-rest task by useTasks ordering.
  const task = useMemo<Task | null>(() => {
    const candidates = allTasks.filter(t => t.status !== 'done' && !t.is_rest);
    if (taskIdHint) return candidates.find(t => t.id === taskIdHint) ?? null;
    return candidates[0] ?? null;
  }, [allTasks, taskIdHint]);

  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);

  useEffect(() => {
    if (!running) return;
    tick.current = window.setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          clearInterval(tick.current!); setRunning(false);
          if (breakMode) {
            // Break finished — return to idle, ready to start another focus.
            setBreakMode(false);
            setSecondsLeft(planned * 60);
            toast('Break done. Ready when you are.');
          } else {
            setOverrunPrompt(true);
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => { if (tick.current) clearInterval(tick.current); };
  }, [running, breakMode, planned]);

  // Distraction recovery — when tab hidden during a running session
  useEffect(() => {
    function onVis() {
      if (document.hidden && running) wasRunning.current = true;
      else if (!document.hidden && wasRunning.current) {
        wasRunning.current = false;
        setInterrupted(true);
      }
    }
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [running]);

  async function start() {
    if (!user) return;
    if (task && task.status === 'not_started') {
      await update.mutateAsync({ id: task.id, patch: { status: 'started' } as any });
    }
    // Reuse an existing open session if one is already in flight (e.g. after
    // continueMore). Otherwise insert a fresh row.
    if (!sessionId) {
      const { data, error } = await supabase.from('focus_sessions').insert({
        user_id: user.id, task_id: task?.id ?? null, planned_minutes: planned,
      }).select().single();
      if (error) { toast.error(error.message); return; }
      setSessionId(data.id);
    }
    setRunning(true);
  }

  async function pause() {
    setRunning(false);
  }

  async function reschedule() {
    if (task) {
      await update.mutateAsync({
        id: task.id,
        patch: buildReschedulePatch(task, task.scheduled_date ?? todayISO()),
      });
    }
    nav('/replan');
  }

  async function markBlocked() {
    if (task) await update.mutateAsync({ id: task.id, patch: { status: 'blocked' } as any });
    if (sessionId) await supabase.from('focus_sessions').update({ ended_at: new Date().toISOString(), outcome: 'blocked' }).eq('id', sessionId);
    toast.success('Marked as blocked. We\'ll surface it when something unblocks.');
    nav('/');
  }

  async function reduceScope() {
    if (task) {
      await update.mutateAsync({ id: task.id, patch: {
        duration_minutes: Math.max(10, Math.round((task.duration_minutes || 30) / 2)),
      } as any });
      toast.success('Scope reduced. Smaller is still real.');
    }
    setOverrunPrompt(false);
    setCompletionCheck(true);
  }

  async function continueMore() {
    setOverrunPrompt(false);
    if (!user) return;
    // Insert the new session BEFORE clearing the previous id, so a failed
    // insert leaves the original session still owned by the UI.
    const { data, error } = await supabase.from('focus_sessions').insert({
      user_id: user.id, task_id: task?.id ?? null, planned_minutes: 10,
    }).select().single();
    if (error) { toast.error(error.message); return; }
    setPlanned(p => p + 10);
    setSecondsLeft(10 * 60);
    setSessionId(data.id);
    setRunning(true);
    toast('+10 minutes. Same task, same next step.');
  }

  async function takeBreak() {
    setOverrunPrompt(false);
    // Close out the focus session as a "more_time" outcome since the user
    // chose to step away rather than finish.
    if (sessionId) await supabase.from('focus_sessions').update({ ended_at: new Date().toISOString(), outcome: 'more_time' }).eq('id', sessionId);
    setSessionId(null);
    toast('Five-minute break. Stand up, drink water.');
    // Run an actual 5-minute countdown via the existing tick effect.
    setBreakMode(true);
    setSecondsLeft(5 * 60);
    setRunning(true);
  }

  async function complete(outcome: 'completed' | 'more_time' | 'replan' | 'blocked') {
    if (sessionId) {
      await supabase.from('focus_sessions').update({
        ended_at: new Date().toISOString(),
        outcome,
      }).eq('id', sessionId);
    }
    if (outcome === 'completed' && task) {
      await update.mutateAsync({ id: task.id, patch: { status: 'done', progress: 100 } as any });
      toast.success('Done. That was real work.');
      nav('/');
    } else if (outcome === 'more_time' && task) {
      // Use the canonical status→progress mapping so we agree with TaskDetail.
      const nextProgress = progressForStatus('in_progress', task.progress || 0);
      await update.mutateAsync({ id: task.id, patch: {
        status: 'in_progress',
        progress: nextProgress,
      } as any });
      nav('/');
    } else if (outcome === 'blocked') {
      await markBlocked();
    } else {
      nav('/replan');
    }
  }

  const totalSec = planned * 60;
  const pct = totalSec ? (totalSec - secondsLeft) / totalSec : 0;
  const ringSize = 220;
  const stroke = 6;
  const r = (ringSize - stroke) / 2;
  const c = 2 * Math.PI * r;
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const ringColor = running ? 'hsl(var(--secondary))' : 'hsl(var(--primary))';

  return (
    <AppShell>
      <div className="pace-eyebrow">Focusing on</div>
      <h1 className="pace-screen-title mt-1">{task?.title ?? 'Pick a task to focus on'}</h1>
      {task?.next_action && (
        <div className="mt-2 text-[14px] text-muted-foreground flex items-start gap-1.5">
          <ArrowRight className="w-3.5 h-3.5 mt-1 shrink-0" />
          <span>{task.next_action}</span>
        </div>
      )}

      <div className="my-8 flex justify-center">
        <div className="relative" style={{ width: ringSize, height: ringSize }}>
          <svg width={ringSize} height={ringSize} className="-rotate-90">
            <circle cx={ringSize/2} cy={ringSize/2} r={r} stroke="hsl(var(--foreground))" strokeOpacity="0.1" strokeWidth={stroke} fill="none" />
            <circle cx={ringSize/2} cy={ringSize/2} r={r}
              stroke={ringColor} strokeWidth={stroke} fill="none"
              strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 1s linear' }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-[44px] font-semibold tabular-nums tracking-tight">
              {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
            </div>
            <div className="pace-eyebrow mt-1">of {String(planned).padStart(2, '0')}:00</div>
          </div>
        </div>
      </div>

      {interrupted && running && (
        <div className="pace-alert mb-3 animate-fade-in">
          <div className="text-[14px] font-medium">Welcome back.</div>
          <div className="text-[13px] mt-1">
            You were working on <span className="font-medium text-foreground">{task?.title ?? 'this task'}</span>
            {task?.next_action && <> — next: <span className="font-medium text-foreground">{task.next_action}</span></>}.
          </div>
          <button onClick={() => setInterrupted(false)} className="pace-btn-ghost pace-btn-sm mt-2">Got it</button>
        </div>
      )}

      {overrunPrompt && (
        <div className="pace-card animate-fade-in space-y-3">
          <div>
            <div className="pace-section">Time's up — continue or adjust?</div>
            <div className="text-[13px] text-muted-foreground mt-1">Both are good answers.</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={continueMore} className="pace-btn-primary">Continue +10m</button>
            <button onClick={takeBreak} className="pace-btn">Take a break</button>
            <button onClick={reduceScope} className="pace-btn">Reduce scope</button>
            <button onClick={reschedule} className="pace-btn">Reschedule</button>
            <button onClick={markBlocked} className="pace-btn col-span-2">Mark blocked</button>
          </div>
        </div>
      )}

      {!running && !overrunPrompt && !completionCheck && secondsLeft === planned * 60 && (
        <div className="space-y-3">
          <div className="pace-card flex items-center justify-between">
            <div>
              <div className="pace-eyebrow"><span className="priority-dot should" />Do Not Disturb</div>
              <div className="text-[12px] text-muted-foreground mt-1">Notifications paused while you focus.</div>
            </div>
            <button onClick={() => setDnd(d => !d)}
              className={`w-11 h-6 rounded-full relative transition ${dnd ? 'bg-primary' : 'bg-muted'}`}>
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-card shadow transition-all ${dnd ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>

          <div className="pace-card">
            <label className="pace-field-label">Session length</label>
            <div className="flex gap-1.5">
              {[15, 25, 45, 60].map(m => (
                <button key={m} onClick={() => { setPlanned(m); setSecondsLeft(m * 60); }}
                  className={planned === m ? 'pace-chip-filled' : 'pace-chip'}>{m}m</button>
              ))}
            </div>
          </div>

          <button onClick={start} disabled={!task} className="pace-btn-primary w-full">
            {task ? 'Start focus' : 'Capture a task first'}
          </button>
        </div>
      )}

      {running && !overrunPrompt && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={pause} className="pace-btn">Pause</button>
          <button onClick={() => setCompletionCheck(true)} className="pace-btn-primary">Finish session</button>
        </div>
      )}

      {!running && !overrunPrompt && secondsLeft < planned * 60 && !completionCheck && (
        <div className="space-y-2">
          {secondsLeft > 0 && <button onClick={() => setRunning(true)} className="pace-btn w-full">Resume</button>}
          <button onClick={() => setCompletionCheck(true)} className="pace-btn-primary w-full">Finish session</button>
        </div>
      )}

      {completionCheck && (
        <div className="pace-card animate-fade-in space-y-3">
          <div>
            <div className="pace-section">What happened with this task?</div>
            <div className="text-[13px] text-muted-foreground mt-1">No wrong answer.</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => complete('completed')} className="pace-btn-primary">Completed</button>
            <button onClick={() => complete('more_time')} className="pace-btn">Needs more time</button>
            <button onClick={() => complete('replan')} className="pace-btn">Should be replanned</button>
            <button onClick={() => complete('blocked')} className="pace-btn">Blocked</button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
