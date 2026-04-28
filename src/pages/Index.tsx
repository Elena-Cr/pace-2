import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import Home from './Home';

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground font-mono text-xs">Loading…</div>;
  if (!user) return <Navigate to="/auth" replace />;
  return <Home />;
}
