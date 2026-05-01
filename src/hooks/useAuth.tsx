import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type Profile = { id: string; display_name: string; avatar_url: string | null };

type Ctx = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthCtx = createContext<Ctx>({
  user: null, session: null, profile: null, loading: true, signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (!s?.user) setProfile(null);
      else {
        // defer profile fetch to avoid deadlock
        setTimeout(() => {
          supabase.from('profiles').select('id, display_name, avatar_url').eq('id', s.user.id).maybeSingle()
            .then(({ data }) => setProfile(data as Profile | null));
        }, 0);
      }
    });

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        // Validate the session against the server. If the user was deleted
        // (or the token is otherwise invalid), getUser returns an error and
        // we sign out locally to avoid a stranded "logged-in but no data" state.
        const { data: { user: verified }, error } = await supabase.auth.getUser();
        if (error || !verified) {
          await supabase.auth.signOut();
          setSession(null); setUser(null); setProfile(null);
          setLoading(false);
          return;
        }
        setSession(session);
        setUser(verified);
        supabase.from('profiles').select('id, display_name, avatar_url').eq('id', verified.id).maybeSingle()
          .then(({ data }) => setProfile(data as Profile | null));
      } else {
        setSession(null); setUser(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => { await supabase.auth.signOut(); };

  return <AuthCtx.Provider value={{ user, session, profile, loading, signOut }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
