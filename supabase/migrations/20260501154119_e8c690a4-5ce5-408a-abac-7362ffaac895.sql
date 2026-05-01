-- Drop task energy column (we no longer model "required energy" on tasks).
ALTER TABLE public.tasks DROP COLUMN IF EXISTS energy;

-- Extend user_profiles with the typical weekly energy pattern and the
-- capacity-effect knob.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS energy_pattern jsonb NOT NULL DEFAULT
    '{"mode":"whole","whole":"Med","morning":null,"afternoon":null,"evening":null}'::jsonb,
  ADD COLUMN IF NOT EXISTS energy_affects_capacity boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS energy_capacity_pct integer NOT NULL DEFAULT 10;