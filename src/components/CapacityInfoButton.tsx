import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// Small info button used next to capacity / overload chips. Explains how
// the daily capacity number is derived so users understand why their day
// reads as Balanced / Close / Over.
export default function CapacityInfoButton({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const dim = size === 'md' ? 'w-4 h-4' : 'w-3.5 h-3.5';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="How is capacity calculated?"
          className="inline-flex items-center justify-center rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition"
        >
          <Info className={dim} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-[12px] leading-relaxed">
        <div className="font-medium text-foreground mb-1">How capacity works</div>
        <p className="text-muted-foreground">
          Your daily capacity is set in Settings. Low energy days subtract a
          percentage from this capacity. High energy days add to it. Medium
          energy keeps it the same as your default. You can adjust your base
          capacity and the energy adjustment percentages in Settings.
        </p>
      </PopoverContent>
    </Popover>
  );
}
