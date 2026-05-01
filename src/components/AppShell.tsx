import { ReactNode } from 'react';
import BottomNav from './BottomNav';

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <main
        className="mx-auto max-w-md sm:max-w-lg lg:max-w-2xl px-5 pt-6 pb-28 lg:my-8 lg:bg-card lg:rounded-2xl lg:border lg:border-border lg:shadow-sm"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.5rem)' }}
      >
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
