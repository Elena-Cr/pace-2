ALTER TABLE public.daily_capacity
  ADD COLUMN IF NOT EXISTS morning_energy text,
  ADD COLUMN IF NOT EXISTS afternoon_energy text,
  ADD COLUMN IF NOT EXISTS evening_energy text;