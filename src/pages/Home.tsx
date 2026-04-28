import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import AppShell from '@/components/AppShell';
import TaskCard from '@/components/TaskCard';
import { greeting, todayISO } from '@/lib/pace';
import { toast } from 'sonner';

type Task = any;

export default function Home() {
  const { user, profile, loading } = useAuth();
  const nav = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (!loading && !user) nav('/auth', { replace: true });
  }, [user, loading, nav]);

  useEffect(() => {
    if (!user) return;
    load();
  }, [user]);

  async function load() {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .neq('status', 'done')
      .order('priority', { ascending: true })
      .order('deadline', { ascending: true, nullsFirst: false })
      .limit(50);
    if (error) { toast.error(error.message); return; }
    setTasks(data ?? []);
    const { count } = await supabase.from('tasks').select('id', { count: 'exact', head: true })
      .eq('status', 'done')
      .gte('updated_at', todayISO());
    setDone(count ?? 0);
  }

  const today = new Date();
  const dateStr = today.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const restBlocks = tasks.filter(t => t.is_rest);
  const real = tasks.filter(t => !t.is_rest);

  return (
    <AppShell>
      <div className="pace-eyebrow">{dateStr}</div>
      <h1 className="pace-title mt-1">{greeting()}, {profile?.display_name ?? 'friend'}</h1>
      <div className="pace-eyebrow mt-1">
        {real.length} {real.length === 1 ? 'thing' : 'things'} planned · {restBlocks.length} rest {restBlocks.length === 1 ? 'block' : 'blocks'}
      </div>

      <div className="mt-6 space-y-2.5">
        {real.length === 0 && restBlocks.length === 0 && (
          <div className="pace-card-soft text-sm text-muted-foreground">
            Nothing on the list yet. Tap the <span className="font-semibold text-foreground">＋</span> below to capture your first responsibility — title is the only thing required.
          </div>
        )}

        {tasks.map((t) => t.is_rest ? (
          <div key={t.id} className="pace-rest">
            <span>◯ {t.title}</span>
            <span>{t.next_action ?? ''}</span>
          </div>
        ) : (
          <TaskCard key={t.id} task={t} onOpen={(task) => nav('/focus', { state: { taskId: task.id } })} />
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
