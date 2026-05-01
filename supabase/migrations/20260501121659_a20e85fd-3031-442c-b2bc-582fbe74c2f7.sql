
-- 1. Rename canonical columns on tasks
ALTER TABLE public.tasks RENAME COLUMN scheduled_for TO scheduled_date;
ALTER TABLE public.tasks RENAME COLUMN estimated_minutes TO duration_minutes;

-- 2. Add new optional fields
ALTER TABLE public.tasks
  ADD COLUMN start_time time without time zone,
  ADD COLUMN end_time   time without time zone,
  ADD COLUMN parent_task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tasks_parent ON public.tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON public.tasks(user_id, scheduled_date);

-- 3. Drop difficulty (we're keeping effort_level only)
ALTER TABLE public.tasks DROP COLUMN IF EXISTS difficulty;

-- 4. user_profiles table
CREATE TABLE public.user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  daily_capacity_minutes integer NOT NULL DEFAULT 330,
  preferred_tasks_per_day integer NOT NULL DEFAULT 4,
  default_time_blocks jsonb NOT NULL DEFAULT '[
    {"label":"Sleep","start":"23:30","end":"07:30","kind":"sleep"},
    {"label":"Lunch","start":"12:30","end":"13:00","kind":"meal"},
    {"label":"Recovery walk","start":"17:00","end":"17:30","kind":"recovery"}
  ]'::jsonb,
  onboarding_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own user_profile select" ON public.user_profiles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own user_profile insert" ON public.user_profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own user_profile update" ON public.user_profiles
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_user_profiles_touch
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 5. Auto-create user_profile when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1), 'Friend'));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  INSERT INTO public.user_profiles (user_id) VALUES (NEW.id);
  RETURN NEW;
END $$;

-- Backfill profiles for existing users
INSERT INTO public.user_profiles (user_id)
SELECT id FROM auth.users
WHERE id NOT IN (SELECT user_id FROM public.user_profiles);
