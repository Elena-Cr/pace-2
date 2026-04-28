import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import AppShell from '@/components/AppShell';
import { toast } from 'sonner';

export default function Replan() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [carry, setCarry] = useState<any[]>([]);
  const [feeling, setFeeling] = useState<string | null>(null);

  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);

  useEffect(() => {
    if (!user) return;
    const today = new Date().toISOString().slice(0, 10);
    supabase.from('tasks').select('*')
      .neq('status', 'done')
      .lt('scheduled_for', today)
      .order('reschedule_count', { ascending: false })
      .then(({ data }) => setCarry(data ?? []));
  }, [user]);

  async function action(id: string, kind: 'start' | 'reschedule' | 'remove' | 'tiny') {
    const t = carry.find(x => x.id === id);
    if (!t) return;
    if (kind === 'start') {
      nav('/focus', { state: { taskId: id, minutes: 15 } });
      return;
    }
    if (kind === 'remove') {
      await supabase.from('tasks').delete().eq('id', id);
      setCarry(c => c.filter(x => x.id !== id));
      toast.success('Removed. That counts as a decision.');
      return;
    }
    if (kind === 'reschedule') {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      await supabase.from('tasks').update({
        scheduled_for: tomorrow.toISOString().slice(0, 10),
        reschedule_count: (t.reschedule_count || 0) + 1,
        status: 'rescheduled',
      }).eq('id', id);
      setCarry(c => c.filter(x => x.id !== id));
      toast.success('Carried to tomorrow.');
      return;
    }
    if (kind === 'tiny') {
      await supabase.from('tasks').update({
        title: `Tiny: ${t.title}`,
        estimated_minutes: 10,
        scheduled_for: new Date().toISOString().slice(0, 10),
      }).eq('id', id);
      setCarry(c => c.filter(x => x.id !== id));
      toast.success('Made it tiny. Ten minutes is a real start.');
    }
  }

  return (
    <AppShell>
      <h1 className="pace-title">Carrying over</h1>
      <div className="pace-eyebrow mt-1">From earlier · {carry.length} {carry.length === 1 ? 'task' : 'tasks'}</div>

      <div className="mt-5 space-y-3">
        {carry.length === 0 && (
          <div className="pace-card-soft text-sm text-muted-foreground">
            Nothing carrying over. That's worth noticing too.
          </div>
        )}

        {carry.map(t => (
          <div key={t.id} className="space-y-2.5">
            <div className="pace-alert animate-fade-in">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                <span className="priority-dot must" />{t.title} didn't get done
              </div>
              That's okay. What feels right for today?
              <div className="mt-2 flex gap-1.5 flex-wrap">
                <button onClick={() => action(t.id, 'start')} className="pace-btn-primary pace-btn-sm">Start now (15m)</button>
                <button onClick={() => action(t.id, 'tiny')} className="pace-btn pace-btn-sm">Reduce scope</button>
                <button onClick={() => action(t.id, 'reschedule')} className="pace-btn pace-btn-sm">Reschedule</button>
                <button onClick={() => action(t.id, 'remove')} className="pace-btn pace-btn-sm">Remove</button>
              </div>
            </div>

            {(t.reschedule_count ?? 0) >= 2 && (
              <div className="pace-alert">
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  <span className="priority-dot should" />This has moved a few times
                </div>
                No judgment. Want to reconnect with why it matters, or shrink it to something tiny?
                <div className="mt-2 flex gap-1.5">
                  <button className="pace-btn pace-btn-sm">Why it matters</button>
                  <button onClick={() => action(t.id, 'tiny')} className="pace-btn pace-btn-sm">Make it tiny</button>
                </div>
              </div>
            )}
          </div>
        ))}

        {carry.length > 0 && (
          <div className="pace-card mt-2">
            <div className="pace-eyebrow"><span className="priority-dot should" />Quick check-in</div>
            <div className="text-[13px] mt-1">Before we replan — how are you feeling?</div>
            <div className="mt-2 flex gap-1.5 flex-wrap">
              {['Tired','Underestimated it','Waiting on others','Higher priority came up'].map(o => (
                <button key={o} onClick={() => setFeeling(o)}
                  className={feeling === o ? 'pace-chip-filled' : 'pace-chip'}>{o}</button>
              ))}
            </div>
            {feeling && <div className="mt-2 text-[12px] text-muted-foreground">Noted. We'll factor that in.</div>}
          </div>
        )}
      </div>
    </AppShell>
  );
}
