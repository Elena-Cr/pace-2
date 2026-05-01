import { useEffect, useState, useCallback } from 'react';
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

export type UserProfile = {
  id: string;
  user_id: string;
  onboarding_completed: boolean;
  daily_capacity_minutes: number;
  preferred_tasks_per_day: number;
  default_time_blocks: TimeBlock[];
  created_at: string;
  updated_at: string;
};

export function useUserProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) { setProfile(null); setLoading(false); return; }
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    setProfile(data as UserProfile | null);
    setLoading(false);
  }, [user]);

  useEffect(() => { reload(); }, [reload]);

  const update = useCallback(async (patch: Partial<UserProfile>) => {
    if (!user) return;
    const { data, error } = await supabase
      .from('user_profiles')
      .update(patch as any)
      .eq('user_id', user.id)
      .select()
      .single();
    if (!error && data) setProfile(data as UserProfile);
    return { data, error };
  }, [user]);

  return { profile, loading, reload, update };
}
