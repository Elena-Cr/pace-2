import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export type TimeBlock = {
  label: string;
  start: string;       // 'HH:MM'
  end: string;         // 'HH:MM'
  kind: 'sleep' | 'meal' | 'recovery' | 'custom';
  // Optional weekday filter. 0 = Mon … 6 = Sun. Absent or empty = applies
  // every day (backwards compatible with existing rows that lack this field).
  days?: number[];
};

export type EnergyLevel = 'Low' | 'Med' | 'High';

// User's typical pattern. `mode: 'whole'` uses `whole`. `mode: 'period'`
// uses morning/afternoon/evening (each may fall back to `whole` if null).
export type EnergyPattern = {
  mode: 'whole' | 'period';
  whole: EnergyLevel;
  morning: EnergyLevel | null;
  afternoon: EnergyLevel | null;
  evening: EnergyLevel | null;
};

export const DEFAULT_ENERGY_PATTERN: EnergyPattern = {
  mode: 'whole',
  whole: 'Med',
  morning: null,
  afternoon: null,
  evening: null,
};

export type UserProfile = {
  id: string;
  user_id: string;
  onboarding_completed: boolean;
  daily_capacity_minutes: number;
  preferred_tasks_per_day: number;
  default_time_blocks: TimeBlock[];
  energy_pattern: EnergyPattern;
  energy_affects_capacity: boolean;
  energy_capacity_pct: number;
  created_at: string;
  updated_at: string;
};

function coerceProfile(row: any): UserProfile | null {
  if (!row) return null;
  const blocks = Array.isArray(row.default_time_blocks) ? row.default_time_blocks : [];
  const pat = (row.energy_pattern && typeof row.energy_pattern === 'object')
    ? { ...DEFAULT_ENERGY_PATTERN, ...row.energy_pattern }
    : DEFAULT_ENERGY_PATTERN;
  return {
    ...row,
    default_time_blocks: blocks as TimeBlock[],
    energy_pattern: pat as EnergyPattern,
    energy_affects_capacity: row.energy_affects_capacity ?? true,
    energy_capacity_pct: row.energy_capacity_pct ?? 10,
  } as UserProfile;
}

export function useUserProfile() {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['userProfile', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId!)
        .maybeSingle();
      if (error) throw error;
      return coerceProfile(data);
    },
  });

  const mutation = useMutation({
    mutationFn: async (patch: Partial<UserProfile>) => {
      if (!userId) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('user_profiles')
        .update(patch as any)
        .eq('user_id', userId)
        .select()
        .single();
      if (error) throw error;
      return { data: coerceProfile(data), error: null as any };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userProfile', userId] });
    },
  });

  const update = useCallback(async (patch: Partial<UserProfile>) => {
    try {
      return await mutation.mutateAsync(patch);
    } catch (error: any) {
      return { data: null, error };
    }
  }, [mutation]);

  const reload = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['userProfile', userId] });
  }, [queryClient, userId]);

  return {
    profile: query.data ?? null,
    loading: !!userId && query.isLoading,
    error: query.error,
    update,
    reload,
  };
}
