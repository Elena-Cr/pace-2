import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTasks, useTaskMutations } from '@/hooks/useTasks';
import AppShell from '@/components/AppShell';
import { type Task, progressForStatus, getTodayTasks } from '@/lib/scheduling';
import { todayISO, DOMAIN_COLOR_VAR, type Domain, fmtMin } from '@/lib/pace';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

import { toast } from 'sonner';
import { ArrowRight } from 'lucide-react';

export default function Focus() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as any;
  const taskIdHint: string | undefined = loc.state?.taskId;

  const { data: allTasks = [] } = useTasks();
  const { update } = useTaskMutations();

  // Pick the focus task: explicit hint, else null so the user picks from a
  // list. (Auto-picking the first open task hid the choice from users.)
  const task = useMemo<Task | null>(() => {
    const candidates = allTasks.filter(t => t.status !== 'done' && !t.is_rest);
    if (taskIdHint) return candidates.find(t => t.id === taskIdHint) ?? null;
    return null;
  }, [allTasks, taskIdHint]);

  // Default session length: if the chosen task has a duration under 2h, use
  // it; otherwise (or with no task) fall back to caller's hint or 25m.
  const taskDefault = task?.duration_minutes && task.duration_minutes > 0 && task.duration_minutes < 120
    ? task.duration_minutes
    : null;
  const initialMinutes: number = taskDefault ?? loc.state?.minutes ?? 25;

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
  // Confirmation gate for switching tasks while a session is running.
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);
  // After "Needs more time" we prompt to optionally reschedule the remainder.
  const [moreTimeReschedule, setMoreTimeReschedule] = useState(false);
  const tick = useRef<number | null>(null);
  const wasRunning = useRef(false);

  // When a new task is chosen (e.g. via the picker) and nothing is running yet,
  // sync the planned length to that task's duration if it's a sensible focus block.
  useEffect(() => {
    if (running) return;
    if (sessionId) return;
    if (taskDefault && planned !== taskDefault) {
      setPlanned(taskDefault);
      setSecondsLeft(taskDefault * 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);

  // Today's open tasks for the in-page picker.
  const todayOpen = useMemo(
    () => getTodayTasks(allTasks, todayISO()).filter(t => t.status !== 'done'),
    [allTasks],
  );

  // True when the timer is at its initial state and no session has started.
  const isIdle = !running && !sessionId && secondsLeft === planned * 60 && !overrunPrompt && !completionCheck && !breakMode;

  function chooseTask(id: string) {
    if (sessionId || running) {
      // A session is in flight — confirm before swapping subjects.
      setPendingSwitchId(id);
      return;
    }
    nav('/focus', { state: { taskId: id }, replace: true });
  }

  function confirmSwitch() {
    const id = pendingSwitchId;
    setPendingSwitchId(null);
    if (!id) return;
    // Drop the running session locally — outcomes are only persisted on
    // explicit complete; a quick switch is treated as a discard.
    setRunning(false);
    setSessionId(null);
    setSecondsLeft(planned * 60);
    nav('/focus', { state: { taskId: id }, replace: true });
  }


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
    // Navigate to Replan with the task pre-selected; the date-picker dialog
    // there is the single place where reschedules actually happen.
    nav('/replan', { state: { taskId: task?.id } });
  }

  async function markBlocked() {
    if (task) await update.mutateAsync({ id: task.id, patch: { status: 'blocked' } as any });
    if (sessionId) await supabase.from('focus_sessions').update({ ended_at: new Date().toISOString(), outcome: 'blocked' }).eq('id', sessionId);
    toast.success('Marked as blocked. We\'ll surface it when something unblocks.');
    nav('/');
  }

  // (Reduce-scope removed — duration is now edited from TaskDetail's Edit form.)


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
      if (task) await update.mutateAsync({ id: task.id, patch: { status: 'blocked' } as any });
      toast.success('Marked as blocked. We\'ll surface it when something unblocks.');
      nav('/');
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
        <div className="relative" style={{ width: ringSize, height: ringSize }}
          role="timer"
          aria-live="polite"
          aria-atomic="true"
          aria-label={`${mins} minutes ${secs} seconds remaining of ${planned} minute ${breakMode ? 'break' : 'focus session'}`}>
          <svg width={ringSize} height={ringSize} className="-rotate-90" aria-hidden="true">
            <circle cx={ringSize/2} cy={ringSize/2} r={r} stroke="hsl(var(--foreground))" strokeOpacity="0.1" strokeWidth={stroke} fill="none" />
            <circle cx={ringSize/2} cy={ringSize/2} r={r}
              stroke={ringColor} strokeWidth={stroke} fill="none"
              strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 1s linear' }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
            <div className="text-[44px] font-semibold tabular-nums tracking-tight">
              {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
            </div>
            <div className="pace-eyebrow mt-1">of {String(planned).padStart(2, '0')}:00</div>
          </div>
        </div>
      </div>

      {/* Task picker — shown while idle so the user can switch what they're
          focusing on without leaving Focus. While a session is running we
          gate switches behind a confirm dialog (confirmSwitch). */}
      {(isIdle || !task) && (
        <div className="pace-card mb-3">
          <div className="flex items-center justify-between">
            <div className="pace-eyebrow">{task ? 'Switch task' : 'Pick a task'}</div>
            <span className="pace-meta">{todayOpen.length} today</span>
          </div>
          {todayOpen.length === 0 ? (
            <div className="mt-2 text-[13px] text-muted-foreground">
              Nothing open on today's plan. Add an intention from Home.
            </div>
          ) : (
            <ul className="mt-2 max-h-48 overflow-y-auto space-y-1 -mx-1 px-1">
              {todayOpen.map(t => {
                const dom = (t.domain || 'personal') as Domain;
                const active = task?.id === t.id;
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => chooseTask(t.id)}
                      className={`w-full text-left flex items-center gap-2 px-2 py-2 rounded-xl border transition ${active ? 'border-primary/50 bg-primary/5' : 'border-border/40 hover:bg-muted/40'}`}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: DOMAIN_COLOR_VAR[dom] }} />
                      <span className="text-[14px] truncate flex-1 min-w-0">{t.title}</span>
                      {t.duration_minutes != null && (
                        <span className="text-[11px] text-muted-foreground shrink-0">{fmtMin(t.duration_minutes)}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

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
            <button onClick={reschedule} className="pace-btn">Reschedule</button>
            <button onClick={() => { setOverrunPrompt(false); setCompletionCheck(true); }} className="pace-btn">Mark blocked</button>
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

      {running && !overrunPrompt && !breakMode && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={pause} className="pace-btn">Pause</button>
          <button onClick={() => setCompletionCheck(true)} className="pace-btn-primary">Finish session</button>
        </div>
      )}

      {breakMode && running && (
        <div className="pace-card animate-fade-in">
          <div className="pace-section">On a 5-minute break</div>
          <div className="text-[13px] text-muted-foreground mt-1">Stand up, drink water. We'll come back to {task?.title ?? 'your task'} after.</div>
          <button onClick={() => { setRunning(false); setBreakMode(false); setSecondsLeft(planned * 60); }}
            className="pace-btn pace-btn-sm mt-3">Skip break</button>
        </div>
      )}

      {!running && !overrunPrompt && secondsLeft < planned * 60 && !completionCheck && (
        <div className="space-y-2">
          {secondsLeft > 0 && <button onClick={() => setRunning(true)} className="pace-btn w-full">Resume</button>}
          <button onClick={() => setCompletionCheck(true)} className="pace-btn-primary w-full">Finish session</button>
        </div>
      )}

      {completionCheck && (() => {
        // actualMinutes = planned − remaining, rounded up so a 24:30 session
        // reads as "25m" not "24m". Caps at planned (overrun is its own flow).
        const actualMinutes = Math.max(0, Math.min(planned, Math.ceil((planned * 60 - secondsLeft) / 60)));
        return (
          <div className="pace-card animate-fade-in space-y-3">
            <div>
              <div className="pace-section">
                {task
                  ? `You focused for ${actualMinutes}m on ${task.title}. What's the status now?`
                  : `You focused for ${actualMinutes}m. What's the status now?`}
              </div>
              <div className="text-[13px] text-muted-foreground mt-1">
                This updates the task, not just the session.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => complete('completed')} className="pace-btn-primary">Task completed</button>
              <button onClick={() => complete('more_time')} className="pace-btn">Needs more time</button>
              <button onClick={() => complete('replan')} className="pace-btn">Should be replanned</button>
              <button onClick={() => complete('blocked')} className="pace-btn">Blocked</button>
            </div>
          </div>
        );
      })()}

      {/* Switch-task confirmation when a session is in flight. */}
      <Dialog open={!!pendingSwitchId} onOpenChange={(o) => { if (!o) setPendingSwitchId(null); }}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle className="pace-title text-left">Switch task?</DialogTitle>
            <DialogDescription className="text-[13px] text-muted-foreground text-left">
              Your current session will end without being saved. The new task starts fresh.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={() => setPendingSwitchId(null)} className="pace-btn">Keep going</button>
            <button onClick={confirmSwitch} className="pace-btn-primary">Switch</button>
          </div>
        </DialogContent>
      </Dialog>

    </AppShell>
  );
}
