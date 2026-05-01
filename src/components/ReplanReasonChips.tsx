import { ReplanReason, REPLAN_REASON_LABEL } from '@/lib/pace';

type Props = {
  selected?: ReplanReason | null;
  onSelect: (reason: ReplanReason) => void;
};

// Single source of truth for replan-reason chip rows.
// Used by Replan.tsx and Calendar.tsx so both surfaces stay in sync
// with REPLAN_REASON_LABEL.
export default function ReplanReasonChips({ selected, onSelect }: Props) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {(Object.keys(REPLAN_REASON_LABEL) as ReplanReason[]).map(r => (
        <button
          key={r}
          type="button"
          onClick={() => onSelect(r)}
          className={selected === r ? 'pace-chip-filled' : 'pace-chip'}
        >
          {REPLAN_REASON_LABEL[r]}
        </button>
      ))}
    </div>
  );
}
