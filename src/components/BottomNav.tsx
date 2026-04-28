import { NavLink, useLocation } from 'react-router-dom';
import { Home, CalendarDays, Plus, Timer, BarChart3 } from 'lucide-react';

const items = [
  { to: '/', icon: Home, label: 'Today' },
  { to: '/plan', icon: CalendarDays, label: 'Plan' },
  { to: '/capture', icon: Plus, label: '', fab: true },
  { to: '/focus', icon: Timer, label: 'Focus' },
  { to: '/workload', icon: BarChart3, label: 'Workload' },
];

export default function BottomNav() {
  const loc = useLocation();
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur border-t border-border/60"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="mx-auto max-w-md flex items-end justify-around px-3 pt-2 pb-2">
        {items.map((it) => {
          const active = loc.pathname === it.to;
          if (it.fab) {
            return (
              <NavLink key={it.to} to={it.to} aria-label="Capture"
                className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_8px_24px_hsl(var(--primary)/0.35)] transition active:scale-95">
                <Plus className="w-6 h-6" />
              </NavLink>
            );
          }
          const Icon = it.icon;
          return (
            <NavLink key={it.to} to={it.to}
              className={`flex flex-1 flex-col items-center gap-1 py-1.5 ${active ? 'text-primary' : 'text-muted-foreground'}`}>
              <Icon className="w-5 h-5" strokeWidth={active ? 2.2 : 1.8} />
              <span className="text-[11px] font-medium">{it.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
