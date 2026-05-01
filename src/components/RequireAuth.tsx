import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

/**
 * Wraps a route to ensure only authenticated users can render it.
 * Logged-out users are redirected to /auth. Returns nothing while auth resolves
 * to avoid flashing protected content.
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground font-mono text-xs">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
