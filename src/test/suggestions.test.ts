import { describe, it, expect } from 'vitest';
import { stem } from '@/hooks/useTaskSuggestions';

describe('Capture suggestion dismissal', () => {
  it('uses stem so dismissal survives small typo or extra char', () => {
    expect(stem('stats prob')).toBe(stem('stats probl'));
  });

  it('strips trailing numeric variants', () => {
    expect(stem('stats problem set 4')).toBe(stem('stats problem set 5'));
  });
});
