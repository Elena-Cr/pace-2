import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTasks, useTaskMutations } from '@/hooks/useTasks';
import AppShell from '@/components/AppShell';
import { type Task, progressForStatus, getTodayTasks, buildBlockedPatch } from '@/lib/scheduling';
import { todayISO, DOMAIN_COLOR_VAR, type Domain, type Subtask, fmtMin } from '@/lib/pace';
import { pickCompletionMessage } from '@/lib/completionMessages';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import RescheduleDialog from '@/components/RescheduleDialog';

import { toast } from 'sonner';
import { ArrowRight, ChevronRight, BellOff } from 'lucide-react';

export default function Focus() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as any;
  const taskIdHint: string | undefined = loc.state?.taskId;
  const subtaskIdHint: string | undefined = loc.state?.subtaskId;

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
  const [rescheduleRemainderOpen, setRescheduleRemainderOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  // Count of completed focus_sessions for the current task — drives the
  // "Session N for this action" header. Refreshed when task or sessionId
  // changes (a new session insert means an outcome was just recorded).
  const [completedSessionCount, setCompletedSessionCount] = useState(0);
  // Mid-session break banner: tracks the highest 25-min interval already
  // prompted, so we don't re-show the banner within the same interval.
  const [breakPromptedInterval, setBreakPromptedInterval] = useState(0);
  const [showBreakBanner, setShowBreakBanner] = useState(false);
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

  // Which task in the picker is expanded to show its subtasks.
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  // Currently-focused subtask id (initialised from nav state hint).
  const [activeSubtaskId, setActiveSubtaskId] = useState<string | null>(subtaskIdHint ?? null);

  // Sync activeSubtaskId when the route hint changes (e.g. via chooseTask).
  useEffect(() => { setActiveSubtaskId(subtaskIdHint ?? null); }, [subtaskIdHint, taskIdHint]);

  // Subtasks of the current focus task (live-read so toggles reflect immediately).
  const subtasks: Subtask[] = Array.isArray(task?.subtasks) ? (task!.subtasks as Subtask[]) : [];
  const activeSubtask = subtasks.find(s => s.id === activeSubtaskId) ?? null;

  // True when the timer is at its initial state and no session has started.
  const isIdle = !running && !sessionId && secondsLeft === planned * 60 && !overrunPrompt && !completionCheck && !breakMode;

  function chooseTask(id: string, subId?: string | null) {
    if (sessionId || running) {
      // A session is in flight — confirm before swapping subjects.
      setPendingSwitchId(id);
      return;
    }
    nav('/focus', { state: { taskId: id, subtaskId: subId ?? null }, replace: true });
  }

  async function confirmSwitch() {
    const id = pendingSwitchId;
    setPendingSwitchId(null);
    if (!id) return;
    // Close out the in-flight session as 'switched' so we don't leave
    // orphaned open rows in focus_sessions (Issue L).
    if (sessionId) {
      await supabase.from('focus_sessions').update({
        ended_at: new Date().toISOString(),
        outcome: 'abandoned',
      }).eq('id', sessionId);
    }
    setRunning(false);
    setSessionId(null);
    setSecondsLeft(planned * 60);
    nav('/focus', { state: { taskId: id }, replace: true });
  }

  // Toggle a subtask's done state and persist to the task. Subtask state
  // persists independently of the parent task's overall completion.
  async function toggleSubtask(sid: string) {
    if (!task) return;
    const next = subtasks.map(s => s.id === sid ? { ...s, done: !s.done } : s);
    await update.mutateAsync({ id: task.id, patch: { subtasks: next } as any });
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

  // Count completed focus sessions for the currently focused task. Drives
  // the "Session N for this action" header. Re-runs when the task changes
  // or after a session row is recorded (sessionId transitions).
  useEffect(() => {
    let cancelled = false;
    if (!user || !task?.id) { setCompletedSessionCount(0); return; }
    supabase
      .from('focus_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('task_id', task.id)
      .not('ended_at', 'is', null)
      .then(({ count }) => { if (!cancelled) setCompletedSessionCount(count ?? 0); });
    return () => { cancelled = true; };
  }, [user, task?.id, sessionId, completionCheck]);

  // Reset break banner state whenever a new (non-break) session starts.
  useEffect(() => {
    if (!sessionId || breakMode) return;
    setBreakPromptedInterval(0);
    setShowBreakBanner(false);
  }, [sessionId, breakMode]);

  // Mid-session break prompt: if planned ≥ 45m, show a non-blocking banner
  // every 25 minutes of elapsed focus time. We track the highest interval
  // already prompted so dismissal sticks until the next interval crosses.
  useEffect(() => {
    if (!running || breakMode || planned < 45) return;
    const elapsedMin = Math.floor((planned * 60 - secondsLeft) / 60);
    const interval = Math.floor(elapsedMin / 25);
    if (interval > breakPromptedInterval && elapsedMin > 0 && secondsLeft > 0) {
      setBreakPromptedInterval(interval);
      setShowBreakBanner(true);
    }
  }, [secondsLeft, running, breakMode, planned, breakPromptedInterval]);

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
    if (dnd) {
      toast('Tip: enable Do Not Disturb on your device for a cleaner session.', {
        action: { label: 'Got it', onClick: () => {} },
      });
    }
  }

  async function pause() {
    setRunning(false);
  }

  function reschedule() {
    if (task) setRescheduleOpen(true);
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

  // Called from the completion dialog when the user wants 10 more minutes
  // on the same task. Adds 10 minutes to the timer and resumes without
  // closing the focus state. Reuses continueMore so a fresh row is logged.
  async function extendTen() {
    setCompletionCheck(false);
    await continueMore();
  }

  // Called from the completion dialog "Schedule the rest for later"
  // button. Closes the current session as 'replan' and opens the
  // RescheduleDialog pre-filled with the current task.
  async function scheduleRemainder() {
    setCompletionCheck(false);
    if (sessionId) {
      await supabase.from('focus_sessions').update({
        ended_at: new Date().toISOString(),
        outcome: 'replan',
      }).eq('id', sessionId);
      setSessionId(null);
    }
    if (task) setRescheduleOpen(true);
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
      // Don't navigate away yet — offer a reschedule prompt for the remainder.
      setCompletionCheck(false);
      setMoreTimeReschedule(true);
    } else if (outcome === 'blocked') {
      if (task) await update.mutateAsync({ id: task.id, patch: { status: 'blocked' } as any });
      toast.success('Marked as blocked. We\'ll surface it when something unblocks.');
      nav('/');
    } else {
      // 'replan' outcome: open the reschedule modal instead of navigating away.
      setCompletionCheck(false);
      if (task) setRescheduleOpen(true);
    }
  }

  const totalSec = planned * 60;
  const pct = totalSec ? (totalSec - secondsLeft) / totalSec : 0;
  const ringSize = 220;
  const stroke = 6;
  const r = (ringSize - stroke) / 2;
  const ringStyle = { width: 'min(220px, 80vw)', aspectRatio: '1 / 1' } as const;
  const c = 2 * Math.PI * r;
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  // Active = primary brand colour; paused = muted secondary.
  const ringColor = running ? 'hsl(var(--primary))' : 'hsl(var(--secondary))';

  return (
    <AppShell>
      <div className="pace-eyebrow">Focusing on</div>
      <h1 className="pace-screen-title mt-1">{task?.title ?? 'Pick an action to focus on'}</h1>
      {activeSubtask && (
        <div className="mt-2 text-[14px] flex items-start gap-1.5">
          <ChevronRight className="w-3.5 h-3.5 mt-1 shrink-0 text-primary" />
          <span className={activeSubtask.done ? 'line-through text-muted-foreground' : 'text-foreground'}>
            {activeSubtask.title}
          </span>
        </div>
      )}
      {task?.next_action && !activeSubtask && (
        <div className="mt-2 text-[14px] text-muted-foreground flex items-start gap-1.5">
          <ArrowRight className="w-3.5 h-3.5 mt-1 shrink-0" />
          <span>{task.next_action}</span>
        </div>
      )}

      {/* Session counter — N is completed sessions for this action + 1 for
          the in-progress one. If we know both estimate and session length,
          show an approximate total to help the user pace themselves. */}
      {task && (() => {
        const sessionN = completedSessionCount + 1;
        const estimate = task.duration_minutes ?? 0;
        const approx = estimate > 0 && planned > 0 ? Math.ceil(estimate / planned) : null;
        return (
          <div className="mt-2 text-[12px] text-muted-foreground">
            Session {sessionN} for this action
            {approx != null && approx > 0 && (
              <> — approx. {approx} {approx === 1 ? 'session' : 'sessions'} to complete</>
            )}
          </div>
        );
      })()}

      {/* Mid-session break banner (planned ≥ 45m, every 25 minutes). */}
      {showBreakBanner && running && !breakMode && (
        <div className="mt-3 pace-card-soft animate-fade-in flex items-center gap-2">
          <div className="flex-1 text-[13px]">
            Time for a short break? Pause for 5 minutes.
          </div>
          <button
            onClick={() => { setShowBreakBanner(false); takeBreak(); }}
            className="pace-btn pace-btn-sm">Take break</button>
          <button
            onClick={() => setShowBreakBanner(false)}
            className="pace-btn-ghost pace-btn-sm">Keep going</button>
        </div>
      )}

      <div className="my-8 flex justify-center">
        <div className="relative" style={ringStyle}
          role="timer"
          aria-live="polite"
          aria-atomic="true"
          aria-label={`${mins} minutes ${secs} seconds remaining of ${planned} minute ${breakMode ? 'break' : 'focus session'}`}>
          <svg viewBox={`0 0 ${ringSize} ${ringSize}`} className="-rotate-90 w-full h-full" aria-hidden="true">
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
            <div className="pace-eyebrow">{task ? 'Switch action' : 'Pick an action'}</div>
            <span className="pace-meta">{todayOpen.length} today</span>
          </div>
          {todayOpen.length === 0 ? (
            <div className="mt-2 text-[13px] text-muted-foreground">
              Nothing open on today's plan. Add an action from Home.
            </div>
          ) : (
            <ul className="mt-2 max-h-64 overflow-y-auto space-y-1 -mx-1 px-1">
              {todayOpen.map(t => {
                const dom = (t.domain || 'personal') as Domain;
                const active = task?.id === t.id;
                const subs: Subtask[] = Array.isArray(t.subtasks) ? (t.subtasks as Subtask[]) : [];
                const expanded = expandedTaskId === t.id || (active && subs.length > 0);
                return (
                  <li key={t.id}>
                    <div className={`rounded-xl border transition ${active ? 'border-primary/50 bg-primary/5' : 'border-border/40 hover:bg-muted/40'}`}>
                      <div className="flex items-center gap-1 px-2 py-2">
                        <button
                          onClick={() => chooseTask(t.id, null)}
                          className="text-left flex items-center gap-2 flex-1 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: DOMAIN_COLOR_VAR[dom] }} />
                          <span className="text-[14px] truncate flex-1 min-w-0">{t.title}</span>
                          {t.duration_minutes != null && (
                            <span className="text-[11px] text-muted-foreground shrink-0">{fmtMin(t.duration_minutes)}</span>
                          )}
                        </button>
                        {subs.length > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setExpandedTaskId(expanded ? null : t.id); }}
                            className="pace-btn-ghost pace-btn-sm shrink-0"
                            aria-label={expanded ? 'Hide subtasks' : 'Show subtasks'}
                          >
                            {subs.filter(s => !s.done).length}/{subs.length}
                          </button>
                        )}
                      </div>
                      {expanded && subs.length > 0 && (
                        <ul className="pl-7 pr-2 pb-2 space-y-0.5">
                          {subs.map(s => {
                            const sActive = active && activeSubtaskId === s.id;
                            return (
                              <li key={s.id}>
                                <button
                                  onClick={() => chooseTask(t.id, s.id)}
                                  disabled={s.done}
                                  className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] transition ${sActive ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/60'} ${s.done ? 'opacity-50' : ''}`}>
                                  <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />
                                  <span className={`truncate ${s.done ? 'line-through' : ''}`}>{s.title}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Subtask checklist for the active task — visible whenever a task is
          selected so progress can be ticked off during the session. State
          persists independently of the parent task's overall completion. */}
      {task && subtasks.length > 0 && (
        <div className="pace-card mb-3">
          <div className="flex items-center justify-between">
            <div className="pace-eyebrow">Subtasks</div>
            <span className="pace-meta">{subtasks.filter(s => s.done).length}/{subtasks.length} done</span>
          </div>
          <ul className="mt-2 space-y-1">
            {subtasks.map(s => {
              const sActive = activeSubtaskId === s.id;
              return (
                <li key={s.id} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${sActive ? 'bg-primary/5' : ''}`}>
                  <button
                    onClick={() => toggleSubtask(s.id)}
                    aria-label={s.done ? `Mark ${s.title} not done` : `Mark ${s.title} done`}
                    className={`w-4 h-4 rounded-full border-[1.5px] inline-flex items-center justify-center shrink-0 ${
                      s.done ? 'bg-primary border-primary' : 'border-muted-foreground/40'
                    }`}>
                    {s.done && <span className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />}
                  </button>
                  <button
                    onClick={() => !s.done && setActiveSubtaskId(sActive ? null : s.id)}
                    disabled={s.done}
                    className="text-left flex-1 min-w-0">
                    <span className={`text-[14px] truncate ${s.done ? 'line-through text-muted-foreground' : ''}`}>{s.title}</span>
                  </button>
                  {sActive && !s.done && (
                    <span className="text-[10px] uppercase tracking-wide text-primary shrink-0">Now</span>
                  )}
                </li>
              );
            })}
          </ul>
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
              <div className="pace-eyebrow inline-flex items-center gap-1.5"><BellOff className="w-3.5 h-3.5" />Remind me to enable Do Not Disturb</div>
              <div className="text-[12px] text-muted-foreground mt-1 inline-flex items-center gap-1.5"><BellOff className="w-3 h-3" />We'll remind you to enable Do Not Disturb when you start.</div>
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

          {task ? (
            <button onClick={start} className="pace-btn-primary w-full">Start focus</button>
          ) : (
            <button onClick={() => nav('/capture')} className="pace-btn-primary w-full">Add an action first</button>
          )}
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
              <button onClick={extendTen} className="pace-btn">Extend by 10 minutes</button>
              <button onClick={scheduleRemainder} className="pace-btn">Schedule the rest for later</button>
              <button onClick={() => complete('blocked')} className="pace-btn">Blocked</button>
            </div>
          </div>
        );
      })()}

      {/* Switch-task confirmation when a session is in flight. */}
      <Dialog open={!!pendingSwitchId} onOpenChange={(o) => { if (!o) setPendingSwitchId(null); }}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle className="pace-title text-left">Switch action?</DialogTitle>
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

      {/* "Needs more time" → optional reschedule of the remainder. */}
      <Dialog open={moreTimeReschedule && !!task} onOpenChange={(o) => {
        if (!o) { setMoreTimeReschedule(false); nav('/'); }
      }}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle className="pace-title text-left">Want to reschedule the remainder?</DialogTitle>
            <DialogDescription className="text-[13px] text-muted-foreground text-left">
              You made progress. Pick a day to pick this back up — or carry on as-is.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={() => { setMoreTimeReschedule(false); nav('/'); }} className="pace-btn">Not now</button>
            <button onClick={() => { setMoreTimeReschedule(false); setRescheduleRemainderOpen(true); }} className="pace-btn-primary">Pick a day</button>
          </div>
        </DialogContent>
      </Dialog>

      <RescheduleDialog
        taskId={rescheduleRemainderOpen ? (task?.id ?? null) : null}
        open={rescheduleRemainderOpen}
        onClose={() => { setRescheduleRemainderOpen(false); nav('/'); }}
      />

      <RescheduleDialog
        taskId={rescheduleOpen ? (task?.id ?? null) : null}
        open={rescheduleOpen}
        onClose={() => setRescheduleOpen(false)}
      />

    </AppShell>
  );
}
