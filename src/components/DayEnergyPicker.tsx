import { useState } from 'react';
import { Zap } from 'lucide-react';
import { useUpsertCapacity } from '@/hooks/useDailyCapacity';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

type Energy = 'Low' | 'Med' | 'High';
const LEVELS: Energy[] = ['Low', 'Med', 'High'];
const LABEL: Record<Energy, string> = { Low: 'Low', Med: 'Medium', High: 'High' };

// Tiny pill-style energy picker for a single calendar day. Reads/writes the
// same daily_capacity row used by the rest of the app, so capacity math
// (effectiveCapacityMinutes) automatically picks up the change.
export default function DayEnergyPicker({
  date,
  current,
  availableHours,
  size = 'sm',
}: {
  date: string;
  current: string | null | undefined;
  availableHours?: number;
  size?: 'sm' | 'md';
}) {
  const upsert = useUpsertCapacity();
  const [open, setOpen] = useState(false);
  const value = (current as Energy) ?? 'Med';

  async function set(level: Energy) {
    setOpen(false);
    try {
      await upsert.mutateAsync({
        date,
        energy_level: level,
        // include hours so we don't overwrite to NaN; default if absent
        ...(availableHours != null ? { available_hours: availableHours } : {}),
      });
      toast.success(`Energy set to ${LABEL[level]} for this day`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not update energy.');
    }
  }

  const tone =
    value === 'High' ? 'bg-[hsl(var(--success)/0.18)] text-[hsl(var(--success))]' :
    value === 'Low'  ? 'bg-[hsl(var(--attention)/0.16)] text-[hsl(var(--attention))]' :
                       'bg-muted text-foreground';

  const sizeCls = size === 'md'
    ? 'px-3 py-1 text-[12px]'
    : 'px-2 py-0.5 text-[10px]';

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded-full font-medium ${sizeCls} ${tone} hover:opacity-90`}
          aria-label={`Energy: ${LABEL[value]}. Tap to change.`}
        >
          <Zap className={size === 'md' ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
          {LABEL[value]}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        <DropdownMenuLabel className="text-[11px]">Energy for this day</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LEVELS.map(l => (
          <DropdownMenuItem
            key={l}
            onClick={() => set(l)}
            className={l === value ? 'font-semibold' : ''}
          >
            {LABEL[l]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
