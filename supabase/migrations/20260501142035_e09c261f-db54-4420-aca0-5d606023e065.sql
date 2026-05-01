DROP INDEX IF EXISTS public.idx_tasks_parent;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS parent_task_id;