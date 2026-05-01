ALTER TABLE public.tasks ADD COLUMN completed_at TIMESTAMPTZ;
UPDATE public.tasks SET completed_at = updated_at WHERE status = 'done' AND completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON public.tasks(completed_at);