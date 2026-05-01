import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export type Capacity = {
  user_id: string;
  date: string;
  available_hours: number;
  energy_level: string;
  recovery_notes: string | null;
  // Optional per-time-of-day overrides on top of the daily energy_level.
  morning_energy: string | null;
  afternoon_energy: string | null;
  evening_energy: string | null;
};

const KEY = (userId?: string, date?: string) => ['daily_capacity', userId, date] as const;
const RANGE_KEY = (userId?: string, start?: string, end?: string) =>
  ['daily_capacity_range', userId, start, end] as const;

export function useDailyCapacity(date: string) {
  const { user } = useAuth();
  return useQuery<Capacity | null>({
    queryKey: KEY(user?.id, date),
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_capacity').select('*')
        .eq('user_id', user!.id).eq('date', date).maybeSingle();
      if (error) throw error;
      return (data as Capacity | null) ?? null;
    },
  });
}

export function useDailyCapacityRange(start: string, endExclusive: string) {
  const { user } = useAuth();
  return useQuery<Record<string, Capacity>>({
    queryKey: RANGE_KEY(user?.id, start, endExclusive),
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_capacity').select('*')
        .eq('user_id', user!.id)
        .gte('date', start).lt('date', endExclusive);
      if (error) throw error;
      const map: Record<string, Capacity> = {};
      (data ?? []).forEach((c: any) => { map[c.date] = c as Capacity; });
      return map;
    },
  });
}

export function useUpsertCapacity() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Capacity> & { date: string }) => {
      const { error } = await supabase
        .from('daily_capacity')
        .upsert({ user_id: user!.id, ...payload } as any, { onConflict: 'user_id,date' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['daily_capacity', user?.id] });
      qc.invalidateQueries({ queryKey: ['daily_capacity_range', user?.id] });
    },
  });
}
