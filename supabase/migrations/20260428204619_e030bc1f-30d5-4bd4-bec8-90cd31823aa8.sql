
-- Extend task_status enum with new states
ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'started';
ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'blocked';
ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'nearly_done';

-- Replanning reason enum
DO $$ BEGIN
  CREATE TYPE public.replan_reason AS ENUM ('too_tired','underestimated','waiting_others','higher_priority','needed_more_time','circumstances_changed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Mood enum for emotion-aware replanning
DO $$ BEGIN
  CREATE TYPE public.mood AS ENUM ('fine','tired','overwhelmed','frustrated','unsure');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Add columns to tasks
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS effort_level text,
  ADD COLUMN IF NOT EXISTS subtasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS replanning_reason public.replan_reason,
  ADD COLUMN IF NOT EXISTS last_mood public.mood,
  ADD COLUMN IF NOT EXISTS others_rely boolean NOT NULL DEFAULT false;

-- Daily capacity table
CREATE TABLE IF NOT EXISTS public.daily_capacity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  date date NOT NULL,
  available_hours numeric NOT NULL DEFAULT 5.5,
  energy_level text NOT NULL DEFAULT 'Med',
  recovery_notes text,
  recovery_rating int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

ALTER TABLE public.daily_capacity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own capacity all" ON public.daily_capacity;
CREATE POLICY "own capacity all" ON public.daily_capacity
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS touch_daily_capacity ON public.daily_capacity;
CREATE TRIGGER touch_daily_capacity BEFORE UPDATE ON public.daily_capacity
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
