import { describe, it, expectTypeOf } from 'vitest';
import type { Task, Subtask } from '@/lib/scheduling';

describe('Task type', () => {
  it('has Subtask[] for subtasks, not any', () => {
    expectTypeOf<Task['subtasks']>().toEqualTypeOf<Subtask[]>();
  });
  it('has scheduled_date as string | null', () => {
    expectTypeOf<Task['scheduled_date']>().toEqualTypeOf<string | null>();
  });
});
