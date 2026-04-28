import { ReactNode } from 'react';
import BottomNav from './BottomNav';

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <main
        className="mx-auto max-w-md px-5 pt-6 pb-28"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.5rem)' }}
      >
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
