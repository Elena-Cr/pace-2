import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { rowsToTasks, rowToTask, type Task } from '@/lib/scheduling';

const KEY = (userId?: string) => ['tasks', userId] as const;

export function useTasks() {
  const { user } = useAuth();
  return useQuery<Task[]>({
    queryKey: KEY(user?.id),
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks').select('*')
        .eq('user_id', user!.id)
        .order('priority', { ascending: true })
        .order('deadline', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return rowsToTasks(data ?? []);
    },
  });
}

export function useTask(id: string | undefined) {
  const { user } = useAuth();
  return useQuery<Task | null>({
    queryKey: ['task', user?.id, id],
    enabled: !!user && !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks').select('*').eq('id', id!).maybeSingle();
      if (error) throw error;
      return data ? rowToTask(data) : null;
    },
  });
}

export function useTaskMutations() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: KEY(user?.id) });
    qc.invalidateQueries({ queryKey: ['task', user?.id] });
  };

  const insert = useMutation({
    mutationFn: async (patch: Partial<Task> & { title: string }) => {
      const { data, error } = await supabase.from('tasks')
        .insert({ user_id: user!.id, ...patch } as any)
        .select().single();
      if (error) throw error;
      return rowToTask(data);
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Task> }) => {
      // Auto-stamp completed_at when status transitions to/from done so Home
      // can rely on it rather than the noisier updated_at column.
      const finalPatch: Partial<Task> = { ...patch };
      if (patch.status === 'done' && finalPatch.completed_at === undefined) {
        finalPatch.completed_at = new Date().toISOString();
      } else if (patch.status && patch.status !== 'done' && finalPatch.completed_at === undefined) {
        finalPatch.completed_at = null;
      }
      const { data, error } = await supabase.from('tasks')
        .update(finalPatch as any).eq('id', id).select().single();
      if (error) throw error;
      return rowToTask(data);
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tasks').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { insert, update, remove, invalidate };
}
