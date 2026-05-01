import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Domain, Priority } from '@/lib/pace';

export type PastTask = {
  id: string;
  title: string;
  domain: Domain | null;
  priority: Priority;
  duration_minutes: number | null;
  energy: string | null;
  effort_level: string | null;
  next_action: string | null;
  involves_others: boolean;
  others_rely: boolean;
  created_at: string;
};

export type Suggestion = {
  source: 'similar' | 'repeating';
  matches: number;
  confidence: 'high' | 'med' | 'low';
  exampleTitle: string;
  domain: Domain | null;
  priority: Priority | null;
  duration_minutes: number | null;
  energy: string | null;
  effort_level: string | null;
  next_action: string | null;
  involves_others: boolean;
  others_rely: boolean;
};

const STOPWORDS = new Set([
  'a','an','the','and','or','of','to','for','in','on','at','with','my','your','this','that','is','be','do','it','from','about','by','as','again','today','tomorrow','tonight','week','weekly','monthly'
]);

function tokenize(s: string): string[] {
  return s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

// Strip trailing numbers/parts so "stats problem set 4" → "stats problem set"
export function stem(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(part|week|day|chapter|ch|set|n|no|num|number|wk)?\s*\d+\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a), B = new Set(b);
  let inter = 0;
  A.forEach(x => { if (B.has(x)) inter++; });
  return inter / (A.size + B.size - inter);
}

function median(nums: number[]): number | null {
  const arr = nums.filter(n => n != null && !isNaN(n)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
}

function mode<T>(items: (T | null | undefined)[]): T | null {
  const counts = new Map<T, number>();
  items.forEach(x => { if (x != null) counts.set(x as T, (counts.get(x as T) || 0) + 1); });
  let best: T | null = null, bestN = 0;
  counts.forEach((n, v) => { if (n > bestN) { bestN = n; best = v; } });
  return best;
}

function summarize(group: PastTask[], source: Suggestion['source']): Suggestion {
  const matches = group.length;
  const confidence: Suggestion['confidence'] = matches >= 4 ? 'high' : matches >= 2 ? 'med' : 'low';
  // Pick the most recent example title
  const example = [...group].sort((a, b) => (b.created_at > a.created_at ? 1 : -1))[0];
  return {
    source,
    matches,
    confidence,
    exampleTitle: example.title,
    domain: mode(group.map(g => g.domain)),
    priority: mode(group.map(g => g.priority)),
    duration_minutes: median(group.map(g => g.duration_minutes ?? NaN).filter(n => !isNaN(n))),
    energy: mode(group.map(g => g.energy)),
    effort_level: mode(group.map(g => g.effort_level)),
    next_action: mode(group.map(g => g.next_action)),
    involves_others: group.filter(g => g.involves_others).length > group.length / 2,
    others_rely: group.filter(g => g.others_rely).length > group.length / 2,
  };
}

export function useTaskSuggestions(userId: string | undefined) {
  const [past, setPast] = useState<PastTask[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    supabase.from('tasks')
      .select('id,title,domain,priority,duration_minutes,energy,effort_level,next_action,involves_others,others_rely,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data }) => {
        setPast((data ?? []) as PastTask[]);
        setLoading(false);
      });
  }, [userId]);

  // Repeating templates: group past tasks by stem(title), show those with 2+ occurrences
  const templates = useMemo<Suggestion[]>(() => {
    const groups = new Map<string, PastTask[]>();
    past.forEach(t => {
      const key = stem(t.title);
      if (!key) return;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
    });
    return Array.from(groups.values())
      .filter(g => g.length >= 2)
      .map(g => summarize(g, 'repeating'))
      .sort((a, b) => b.matches - a.matches)
      .slice(0, 6);
  }, [past]);

  // Match by current title input
  function suggestFor(title: string): Suggestion | null {
    const q = title.trim();
    if (q.length < 3 || past.length === 0) return null;
    const qStem = stem(q);
    const qToks = tokenize(q);

    // 1) exact stem match
    const stemHits = past.filter(t => stem(t.title) === qStem);
    if (stemHits.length >= 2) return summarize(stemHits, 'repeating');

    // 2) similar by token overlap
    const scored = past
      .map(t => ({ t, score: jaccard(qToks, tokenize(t.title)) }))
      .filter(x => x.score >= 0.34)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(x => x.t);

    if (scored.length === 0) return null;
    return summarize(scored, scored.length === 1 ? 'similar' : 'similar');
  }

  return { past, templates, suggestFor, loading };
}
