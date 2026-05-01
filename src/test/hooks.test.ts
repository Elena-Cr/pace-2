import { describe, it, expect } from 'vitest';
import { useTasks, useTaskMutations } from '@/hooks/useTasks';
import { useDailyCapacity, useUpsertCapacity } from '@/hooks/useDailyCapacity';

describe('hook surface', () => {
  it('exposes useTasks and mutations', () => {
    expect(typeof useTasks).toBe('function');
    expect(typeof useTaskMutations).toBe('function');
  });
  it('exposes capacity hooks', () => {
    expect(typeof useDailyCapacity).toBe('function');
    expect(typeof useUpsertCapacity).toBe('function');
  });
});
