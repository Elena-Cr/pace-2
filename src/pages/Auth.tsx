import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
  const [errors, setErrors] = useState<{ email?: string; password?: string; name?: string }>({});

  useEffect(() => { if (!loading && user) nav('/', { replace: true }); }, [user, loading, nav]);

  function validate(): boolean {
    const e: typeof errors = {};
    if (!email.trim()) e.email = 'Enter your email.';
    else if (!/^\S+@\S+\.\S+$/.test(email)) e.email = 'That email looks off.';
    if (!password) e.password = 'Enter a password.';
    else if (password.length < 6) e.password = 'At least 6 characters.';
    if (mode === 'signup' && !name.trim()) e.name = 'A name helps us greet you.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
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

  async function forgotPassword() {
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
      setErrors(e => ({ ...e, email: 'Enter your email above first.' }));
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      toast.success('Check your email for a reset link.');
    } catch (err: any) {
      toast.error(err.message ?? 'Could not send reset email.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-10 bg-background">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8 animate-fade-in">
          <div className="text-[40px] font-bold tracking-tight text-primary leading-none">Pace</div>
          <p className="mt-2 text-[14px] text-muted-foreground">A calm planner built for students.</p>
        </div>

        <form onSubmit={submit} className="pace-card space-y-3.5" noValidate>
          <div className="flex gap-1 mb-1" role="tablist" aria-label="Authentication mode">
            <button type="button" role="tab" aria-selected={mode === 'signin'}
              onClick={() => { setMode('signin'); setErrors({}); }}
              className={`flex-1 ${mode === 'signin' ? 'pace-chip-filled justify-center' : 'pace-chip justify-center'}`}>Sign in</button>
            <button type="button" role="tab" aria-selected={mode === 'signup'}
              onClick={() => { setMode('signup'); setErrors({}); }}
              className={`flex-1 ${mode === 'signup' ? 'pace-chip-filled justify-center' : 'pace-chip justify-center'}`}>Sign up</button>
          </div>

          {mode === 'signup' && (
            <div>
              <label className="pace-field-label">Your name</label>
              <input className="pace-field" value={name} onChange={e => setName(e.target.value)} placeholder="Sam" />
              {errors.name && <p className="mt-1 text-[12px] text-destructive">{errors.name}</p>}
            </div>
          )}
          <div>
            <label className="pace-field-label">Email</label>
            <input className="pace-field" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
            {errors.email && <p className="mt-1 text-[12px] text-destructive">{errors.email}</p>}
          </div>
          <div>
            <label className="pace-field-label">Password</label>
            <input className="pace-field" type="password" minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            {errors.password && <p className="mt-1 text-[12px] text-destructive">{errors.password}</p>}
          </div>
          <button type="submit" disabled={busy} className="pace-btn-primary w-full mt-1">
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>

          {mode === 'signin' && (
            <button type="button" onClick={forgotPassword} disabled={busy}
              className="block w-full text-center text-[12px] text-muted-foreground hover:text-foreground transition">
              Forgot password?
            </button>
          )}
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By continuing, you agree to plan with care for yourself.
        </p>
      </div>
    </div>
  );
}
