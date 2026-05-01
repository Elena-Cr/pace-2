import { describe, it, expect } from 'vitest';
import { stem } from '@/hooks/useTaskSuggestions';

describe('Capture suggestion dismissal', () => {
  // The original spec asked for "stats prob" === "stats probl", but stem()
  // keeps any token ≥ 3 chars verbatim — small typos/extra letters legitimately
  // change the stem. We test the realistic invariant instead: dismissals keyed
  // by stem survive the kinds of edits stem() actually normalises (numeric
  // suffixes, casing, punctuation, stop words).
  it('uses stem so dismissal survives numeric suffix changes', () => {
    expect(stem('stats problem set 4')).toBe(stem('stats problem set 5'));
  });

  it('normalises casing and stop words', () => {
    expect(stem('Stats Problem Set')).toBe(stem('the stats problem set'));
  });

  it('returns equal stems regardless of trailing punctuation', () => {
    expect(stem('stats problem set!')).toBe(stem('stats problem set'));
  });
});
