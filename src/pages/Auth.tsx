import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export default function Auth() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!loading && user) nav('/', { replace: true }); }, [user, loading, nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: name || email.split('@')[0] },
          },
        });
        if (error) throw error;
        toast.success('Welcome to Pace. Check your email if confirmation is required.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      toast.error(err.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }


  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-10 bg-background">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10 animate-fade-in">
          <div className="text-[13px] font-semibold text-primary mb-3 tracking-tight">Pace</div>
          <h1 className="pace-screen-title">
            Plan with rest,<br/>not around it.
          </h1>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            A calm planner for students. See all your intentions, estimate workload realistically, and replan with care when things change.
          </p>
        </div>

        <form onSubmit={submit} className="pace-card space-y-3.5">
          <div className="flex gap-1 mb-1">
            <button type="button" onClick={() => setMode('signin')}
              className={`pace-chip ${mode === 'signin' ? 'pace-chip-filled' : ''}`}>Sign in</button>
            <button type="button" onClick={() => setMode('signup')}
              className={`pace-chip ${mode === 'signup' ? 'pace-chip-filled' : ''}`}>Create account</button>
          </div>

          {mode === 'signup' && (
            <div>
              <label className="pace-field-label">Your name</label>
              <input className="pace-field" value={name} onChange={e => setName(e.target.value)} placeholder="Sam" />
            </div>
          )}
          <div>
            <label className="pace-field-label">Email</label>
            <input className="pace-field" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div>
            <label className="pace-field-label">Password</label>
            <input className="pace-field" type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <button type="submit" disabled={busy} className="pace-btn-primary w-full mt-1">
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>

        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By continuing, you agree to plan with care for yourself.
        </p>
      </div>
    </div>
  );
}
