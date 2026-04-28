import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import AppShell from '@/components/AppShell';
import TaskCard from '@/components/TaskCard';
import { greeting, todayISO, Status, STATUS_LABEL } from '@/lib/pace';
import { toast } from 'sonner';

const FILTERS: { k: 'all' | Status; label: string }[] = [
  { k: 'all', label: 'All' },
  { k: 'in_progress', label: STATUS_LABEL.in_progress },
  { k: 'blocked', label: STATUS_LABEL.blocked },
  { k: 'nearly_done', label: STATUS_LABEL.nearly_done },
];

export default function Home() {
  const { user, profile, loading } = useAuth();
  const nav = useNavigate();
  const [tasks, setTasks] = useState<any[]>([]);
  const [missed, setMissed] = useState<any[]>([]);
  const [done, setDone] = useState(0);
  const [filter, setFilter] = useState<'all' | Status>('all');

  useEffect(() => { if (!loading && !user) nav('/auth', { replace: true }); }, [user, loading, nav]);

  useEffect(() => { if (user) load(); }, [user]);

  async function load() {
    const today = todayISO();
    const { data, error } = await supabase
      .from('tasks').select('*')
      .neq('status', 'done')
      .order('priority', { ascending: true })
      .order('deadline', { ascending: true, nullsFirst: false })
      .limit(50);
    if (error) { toast.error(error.message); return; }
    const all = data ?? [];
    setTasks(all.filter(t => !t.scheduled_for || t.scheduled_for >= today));
    setMissed(all.filter(t => t.scheduled_for && t.scheduled_for < today && !t.is_rest));
    const { count } = await supabase.from('tasks').select('id', { count: 'exact', head: true })
      .eq('status', 'done')
      .gte('updated_at', today);
    setDone(count ?? 0);
  }

  async function nudge(id: string, kind: 'start' | 'reschedule' | 'block') {
    if (kind === 'start') { nav('/focus', { state: { taskId: id, minutes: 15 } }); return; }
    const t = missed.find(x => x.id === id); if (!t) return;
    if (kind === 'reschedule') {
      await supabase.from('tasks').update({
        scheduled_for: todayISO(),
        reschedule_count: (t.reschedule_count || 0) + 1,
        status: 'rescheduled',
      }).eq('id', id);
      toast.success('Carried to today.');
    } else {
      await supabase.from('tasks').update({ status: 'blocked' }).eq('id', id);
      toast.success('Marked as blocked. Not your fault.');
    }
    load();
  }

  const today = new Date();
  const dateStr = today.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const restBlocks = tasks.filter(t => t.is_rest);
  const real = tasks.filter(t => !t.is_rest);
  const filtered = filter === 'all' ? real : real.filter(t => t.status === filter);

  return (
    <AppShell>
      <div className="pace-eyebrow">{dateStr}</div>
      <h1 className="pace-screen-title mt-1">{greeting()}, {profile?.display_name ?? 'friend'}</h1>
      <div className="pace-eyebrow mt-1">
        {real.length} {real.length === 1 ? 'thing' : 'things'} planned · {restBlocks.length} rest {restBlocks.length === 1 ? 'block' : 'blocks'}
      </div>

      {missed.length > 0 && (
        <div className="mt-5 space-y-2.5">
          <div className="pace-eyebrow"><span className="priority-dot must" />Needs attention</div>
          {missed.slice(0, 3).map(t => (
            <div key={t.id} className="pace-alert animate-fade-in">
              <div className="text-[14px] font-medium">{t.title}</div>
              <div className="text-[13px] mt-1">This task needs attention. What would help now?</div>
              <div className="mt-2 flex gap-1.5 flex-wrap">
                <button onClick={() => nudge(t.id, 'start')} className="pace-btn-primary pace-btn-sm">Start now</button>
                <button onClick={() => nudge(t.id, 'reschedule')} className="pace-btn pace-btn-sm">Reschedule</button>
                <button onClick={() => nudge(t.id, 'block')} className="pace-btn pace-btn-sm">Mark blocked</button>
                <button onClick={() => nav(`/task/${t.id}`)} className="pace-btn-ghost pace-btn-sm">Open</button>
              </div>
            </div>
          ))}
          {missed.length > 3 && (
            <button onClick={() => nav('/replan')} className="pace-btn-ghost w-full">See {missed.length - 3} more in Replan</button>
          )}
        </div>
      )}

      <div className="mt-6 flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {FILTERS.map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)}
            className={filter === f.k ? 'pace-chip-filled shrink-0' : 'pace-chip shrink-0'}>{f.label}</button>
        ))}
      </div>

      <div className="mt-3 space-y-2.5">
        {filtered.length === 0 && restBlocks.length === 0 && (
          <div className="pace-card-soft text-sm text-muted-foreground">
            Nothing on the list yet. Tap the <span className="font-semibold text-foreground">＋</span> below to capture your first intention — title is the only thing required.
          </div>
        )}

        {filtered.map((t) => (
          <TaskCard key={t.id} task={t} onOpen={(task) => nav(`/task/${task.id}`)} />
        ))}

        {filter === 'all' && restBlocks.map(t => (
          <div key={t.id} className="pace-rest">
            <span>◯ {t.title}</span>
            <span>{t.next_action ?? ''}</span>
          </div>
        ))}

        {done > 0 && (
          <div className="pace-card-soft mt-4 text-[12px] text-muted-foreground">
            ✓ {done} {done === 1 ? 'thing done' : 'things done'} today. Nice pacing.
          </div>
        )}
      </div>
    </AppShell>
  );
}
