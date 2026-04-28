import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import AppShell from '@/components/AppShell';
import { toast } from 'sonner';
import { ArrowRight } from 'lucide-react';

export default function Focus() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as any;
  const initialMinutes: number = loc.state?.minutes ?? 25;
  const taskIdHint: string | undefined = loc.state?.taskId;

  const [task, setTask] = useState<any>(null);
  const [planned, setPlanned] = useState(initialMinutes);
  const [secondsLeft, setSecondsLeft] = useState(initialMinutes * 60);
  const [running, setRunning] = useState(false);
  const [dnd, setDnd] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const tick = useRef<number | null>(null);

  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);

  useEffect(() => {
    if (!user) return;
    const q = supabase.from('tasks').select('*').neq('status', 'done').eq('is_rest', false);
    (taskIdHint
      ? q.eq('id', taskIdHint).maybeSingle()
      : q.order('priority', { ascending: true }).order('deadline', { ascending: true, nullsFirst: false }).limit(1).maybeSingle()
    ).then(({ data }) => setTask(data));
  }, [user, taskIdHint]);

  useEffect(() => {
    if (!running) return;
    tick.current = window.setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) { clearInterval(tick.current!); setRunning(false); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => { if (tick.current) clearInterval(tick.current); };
  }, [running]);

  async function start() {
    if (!user) return;
    if (task && task.status === 'not_started') {
      await supabase.from('tasks').update({ status: 'in_progress' }).eq('id', task.id);
    }
    const { data, error } = await supabase.from('focus_sessions').insert({
      user_id: user.id, task_id: task?.id ?? null, planned_minutes: planned,
    }).select().single();
    if (error) { toast.error(error.message); return; }
    setSessionId(data.id);
    setRunning(true);
  }

  async function finish(outcome: 'completed' | 'more_time' | 'replan') {
    if (sessionId) {
      await supabase.from('focus_sessions').update({ ended_at: new Date().toISOString(), outcome }).eq('id', sessionId);
    }
    if (outcome === 'completed' && task) {
      await supabase.from('tasks').update({ status: 'done', progress: 100 }).eq('id', task.id);
      toast.success('Done. That was real work.');
      nav('/');
    } else if (outcome === 'more_time') {
      setPlanned(p => p + 10);
      setSecondsLeft(10 * 60);
      setSessionId(null);
      setRunning(true);
      toast('+10 minutes. Same task, same next step.');
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

  return (
    <AppShell>
      <div className="pace-eyebrow">Focusing on</div>
      <h1 className="pace-title mt-1">{task?.title ?? 'Pick a task to focus on'}</h1>
      {task?.next_action && (
        <div className="mt-2 text-[13px] text-muted-foreground flex items-start gap-1.5">
          <ArrowRight className="w-3.5 h-3.5 mt-1 shrink-0" />
          <span>{task.next_action}</span>
        </div>
      )}

      <div className="my-8 flex justify-center">
        <div className="relative" style={{ width: ringSize, height: ringSize }}>
          <svg width={ringSize} height={ringSize} className="-rotate-90">
            <circle cx={ringSize/2} cy={ringSize/2} r={r} stroke="hsl(var(--foreground))" strokeOpacity="0.15" strokeWidth={stroke} fill="none" />
            <circle cx={ringSize/2} cy={ringSize/2} r={r}
              stroke="hsl(var(--foreground))" strokeWidth={stroke} fill="none"
              strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 1s linear' }} />
            <circle cx={ringSize/2} cy={ringSize/2} r={r - 14} stroke="hsl(var(--foreground))" strokeOpacity="0.2" strokeWidth="1" strokeDasharray="3 4" fill="none" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="font-display text-[40px] font-semibold tabular-nums tracking-tight">
              {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
              of {String(planned).padStart(2, '0')}:00
            </div>
          </div>
        </div>
      </div>

      {!running && secondsLeft === planned * 60 && (
        <div className="space-y-3">
          <div className="pace-card flex items-center justify-between">
            <div>
              <div className="pace-eyebrow"><span className="priority-dot should" />Do Not Disturb</div>
              <div className="text-[12px] text-muted-foreground mt-1">Notifications paused while you focus.</div>
            </div>
            <button onClick={() => setDnd(d => !d)}
              className={`w-11 h-6 rounded-full border-[1.5px] border-foreground relative transition ${dnd ? 'bg-foreground' : 'bg-background'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full transition ${dnd ? 'right-0.5 bg-background' : 'left-0.5 bg-muted-foreground'}`} />
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

      {running && (
        <button onClick={() => setRunning(false)} className="pace-btn w-full">Pause</button>
      )}

      {!running && secondsLeft < planned * 60 && (
        <div className="space-y-2">
          {secondsLeft > 0 && <button onClick={() => setRunning(true)} className="pace-btn w-full">Resume</button>}
          <div className="pace-card">
            <div className="pace-eyebrow"><span className="priority-dot must" />When time ends</div>
            <div className="mt-2 flex gap-1.5 flex-wrap">
              <button onClick={() => finish('completed')} className="pace-btn-primary pace-btn-sm">Completed</button>
              <button onClick={() => finish('more_time')} className="pace-btn pace-btn-sm">Need more time</button>
              <button onClick={() => finish('replan')} className="pace-btn pace-btn-sm">Replan</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
